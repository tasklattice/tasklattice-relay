import {
  memoryConversationSchema,
  type MemoryConversation,
  type MemoryRuntimeType,
} from "@tali/contracts";
import type {
  MemoryBinding,
  MemoryOutboxRecord,
  MemoryRecord,
} from "../generated/prisma/client";
import { getControlConfig } from "../config/control-config";
import {
  MemoryProviderError,
  type MemoryProvider,
  type MemoryProviderScope,
} from "./memory-provider";
import { createMemoryProvider } from "./memory-provider-factory";
import { MemoryOutboxCipher } from "./memory-outbox-cipher";
import { MemoryRepository } from "./memory-repository";

const SYSTEM_ACTOR = "memory-service";
const MAX_OUTBOX_ATTEMPTS = 8;

export interface PrepareAgentMemoryInput {
  actorId: string;
  displayName: string;
  existingMemoryId?: string;
  instanceId: string;
  requestIdempotencyKey: string;
  runtimeType: MemoryRuntimeType;
}

export interface PreparedAgentMemory {
  binding: MemoryBinding;
  createdNew: boolean;
  memory: MemoryRecord;
}

export interface ResolvedAgentMemory {
  createdNew: boolean;
  memory: MemoryRecord;
}

export interface ProcessOutboxResult {
  claimed: number;
  deadLettered: number;
  delivered: number;
  retried: number;
}

function safeError(error: unknown): string {
  return (
    error instanceof MemoryProviderError
      ? error.message
      : "The Memory provider operation did not complete."
  ).slice(0, 1_000);
}

function retryDelayMs(retryCount: number): number {
  return Math.min(30 * 60_000, 15_000 * (2 ** Math.max(0, retryCount - 1)));
}

export class MemoryService {
  private providerInstance: MemoryProvider | undefined;
  private readonly outboxCipher: MemoryOutboxCipher;

  constructor(
    readonly repository: MemoryRepository,
    private readonly providerFactory: () => MemoryProvider = createMemoryProvider,
    outboxSecret: () => string = () => getControlConfig().auth.secret,
  ) {
    this.outboxCipher = new MemoryOutboxCipher(
      repository.projectId,
      outboxSecret,
    );
  }

  provider(): MemoryProvider {
    this.providerInstance ??= this.providerFactory();
    return this.providerInstance;
  }

  async provision(input: {
    actorId: string;
    displayName: string;
    idempotencyKey: string;
    retentionPolicy?: Record<string, unknown>;
  }): Promise<MemoryRecord> {
    const memory = await this.repository.createMemory({
      displayName: input.displayName,
      idempotencyKey: input.idempotencyKey,
      provider: this.provider().kind,
      ...(input.retentionPolicy
        ? { retentionPolicy: input.retentionPolicy }
        : {}),
    });
    if (
      memory.providerRef
      && (memory.status === "ready" || memory.status === "unbound")
    ) {
      return memory;
    }
    if (["deleting", "deletion_failed", "deleted"].includes(memory.status)) {
      throw new Error("This Memory cannot be provisioned in its current state.");
    }
    try {
      const created = await this.provider().createMemory({
        projectId: this.repository.projectId,
        memoryId: memory.id,
        displayName: memory.displayName,
        idempotencyKey: input.idempotencyKey,
      });
      return await this.repository.transitionMemory({
        memoryId: memory.id,
        to: "ready",
        actorId: input.actorId,
        action: "memory.provisioned",
        providerRef: created.providerRef,
        lastErrorSummary: null,
      });
    } catch (error) {
      await this.repository.transitionMemory({
        memoryId: memory.id,
        to: "degraded",
        actorId: input.actorId,
        action: "memory.provisioning_failed",
        lastErrorSummary: safeError(error),
      }).catch(() => undefined);
      throw error;
    }
  }

  async prepareForAgent(
    input: PrepareAgentMemoryInput,
  ): Promise<PreparedAgentMemory> {
    const resolved = await this.resolveForAgent(input);
    const binding = await this.bindToAgent({
      ...input,
      memoryId: resolved.memory.id,
    });
    return { ...resolved, binding };
  }

  async resolveForAgent(
    input: Omit<PrepareAgentMemoryInput, "runtimeType">,
  ): Promise<ResolvedAgentMemory> {
    const createdNew = !input.existingMemoryId;
    let memory = input.existingMemoryId
      ? await this.repository.getMemory(input.existingMemoryId)
      : await this.provision({
          actorId: input.actorId,
          displayName: `${input.displayName} Memory`,
          idempotencyKey: `agent-memory:${input.requestIdempotencyKey}`,
        });
    if (!memory) throw new Error("The selected Memory was not found.");
    if (!memory.providerRef || !["ready", "unbound"].includes(memory.status)) {
      throw new Error("Select a ready, unbound Memory.");
    }
    const activeBinding = await this.repository.getActiveBindingForMemory(memory.id);
    if (activeBinding && activeBinding.instanceId !== input.instanceId) {
      throw new Error("The selected Memory is already attached to another Agent.");
    }
    if (memory.status === "unbound") {
      memory = await this.repository.transitionMemory({
        memoryId: memory.id,
        to: "ready",
        actorId: input.actorId,
        action: "memory.rebinding_started",
        lastErrorSummary: null,
      });
    }
    return { createdNew, memory };
  }

  async bindToAgent(input: {
    actorId: string;
    instanceId: string;
    memoryId: string;
    requestIdempotencyKey: string;
    runtimeType: MemoryRuntimeType;
  }): Promise<MemoryBinding> {
    const memory = await this.repository.getMemory(input.memoryId);
    if (!memory?.providerRef || memory.status !== "ready") {
      throw new Error("Select a ready, unbound Memory.");
    }
    const activeBinding = await this.repository.getActiveBindingForMemory(memory.id);
    if (activeBinding && activeBinding.instanceId !== input.instanceId) {
      throw new Error("The selected Memory is already attached to another Agent.");
    }
    const binding = await this.repository.bindPrimary({
      memoryId: memory.id,
      instanceId: input.instanceId,
      runtimeType: input.runtimeType,
      idempotencyKey:
        `agent-binding:${input.requestIdempotencyKey}:${memory.id}`,
      actorId: input.actorId,
    });
    return binding;
  }

  async rollbackAgentPreparation(
    prepared: PreparedAgentMemory,
    actorId: string,
  ): Promise<void> {
    await this.repository.rollbackBinding(prepared.binding.id, actorId);
    if (prepared.createdNew) {
      await this.delete(prepared.memory.id, actorId).catch(() => undefined);
    } else {
      const current = await this.repository.getMemory(prepared.memory.id);
      if (current?.status === "ready") {
        await this.repository.transitionMemory({
          memoryId: current.id,
          to: "unbound",
          actorId,
          action: "memory.rebinding_rolled_back",
        });
      }
    }
  }

  async rollbackAgentResolution(
    resolved: ResolvedAgentMemory,
    actorId: string,
  ): Promise<void> {
    if (resolved.createdNew) {
      await this.delete(resolved.memory.id, actorId).catch(() => undefined);
      return;
    }
    const current = await this.repository.getMemory(resolved.memory.id);
    if (current?.status === "ready") {
      await this.repository.transitionMemory({
        memoryId: current.id,
        to: "unbound",
        actorId,
        action: "memory.rebinding_rolled_back",
      });
    }
  }

  async detachFromAgent(
    instanceId: string,
    actorId = SYSTEM_ACTOR,
  ): Promise<MemoryRecord | null> {
    const binding = await this.repository.detachPrimaryForInstance(
      instanceId,
      actorId,
    );
    if (!binding) return null;
    const memory = await this.repository.getMemory(binding.memoryId);
    if (!memory || memory.status === "unbound") return memory;
    if (!["ready", "degraded"].includes(memory.status)) return memory;
    return this.repository.transitionMemory({
      memoryId: memory.id,
      to: "unbound",
      actorId,
      action: "memory.unbound",
    });
  }

  async delete(memoryId: string, actorId: string): Promise<MemoryRecord> {
    let memory = await this.repository.getMemory(memoryId, true);
    if (!memory) throw new Error("Memory not found.");
    if (memory.status === "deleted") return memory;
    if (!memory.providerRef) {
      throw new Error("The Memory provider reference is unavailable.");
    }
    memory = await this.repository.startDeletion(memory.id, actorId);
    try {
      const result = await this.provider().deleteMemory({
        ...this.scope(memory),
        idempotencyKey: `delete-memory:${memory.id}`,
      });
      if (!result.verifiedAbsent) {
        throw new MemoryProviderError({
          code: "internal",
          message: "The Memory provider could not verify deletion.",
          retryable: true,
        });
      }
      return await this.repository.transitionMemory({
        memoryId: memory.id,
        to: "deleted",
        actorId,
        action: "memory.deleted",
        providerRef: null,
        lastErrorSummary: null,
        deletedAt: new Date(),
      });
    } catch (error) {
      await this.repository.transitionMemory({
        memoryId: memory.id,
        to: "deletion_failed",
        actorId,
        action: "memory.deletion_failed",
        lastErrorSummary: safeError(error),
      }).catch(() => undefined);
      throw error;
    }
  }

  async enqueueConversation(input: {
    memoryId: string;
    conversation: MemoryConversation;
    idempotencyKey: string;
  }): Promise<MemoryOutboxRecord> {
    const memory = await this.repository.getMemory(input.memoryId);
    if (!memory || ["deleting", "deletion_failed"].includes(memory.status)) {
      throw new Error("This Memory is not accepting new conversations.");
    }
    const conversation = memoryConversationSchema.parse(input.conversation);
    return this.repository.enqueueOutbox({
      memoryId: memory.id,
      conversationId: conversation.id,
      eventType: "conversation.completed",
      encryptedPayload: this.outboxCipher.encrypt(
        conversation,
        memory.id,
        input.idempotencyKey,
      ),
      idempotencyKey: input.idempotencyKey,
    });
  }

  async processDueOutbox(
    limit = 25,
    now = new Date(),
  ): Promise<ProcessOutboxResult> {
    const result: ProcessOutboxResult = {
      claimed: 0,
      deadLettered: 0,
      delivered: 0,
      retried: 0,
    };
    const events = await this.repository.claimDueOutbox(limit, now);
    result.claimed = events.length;
    for (const event of events) {
      try {
        const memory = await this.repository.getMemory(event.memoryId);
        if (!memory?.providerRef) {
          throw new MemoryProviderError({
            code: "not_found",
            message: "The Memory provider resource is unavailable.",
            retryable: false,
          });
        }
        const conversation = memoryConversationSchema.parse(
          this.outboxCipher.decrypt(
            event.encryptedPayload!,
            event.memoryId,
            event.idempotencyKey,
          ),
        );
        await this.provider().appendConversation({
          ...this.scope(memory),
          conversation,
          idempotencyKey: event.idempotencyKey,
        });
        await this.repository.markOutboxDelivered(event.id, now);
        await this.repository.setMemoryActivity(memory.id, now, true);
        if (memory.status === "degraded") {
          const activeBindings = await this.repository.countBindings(
            memory.id,
            "active",
          );
          await this.repository.transitionMemory({
            memoryId: memory.id,
            to: activeBindings ? "ready" : "unbound",
            actorId: SYSTEM_ACTOR,
            action: "memory.provider_recovered",
            lastErrorSummary: null,
          });
        }
        result.delivered += 1;
      } catch (error) {
        const retryCount = event.retryCount + 1;
        const retryable = !(error instanceof MemoryProviderError)
          || error.retryable;
        const deadLetter = !retryable || retryCount >= MAX_OUTBOX_ATTEMPTS;
        await this.repository.markOutboxFailed({
          outboxId: event.id,
          errorSummary: safeError(error),
          retryCount,
          nextRetryAt: new Date(now.getTime() + retryDelayMs(retryCount)),
          deadLetter,
        });
        const memory = await this.repository.getMemory(event.memoryId);
        if (memory && ["ready", "unbound"].includes(memory.status)) {
          await this.repository.transitionMemory({
            memoryId: memory.id,
            to: "degraded",
            actorId: SYSTEM_ACTOR,
            action: deadLetter
              ? "memory.retain_dead_lettered"
              : "memory.retain_retry_scheduled",
            lastErrorSummary: safeError(error),
          }).catch(() => undefined);
        }
        if (deadLetter) result.deadLettered += 1;
        else result.retried += 1;
      }
    }
    return result;
  }

  private scope(memory: MemoryRecord): MemoryProviderScope {
    if (!memory.providerRef) {
      throw new Error("The Memory provider reference is unavailable.");
    }
    return {
      projectId: this.repository.projectId,
      memoryId: memory.id,
      providerRef: memory.providerRef,
    };
  }
}
