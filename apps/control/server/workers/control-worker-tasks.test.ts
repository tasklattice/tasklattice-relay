import { describe, expect, it, vi } from "vitest";
import type {
  ControlJobMetadata,
  PgBossControlJobQueue,
  ProjectDeletionJobPayload,
  ProjectRuntimeReconcileJobPayload,
} from "../jobs/control-job-queue";
import { CONTROL_JOB_QUEUES } from "../jobs/control-job-queue";
import type { StructuredLogger } from "../observability/structured-logger";
import type { PrismaClient } from "../generated/prisma/client";
import type { ProjectDeletionService } from "../projects/project-deletion-service";
import type { ProjectRuntimeTargetService } from "../projects/project-runtime-target-service";
import { createTestPrisma } from "../test/prisma";
import {
  ControlWorkerTasks,
  type InstanceLifecycleService,
} from "./control-worker-tasks";

function metadata<T extends object>(
  name: string,
  data: T,
  input: { retryCount?: number; retryLimit?: number } = {},
): ControlJobMetadata<T> {
  return {
    data,
    id: "00000000-0000-4000-8000-000000000101",
    name,
    retryCount: input.retryCount ?? 0,
    retryLimit: input.retryLimit ?? 25,
  } as ControlJobMetadata<T>;
}

function quietLogger(): StructuredLogger {
  return { log: vi.fn() };
}

describe("ControlWorkerTasks", () => {
  it("serializes Project Gateway reconciliation within each Worker", async () => {
    const work = vi.fn(async (
      name: string,
      _options: unknown,
      _handler: unknown,
    ) => name);
    const tasks = new ControlWorkerTasks({
      db: createTestPrisma(),
      deletionService: {} as ProjectDeletionService,
      jobs: { boss: { work } } as unknown as PgBossControlJobQueue,
      logger: quietLogger(),
      runtimeTargets: {} as ProjectRuntimeTargetService,
    });

    await tasks.register();

    const registration = work.mock.calls.find(
      ([name]) => name === CONTROL_JOB_QUEUES.projectRuntimeReconcile,
    );
    expect(registration?.[1]).toMatchObject({ localConcurrency: 1 });
    const lifecycleRegistration = work.mock.calls.find(
      ([name]) => name === CONTROL_JOB_QUEUES.instanceLifecycle,
    );
    expect(lifecycleRegistration?.[1]).toMatchObject({
      groupConcurrency: 1,
      localConcurrency: 2,
    });
  });

  it("runs Instance provisioning in the Worker and records retry state", async () => {
    const failure = new Error("OpenShell temporarily unavailable");
    const service = {
      provision: vi.fn(async () => { throw failure; }),
      recordProvisioningFailure: vi.fn(async () => undefined),
      deleteRuntime: vi.fn(async () => undefined),
      recordDeletionFailure: vi.fn(async () => undefined),
    } satisfies InstanceLifecycleService;
    const tasks = new ControlWorkerTasks({
      db: createTestPrisma(),
      deletionService: {} as ProjectDeletionService,
      jobs: {} as PgBossControlJobQueue,
      logger: quietLogger(),
      runtimeTargets: {} as ProjectRuntimeTargetService,
      instances: () => service,
    });
    const instanceId = "00000000-0000-4000-8000-000000000401";
    const operationId = "00000000-0000-4000-8000-000000000501";

    await expect(tasks.instanceLifecycle(metadata(
      CONTROL_JOB_QUEUES.instanceLifecycle,
      { projectId: "individual", instanceId, operationId, action: "provision" },
      { retryCount: 2, retryLimit: 25 },
    ))).rejects.toThrow(failure);
    expect(service.provision).toHaveBeenCalledWith(instanceId, operationId);
    expect(service.recordProvisioningFailure).toHaveBeenCalledWith(
      instanceId,
      failure,
      false,
      operationId,
    );
    expect(service.deleteRuntime).not.toHaveBeenCalled();
  });

  it("runs Instance deletion in the Worker", async () => {
    const service = {
      provision: vi.fn(async () => undefined),
      recordProvisioningFailure: vi.fn(async () => undefined),
      deleteRuntime: vi.fn(async () => undefined),
      recordDeletionFailure: vi.fn(async () => undefined),
    } satisfies InstanceLifecycleService;
    const tasks = new ControlWorkerTasks({
      db: createTestPrisma(),
      deletionService: {} as ProjectDeletionService,
      jobs: {} as PgBossControlJobQueue,
      logger: quietLogger(),
      runtimeTargets: {} as ProjectRuntimeTargetService,
      instances: () => service,
    });
    const instanceId = "00000000-0000-4000-8000-000000000402";
    const operationId = "00000000-0000-4000-8000-000000000502";

    await expect(tasks.instanceLifecycle(metadata(
      CONTROL_JOB_QUEUES.instanceLifecycle,
      { projectId: "individual", instanceId, operationId, action: "delete" },
    ))).resolves.toBeUndefined();
    expect(service.deleteRuntime).toHaveBeenCalledWith(instanceId, operationId);
    expect(service.provision).not.toHaveBeenCalled();
  });

  it("records retry and terminal failure state around Project deletion", async () => {
    const db = createTestPrisma();
    const requestedAt = new Date("2026-08-27T08:00:00.000Z");
    await db.project.update({
      where: { id: "individual" },
      data: { deletedAt: requestedAt, deletedBy: "local-admin" },
    });
    await db.projectDeletionTask.create({
      data: {
        nextAttemptAt: requestedAt,
        projectId: "individual",
        scheduledFor: requestedAt,
      },
    });
    const purge = vi.fn(async () => {
      throw new Error("Runner unavailable");
    });
    const tasks = new ControlWorkerTasks({
      db,
      deletionService: { purge } as unknown as ProjectDeletionService,
      jobs: {} as PgBossControlJobQueue,
      logger: quietLogger(),
      runtimeTargets: {} as ProjectRuntimeTargetService,
    });

    await expect(tasks.projectDeletion(metadata<ProjectDeletionJobPayload>(
      "control-project-delete",
      { projectId: "individual" },
    ))).rejects.toThrow("Runner unavailable");
    await expect(db.projectDeletionTask.findUnique({
      where: { projectId: "individual" },
    })).resolves.toMatchObject({
      attempts: 1,
      lastError: "Runner unavailable",
      queueJobId: "00000000-0000-4000-8000-000000000101",
      status: "retry",
    });

    await expect(tasks.projectDeletion(metadata<ProjectDeletionJobPayload>(
      "control-project-delete",
      { projectId: "individual" },
      { retryCount: 25, retryLimit: 25 },
    ))).rejects.toThrow("Runner unavailable");
    await expect(db.projectDeletionTask.findUnique({
      where: { projectId: "individual" },
    })).resolves.toMatchObject({
      attempts: 26,
      status: "failed",
    });
  });

  it("attaches historical deletion tasks to the durable queue", async () => {
    const db = createTestPrisma();
    const scheduledFor = new Date("2026-08-27T08:00:00.000Z");
    await db.project.update({
      where: { id: "individual" },
      data: { deletedAt: scheduledFor, deletedBy: "local-admin" },
    });
    await db.projectDeletionTask.create({
      data: {
        nextAttemptAt: scheduledFor,
        projectId: "individual",
        scheduledFor,
      },
    });
    const enqueueProjectDeletion = vi.fn(async () =>
      "00000000-0000-4000-8000-000000000102"
    );
    const jobs = {
      enqueueProjectDeletion,
    } as unknown as PgBossControlJobQueue;
    const tasks = new ControlWorkerTasks({
      db,
      deletionService: {} as ProjectDeletionService,
      jobs,
      logger: quietLogger(),
      runtimeTargets: {} as ProjectRuntimeTargetService,
    });

    await expect(tasks.attachHistoricalDeletionJobs(scheduledFor))
      .resolves.toBe(1);
    expect(enqueueProjectDeletion).toHaveBeenCalledWith(
      "individual",
      scheduledFor,
      expect.any(Object),
    );
    await expect(db.projectDeletionTask.findUnique({
      where: { projectId: "individual" },
    })).resolves.toMatchObject({
      queueJobId: "00000000-0000-4000-8000-000000000102",
      status: "scheduled",
    });
  });

  it("reattaches orphaned Instance provisioning and deletion work", async () => {
    const now = new Date();
    const provisioningId = "00000000-0000-4000-8000-000000000411";
    const deletingId = "00000000-0000-4000-8000-000000000412";
    const completedId = "00000000-0000-4000-8000-000000000413";
    const legacyCompletedId = "00000000-0000-4000-8000-000000000414";
    const findMany = vi.fn(async () => [
        {
          projectId: "individual",
          id: provisioningId,
          deletedAt: null,
          payload: { id: provisioningId, status: "PROVISIONING" },
        },
        {
          projectId: "individual",
          id: deletingId,
          deletedAt: now,
          payload: { id: deletingId, status: "DESTROYING" },
        },
        {
          projectId: "individual",
          id: completedId,
          deletedAt: now,
          payload: {
            id: completedId,
            status: "DESTROYING",
            deletionCompletedAt: now.toISOString(),
            modelRoutingBindingRevokedAt: now.toISOString(),
          },
        },
        {
          projectId: "individual",
          id: legacyCompletedId,
          deletedAt: now,
          payload: {
            id: legacyCompletedId,
            status: "DESTROYING",
            deletionCompletedAt: now.toISOString(),
          },
        },
      ]);
    const db = {
      agentRecord: { findMany },
    } as unknown as PrismaClient;
    const enqueueInstanceLifecycle = vi.fn(async () =>
      "00000000-0000-4000-8000-000000000499"
    );
    const attachQueueJob = vi.fn(async () => undefined);
    const createOperation = vi.fn(async (instanceId: string) => ({
      id: `10000000-0000-4000-8000-${instanceId.slice(-12)}`,
      status: "queued" as const,
    }));
    const tasks = new ControlWorkerTasks({
      db,
      deletionService: {} as ProjectDeletionService,
      jobs: { enqueueInstanceLifecycle } as unknown as PgBossControlJobQueue,
      logger: quietLogger(),
      runtimeTargets: {} as ProjectRuntimeTargetService,
      instanceLifecycleOperations: () => ({
        attachQueueJob,
        create: createOperation,
        latestForInstance: vi.fn(async () => undefined),
      }) as never,
    });

    await expect(tasks.attachInstanceLifecycleJobs()).resolves.toBe(3);
    expect(enqueueInstanceLifecycle).toHaveBeenCalledWith({
      projectId: "individual",
      instanceId: provisioningId,
      operationId: expect.any(String),
      action: "provision",
    });
    expect(enqueueInstanceLifecycle).toHaveBeenCalledWith({
      projectId: "individual",
      instanceId: deletingId,
      operationId: expect.any(String),
      action: "delete",
    });
    expect(enqueueInstanceLifecycle).toHaveBeenCalledWith({
      projectId: "individual",
      instanceId: legacyCompletedId,
      operationId: expect.any(String),
      action: "delete",
    });
    expect(attachQueueJob).toHaveBeenCalledTimes(3);
  });

  it("drains due Memory outbox work from the scheduled maintenance worker", async () => {
    const db = createTestPrisma();
    const referenceTime = new Date("2026-08-27T09:00:00.000Z");
    const memory = await db.memoryRecord.create({
      data: {
        projectId: "individual",
        displayName: "Worker test Memory",
        idempotencyKey: "worker-memory-a",
      },
    });
    await db.memoryOutboxRecord.create({
      data: {
        projectId: "individual",
        memoryId: memory.id,
        conversationId: "conversation-a",
        eventType: "conversation.completed",
        encryptedPayload: "opaque-envelope",
        idempotencyKey: "retain-a",
        nextRetryAt: new Date(referenceTime.getTime() - 1_000),
      },
    });
    const processDueOutbox = vi.fn(async () => ({
      claimed: 1,
      deadLettered: 0,
      delivered: 1,
      retried: 0,
    }));
    const memories = vi.fn(() => ({ processDueOutbox }));
    const tasks = new ControlWorkerTasks({
      db,
      deletionService: {} as ProjectDeletionService,
      jobs: {} as PgBossControlJobQueue,
      logger: quietLogger(),
      runtimeTargets: {} as ProjectRuntimeTargetService,
      memories,
    });

    await expect(tasks.drainMemoryOutbox(referenceTime)).resolves.toEqual({
      claimed: 1,
      deadLettered: 0,
      delivered: 1,
      retried: 0,
    });
    expect(memories).toHaveBeenCalledWith("individual");
    expect(processDueOutbox).toHaveBeenCalledWith(25, referenceTime);
  });

  it("does not reconcile a Project after deletion has started", async () => {
    const db = createTestPrisma();
    await db.project.update({
      where: { id: "individual" },
      data: { deletedAt: new Date(), deletedBy: "local-admin" },
    });
    const ensureProjectNamespace = vi.fn(async () => true);
    const tasks = new ControlWorkerTasks({
      db,
      deletionService: {} as ProjectDeletionService,
      jobs: {} as PgBossControlJobQueue,
      logger: quietLogger(),
      runtimeTargets: {
        ensureProjectNamespace,
      } as unknown as ProjectRuntimeTargetService,
    });

    await expect(tasks.projectRuntimeReconcile(
      metadata<ProjectRuntimeReconcileJobPayload>(
        "control-project-runtime-reconcile",
        { projectId: "individual", reason: "periodic" },
      ),
    )).resolves.toBeUndefined();
    expect(ensureProjectNamespace).not.toHaveBeenCalled();
  });
});
