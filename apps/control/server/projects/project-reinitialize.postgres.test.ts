import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PgBoss } from "pg-boss";
import { PrismaClient } from "../generated/prisma/client";
import { developmentControlConfig, setControlConfigForTests } from "../config/control-config";
import {
  CONTROL_JOB_QUEUES,
  PgBossControlJobQueue,
  type ProjectRuntimeReconcileJobPayload,
} from "../jobs/control-job-queue";
import type { PlatformPrincipal } from "../auth/auth";
import { ProjectService } from "./project-service";
import { ProjectRuntimeStatusService } from "./project-runtime-status";
import { ProjectRuntimeTargetService } from "./project-runtime-target-service";

const url = process.env.ASYNC_PROJECT_DATABASE_URL;
const queue = CONTROL_JOB_QUEUES.projectRuntimeReconcile;

describe.skipIf(!url)("Manual Project initialization on PostgreSQL", () => {
  let db: PrismaClient;
  let jobs: PgBossControlJobQueue;
  let status: ProjectRuntimeStatusService;
  const auth: PlatformPrincipal = {
    user: {
      id: "local-admin", username: "admin", email: "admin@tasklattice.local",
      displayName: "Administrator", systemRole: "platform_administrator", hasPassword: true,
    },
  };

  beforeAll(async () => {
    const config = developmentControlConfig();
    config.database.url = url!;
    config.runtime_namespaces.enabled = true;
    if (config.litellm) config.litellm.master_key = "";
    setControlConfigForTests(config);
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    // Isolate queue consumers from the other PostgreSQL integration suites.
    jobs = new PgBossControlJobQueue(new PgBoss({
      connectionString: url!,
      schema: `tali_reinitialize_${randomUUID().replaceAll("-", "")}`,
      useListenNotify: true,
    }));
    await jobs.start();
    status = new ProjectRuntimeStatusService(db, jobs);
  });
  beforeEach(async () => { await jobs.boss.deleteAllJobs(); });
  afterAll(async () => {
    await jobs?.stop();
    await db?.$disconnect();
    setControlConfigForTests(undefined);
  });

  const tasks = (projectId: string) => jobs.boss.findJobs<ProjectRuntimeReconcileJobPayload>(queue, { key: projectId });
  const target = (projectId: string) => db.projectRuntimeTarget.findUniqueOrThrow({ where: { projectId } });

  async function fixture(state: "created" | "retry" = "retry") {
    const project = await new ProjectService(db, undefined, undefined, jobs)
      .create(auth, "dep1", `Reinitialize ${randomUUID()}`, [], "platform");
    const [job] = await tasks(project.id);
    if (state === "retry") {
      await jobs.boss.update(queue, undefined, {
        id: job!.id, retryDelay: 3600, retryDelayMax: 3600, retryBackoff: true,
      });
      const [active] = await jobs.boss.fetch(queue);
      expect(active?.id).toBe(job!.id);
      await jobs.boss.fail(queue, job!.id, { message: "Previous initialization failed" });
      // Exercise an actual retry so preserving history includes a nonzero count.
      await jobs.boss.update(queue, undefined, { id: job!.id, startAfter: 0 });
      expect((await jobs.boss.fetch(queue))[0]?.id).toBe(job!.id);
      await jobs.boss.fail(queue, job!.id, { message: "Initialization failed again" });
    } else {
      await jobs.boss.update(queue, undefined, { id: job!.id, startAfter: new Date(Date.now() + 3600_000) });
    }
    await db.projectRuntimeTarget.update({
      where: { projectId: project.id },
      data: { status: "retry", attempts: 4, lastError: "Previous initialization failed" },
    });
    const [before] = await tasks(project.id);
    expect(before!.state).toBe(state);
    if (state === "retry") expect(before!.retryCount).toBe(1);
    expect(before!.startAfter.getTime()).toBeGreaterThan(Date.now() + 3000_000);
    return { projectId: project.id, before: before! };
  }

  it.each(["created", "retry"] as const)("wakes the existing %s task immediately without resetting its history", async (state) => {
    const { projectId, before } = await fixture(state);
    const result = await status.reinitialize(projectId);
    const after = await tasks(projectId);
    expect(result).toMatchObject({ status: "pending", generation: 2, attempts: 0, lastError: null });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: before.id, state, createdOn: before.createdOn,
      retryCount: before.retryCount, retryLimit: before.retryLimit,
      retryDelay: before.retryDelay, retryBackoff: before.retryBackoff,
      priority: 50, singletonKey: projectId, groupId: projectId,
      data: { projectId, reason: "manual" },
    });
    expect(after[0]!.startAfter.getTime()).toBeLessThanOrEqual(Date.now());
    // The job is actually claimable now, not merely reported as pending.
    expect((await jobs.boss.fetch(queue))[0]?.id).toBe(before.id);
  });

  it("coalesces concurrent and repeated Reinitialize requests into the same task and generation", async () => {
    const { projectId, before } = await fixture();
    await Promise.all(Array.from({ length: 5 }, () => status.reinitialize(projectId)));
    await status.reinitialize(projectId);
    expect(await tasks(projectId)).toMatchObject([{ id: before.id, data: { reason: "manual" } }]);
    expect(await target(projectId)).toMatchObject({ status: "pending", generation: 2 });
  });

  it("wakes an existing backoff task when an administrator retries a failed initialization", async () => {
    const { projectId, before } = await fixture();
    expect(await status.retry(projectId)).toMatchObject({ status: "pending", generation: 2 });
    expect(await tasks(projectId)).toMatchObject([{ id: before.id, data: { reason: "retry" } }]);
    expect((await jobs.boss.fetch(queue))[0]?.id).toBe(before.id);
  });

  it("leaves automatic reconciliation backoff unchanged", async () => {
    const { projectId, before } = await fixture();
    expect(await jobs.enqueueProjectRuntimeReconcile(projectId, "periodic")).toBeUndefined();
    expect(await tasks(projectId)).toEqual([before]);
    expect(await jobs.boss.fetch(queue)).toEqual([]);
  });

  it("inserts one task when none is pending and coalesces subsequent manual requests", async () => {
    const { projectId, before } = await fixture();
    await jobs.boss.cancel(queue, before.id);
    await Promise.all([status.reinitialize(projectId), status.reinitialize(projectId)]);
    const all = await tasks(projectId);
    expect(all.filter((job) => job.state === "cancelled")).toHaveLength(1);
    const pending = all.filter((job) => job.state === "created");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).not.toBe(before.id);
    expect((await jobs.boss.fetch(queue))[0]?.id).toBe(pending[0]!.id);
  });

  it("does not mutate or duplicate a fetched task before its runtime lease is acquired", async () => {
    const { projectId } = await fixture();
    await jobs.enqueueProjectRuntimeReconcile(projectId, "manual");
    await jobs.boss.fetch(queue);
    const before = await tasks(projectId);
    expect(before[0]!.state).toBe("active");
    expect(await jobs.enqueueProjectRuntimeReconcile(projectId, "retry")).toBeUndefined();
    expect(await tasks(projectId)).toEqual(before);
  });

  it("rejects manual requests during initialization and lets the existing worker finish", async () => {
    const { projectId } = await fixture();
    await status.reinitialize(projectId);
    await jobs.boss.fetch(queue);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const namespaces = { reconcile: vi.fn(async () => { entered(); await gate; }), deleteAndWait: vi.fn() };
    const gateways = { reconcile: vi.fn(async () => undefined), delete: vi.fn() };
    const bridges = { reconcile: vi.fn(async () => undefined) };
    const worker = new ProjectRuntimeTargetService(db, namespaces, gateways, bridges);
    const running = worker.ensureProjectNamespace(projectId);
    try {
      await Promise.race([started, running.then(() => { throw new Error("Worker never acquired the lease"); })]);
      const beforeTarget = await target(projectId);
      const beforeJobs = await tasks(projectId);
      expect(beforeTarget).toMatchObject({ status: "reconciling", generation: 2, leaseOwner: expect.any(String) });
      await expect(status.reinitialize(projectId)).rejects.toMatchObject({ status: 409 });
      await expect(status.retry(projectId)).rejects.toMatchObject({ status: 409 });
      expect(await target(projectId)).toEqual(beforeTarget);
      expect(await tasks(projectId)).toEqual(beforeJobs);
    } finally {
      release();
      await running;
    }
    expect(await target(projectId)).toMatchObject({
      status: "ready", generation: 2, observedGeneration: 2, leaseOwner: null,
    });
    expect(namespaces.reconcile).toHaveBeenCalledTimes(1);
    expect(gateways.reconcile).toHaveBeenCalledTimes(1);
    expect(bridges.reconcile).toHaveBeenCalledTimes(1);
  });

  it("rolls back the task wake-up and Project generation together on transaction failure", async () => {
    const { projectId, before } = await fixture();
    const beforeTarget = await target(projectId);
    const failure = vi.spyOn(jobs, "enqueueProjectRuntimeReconcile").mockImplementationOnce(async (...args) => {
      await PgBossControlJobQueue.prototype.enqueueProjectRuntimeReconcile.apply(jobs, args);
      throw new Error("Injected failure after queue wake-up");
    });
    try {
      await expect(status.reinitialize(projectId)).rejects.toThrow("Injected failure after queue wake-up");
    } finally {
      failure.mockRestore();
    }
    expect(await target(projectId)).toEqual(beforeTarget);
    expect(await tasks(projectId)).toEqual([before]);
    expect(await jobs.boss.fetch(queue)).toEqual([]);
  });

  it("notifies an idle worker immediately instead of waiting for its polling interval", async () => {
    const { projectId, before } = await fixture();
    let received: string | undefined;
    await jobs.boss.work(queue, { pollingIntervalSeconds: 60, notifyPollingIntervalSeconds: 60 }, async ([job]) => {
      received = job!.id;
    });
    try {
      // Let the initial empty fetch finish so only NOTIFY can cause a prompt fetch.
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(received).toBeUndefined();
      await status.reinitialize(projectId);
      await vi.waitFor(() => expect(received).toBe(before.id), { timeout: 3000, interval: 20 });
    } finally {
      await jobs.boss.offWork(queue);
    }
  });
});
