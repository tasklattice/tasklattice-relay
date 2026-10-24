import { databaseAgentCatalog } from "../agent-garden/database-agent-catalog";
import { randomUUID } from "node:crypto";
import { encryptPlatformSecret } from "../platform/platform-secret-crypto";
import { AgentGardenStore } from "../agent-garden/agent-garden-store";
import { AgentGardenService } from "../agent-garden/agent-garden-service";
import type { ManagedAgentRuntimeClient, ManagedAgentRuntimeInput } from "../kubernetes/managed-agent-runtime-client";
import { ResourceOperationService } from "./resource-operation-service";
import { hasA2aInstanceDeletedSinceOperation } from "../agent-garden/a2a-lifecycle-queries";
import { lockProjectRow } from "./project-row-lock";
import { runResourceOperation } from "../workers/resource-operation-task";
import type { ControlJobMetadata } from "../jobs/control-job-queue";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { developmentControlConfig, getControlConfig, setControlConfigForTests } from "../config/control-config";
import { PgBossControlJobQueue, CONTROL_JOB_QUEUES } from "../jobs/control-job-queue";
import { ProjectService } from "./project-service";
import { ProjectRuntimeTargetService } from "./project-runtime-target-service";
import { ProjectRuntimeStatusService } from "./project-runtime-status";
import { ProjectDeletionService } from "./project-deletion-service";
import type { PlatformPrincipal } from "../auth/auth";

const url = process.env.ASYNC_PROJECT_DATABASE_URL;
describe.skipIf(!url)("Project initialization on PostgreSQL", () => {
  let db: PrismaClient;
  let jobs: PgBossControlJobQueue;
  let projectId: string;
  const auth: PlatformPrincipal = { user: { id: "local-admin", username: "admin", email: "admin@tasklattice.local",
    displayName: "Administrator", systemRole: "platform_administrator", hasPassword: true } };
  beforeAll(async () => {
    const config = developmentControlConfig(); config.database.url = url!; config.runtime_namespaces.enabled = true;
    setControlConfigForTests(config);
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    jobs = new PgBossControlJobQueue(); await jobs.start();
  });
  afterAll(async () => { await jobs?.stop(); await db?.$disconnect(); setControlConfigForTests(undefined); });

  it("commits the task and all initial data atomically, then rolls both back on enqueue failure", async () => {
    const service = new ProjectService(db, undefined, undefined, jobs);
    const created = await service.create(auth, "dep1", "Async integration", [], "platform");
    projectId = created.id;
    expect(projectId).toMatch(/^tp-[a-z2-7]{13}$/);
    expect(created.initialization?.status).toBe("pending");
    expect(await db.projectRuntimeTarget.findUnique({ where: { projectId } })).toMatchObject({ status: "pending", namespace: projectId });
    const tasks = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT count(*) FROM tali_control_jobs.job WHERE name=$1 AND data->>\'projectId\'=$2', CONTROL_JOB_QUEUES.projectRuntimeReconcile, created.id);
    expect(Number(tasks[0]?.count)).toBe(1);
    let rolledBackProjectId: string | undefined;
    const failure = vi.spyOn(jobs, "enqueueProjectRuntimeReconcile").mockImplementationOnce(async (...args) => {
      rolledBackProjectId = args[0];
      // Prove that even an already-inserted queue row rolls back with the Project.
      await PgBossControlJobQueue.prototype.enqueueProjectRuntimeReconcile.apply(jobs, args);
      throw new Error("Injected queue failure");
    });
    await expect(service.create(auth, "dep1", "Rollback integration", [], "platform")).rejects.toThrow("Injected queue failure");
    failure.mockRestore();
    expect(rolledBackProjectId).toMatch(/^tp-[a-z2-7]{13}$/);
    expect(await db.project.findUnique({ where: { id: rolledBackProjectId! } })).toBeNull();
    const remaining = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT count(*) FROM tali_control_jobs.job WHERE data->>\'projectId\'=$1', rolledBackProjectId);
    expect(Number(remaining[0]?.count)).toBe(0);
  });

  it("queues encrypted resource operations and recovers retries without replaying completed work", async () => {
    await db.projectRuntimeTarget.update({ where: { projectId }, data: { status: "ready", observedGeneration: 1 } });
    const publisher = new ResourceOperationService(db, jobs);
    const accepted = await publisher.enqueue(projectId, "local-admin", "remove", { id: "test-agent", secret: "do-not-persist-plaintext" });
    const stored = await db.resourceOperationRecord.findUniqueOrThrow({ where: { id: accepted.operationId } });
    expect(stored.inputEncrypted).not.toContain("do-not-persist-plaintext");
    await expect(publisher.get(projectId, accepted.operationId, "another-user", false)).rejects.toThrow("access denied");
    const remove = vi.fn(async () => true);
    const garden = { remove, removeInstance: vi.fn(), onboard: vi.fn(), discover: vi.fn(), instantiate: vi.fn() };
    const job = { data: { projectId, operationId: accepted.operationId }, retryCount: 0, retryLimit: 2 } as ControlJobMetadata<{ projectId: string; operationId: string }>;
    remove.mockRejectedValueOnce(new Error("Temporary resource failure"));
    await expect(runResourceOperation(db, job, () => garden)).rejects.toThrow("Temporary resource failure");
    expect((await publisher.get(projectId, accepted.operationId, "local-admin", false)).status).toBe("retry");
    expect(await db.projectRuntimeTarget.findUnique({ where: { projectId } })).toMatchObject({ leaseOwner: null });
    await runResourceOperation(db, { ...job, retryCount: 1 }, () => garden);
    await runResourceOperation(db, { ...job, retryCount: 1 }, () => garden);
    expect(remove).toHaveBeenCalledTimes(2);
    expect((await publisher.get(projectId, accepted.operationId, "local-admin", false)).status).toBe("completed");
    const failing = await publisher.enqueue(projectId, "local-admin", "remove", { id: "failing" });
    remove.mockRejectedValueOnce(new Error("Permanent failure"));
    await expect(runResourceOperation(db, { ...job, data: { projectId, operationId: failing.operationId }, retryCount: 2 }, () => garden)).rejects.toThrow("Permanent failure");
    expect((await publisher.get(projectId, failing.operationId, "local-admin", false)).status).toBe("failed");
  });


  let a2aSequence = 0;
  async function a2aFixture(registered = false) {
    const project = await new ProjectService(db, undefined, undefined, jobs)
      .create(auth, "dep1", `A2A deletion integration ${++a2aSequence}`, [], "platform");
    const id = project.id;
    await db.projectRuntimeTarget.update({ where: { projectId: id }, data: { status: "ready" } });
    const publisher = new ResourceOperationService(db, jobs);
    const store = new AgentGardenStore(id, db);
    const runtime = {
      onboard: vi.fn<ManagedAgentRuntimeClient["onboard"]>(async () => { throw new Error("ImagePullBackOff"); }),
      remove: vi.fn<ManagedAgentRuntimeClient["remove"]>(async () => undefined),
    };
    const garden = (operationId?: string) => new AgentGardenService(
      store, undefined, undefined, undefined, runtime, undefined, operationId,
    );
    const job = (operationId: string, retryCount = 0) => ({
      data: { projectId: id, operationId }, retryCount, retryLimit: 25,
    }) as ControlJobMetadata<{ projectId: string; operationId: string }>;
    const agentId = registered ? randomUUID() : "a2a-github-daily-triage";
    if (registered) {
      await store.saveAgent({
        ...databaseAgentCatalog.find((agent) => agent.id === "a2a-github-daily-triage")!,
        id: agentId, source: "PROJECT_REGISTERED",
      }, "local-admin");
    }
    const create = await publisher.enqueue(id, "local-admin", "instantiate", { id: agentId });
    const creation = () => runResourceOperation(db, job(create.operationId), () => garden(create.operationId));
    const state = (operationId: string) => publisher.get(id, operationId, "local-admin", false);
    return { id, agentId, publisher, store, runtime, garden, job, create, creation, state };
  }

  it.each([false, true])("cancels creation retries and cleans tombstones in degraded Projects (registered=%s)", async (registered) => {
    const f = await a2aFixture(registered);
    await expect(f.creation()).rejects.toThrow("Runtime provisioning failed");
    const instance = (await f.store.listManagedInstances())[0]!;
    expect(instance.status).toBe("FAILED");
    expect((await f.state(f.create.operationId)).status).toBe("retry");
    const accepted = await f.publisher.enqueue(f.id, "local-admin", "removeInstance", { id: instance.id });
    expect(accepted).toMatchObject({ background: true, accepted: true, id: instance.id });
    expect(await f.store.listManagedInstances()).toEqual([]);
    expect((await f.store.getManagedInstance(instance.id, true))?.status).toBe("DESTROYING");
    expect((await f.state(f.create.operationId)).status).toBe("cancelled");
    await f.creation();
    expect(f.runtime.onboard).toHaveBeenCalledTimes(1);
    await db.projectRuntimeTarget.update({ where: { projectId: f.id }, data: { status: "failed" } });
    f.runtime.remove.mockRejectedValueOnce(new Error("Temporary Kubernetes failure"));
    const cleanup = () => runResourceOperation(db, f.job(accepted.operationId), () => f.garden(accepted.operationId));
    await expect(cleanup()).rejects.toThrow("Temporary Kubernetes failure");
    expect((await f.state(accepted.operationId)).status).toBe("retry");
    expect(await f.store.listManagedInstances()).toEqual([]);
    await cleanup();
    await cleanup();
    expect((await f.state(accepted.operationId)).status).toBe("completed");
    expect(f.runtime.remove).toHaveBeenCalledTimes(2);
    expect(f.runtime.remove).toHaveBeenLastCalledWith(expect.objectContaining({ instanceId: instance.id, namespace: f.id }));
    // Repeated deletion remains safe and does not make an old creation runnable.
    const duplicate = await f.publisher.enqueue(f.id, "local-admin", "removeInstance", { id: instance.id });
    expect(duplicate.background).toBe(true);
    await runResourceOperation(db, f.job(duplicate.operationId), () => f.garden(duplicate.operationId));
    await f.creation();
    expect(f.runtime.onboard).toHaveBeenCalledTimes(1);
  });

  it.each([[false, "throws"], [false, "returns"], [true, "throws"], [true, "returns"]] as const)("fences in-flight creation (registered=%s, outcome=%s)", async (registered, outcome) => {
    const f = await a2aFixture(registered);
    let release!: () => void;
    let started!: (input: ManagedAgentRuntimeInput) => void;
    const entered = new Promise<ManagedAgentRuntimeInput>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    f.runtime.onboard.mockImplementationOnce(async (input) => {
      started(input);
      await gate;
      if (outcome === "throws") await input.assertActive?.();
      return {
        endpoint: "http://demo:3000", agentCardUrl: "http://demo:3000/card",
        deploymentName: "demo", serviceName: "demo", podName: "demo-pod",
        namespace: input.namespace, imageReference: input.image, imageDigest: input.image,
      };
    });
    const running = f.creation();
    const input = await entered;
    const accepted = await f.publisher.enqueue(f.id, "local-admin", "removeInstance", { id: input.instanceId });
    // A second worker cannot clean up while the original external call is active.
    await expect(runResourceOperation(db, f.job(accepted.operationId), () => f.garden()))
      .rejects.toThrow("Waiting for Project initialization or another resource operation");
    expect(f.runtime.remove).not.toHaveBeenCalled();
    release();
    await running;
    expect((await f.state(f.create.operationId)).status).toBe("cancelled");
    expect((await f.store.getManagedInstance(input.instanceId, true))?.status).toBe("DESTROYING");
    await runResourceOperation(db, f.job(accepted.operationId, 1), () => f.garden());
    await f.creation();
    expect(f.runtime.onboard).toHaveBeenCalledTimes(1);
    expect(f.runtime.remove).toHaveBeenCalledTimes(1);
    expect(await f.store.listManagedInstances()).toEqual([]);
    expect((await f.state(accepted.operationId)).status).toBe("completed");
  });

  it("rolls back deletion intent and creation cancellation if enqueue fails", async () => {
    const f = await a2aFixture();
    await expect(f.creation()).rejects.toThrow();
    const instance = (await f.store.listManagedInstances())[0]!;
    const enqueue = vi.spyOn(jobs, "enqueueResourceOperation").mockImplementationOnce(async (...args) => {
      await PgBossControlJobQueue.prototype.enqueueResourceOperation.apply(jobs, args);
      throw new Error("Injected deletion enqueue failure");
    });
    try {
      await expect(f.publisher.enqueue(f.id, "local-admin", "removeInstance", { id: instance.id }))
        .rejects.toThrow("Injected deletion enqueue failure");
    } finally { enqueue.mockRestore(); }
    expect(await f.store.getManagedInstance(instance.id)).toBeDefined();
    expect((await f.state(f.create.operationId)).status).toBe("retry");
    expect(await db.resourceOperationRecord.count({ where: { projectId: f.id, action: "removeInstance" } })).toBe(0);
    const queued = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) FROM tali_control_jobs.job WHERE name=$1 AND data->>'projectId'=$2`,
      CONTROL_JOB_QUEUES.resourceOperation, f.id,
    );
    expect(Number(queued[0]?.count)).toBe(1);
  });

  it("rechecks cancellation after reading a stale operation before claiming its lease", async () => {
    const f = await a2aFixture();
    await expect(f.creation()).rejects.toThrow();
    const instance = (await f.store.listManagedInstances())[0]!;
    const find = db.resourceOperationRecord.findFirst.bind(db.resourceOperationRecord);
    const spy = vi.spyOn(db.resourceOperationRecord, "findFirst").mockImplementationOnce((async (args: Parameters<typeof find>[0]) => {
      const stale = await find(args);
      await f.publisher.enqueue(f.id, "local-admin", "removeInstance", { id: instance.id });
      return stale;
    }) as typeof find);
    try { await f.creation(); } finally { spy.mockRestore(); }
    expect(f.runtime.onboard).toHaveBeenCalledTimes(1);
    expect((await f.state(f.create.operationId)).status).toBe("cancelled");
  });


  it("fences historical deletion jobs that have no request-time tombstone", async () => {
    const f = await a2aFixture();
    await expect(f.creation()).rejects.toThrow();
    const instance = (await f.store.listManagedInstances())[0]!;
    const operationId = randomUUID();
    await db.$transaction(async (transaction) => {
      await transaction.resourceOperationRecord.create({ data: {
        id: operationId, projectId: f.id, actorId: "local-admin", action: "removeInstance",
        inputEncrypted: encryptPlatformSecret(JSON.stringify({ id: instance.id }), getControlConfig().auth.secret),
      } });
      await jobs.enqueueResourceOperation(f.id, operationId, transaction);
    });
    await runResourceOperation(db, f.job(operationId), () => f.garden());
    expect((await f.state(f.create.operationId)).status).toBe("cancelled");
    await f.creation();
    expect(f.runtime.onboard).toHaveBeenCalledTimes(1);
    expect(f.runtime.remove).toHaveBeenCalledTimes(1);
    expect(await f.store.listManagedInstances()).toEqual([]);
  });

  it("allows explicit replacement creation without an old delete cancelling it", async () => {
    const f = await a2aFixture();
    await expect(f.creation()).rejects.toThrow();
    const instance = (await f.store.listManagedInstances())[0]!;
    const deletion = await f.publisher.enqueue(f.id, "local-admin", "removeInstance", { id: instance.id });
    const replacement = await f.publisher.enqueue(f.id, "local-admin", "instantiate", { id: instance.agentId });
    const duplicate = await f.publisher.enqueue(f.id, "local-admin", "removeInstance", { id: instance.id });
    await runResourceOperation(db, f.job(deletion.operationId), () => f.garden());
    await expect(runResourceOperation(db, f.job(replacement.operationId), () => f.garden(replacement.operationId)))
      .rejects.toThrow("Runtime provisioning failed");
    await runResourceOperation(db, f.job(duplicate.operationId), () => f.garden());
    const active = await f.store.listManagedInstances();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).not.toBe(instance.id);
    expect((await f.state(replacement.operationId)).status).toBe("retry");
    expect((await f.state(f.create.operationId)).status).toBe("cancelled");
    const priorities = await db.$queryRawUnsafe<Array<{ priority: number }>>(
      `SELECT priority FROM tali_control_jobs.job WHERE name=$1 AND data->>'operationId'=$2`,
      CONTROL_JOB_QUEUES.resourceOperation, deletion.operationId,
    );
    expect(priorities[0]?.priority).toBe(90);
  });


  it.each(["remove", "removeInstance"] as const)("cancels ordinary container onboarding via %s using the shared deletion flow", async (action) => {
    const f = await a2aFixture();
    const onboard = await f.publisher.enqueue(f.id, "local-admin", "onboard", {
      sourceType: "container-image", name: "Custom A2A", description: "Custom container",
      category: "Research", owner: "Platform", tags: [], usageMode: "CALLABLE",
      image: "registry.local/custom-a2a:v1", containerPort: 8080,
      agentCardPath: "/.well-known/agent-card.json", imagePullSecretName: "",
      command: [], args: [],
    });
    let entered!: (input: ManagedAgentRuntimeInput) => void;
    let release!: () => void;
    const ready = new Promise<ManagedAgentRuntimeInput>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    f.runtime.onboard.mockImplementationOnce(async (input) => {
      entered(input);
      await gate;
      await input.assertActive?.();
      throw new Error("Should have been cancelled");
    });
    const running = runResourceOperation(db, f.job(onboard.operationId), () => f.garden(onboard.operationId));
    const input = await ready;
    expect(input.image).toBe("registry.local/custom-a2a:v1");
    const deletion = await f.publisher.enqueue(f.id, "local-admin", action, {
      id: action === "remove" ? input.agentId : input.instanceId,
    });
    expect(deletion.background).toBe(true);
    release();
    await running;
    expect((await f.state(onboard.operationId)).status).toBe("cancelled");
    await runResourceOperation(db, f.job(deletion.operationId), () => f.garden());
    await runResourceOperation(db, f.job(onboard.operationId, 1), () => f.garden(onboard.operationId));
    expect(f.runtime.onboard).toHaveBeenCalledTimes(1);
    expect(f.runtime.remove).toHaveBeenCalledTimes(1);
    expect(await f.store.listManagedInstances()).toEqual([]);
    expect(Boolean(await f.store.getAgent(input.agentId))).toBe(action === "removeInstance");
  });

  it("deletes an external A2A definition and instance without touching Kubernetes", async () => {
    const f = await a2aFixture(true);
    const agent = (await f.store.getAgent(f.agentId))!;
    await f.store.saveAgent({ ...agent, configuration: { onboardingSource: "EXISTING_AGENT" } });
    await f.creation();
    expect(await f.store.listManagedInstances()).toHaveLength(1);
    const deletion = await f.publisher.enqueue(f.id, "local-admin", "remove", { id: f.agentId });
    expect(deletion.background).toBe(true);
    expect(await f.store.getAgent(f.agentId)).toBeUndefined();
    await runResourceOperation(db, f.job(deletion.operationId), () => f.garden());
    expect((await f.state(deletion.operationId)).status).toBe("completed");
    expect(await f.store.listManagedInstances()).toEqual([]);
    expect(f.runtime.remove).not.toHaveBeenCalled();
    expect(f.runtime.onboard).not.toHaveBeenCalled();
  });


  it("cancels external onboarding before discovery can recreate its deleted definition", async () => {
    const f = await a2aFixture();
    const onboard = await f.publisher.enqueue(f.id, "local-admin", "onboard", {
      sourceType: "existing-agent", name: "Remote A2A", description: "External service",
      category: "Research", owner: "Platform", tags: [],
      agentCardUrl: "https://agents.example.com/card", authType: "none",
      authReference: "", internalNetworkOnly: false,
    });
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const discover = vi.fn(async () => {
      started();
      await gate;
      return {
        endpoint: "https://agents.example.com/a2a", agentCardUrl: "https://agents.example.com/card",
        a2a: databaseAgentCatalog.find((agent) => agent.id === "a2a-github-daily-triage")!.a2a!, skills: [],
      };
    });
    const garden = new AgentGardenService(f.store, undefined, { discover }, undefined, f.runtime, undefined, onboard.operationId);
    const running = runResourceOperation(db, f.job(onboard.operationId), () => garden);
    await entered;
    const rediscover = await f.publisher.enqueue(f.id, "local-admin", "discover", { id: onboard.operationId });
    const deletion = await f.publisher.enqueue(f.id, "local-admin", "remove", { id: onboard.operationId });
    expect(deletion.background).toBe(true);
    release();
    await running;
    await runResourceOperation(db, f.job(deletion.operationId), () => f.garden());
    await runResourceOperation(db, f.job(rediscover.operationId), () => garden);
    expect((await f.state(onboard.operationId)).status).toBe("cancelled");
    expect((await f.state(rediscover.operationId)).status).toBe("cancelled");
    expect(await f.store.getAgent(onboard.operationId)).toBeUndefined();
    expect(await f.store.listManagedInstances()).toEqual([]);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(f.runtime.remove).not.toHaveBeenCalled();
  });


  async function legacyCreation(f: Awaited<ReturnType<typeof a2aFixture>>) {
    const operation = await f.publisher.enqueue(f.id, "local-admin", "instantiate", { id: f.agentId });
    await db.resourceOperationRecord.update({ where: { id: operation.operationId }, data: {
      inputEncrypted: encryptPlatformSecret(JSON.stringify({ id: f.agentId }), getControlConfig().auth.secret),
      status: "retry",
    } });
    return operation;
  }

  it("compares legacy deletion timestamps at microsecond precision within the Project", async () => {
    const f = await a2aFixture(true);
    await expect(f.creation()).rejects.toThrow();
    const instance = (await f.store.listManagedInstances())[0]!;
    await db.$transaction(async (transaction) => {
      await lockProjectRow(transaction, f.id);
      await transaction.$executeRaw`
        UPDATE tasklattice.resource_operations
        SET created_at = '2020-01-01T00:00:00.100002Z'::timestamptz
        WHERE id = ${f.create.operationId}::uuid
      `;
      const input = { projectId: f.id, operationId: f.create.operationId, agentId: f.agentId };
      for (const [timestamp, expected] of [
        ["2020-01-01T00:00:00.100001Z", false],
        ["2020-01-01T00:00:00.100002Z", true],
        ["2020-01-01T00:00:00.100003Z", true],
      ] as const) {
        await transaction.$executeRaw`
          UPDATE tasklattice.agents SET deleted_at = ${timestamp}::timestamptz
          WHERE project_id = ${f.id} AND id = ${instance.id}
        `;
        expect(await hasA2aInstanceDeletedSinceOperation(transaction, input)).toBe(expected);
      }
      expect(await hasA2aInstanceDeletedSinceOperation(transaction, {
        ...input, projectId,
      })).toBe(false);
      expect(await hasA2aInstanceDeletedSinceOperation(transaction, {
        ...input, agentId: "' OR 1=1 --",
      })).toBe(false);
    });
  });

  it.each([false, true])("does not replay pre-upgrade creation after an old soft deletion (registered=%s)", async (registered) => {
    const f = await a2aFixture(registered);
    await expect(f.creation()).rejects.toThrow();
    const instance = (await f.store.listManagedInstances())[0]!;
    const old = await legacyCreation(f);
    // Old releases removed the runtime and soft-deleted the row without cancelling creation jobs.
    await db.$executeRawUnsafe(
      "UPDATE tasklattice.agents SET deleted_at=clock_timestamp() WHERE project_id=$1 AND id=$2",
      f.id, instance.id,
    );
    await runResourceOperation(db, f.job(old.operationId, 1), () => f.garden(old.operationId));
    expect((await f.state(old.operationId)).status).toBe("cancelled");
    expect(f.runtime.onboard).toHaveBeenCalledTimes(1);
    expect(await f.store.listManagedInstances()).toEqual([]);
  });

  it.each([false, true])("retries a failed container Instance with the same identity (registered=%s)", async (registered) => {
    const f = await a2aFixture(registered);
    await expect(f.creation()).rejects.toThrow();
    const instance = (await f.store.listManagedInstances())[0]!;
    await expect(f.creation()).rejects.toThrow();
    expect(f.runtime.onboard).toHaveBeenCalledTimes(2);
    expect(f.runtime.onboard.mock.calls[1]?.[0].instanceId).toBe(instance.id);
    expect(await f.store.listManagedInstances()).toHaveLength(1);
  });

  it.each(["onboard", "discover"] as const)("cancels legacy %s after definition deletion", async (action) => {
    const f = await a2aFixture(true);
    await expect(f.creation()).rejects.toThrow();
    const id = action === "onboard" ? f.agentId : randomUUID();
    await db.resourceOperationRecord.create({ data: {
      id, projectId: f.id, actorId: "local-admin", action, status: "retry",
      inputEncrypted: encryptPlatformSecret(JSON.stringify({ id: f.agentId }), getControlConfig().auth.secret),
    } });
    await db.agentCatalogRecord.update({ where: { projectId_id: { projectId: f.id, id: f.agentId } }, data: {
      deletedAt: new Date(),
    } });
    await runResourceOperation(db, f.job(id, 1), () => f.garden(id));
    expect((await f.state(id)).status).toBe("cancelled");
    expect(f.runtime.onboard).toHaveBeenCalledTimes(1);
    expect(await f.store.getAgent(f.agentId)).toBeUndefined();
  });

  it.each([false, true])("reuses a ready container without redeploying it (registered=%s)", async (registered) => {
    const f = await a2aFixture(registered);
    await expect(f.creation()).rejects.toThrow();
    const instance = (await f.store.listManagedInstances())[0]!;
    await f.store.saveManagedInstance({ ...instance, status: "READY" }, "local-admin");
    await f.creation();
    expect((await f.state(f.create.operationId)).status).toBe("completed");
    expect(f.runtime.onboard).toHaveBeenCalledTimes(1);
    expect((await f.store.listManagedInstances())[0]?.id).toBe(instance.id);
  });

  it("cancels legacy retries on repeated deletion while preserving new requests", async () => {
    const f = await a2aFixture();
    await expect(f.creation()).rejects.toThrow();
    const instance = (await f.store.listManagedInstances())[0]!;
    const old = await legacyCreation(f);
    await db.$executeRawUnsafe(
      "UPDATE tasklattice.agents SET deleted_at=clock_timestamp() WHERE project_id=$1 AND id=$2",
      f.id, instance.id,
    );
    const replacement = await f.publisher.enqueue(f.id, "local-admin", "instantiate", { id: f.agentId });
    // Transaction timestamps can precede lock acquisition; new jobs use atomic cancellation.
    await db.resourceOperationRecord.update({ where: { id: replacement.operationId }, data: {
      createdAt: new Date("2020-01-01T00:00:00Z"),
    } });
    const deletions = await Promise.all([1, 2].map(() =>
      f.publisher.enqueue(f.id, "local-admin", "removeInstance", { id: instance.id }),
    ));
    expect((await f.state(old.operationId)).status).toBe("cancelled");
    expect((await f.state(replacement.operationId)).status).toBe("pending");
    for (const deletion of deletions) {
      await runResourceOperation(db, f.job(deletion.operationId), () => f.garden());
    }
    expect(f.runtime.remove).toHaveBeenCalledTimes(1);
    await expect(runResourceOperation(db, f.job(replacement.operationId), () => f.garden(replacement.operationId)))
      .rejects.toThrow("Runtime provisioning failed");
    expect(f.runtime.onboard).toHaveBeenCalledTimes(2);
    expect(await f.store.listManagedInstances()).toHaveLength(1);
  });

  it("preserves the original deletion time when cleaning up before a legacy replacement runs", async () => {
    const f = await a2aFixture(true);
    await expect(f.creation()).rejects.toThrow();
    const instance = (await f.store.listManagedInstances())[0]!;
    const deletedAt = new Date("2020-01-01T00:00:00Z");
    await db.agentRecord.update({ where: { projectId_id: { projectId: f.id, id: instance.id } }, data: { deletedAt } });
    const replacement = await legacyCreation(f);
    const deletion = await f.publisher.enqueue(f.id, "local-admin", "removeInstance", { id: instance.id });
    await runResourceOperation(db, f.job(deletion.operationId), () => f.garden());
    const row = await db.agentRecord.findUniqueOrThrow({ where: { projectId_id: { projectId: f.id, id: instance.id } } });
    expect(row.deletedAt).toEqual(deletedAt);
    await expect(runResourceOperation(db, f.job(replacement.operationId), () => f.garden(replacement.operationId)))
      .rejects.toThrow("Runtime provisioning failed");
    expect((await f.state(replacement.operationId)).status).toBe("retry");
    expect(f.runtime.onboard).toHaveBeenCalledTimes(2);
    expect((await f.store.listManagedInstances())[0]?.id).not.toBe(instance.id);
  });

  it("preserves failures, permits retry and prevents resurrection when deletion races creation", async () => {
    const namespaces = { reconcile: vi.fn(async (): Promise<void> => { throw new Error("Cluster unavailable"); }), deleteAndWait: vi.fn(async () => undefined) };
    const gateways = { reconcile: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) };
    const bridges = { reconcile: vi.fn(async () => undefined) };
    const worker = new ProjectRuntimeTargetService(db, namespaces, gateways, bridges);
    await expect(worker.ensureProjectNamespace(projectId)).rejects.toThrow("Cluster unavailable");
    expect(await db.project.findUnique({ where: { id: projectId } })).not.toBeNull();
    expect(await db.projectRuntimeTarget.findUnique({ where: { projectId } })).toMatchObject({ status: "retry" });
    await db.projectRuntimeTarget.update({ where: { projectId }, data: { status: "failed" } });
    expect((await new ProjectRuntimeStatusService(db, jobs).retry(projectId)).status).toBe("pending");
    let unblock!: () => void;
    let started!: () => void;
    const active = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    namespaces.reconcile.mockImplementationOnce(async () => { started(); await gate; });
    const initializing = worker.ensureProjectNamespace(projectId);
    const cancelled = expect(initializing).rejects.toThrow("cancelled by deletion");
    await active;
    await new ProjectService(db, undefined, undefined, jobs).delete(projectId, "local-admin");
    await expect(new ProjectDeletionService(db).purge(projectId)).rejects.toThrow("Waiting for in-flight");
    unblock(); await cancelled;
    expect(gateways.reconcile).not.toHaveBeenCalled();
    expect(bridges.reconcile).not.toHaveBeenCalled();
    expect(await db.projectRuntimeTarget.findUnique({ where: { projectId } })).toMatchObject({ status: "deleting", leaseOwner: null });
    await expect(new ProjectRuntimeStatusService(db, jobs).retry(projectId)).rejects.toThrow("being deleted");
    await worker.deleteProjectNamespace(projectId);
    expect(namespaces.deleteAndWait).toHaveBeenCalled();
  });
});
