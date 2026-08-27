import type { MemoryRuntimeType } from "@tali/contracts";
import type {
  MemoryBinding,
  MemoryRecord,
  Prisma,
  PrismaClient,
} from "../generated/prisma/client";
import { transitionMemoryBindingStatus } from "./memory-domain";

export interface CreateMemoryRecordInput {
  displayName: string;
  idempotencyKey: string;
  retentionPolicy?: Record<string, unknown>;
}

export interface BindPrimaryMemoryInput {
  memoryId: string;
  instanceId: string;
  runtimeType: MemoryRuntimeType;
  idempotencyKey: string;
  attachedAt?: Date;
}

/**
 * Project-scoped persistence boundary. Callers never pass a Project ID to an
 * individual operation, preventing accidental cross-Project predicates.
 */
export class MemoryRepository {
  constructor(
    private readonly projectId: string,
    private readonly database: PrismaClient,
  ) {}

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
        idempotencyKey: input.idempotencyKey,
        retentionPolicy: JSON.parse(
          JSON.stringify(input.retentionPolicy ?? {}),
        ) as Prisma.InputJsonValue,
      },
    });
  }

  async bindPrimary(input: BindPrimaryMemoryInput): Promise<MemoryBinding> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.memoryBinding.findUnique({
        where: {
          projectId_idempotencyKey: {
            projectId: this.projectId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) return existing;

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
      return transaction.memoryBinding.update({
        where: {
          projectId_id: { projectId: this.projectId, id: pending.id },
        },
        data: {
          status: "active",
          attachedAt: input.attachedAt ?? new Date(),
        },
      });
    });
  }
}
