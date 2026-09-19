import { ResourceOperationService } from "./resource-operation-service";
import { runResourceOperation } from "../workers/resource-operation-task";
import type { ControlJobMetadata } from "../jobs/control-job-queue";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { developmentControlConfig, setControlConfigForTests } from "../config/control-config";
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
