import { PgBoss, fromPrisma, type JobWithMetadata } from "pg-boss";
import { getControlConfig } from "../config/control-config";
import type { Prisma } from "../generated/prisma/client";

export const CONTROL_JOB_SCHEMA = "tali_control_jobs";
export const CONTROL_JOB_QUEUES = {
  deadLetter: "control-dead-letter",
  instanceLifecycle: "control-instance-lifecycle",
  maintenance: "control-maintenance",
  projectDeletion: "control-project-delete",
  projectRuntimeReconcile: "control-project-runtime-reconcile",
  vectorDocumentIngestion: "control-vector-document-ingestion",
} as const;

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

export interface ProjectDeletionJobPayload {
  projectId: string;
}

export interface ProjectRuntimeReconcileJobPayload {
  projectId: string;
  reason: "created" | "manual" | "periodic" | "retry";
}

export interface ControlMaintenanceJobPayload {
  reason: "scheduled" | "startup";
}

export interface VectorDocumentIngestionJobPayload {
  projectId: string;
  databaseId: string;
  ingestionJobId: string;
}

export interface InstanceLifecycleJobPayload {
  projectId: string;
  instanceId: string;
  operationId: string;
  action: "provision" | "delete";
}

export type ControlJobMetadata<T extends object> = JobWithMetadata<T>;

export interface ControlJobPublisher {
  enqueueInstanceLifecycle?(
    payload: InstanceLifecycleJobPayload,
    transaction?: Prisma.TransactionClient,
  ): Promise<string | undefined>;
  enqueueProjectDeletion(
    projectId: string,
    scheduledFor: Date,
    transaction?: Prisma.TransactionClient,
  ): Promise<string>;
  enqueueProjectRuntimeReconcile(
    projectId: string,
    reason: ProjectRuntimeReconcileJobPayload["reason"],
    transaction?: Prisma.TransactionClient,
  ): Promise<string | undefined>;
  enqueueVectorDocumentIngestion?(
    payload: VectorDocumentIngestionJobPayload,
    transaction?: Prisma.TransactionClient,
  ): Promise<string>;
  start(): Promise<void>;
}

export class PgBossControlJobQueue implements ControlJobPublisher {
  readonly boss: PgBoss;
  private startPromise: Promise<void> | undefined;
  private started = false;

  constructor(boss?: PgBoss) {
    this.boss = boss ?? new PgBoss({
      application_name:
        process.env.CONTROL_WORKER_ROLE ?? "tali-control-job-producer",
      connectionString: getControlConfig().database.url,
      max: 5,
      persistQueueStats: true,
      queueStatRetentionDays: 30,
      schema: CONTROL_JOB_SCHEMA,
      useListenNotify: true,
    });
  }

  async start(): Promise<void> {
    this.startPromise ??= this.startQueue().catch((error) => {
      this.startPromise = undefined;
      throw error;
    });
    await this.startPromise;
  }

  async stop(timeoutMs = 30_000): Promise<void> {
    if (!this.startPromise && !this.started) return;
    await this.boss.stop({
      close: true,
      graceful: true,
      timeout: timeoutMs,
    });
    this.startPromise = undefined;
    this.started = false;
  }

  async enqueueProjectDeletion(
    projectId: string,
    scheduledFor: Date,
    transaction?: Prisma.TransactionClient,
  ): Promise<string> {
    await this.start();
    const id = await this.boss.send(
      CONTROL_JOB_QUEUES.projectDeletion,
      { projectId } satisfies ProjectDeletionJobPayload,
      {
        group: { id: projectId },
        priority: 100,
        singletonKey: projectId,
        startAfter: scheduledFor,
        ...(transaction ? { db: fromPrisma(transaction) } : {}),
      },
    );
    if (!id) {
      throw new Error(`Unable to enqueue Project deletion for ${projectId}.`);
    }
    return id;
  }

  async enqueueInstanceLifecycle(
    payload: InstanceLifecycleJobPayload,
    transaction?: Prisma.TransactionClient,
  ): Promise<string | undefined> {
    await this.start();
    const id = await this.boss.send(
      CONTROL_JOB_QUEUES.instanceLifecycle,
      payload,
      {
        group: { id: `${payload.projectId}:${payload.instanceId}` },
        priority: payload.action === "delete" ? 90 : 60,
        singletonKey:
          `${payload.projectId}:${payload.instanceId}:${payload.action}`,
        ...(transaction ? { db: fromPrisma(transaction) } : {}),
      },
    );
    return id ?? undefined;
  }

  async enqueueProjectRuntimeReconcile(
    projectId: string,
    reason: ProjectRuntimeReconcileJobPayload["reason"],
    transaction?: Prisma.TransactionClient,
  ): Promise<string | undefined> {
    await this.start();
    const id = await this.boss.send(
      CONTROL_JOB_QUEUES.projectRuntimeReconcile,
      { projectId, reason } satisfies ProjectRuntimeReconcileJobPayload,
      {
        group: { id: projectId },
        priority: reason === "created" || reason === "retry" ? 50 : 10,
        singletonKey: projectId,
        ...(transaction ? { db: fromPrisma(transaction) } : {}),
      },
    );
    return id ?? undefined;
  }

  async enqueueVectorDocumentIngestion(
    payload: VectorDocumentIngestionJobPayload,
    transaction?: Prisma.TransactionClient,
  ): Promise<string> {
    await this.start();
    const id = await this.boss.send(
      CONTROL_JOB_QUEUES.vectorDocumentIngestion,
      payload,
      {
        group: { id: `${payload.projectId}:${payload.databaseId}` },
        priority: 40,
        singletonKey: payload.ingestionJobId,
        ...(transaction ? { db: fromPrisma(transaction) } : {}),
      },
    );
    if (!id) {
      throw new Error(`Unable to enqueue Vector Document ingestion ${payload.ingestionJobId}.`);
    }
    return id;
  }

  async enqueueMaintenance(
    reason: ControlMaintenanceJobPayload["reason"],
  ): Promise<string | undefined> {
    await this.start();
    return await this.boss.send(
      CONTROL_JOB_QUEUES.maintenance,
      { reason } satisfies ControlMaintenanceJobPayload,
    ) ?? undefined;
  }

  async scheduleMaintenance(): Promise<void> {
    await this.start();
    await this.boss.schedule(
      CONTROL_JOB_QUEUES.maintenance,
      "* * * * *",
      { reason: "scheduled" } satisfies ControlMaintenanceJobPayload,
      { key: "control-plane-maintenance" },
    );
  }

  private async startQueue(): Promise<void> {
    await this.boss.start();
    this.started = true;
    await this.ensureQueues();
  }

  private async ensureQueues(): Promise<void> {
    await this.boss.createQueue(CONTROL_JOB_QUEUES.deadLetter, {
      deleteAfterSeconds: NINETY_DAYS_SECONDS,
      retentionSeconds: NINETY_DAYS_SECONDS,
      retryLimit: 0,
    });

    const durableTaskOptions = {
      deadLetter: CONTROL_JOB_QUEUES.deadLetter,
      deleteAfterSeconds: THIRTY_DAYS_SECONDS,
      expireInSeconds: 60 * 60,
      heartbeatSeconds: 60,
      notify: true,
      retentionSeconds: THIRTY_DAYS_SECONDS,
      retryBackoff: true,
      retryDelay: 30,
      retryDelayMax: 30 * 60,
      retryLimit: 25,
    } as const;
    for (const name of [
      CONTROL_JOB_QUEUES.instanceLifecycle,
      CONTROL_JOB_QUEUES.projectDeletion,
      CONTROL_JOB_QUEUES.projectRuntimeReconcile,
      CONTROL_JOB_QUEUES.vectorDocumentIngestion,
    ]) {
      await this.boss.createQueue(name, {
        ...durableTaskOptions,
        policy: "exclusive",
      });
      await this.boss.updateQueue(name, durableTaskOptions);
    }

    const maintenanceOptions = {
      deleteAfterSeconds: THIRTY_DAYS_SECONDS,
      expireInSeconds: 5 * 60,
      notify: true,
      policy: "exclusive" as const,
      retentionSeconds: THIRTY_DAYS_SECONDS,
      retryBackoff: true,
      retryDelay: 10,
      retryDelayMax: 60,
      retryLimit: 5,
    };
    await this.boss.createQueue(
      CONTROL_JOB_QUEUES.maintenance,
      maintenanceOptions,
    );
    const { policy: _policy, ...maintenanceUpdates } = maintenanceOptions;
    await this.boss.updateQueue(
      CONTROL_JOB_QUEUES.maintenance,
      maintenanceUpdates,
    );
  }
}

let sharedControlJobQueue: PgBossControlJobQueue | undefined;

export function controlJobQueue(): PgBossControlJobQueue {
  sharedControlJobQueue ??= new PgBossControlJobQueue();
  return sharedControlJobQueue;
}
