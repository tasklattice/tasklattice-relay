import { z } from "zod";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import {
  CONTROL_JOB_QUEUES,
  type ControlJobMetadata,
  type ControlMaintenanceJobPayload,
  type InstanceLifecycleJobPayload,
  type PgBossControlJobQueue,
  type ProjectDeletionJobPayload,
  type ProjectRuntimeReconcileJobPayload,
  type VectorDocumentIngestionJobPayload,
} from "../jobs/control-job-queue";
import {
  createStructuredLogger,
  serializeError,
  type StructuredLogger,
} from "../observability/structured-logger";
import { ProjectDeletionService } from "../projects/project-deletion-service";
import { ProjectRuntimeTargetService } from "../projects/project-runtime-target-service";
import { ResourceCatalogService } from "../catalog/resource-catalog-service";
import { ProjectStore } from "../projects/project-store";
import { InstanceService } from "../instances/instance-service";
import { InstanceLifecycleOperationService } from "../instances/instance-lifecycle-service";
import { MemoryRepository } from "../memories/memory-repository";
import {
  MemoryService,
  type ProcessOutboxResult,
} from "../memories/memory-service";

const projectIdPayloadSchema = z.object({ projectId: z.string().trim().min(1) });
const runtimeReconcilePayloadSchema = projectIdPayloadSchema.extend({
  reason: z.enum(["created", "manual", "periodic", "retry"]),
});
const maintenancePayloadSchema = z.object({
  reason: z.enum(["scheduled", "startup"]),
});
const vectorDocumentIngestionPayloadSchema = z.object({
  projectId: z.string().trim().min(1),
  databaseId: z.string().trim().min(1),
  ingestionJobId: z.string().uuid(),
});
const instanceLifecyclePayloadSchema = z.object({
  projectId: z.string().trim().min(1),
  instanceId: z.string().uuid(),
  operationId: z.string().uuid(),
  action: z.enum(["provision", "delete"]),
});

export interface InstanceLifecycleService {
  provision(id: string, operationId?: string): Promise<unknown>;
  recordProvisioningFailure(
    id: string,
    error: unknown,
    terminal: boolean,
    operationId?: string,
  ): Promise<void>;
  deleteRuntime(id: string, operationId?: string): Promise<void>;
  recordDeletionFailure(
    id: string,
    error: unknown,
    operationId?: string,
  ): Promise<void>;
}

export interface ControlWorkerTaskDependencies {
  db?: PrismaClient;
  deletionService?: ProjectDeletionService;
  jobs: PgBossControlJobQueue;
  logger?: StructuredLogger;
  runtimeTargets?: ProjectRuntimeTargetService;
  instances?: (projectId: string) => InstanceLifecycleService;
  instanceLifecycleOperations?: (
    projectId: string,
  ) => Pick<
    InstanceLifecycleOperationService,
    "attachQueueJob" | "create" | "latestForInstance"
  >;
  memories?: (projectId: string) => Pick<MemoryService, "processDueOutbox">;
}

export class ControlWorkerTasks {
  private readonly db: PrismaClient;
  private readonly deletionService: ProjectDeletionService;
  private readonly logger: StructuredLogger;
  private readonly runtimeTargets: ProjectRuntimeTargetService;

  constructor(private readonly dependencies: ControlWorkerTaskDependencies) {
    this.db = dependencies.db ?? prisma();
    this.deletionService =
      dependencies.deletionService ?? new ProjectDeletionService(this.db);
    this.logger =
      dependencies.logger ?? createStructuredLogger("control-worker");
    this.runtimeTargets =
      dependencies.runtimeTargets ?? new ProjectRuntimeTargetService(this.db);
  }

  async projectDeletion(
    job: ControlJobMetadata<ProjectDeletionJobPayload>,
  ): Promise<void> {
    const { projectId } = projectIdPayloadSchema.parse(job.data);
    const startedAt = Date.now();
    const attempt = job.retryCount + 1;
    const task = await this.db.projectDeletionTask.findUnique({
      where: { projectId },
      select: { status: true },
    });
    if (!task || task.status === "completed") {
      this.logJob("info", "job.skipped", job, {
        attempt,
        projectId,
        reason: task ? "already-completed" : "domain-task-absent",
      });
      return;
    }
    await this.db.projectDeletionTask.update({
      where: { projectId },
      data: {
        attempts: attempt,
        lastError: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        queueJobId: job.id,
        status: "running",
      },
    });
    this.logJob("info", "job.started", job, { attempt, projectId });
    try {
      await this.deletionService.purge(projectId);
      this.logJob("info", "job.completed", job, {
        attempt,
        durationMs: Date.now() - startedAt,
        projectId,
      });
    } catch (error) {
      const terminal = job.retryCount >= job.retryLimit;
      await this.db.projectDeletionTask.updateMany({
        where: { projectId, status: "running" },
        data: {
          lastError: safeError(error),
          leaseExpiresAt: null,
          leaseOwner: null,
          status: terminal ? "failed" : "retry",
        },
      });
      this.logJob("error", terminal ? "job.failed" : "job.retry", job, {
        attempt,
        durationMs: Date.now() - startedAt,
        projectId,
        ...serializeError(error),
      });
      throw error;
    }
  }

  async projectRuntimeReconcile(
    job: ControlJobMetadata<ProjectRuntimeReconcileJobPayload>,
  ): Promise<void> {
    const { projectId, reason } = runtimeReconcilePayloadSchema.parse(job.data);
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: { deletedAt: true },
    });
    if (!project || project.deletedAt) {
      this.logJob("info", "job.skipped", job, {
        projectId,
        reason: "project-absent-or-deleting",
      });
      return;
    }
    const startedAt = Date.now();
    this.logJob("info", "job.started", job, { projectId, reason });
    try {
      const reconciled = await this.runtimeTargets.ensureProjectNamespace(
        projectId,
      );
      this.logJob("info", "job.completed", job, {
        durationMs: Date.now() - startedAt,
        outcome: reconciled ? "reconciled" : "disabled",
        projectId,
        reason,
      });
    } catch (error) {
      this.logJob("error", "job.retry", job, {
        durationMs: Date.now() - startedAt,
        projectId,
        reason,
        ...serializeError(error),
      });
      throw error;
    }
  }

  async instanceLifecycle(
    job: ControlJobMetadata<InstanceLifecycleJobPayload>,
  ): Promise<void> {
    const payload = instanceLifecyclePayloadSchema.parse(job.data);
    const startedAt = Date.now();
    const service = this.dependencies.instances?.(payload.projectId)
      ?? new InstanceService(new ProjectStore(payload.projectId, this.db));
    this.logJob("info", "job.started", job, payload);
    try {
      if (payload.action === "provision") {
        await service.provision(payload.instanceId, payload.operationId);
      } else {
        await service.deleteRuntime(payload.instanceId, payload.operationId);
      }
      this.logJob("info", "job.completed", job, {
        ...payload,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (payload.action === "provision") {
        await service.recordProvisioningFailure(
          payload.instanceId,
          error,
          job.retryCount >= job.retryLimit,
          payload.operationId,
        );
      } else {
        await service.recordDeletionFailure(
          payload.instanceId,
          error,
          payload.operationId,
        );
      }
      this.logJob("error", "job.retry", job, {
        ...payload,
        durationMs: Date.now() - startedAt,
        ...serializeError(error),
      });
      throw error;
    }
  }

  async maintenance(
    job: ControlJobMetadata<ControlMaintenanceJobPayload>,
  ): Promise<void> {
    const { reason } = maintenancePayloadSchema.parse(job.data);
    const startedAt = Date.now();
    const deletionJobsAttached = await this.attachHistoricalDeletionJobs();
    const instanceJobsAttached = await this.attachInstanceLifecycleJobs();
    const memoryOutbox = await this.drainMemoryOutbox();
    const projectIds = await this.runtimeTargets.reconciliationCandidateIds();
    let runtimeJobsEnqueued = 0;
    for (const projectId of projectIds) {
      const jobId = await this.dependencies.jobs.enqueueProjectRuntimeReconcile(
        projectId,
        "periodic",
      );
      if (jobId) runtimeJobsEnqueued += 1;
    }
    const queueStatus = (await this.dependencies.jobs.boss.getQueues([
      CONTROL_JOB_QUEUES.projectDeletion,
      CONTROL_JOB_QUEUES.instanceLifecycle,
      CONTROL_JOB_QUEUES.projectRuntimeReconcile,
      CONTROL_JOB_QUEUES.vectorDocumentIngestion,
      CONTROL_JOB_QUEUES.deadLetter,
    ])).map((queue) => ({
      active: queue.activeCount,
      deferred: queue.deferredCount,
      failed: queue.failedCount,
      name: queue.name,
      ready: queue.readyCount,
    }));
    this.logJob("info", "maintenance.completed", job, {
      deletionJobsAttached,
      instanceJobsAttached,
      durationMs: Date.now() - startedAt,
      queueStatus,
      reason,
      runtimeJobsEnqueued,
      memoryOutbox,
    });
  }

  async vectorDocumentIngestion(
    job: ControlJobMetadata<VectorDocumentIngestionJobPayload>,
  ): Promise<void> {
    const payload = vectorDocumentIngestionPayloadSchema.parse(job.data);
    const startedAt = Date.now();
    this.logJob("info", "job.started", job, payload);
    try {
      const catalog = new ResourceCatalogService(new ProjectStore(payload.projectId, this.db));
      await catalog.vectorDocuments.process(payload, job.retryCount);
      this.logJob("info", "job.completed", job, {
        ...payload,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.logJob("error", "job.retry", job, {
        ...payload,
        durationMs: Date.now() - startedAt,
        ...serializeError(error),
      });
      throw error;
    }
  }

  async attachHistoricalDeletionJobs(referenceTime = new Date()): Promise<number> {
    const tasks = await this.db.projectDeletionTask.findMany({
      where: {
        queueJobId: null,
        OR: [
          { status: { in: ["scheduled", "retry"] } },
          {
            status: "running",
            OR: [
              { leaseExpiresAt: null },
              { leaseExpiresAt: { lte: referenceTime } },
            ],
          },
        ],
      },
      orderBy: { scheduledFor: "asc" },
      select: { projectId: true },
    });
    let attached = 0;
    for (const { projectId } of tasks) {
      await this.db.$transaction(async (transaction) => {
        const task = await transaction.projectDeletionTask.findUnique({
          where: { projectId },
          select: {
            leaseExpiresAt: true,
            queueJobId: true,
            scheduledFor: true,
            status: true,
          },
        });
        if (
          !task
          || task.queueJobId
          || task.status === "completed"
          || task.status === "failed"
          || (
            task.status === "running"
            && task.leaseExpiresAt
            && task.leaseExpiresAt > referenceTime
          )
        ) return;
        const queueJobId =
          await this.dependencies.jobs.enqueueProjectDeletion(
            projectId,
            task.scheduledFor,
            transaction,
          );
        await transaction.projectDeletionTask.update({
          where: { projectId },
          data: {
            leaseExpiresAt: null,
            leaseOwner: null,
            queueJobId,
            status: task.status === "running" ? "retry" : task.status,
          },
        });
        attached += 1;
      });
    }
    return attached;
  }

  async attachInstanceLifecycleJobs(): Promise<number> {
    if (!this.dependencies.jobs.enqueueInstanceLifecycle) return 0;
    const records = await this.db.agentRecord.findMany({
      where: {
        kind: "SUPERVISOR",
        OR: [
          {
            deletedAt: null,
            payload: { path: ["status"], equals: "PROVISIONING" },
          },
          {
            deletedAt: null,
            AND: [
              { payload: { path: ["status"], equals: "FAILED" } },
              { payload: { path: ["runtimePhase"], equals: "NOT_FOUND" } },
            ],
          },
          {
            deletedAt: { not: null },
            payload: { path: ["status"], equals: "DESTROYING" },
          },
        ],
      },
      select: { deletedAt: true, id: true, payload: true, projectId: true },
    });
    let attached = 0;
    for (const record of records) {
      const lifecycle = record.payload as {
        deletionCompletedAt?: string;
        modelRoutingBindingRevokedAt?: string;
        status?: string;
      };
      const status = lifecycle.status;
      const action = record.deletedAt || status === "DESTROYING"
        ? "delete"
        : "provision";
      if (
        action === "delete"
        && lifecycle.deletionCompletedAt
        && lifecycle.modelRoutingBindingRevokedAt
      ) continue;
      const operationService = this.dependencies.instanceLifecycleOperations?.(
        record.projectId,
      ) ?? new InstanceLifecycleOperationService(record.projectId, this.db);
      const existingOperation = await operationService.latestForInstance(
        record.id,
        action,
      );
      const operation = existingOperation?.status === "queued"
        || existingOperation?.status === "running"
        ? existingOperation
        : await operationService.create(record.id, action);
      const id = await this.dependencies.jobs.enqueueInstanceLifecycle({
        projectId: record.projectId,
        instanceId: record.id,
        operationId: operation.id,
        action,
      });
      if (id) {
        await operationService.attachQueueJob(operation.id, id);
        attached += 1;
      }
    }
    return attached;
  }

  async drainMemoryOutbox(
    referenceTime = new Date(),
  ): Promise<ProcessOutboxResult> {
    const total: ProcessOutboxResult = {
      claimed: 0,
      deadLettered: 0,
      delivered: 0,
      retried: 0,
    };
    const staleBefore = new Date(referenceTime.getTime() - 5 * 60_000);
    const projects = await this.db.memoryOutboxRecord.findMany({
      where: {
        OR: [
          {
            status: { in: ["pending", "retry"] },
            nextRetryAt: { lte: referenceTime },
          },
          { status: "processing", updatedAt: { lte: staleBefore } },
        ],
      },
      distinct: ["projectId"],
      orderBy: { projectId: "asc" },
      select: { projectId: true },
      take: 100,
    });
    for (const { projectId } of projects) {
      const service = this.dependencies.memories?.(projectId)
        ?? new MemoryService(new MemoryRepository(projectId, this.db));
      const processed = await service.processDueOutbox(25, referenceTime);
      total.claimed += processed.claimed;
      total.deadLettered += processed.deadLettered;
      total.delivered += processed.delivered;
      total.retried += processed.retried;
    }
    return total;
  }

  register(): Promise<string[]> {
    const { boss } = this.dependencies.jobs;
    return Promise.all([
      boss.work<InstanceLifecycleJobPayload>(
        CONTROL_JOB_QUEUES.instanceLifecycle,
        {
          groupConcurrency: 1,
          includeMetadata: true,
          localConcurrency: 2,
          pollingIntervalSeconds: 2,
        },
        async ([job]) => this.instanceLifecycle(
          job! as ControlJobMetadata<InstanceLifecycleJobPayload>,
        ),
      ),
      boss.work<ProjectDeletionJobPayload>(
        CONTROL_JOB_QUEUES.projectDeletion,
        {
          groupConcurrency: 1,
          includeMetadata: true,
          localConcurrency: 2,
          pollingIntervalSeconds: 2,
        },
        async ([job]) => this.projectDeletion(
          job! as ControlJobMetadata<ProjectDeletionJobPayload>,
        ),
      ),
      boss.work<ProjectRuntimeReconcileJobPayload>(
        CONTROL_JOB_QUEUES.projectRuntimeReconcile,
        {
          groupConcurrency: 1,
          includeMetadata: true,
          // A compatibility reconciliation can run the official OpenShell
          // Helm client for several minutes. Keep one child Helm process per
          // Worker so a burst of stale Projects cannot exhaust Worker memory.
          localConcurrency: 1,
          pollingIntervalSeconds: 2,
        },
        async ([job]) => this.projectRuntimeReconcile(
          job! as ControlJobMetadata<ProjectRuntimeReconcileJobPayload>,
        ),
      ),
      boss.work<VectorDocumentIngestionJobPayload>(
        CONTROL_JOB_QUEUES.vectorDocumentIngestion,
        {
          groupConcurrency: 1,
          includeMetadata: true,
          localConcurrency: 1,
          pollingIntervalSeconds: 2,
        },
        async ([job]) => this.vectorDocumentIngestion(
          job! as ControlJobMetadata<VectorDocumentIngestionJobPayload>,
        ),
      ),
      boss.work<ControlMaintenanceJobPayload>(
        CONTROL_JOB_QUEUES.maintenance,
        { includeMetadata: true, pollingIntervalSeconds: 2 },
        async ([job]) => this.maintenance(
          job! as ControlJobMetadata<ControlMaintenanceJobPayload>,
        ),
      ),
    ]);
  }

  private logJob(
    level: "error" | "info",
    event: string,
    job: ControlJobMetadata<object>,
    fields: Record<string, unknown>,
  ): void {
    this.logger.log(level, event, {
      jobId: job.id,
      queue: job.name,
      retryCount: job.retryCount,
      retryLimit: job.retryLimit,
      ...fields,
    });
  }
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4_000);
}
