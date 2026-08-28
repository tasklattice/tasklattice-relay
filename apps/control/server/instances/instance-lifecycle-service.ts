import { randomUUID } from "node:crypto";
import type {
  InstanceLifecycleAction,
  InstanceLifecycleEvent,
  InstanceLifecycleEventLevel,
  InstanceLifecycleOperation,
  InstanceLifecycleStatus,
  ProvisioningStage,
} from "@tali/contracts";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { redactRuntimeDiagnostic } from "./instance-http-view";

const stageProgress: Record<ProvisioningStage, number> = {
  QUEUED: 8,
  PROVIDER: 20,
  SANDBOX: 38,
  POD: 58,
  RUNTIME: 78,
  ENDPOINT: 92,
  READY: 100,
};

type OperationRow = Awaited<ReturnType<PrismaClient["instanceLifecycleOperation"]["findFirstOrThrow"]>>;
type EventRow = Awaited<ReturnType<PrismaClient["instanceLifecycleEvent"]["findFirstOrThrow"]>>;

function operationView(
  row: OperationRow,
  events: EventRow[],
): InstanceLifecycleOperation {
  return {
    id: row.id,
    instanceId: row.instanceId,
    action: row.action as InstanceLifecycleAction,
    status: row.status as InstanceLifecycleStatus,
    ...(row.stage ? { stage: row.stage as ProvisioningStage } : {}),
    progress: row.progress,
    currentMessage: row.currentMessage,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.errorSummary ? { errorSummary: row.errorSummary } : {}),
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.finishedAt ? { finishedAt: row.finishedAt.toISOString() } : {}),
    updatedAt: row.updatedAt.toISOString(),
    events: events.map(eventView),
  };
}

function eventView(row: EventRow): InstanceLifecycleEvent {
  const payload = row.payload;
  return {
    operationId: row.operationId,
    sequence: row.sequence,
    type: row.type,
    level: row.level as InstanceLifecycleEventLevel,
    ...(row.stage ? { stage: row.stage as ProvisioningStage } : {}),
    message: row.message,
    ...(payload && typeof payload === "object" && !Array.isArray(payload)
      ? { payload: payload as Record<string, unknown> }
      : {}),
    occurredAt: row.occurredAt.toISOString(),
  };
}

export class InstanceLifecycleOperationService {
  constructor(
    readonly projectId: string,
    readonly db: PrismaClient = prisma(),
  ) {}

  async create(
    instanceId: string,
    action: InstanceLifecycleAction,
  ): Promise<InstanceLifecycleOperation> {
    const id = randomUUID();
    const now = new Date();
    const message = action === "provision"
      ? "Agent request accepted."
      : "Instance deletion accepted.";
    await this.db.$transaction(async (transaction) => {
      await transaction.instanceLifecycleOperation.create({
        data: {
          projectId: this.projectId,
          id,
          instanceId,
          action,
          status: "queued",
          stage: "QUEUED",
          progress: stageProgress.QUEUED,
          currentMessage: message,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      });
      await transaction.instanceLifecycleEvent.create({
        data: {
          projectId: this.projectId,
          operationId: id,
          sequence: 1,
          type: "accepted",
          level: "info",
          stage: "QUEUED",
          message,
          occurredAt: now,
        },
      });
    });
    return (await this.get(id))!;
  }

  async attachQueueJob(operationId: string, queueJobId: string): Promise<void> {
    await this.db.instanceLifecycleOperation.update({
      where: { projectId_id: { projectId: this.projectId, id: operationId } },
      data: { queueJobId },
    });
  }

  async get(
    operationId: string,
    afterSequence = 0,
  ): Promise<InstanceLifecycleOperation | undefined> {
    const row = await this.db.instanceLifecycleOperation.findUnique({
      where: { projectId_id: { projectId: this.projectId, id: operationId } },
    });
    if (!row) return undefined;
    const events = await this.db.instanceLifecycleEvent.findMany({
      where: {
        projectId: this.projectId,
        operationId,
        sequence: { gt: afterSequence },
      },
      orderBy: { sequence: "asc" },
      take: 1_000,
    });
    return operationView(row, events);
  }

  async latestForInstance(
    instanceId: string,
    action: InstanceLifecycleAction = "provision",
  ): Promise<InstanceLifecycleOperation | undefined> {
    const row = await this.db.instanceLifecycleOperation.findFirst({
      where: { projectId: this.projectId, instanceId, action },
      orderBy: { createdAt: "desc" },
    });
    return row ? this.get(row.id) : undefined;
  }

  async start(operationId: string): Promise<void> {
    await this.append(operationId, {
      status: "running",
      stage: "PROVIDER",
      progress: stageProgress.PROVIDER,
      currentMessage: "Control Worker started the lifecycle operation.",
      startedAt: new Date(),
      type: "started",
      level: "info",
      messages: ["Control Worker started the lifecycle operation."],
    });
  }

  async recordStage(
    operationId: string,
    stage: ProvisioningStage,
    message: string,
    logs: readonly string[] = [],
  ): Promise<void> {
    const sanitized = logs.map(redactRuntimeDiagnostic).filter(Boolean);
    await this.append(operationId, {
      status: stage === "READY" ? "succeeded" : "running",
      stage,
      progress: stageProgress[stage],
      currentMessage: message,
      ...(stage === "READY" ? { finishedAt: new Date() } : {}),
      type: stage === "READY" ? "completed" : "stage",
      level: "info",
      messages: [message, ...sanitized.filter((line) => line !== message)],
    });
  }

  async recordFailure(
    operationId: string,
    error: unknown,
    terminal: boolean,
  ): Promise<void> {
    const summary = redactRuntimeDiagnostic(
      error instanceof Error ? error.message : String(error),
    );
    await this.append(operationId, {
      status: terminal ? "failed" : "queued",
      currentMessage: terminal
        ? "Instance provisioning failed."
        : "Provisioning retry scheduled.",
      errorCode: terminal ? "INSTANCE_PROVISIONING_FAILED" : null,
      errorSummary: summary,
      ...(terminal ? { finishedAt: new Date() } : {}),
      type: terminal ? "failed" : "retry",
      level: terminal ? "error" : "warning",
      messages: [summary],
    });
  }

  private async append(
    operationId: string,
    update: {
      status: InstanceLifecycleStatus;
      stage?: ProvisioningStage;
      progress?: number;
      currentMessage: string;
      errorCode?: string | null;
      errorSummary?: string | null;
      startedAt?: Date;
      finishedAt?: Date;
      type: string;
      level: InstanceLifecycleEventLevel;
      messages: readonly string[];
    },
  ): Promise<void> {
    await this.db.$transaction(async (transaction) => {
      const current = await transaction.instanceLifecycleOperation.findUniqueOrThrow({
        where: { projectId_id: { projectId: this.projectId, id: operationId } },
      });
      const candidates = update.messages.length
        ? update.messages
        : [update.currentMessage];
      const existingEvents = await transaction.instanceLifecycleEvent.findMany({
        where: { projectId: this.projectId, operationId },
        select: { message: true },
        orderBy: { sequence: "desc" },
        take: 1_000,
      });
      const existingMessages = new Set(existingEvents.map((event) => event.message));
      const messages = [...new Set(candidates)].filter(
        (message) => !existingMessages.has(message),
      );
      const revision = current.revision + messages.length;
      const requestedProgress = update.progress ?? current.progress;
      const advances = requestedProgress >= current.progress;
      const terminal = current.status === "succeeded" || current.status === "failed";
      await transaction.instanceLifecycleOperation.update({
        where: { projectId_id: { projectId: this.projectId, id: operationId } },
        data: {
          status: terminal ? current.status : update.status,
          ...(update.stage && advances ? { stage: update.stage } : {}),
          progress: Math.max(current.progress, requestedProgress),
          currentMessage: advances || terminal
            ? update.currentMessage
            : current.currentMessage,
          ...(update.errorCode !== undefined ? { errorCode: update.errorCode } : {}),
          ...(update.errorSummary !== undefined
            ? { errorSummary: update.errorSummary }
            : {}),
          ...(update.startedAt ? { startedAt: update.startedAt } : {}),
          ...(update.finishedAt ? { finishedAt: update.finishedAt } : {}),
          revision,
        },
      });
      if (messages.length) {
        await transaction.instanceLifecycleEvent.createMany({
          data: messages.map((message, index) => ({
            projectId: this.projectId,
            operationId,
            sequence: current.revision + index + 1,
            type: index === 0 ? update.type : "log",
            level: update.level,
            ...(update.stage ? { stage: update.stage } : {}),
            message,
          })),
        });
      }
    });
  }
}
