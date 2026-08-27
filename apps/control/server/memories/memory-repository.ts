import { createHash } from "node:crypto";
import type {
  MemoryBindingStatus,
  MemoryRuntimeType,
  MemoryStatus,
} from "@tali/contracts";
import {
  Prisma,
  type MemoryBinding,
  type MemoryOutboxRecord,
  type MemoryRecord,
  type PrismaClient,
} from "../generated/prisma/client";
import {
  transitionMemoryBindingStatus,
  transitionMemoryStatus,
} from "./memory-domain";

export interface CreateMemoryRecordInput {
  displayName: string;
  idempotencyKey: string;
  provider?: string;
  retentionPolicy?: Record<string, unknown>;
}

export interface BindPrimaryMemoryInput {
  memoryId: string;
  instanceId: string;
  runtimeType: MemoryRuntimeType;
  idempotencyKey: string;
  actorId?: string;
  attachedAt?: Date;
}

export interface MemoryTransitionInput {
  memoryId: string;
  to: MemoryStatus;
  actorId: string;
  action?: string;
  providerRef?: string | null;
  lastActivityAt?: Date | null;
  lastErrorSummary?: string | null;
  deletedAt?: Date | null;
}

export interface EnqueueMemoryOutboxInput {
  memoryId: string;
  conversationId: string;
  eventType: string;
  encryptedPayload: string;
  idempotencyKey: string;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function safeErrorSummary(value: string | null): string | null {
  return value?.slice(0, 1_000) ?? null;
}

function memoryLockParts(projectId: string, memoryId: string): [number, number] {
  const digest = createHash("sha256")
    .update(projectId)
    .update("\0")
    .update(memoryId)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

/**
 * Project-scoped persistence boundary. Callers never pass a Project ID to an
 * individual operation, preventing accidental cross-Project predicates.
 */
export class MemoryRepository {
  constructor(
    readonly projectId: string,
    private readonly database: PrismaClient,
  ) {}

  db(): PrismaClient {
    return this.database;
  }

  async createMemory(input: CreateMemoryRecordInput): Promise<MemoryRecord> {
    return this.database.memoryRecord.upsert({
      where: {
        projectId_idempotencyKey: {
          projectId: this.projectId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      update: {},
      create: {
        projectId: this.projectId,
        displayName: input.displayName.trim(),
        provider: input.provider ?? "hindsight",
        idempotencyKey: input.idempotencyKey,
        retentionPolicy: jsonInput(input.retentionPolicy ?? {}),
      },
    });
  }

  async getMemory(
    memoryId: string,
    includeDeleted = false,
  ): Promise<MemoryRecord | null> {
    return this.database.memoryRecord.findFirst({
      where: {
        projectId: this.projectId,
        id: memoryId,
        ...(!includeDeleted ? { deletedAt: null } : {}),
      },
    });
  }

  async transitionMemory(input: MemoryTransitionInput): Promise<MemoryRecord> {
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.memoryRecord.findUniqueOrThrow({
        where: {
          projectId_id: { projectId: this.projectId, id: input.memoryId },
        },
      });
      const transition = transitionMemoryStatus(current.status, input.to);
      const updated = await transaction.memoryRecord.update({
        where: {
          projectId_id: { projectId: this.projectId, id: input.memoryId },
        },
        data: {
          status: input.to,
          ...(input.providerRef !== undefined
            ? { providerRef: input.providerRef }
            : {}),
          ...(input.lastActivityAt !== undefined
            ? { lastActivityAt: input.lastActivityAt }
            : {}),
          ...(input.lastErrorSummary !== undefined
            ? {
                lastErrorSummary: safeErrorSummary(input.lastErrorSummary),
              }
            : {}),
          ...(input.deletedAt !== undefined ? { deletedAt: input.deletedAt } : {}),
        },
      });
      if (transition.changed || input.action) {
        await transaction.memoryCurationEvent.create({
          data: {
            projectId: this.projectId,
            memoryId: current.id,
            providerItemId: current.id,
            action: input.action ?? transition.event!.type,
            actorId: input.actorId,
            beforeSnapshot: jsonInput({ status: current.status }),
            afterSnapshot: jsonInput({ status: updated.status }),
          },
        });
      }
      return updated;
    });
  }

  async bindPrimary(input: BindPrimaryMemoryInput): Promise<MemoryBinding> {
    return this.database.$transaction(async (transaction) => {
      await this.lockMemory(transaction, input.memoryId);
      const existing = await transaction.memoryBinding.findUnique({
        where: {
          projectId_idempotencyKey: {
            projectId: this.projectId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) return existing;

      const memory = await transaction.memoryRecord.findUnique({
        where: {
          projectId_id: { projectId: this.projectId, id: input.memoryId },
        },
        select: { status: true },
      });
      if (!memory || memory.status !== "ready") {
        throw new Error("Select a ready, unbound Memory.");
      }

      const pending = await transaction.memoryBinding.create({
        data: {
          projectId: this.projectId,
          memoryId: input.memoryId,
          instanceId: input.instanceId,
          runtimeType: input.runtimeType,
          idempotencyKey: input.idempotencyKey,
        },
      });
      transitionMemoryBindingStatus(pending.status, "active");
      const active = await transaction.memoryBinding.update({
        where: {
          projectId_id: { projectId: this.projectId, id: pending.id },
        },
        data: {
          status: "active",
          attachedAt: input.attachedAt ?? new Date(),
        },
      });
      await transaction.memoryCurationEvent.create({
        data: {
          projectId: this.projectId,
          memoryId: input.memoryId,
          providerItemId: active.id,
          action: "memory.binding.attached",
          actorId: input.actorId ?? "memory-service",
          beforeSnapshot: jsonInput({ status: pending.status }),
          afterSnapshot: jsonInput({
            instanceId: active.instanceId,
            runtimeType: active.runtimeType,
            status: active.status,
          }),
        },
      });
      return active;
    });
  }

  async startDeletion(memoryId: string, actorId: string): Promise<MemoryRecord> {
    return this.database.$transaction(async (transaction) => {
      await this.lockMemory(transaction, memoryId);
      const current = await transaction.memoryRecord.findUniqueOrThrow({
        where: { projectId_id: { projectId: this.projectId, id: memoryId } },
      });
      if (current.status === "deleting") return current;
      const activeBinding = await transaction.memoryBinding.findFirst({
        where: {
          projectId: this.projectId,
          memoryId,
          bindingKind: "primary",
          status: "active",
        },
        select: { id: true },
      });
      if (activeBinding) {
        throw new Error("Detach this Memory from its Agent before deleting it.");
      }
      transitionMemoryStatus(current.status, "deleting");
      const updated = await transaction.memoryRecord.update({
        where: { projectId_id: { projectId: this.projectId, id: memoryId } },
        data: { status: "deleting" },
      });
      await transaction.memoryCurationEvent.create({
        data: {
          projectId: this.projectId,
          memoryId,
          providerItemId: memoryId,
          action: "memory.deletion_started",
          actorId,
          beforeSnapshot: jsonInput({ status: current.status }),
          afterSnapshot: jsonInput({ status: updated.status }),
        },
      });
      return updated;
    });
  }

  async getActiveBindingForInstance(
    instanceId: string,
  ): Promise<MemoryBinding | null> {
    return this.database.memoryBinding.findFirst({
      where: {
        projectId: this.projectId,
        instanceId,
        bindingKind: "primary",
        status: "active",
      },
    });
  }

  async getActiveBindingForMemory(memoryId: string): Promise<MemoryBinding | null> {
    return this.database.memoryBinding.findFirst({
      where: {
        projectId: this.projectId,
        memoryId,
        bindingKind: "primary",
        status: "active",
      },
    });
  }

  async detachPrimaryForInstance(
    instanceId: string,
    actorId = "memory-service",
    detachedAt = new Date(),
  ): Promise<MemoryBinding | null> {
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.memoryBinding.findFirst({
        where: {
          projectId: this.projectId,
          instanceId,
          bindingKind: "primary",
          status: "active",
        },
      });
      if (!current) return null;
      transitionMemoryBindingStatus(current.status, "detached");
      const detached = await transaction.memoryBinding.update({
        where: {
          projectId_id: { projectId: this.projectId, id: current.id },
        },
        data: { status: "detached", detachedAt },
      });
      await transaction.memoryCurationEvent.create({
        data: {
          projectId: this.projectId,
          memoryId: current.memoryId,
          providerItemId: current.id,
          action: "memory.binding.detached",
          actorId,
          beforeSnapshot: jsonInput({
            instanceId: current.instanceId,
            runtimeType: current.runtimeType,
            status: current.status,
          }),
          afterSnapshot: jsonInput({ status: detached.status }),
        },
      });
      return detached;
    });
  }

  /** Remove a binding created by an Agent request that never became accepted. */
  async rollbackBinding(bindingId: string, actorId: string): Promise<string | null> {
    return this.database.$transaction(async (transaction) => {
      const binding = await transaction.memoryBinding.findUnique({
        where: {
          projectId_id: { projectId: this.projectId, id: bindingId },
        },
      });
      if (!binding) return null;
      await transaction.memoryBinding.delete({
        where: {
          projectId_id: { projectId: this.projectId, id: binding.id },
        },
      });
      await transaction.memoryCurationEvent.create({
        data: {
          projectId: this.projectId,
          memoryId: binding.memoryId,
          providerItemId: binding.id,
          action: "memory.binding.creation_rolled_back",
          actorId,
          beforeSnapshot: jsonInput({
            instanceId: binding.instanceId,
            runtimeType: binding.runtimeType,
            status: binding.status,
          }),
          afterSnapshot: jsonInput({ status: "absent" }),
        },
      });
      return binding.memoryId;
    });
  }

  async enqueueOutbox(input: EnqueueMemoryOutboxInput): Promise<MemoryOutboxRecord> {
    return this.database.memoryOutboxRecord.upsert({
      where: {
        projectId_idempotencyKey: {
          projectId: this.projectId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      update: {},
      create: {
        projectId: this.projectId,
        memoryId: input.memoryId,
        conversationId: input.conversationId,
        eventType: input.eventType,
        encryptedPayload: input.encryptedPayload,
        idempotencyKey: input.idempotencyKey,
      },
    });
  }

  async claimDueOutbox(
    limit: number,
    now = new Date(),
    staleBefore = new Date(now.getTime() - 5 * 60_000),
  ): Promise<MemoryOutboxRecord[]> {
    const candidates = await this.database.memoryOutboxRecord.findMany({
      where: {
        projectId: this.projectId,
        OR: [
          {
            status: { in: ["pending", "retry"] },
            nextRetryAt: { lte: now },
          },
          { status: "processing", updatedAt: { lte: staleBefore } },
        ],
      },
      orderBy: [{ nextRetryAt: "asc" }, { createdAt: "asc" }],
      take: Math.max(1, Math.min(limit, 100)),
    });
    const claimed: MemoryOutboxRecord[] = [];
    for (const candidate of candidates) {
      const result = await this.database.memoryOutboxRecord.updateMany({
        where: {
          projectId: this.projectId,
          id: candidate.id,
          OR: [
            {
              status: { in: ["pending", "retry"] },
              nextRetryAt: { lte: now },
            },
            { status: "processing", updatedAt: { lte: staleBefore } },
          ],
        },
        data: { status: "processing" },
      });
      if (result.count) {
        claimed.push({ ...candidate, status: "processing", updatedAt: now });
      }
    }
    return claimed;
  }

  async markOutboxDelivered(
    outboxId: string,
    deliveredAt = new Date(),
  ): Promise<void> {
    await this.database.memoryOutboxRecord.updateMany({
      where: {
        projectId: this.projectId,
        id: outboxId,
        status: "processing",
      },
      data: {
        status: "delivered",
        deliveredAt,
        lastErrorSummary: null,
      },
    });
  }

  async markOutboxFailed(input: {
    outboxId: string;
    errorSummary: string;
    retryCount: number;
    nextRetryAt: Date;
    deadLetter: boolean;
  }): Promise<void> {
    await this.database.memoryOutboxRecord.updateMany({
      where: {
        projectId: this.projectId,
        id: input.outboxId,
        status: "processing",
      },
      data: {
        status: input.deadLetter ? "dead_letter" : "retry",
        retryCount: input.retryCount,
        nextRetryAt: input.nextRetryAt,
        lastErrorSummary: input.errorSummary.slice(0, 1_000),
      },
    });
  }

  async replayOutbox(
    outboxId: string,
    actorId = "memory-service",
  ): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.memoryOutboxRecord.findFirst({
        where: {
          projectId: this.projectId,
          id: outboxId,
          status: { in: ["retry", "dead_letter"] },
        },
      });
      if (!current) return false;
      await transaction.memoryOutboxRecord.update({
        where: {
          projectId_id: { projectId: this.projectId, id: outboxId },
        },
        data: {
          status: "pending",
          retryCount: 0,
          nextRetryAt: new Date(),
          lastErrorSummary: null,
        },
      });
      await transaction.memoryCurationEvent.create({
        data: {
          projectId: this.projectId,
          memoryId: current.memoryId,
          providerItemId: outboxId,
          action: "memory.outbox_replayed",
          actorId,
          beforeSnapshot: jsonInput({
            status: current.status,
            retryCount: current.retryCount,
          }),
          afterSnapshot: jsonInput({ status: "pending", retryCount: 0 }),
        },
      });
      return true;
    });
  }

  async setMemoryActivity(
    memoryId: string,
    at: Date,
    clearDegradedError = false,
  ): Promise<void> {
    await this.database.memoryRecord.updateMany({
      where: { projectId: this.projectId, id: memoryId, deletedAt: null },
      data: {
        lastActivityAt: at,
        ...(clearDegradedError ? { lastErrorSummary: null } : {}),
      },
    });
  }

  async countBindings(
    memoryId: string,
    status: MemoryBindingStatus,
  ): Promise<number> {
    return this.database.memoryBinding.count({
      where: {
        projectId: this.projectId,
        memoryId,
        bindingKind: "primary",
        status,
      },
    });
  }

  private async lockMemory(
    transaction: Prisma.TransactionClient,
    memoryId: string,
  ): Promise<void> {
    const [projectLock, memoryLock] = memoryLockParts(this.projectId, memoryId);
    await transaction.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${projectLock}, ${memoryLock})`,
    );
  }
}
