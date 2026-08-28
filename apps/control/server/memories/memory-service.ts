import {
  memoryConversationSchema,
  type MemoryActivityView,
  type MemoryBindingView,
  type MemoryConversation,
  type MemoryContentCounts,
  type MemoryExperience,
  type MemoryExperienceUpdateInput,
  type MemoryFact,
  type MemoryFactUpdateInput,
  type MemoryInsight,
  type MemoryItem,
  type MemoryOutboxView,
  type MemoryPage,
  type MemoryProviderSettingsView,
  type MemoryResourceDetailView,
  type MemoryResourceView,
  type MemoryRuntimeType,
} from "@tali/contracts";
import {
  Prisma,
  type MemoryBinding,
  type MemoryExperienceProjection,
  type MemoryOutboxRecord,
  type MemoryRecord,
} from "../generated/prisma/client";
import { getControlConfig } from "../config/control-config";
import {
  MemoryProviderError,
  type MemoryProvider,
  type MemoryProviderScope,
  type ListMemoryItemsInput,
  type ProviderExportResult,
  type RecallResult,
} from "./memory-provider";
import { createMemoryProvider } from "./memory-provider-factory";
import { MemoryOutboxCipher } from "./memory-outbox-cipher";
import { MemoryRepository } from "./memory-repository";
import { sanitizeRuntimeMemoryText } from "../runtime-bridge/memory-runtime-sanitizer";

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

export interface MemoryItemPageInput {
  cursor?: string | null;
  from?: string;
  limit?: number;
  memoryId: string;
  query?: string;
  sourceDocumentId?: string;
  status?: "active" | "invalidated";
  to?: string;
}

export class MemoryVersionConflictError extends Error {
  readonly code = "memory_version_conflict";
  readonly status = 409;

  constructor() {
    super("The Memory item changed before this update was applied.");
    this.name = "MemoryVersionConflictError";
  }
}

export class MemoryRateLimitError extends Error {
  readonly code = "memory_rate_limit_exceeded";
  readonly status = 429;

  constructor() {
    super("Too many Memory operations were requested. Try again later.");
    this.name = "MemoryRateLimitError";
  }
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

function bindingView(binding: MemoryBinding): MemoryBindingView {
  return {
    id: binding.id,
    instanceId: binding.instanceId,
    runtimeType: binding.runtimeType,
    status: binding.status,
    attachedAt: binding.attachedAt?.toISOString() ?? null,
    detachedAt: binding.detachedAt?.toISOString() ?? null,
  };
}

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeItemSnapshot(item: MemoryItem): Record<string, unknown> {
  if (item.kind === "fact" || item.kind === "insight") {
    return {
      kind: item.kind,
      status: item.status,
      text: sanitizeRuntimeMemoryText(item.text, 8_000),
      updatedAt: item.updatedAt,
    };
  }
  return {
    kind: item.kind,
    status: item.status,
    title: sanitizeRuntimeMemoryText(item.title, 240),
    summary: sanitizeRuntimeMemoryText(item.summary, 8_000),
    version: item.version,
  };
}

function sanitizeEvidence<T extends { excerpt: string | null }>(evidence: T): T {
  return {
    ...evidence,
    excerpt: evidence.excerpt
      ? sanitizeRuntimeMemoryText(evidence.excerpt, 8_000)
      : null,
  };
}

function sanitizeExportItem(item: MemoryItem): MemoryItem {
  if (item.kind === "fact" || item.kind === "insight") {
    return {
      ...item,
      text: sanitizeRuntimeMemoryText(item.text, 32_000),
      evidence: item.evidence.map(sanitizeEvidence),
    };
  }
  return {
    ...item,
    title: sanitizeRuntimeMemoryText(item.title, 240),
    summary: sanitizeRuntimeMemoryText(item.summary, 16_000),
    situation: sanitizeRuntimeMemoryText(item.situation, 16_000),
    goal: sanitizeRuntimeMemoryText(item.goal, 16_000),
    actions: item.actions.map((action) => sanitizeRuntimeMemoryText(action, 4_000)),
    outcome: sanitizeRuntimeMemoryText(item.outcome, 16_000),
    lessonLearned: sanitizeRuntimeMemoryText(item.lessonLearned, 16_000),
    evidence: item.evidence.map(sanitizeEvidence),
  };
}

function sanitizeExportConversation(
  conversation: MemoryConversation,
): MemoryConversation {
  return {
    ...conversation,
    title: conversation.title
      ? sanitizeRuntimeMemoryText(conversation.title, 1_000)
      : null,
    summary: conversation.summary
      ? sanitizeRuntimeMemoryText(conversation.summary, 8_000)
      : null,
    messages: conversation.messages.map((message) => ({
      ...message,
      text: sanitizeRuntimeMemoryText(message.text, 32_000),
    })),
  };
}

function encodeFilteredConversationCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ kind: "filtered-conversations", offset }), "utf8")
    .toString("base64url");
}

function decodeFilteredConversationCursor(value: string | null | undefined): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      kind?: unknown;
      offset?: unknown;
    };
    if (
      parsed.kind !== "filtered-conversations"
      || !Number.isInteger(parsed.offset)
      || (parsed.offset as number) < 0
    ) throw new Error("Invalid cursor.");
    return parsed.offset as number;
  } catch {
    throw new Error("Invalid Memory page cursor.");
  }
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

  async listResources(input: {
    cursor?: string | null;
    limit?: number;
    query?: string;
    statuses?: MemoryRecord["status"][];
  } = {}): Promise<{
    items: MemoryResourceView[];
    nextCursor: string | null;
    totalCount: number;
  }> {
    const page = await this.repository.listMemories({
      limit: input.limit ?? 25,
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.query ? { query: input.query } : {}),
      ...(input.statuses?.length ? { statuses: input.statuses } : {}),
    });
    return {
      ...page,
      items: await Promise.all(page.items.map(async (memory) =>
        this.resourceView(
          memory,
          memory.bindings[0] ?? null,
          await this.contentCountsOrNull(memory),
        )
      )),
    };
  }

  async getResource(memoryId: string): Promise<MemoryResourceDetailView> {
    const memory = await this.requireMemory(memoryId);
    const bindings = await this.repository.bindingHistory(memory.id);
    return {
      ...this.resourceView(
        memory,
        bindings.find(({ status }) => status === "active") ?? null,
        await this.contentCountsOrNull(memory),
      ),
      bindingHistory: bindings.map(bindingView),
      degradedReason: memory.lastErrorSummary,
      retentionPolicy: jsonRecord(memory.retentionPolicy),
    };
  }

  async rename(
    memoryId: string,
    displayName: string,
    actorId: string,
  ): Promise<MemoryResourceDetailView> {
    await this.repository.renameMemory(memoryId, displayName, actorId);
    return this.getResource(memoryId);
  }

  async providerSettings(memoryId: string): Promise<MemoryProviderSettingsView> {
    const memory = await this.requireMemory(memoryId);
    const health = await this.provider().healthCheck({
      ...(memory.providerRef ? { providerRef: memory.providerRef } : {}),
    });
    return {
      provider: memory.provider === "hindsight" ? "Hindsight" : memory.provider,
      providerHealth: health.status,
      checkedAt: health.checkedAt,
      providerReferenceHint: memory.providerRef
        ? `${memory.providerRef.slice(0, 6)}…${memory.providerRef.slice(-4)}`
        : null,
    };
  }

  async retryProvisioning(
    memoryId: string,
    actorId: string,
  ): Promise<MemoryResourceDetailView> {
    const memory = await this.requireMemory(memoryId, true);
    if (!new Set(["provisioning", "degraded"]).has(memory.status)) {
      throw new Error("Only provisioning or degraded Memory can be retried here.");
    }
    if (memory.providerRef) {
      const health = await this.provider().healthCheck({ providerRef: memory.providerRef });
      if (health.status !== "healthy") {
        throw new MemoryProviderError({
          code: "unavailable",
          message: "The Memory provider is not healthy yet.",
          retryable: true,
        });
      }
      const activeBindings = await this.repository.countBindings(memory.id, "active");
      await this.repository.transitionMemory({
        memoryId: memory.id,
        to: activeBindings ? "ready" : "unbound",
        actorId,
        action: "memory.provisioning_retried",
        lastErrorSummary: null,
      });
      return this.getResource(memory.id);
    }
    const created = await this.provider().createMemory({
      projectId: this.repository.projectId,
      memoryId: memory.id,
      displayName: memory.displayName,
      idempotencyKey: memory.idempotencyKey ?? `memory:${memory.id}`,
    });
    await this.repository.transitionMemory({
      memoryId: memory.id,
      to: "ready",
      actorId,
      action: "memory.provisioning_retried",
      providerRef: created.providerRef,
      lastErrorSummary: null,
    });
    return this.getResource(memory.id);
  }

  async listActivity(memoryId: string, limit = 50): Promise<MemoryActivityView[]> {
    await this.requireMemory(memoryId, true);
    return (await this.repository.listCurationEvents(memoryId, limit)).map((event) => ({
      id: event.id,
      action: event.action,
      actorId: event.actorId,
      occurredAt: event.createdAt.toISOString(),
      providerItemId: event.providerItemId,
    }));
  }

  async listConversations(input: MemoryItemPageInput): Promise<MemoryPage<MemoryConversation>> {
    const memory = await this.requireReadableMemory(input.memoryId);
    const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
    if (!input.query?.trim() && !input.from && !input.to) {
      return this.provider().listConversations({
        ...this.scope(memory),
        limit,
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      });
    }
    const all = await this.collectPages((cursor) => this.provider().listConversations({
      ...this.scope(memory),
      limit: 100,
      ...(cursor ? { cursor } : {}),
    }));
    const query = input.query?.trim().toLocaleLowerCase();
    const from = input.from ? Date.parse(input.from) : undefined;
    const to = input.to ? Date.parse(input.to) : undefined;
    const filtered = all.filter((conversation) => {
      const startedAt = Date.parse(conversation.startedAt);
      return (!query || [
        conversation.title,
        conversation.summary,
        ...conversation.messages.map(({ text }) => text),
      ].some((value) => value?.toLocaleLowerCase().includes(query)))
        && (from === undefined || startedAt >= from)
        && (to === undefined || startedAt <= to);
    });
    const offset = decodeFilteredConversationCursor(input.cursor);
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < filtered.length
        ? encodeFilteredConversationCursor(nextOffset)
        : null,
      totalCount: filtered.length,
    };
  }

  async getConversation(
    memoryId: string,
    conversationId: string,
  ): Promise<MemoryConversation> {
    const memory = await this.requireReadableMemory(memoryId);
    return this.provider().getConversation({
      ...this.scope(memory),
      conversationId,
    });
  }

  async listFacts(input: MemoryItemPageInput): Promise<MemoryPage<MemoryFact>> {
    const memory = await this.requireReadableMemory(input.memoryId);
    const page = await this.provider().listFacts(this.itemPageScope(memory, input));
    return {
      ...page,
      items: await this.overlayStatuses(memory.id, page.items),
    };
  }

  async listExperiences(
    input: MemoryItemPageInput,
  ): Promise<MemoryPage<MemoryExperience>> {
    const memory = await this.requireReadableMemory(input.memoryId);
    const page = await this.provider().listExperiences(this.itemPageScope(memory, input));
    const projected = await Promise.all(page.items.map((item) =>
      this.projectExperience(memory.id, item)
    ));
    return {
      ...page,
      items: await this.overlayStatuses(memory.id, projected),
    };
  }

  async listInsights(input: MemoryItemPageInput): Promise<MemoryPage<MemoryInsight>> {
    const memory = await this.requireReadableMemory(input.memoryId);
    const page = await this.provider().listInsights(this.itemPageScope(memory, input));
    return {
      ...page,
      items: await this.overlayStatuses(memory.id, page.items),
    };
  }

  async getItem(memoryId: string, itemId: string): Promise<MemoryItem> {
    const memory = await this.requireReadableMemory(memoryId);
    let item = await this.provider().getItem({ ...this.scope(memory), itemId });
    if (item.kind === "experience") {
      item = await this.projectExperience(memory.id, item);
    }
    const [withStatus] = await this.overlayStatuses(memory.id, [item]);
    return withStatus!;
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

  async attachExisting(input: {
    actorId: string;
    idempotencyKey: string;
    instanceId: string;
    memoryId: string;
    runtimeType: MemoryRuntimeType;
  }): Promise<MemoryBindingView> {
    const instance = await this.repository.db().agentRecord.findFirst({
      where: {
        projectId: this.repository.projectId,
        id: input.instanceId,
        deletedAt: null,
      },
      select: { payload: true },
    });
    if (!instance) throw new Error("Agent Instance not found.");
    const payload = jsonRecord(instance.payload);
    if (payload.agentPlatform !== input.runtimeType) {
      throw new Error("The Memory runtime type does not match the Agent Instance.");
    }
    let memory = await this.requireMemory(input.memoryId);
    if (memory.status === "unbound") {
      memory = await this.repository.transitionMemory({
        memoryId: memory.id,
        to: "ready",
        actorId: input.actorId,
        action: "memory.rebinding_started",
      });
    }
    const binding = await this.bindToAgent({
      actorId: input.actorId,
      instanceId: input.instanceId,
      memoryId: memory.id,
      requestIdempotencyKey: input.idempotencyKey,
      runtimeType: input.runtimeType,
    });
    return bindingView(binding);
  }

  async detachBinding(
    memoryId: string,
    bindingId: string,
    actorId: string,
  ): Promise<MemoryResourceDetailView> {
    const binding = await this.repository.db().memoryBinding.findFirst({
      where: {
        projectId: this.repository.projectId,
        id: bindingId,
        memoryId,
        bindingKind: "primary",
        status: "active",
      },
    });
    if (!binding) throw new Error("Active Memory binding not found.");
    await this.detachFromAgent(binding.instanceId, actorId);
    return this.getResource(memoryId);
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

  async updateFact(input: {
    actorId: string;
    itemId: string;
    memoryId: string;
    update: MemoryFactUpdateInput;
  }): Promise<MemoryFact> {
    const memory = await this.requireWritableMemory(input.memoryId);
    return this.repository.withMemoryLock(memory.id, async (transaction) => {
      const current = await this.provider().getItem({
        ...this.scope(memory),
        itemId: input.itemId,
      });
      if (current.kind !== "fact") throw new Error("The requested Memory Fact was not found.");
      if (current.updatedAt !== input.update.expectedUpdatedAt) {
        throw new MemoryVersionConflictError();
      }
      const next: MemoryFact = {
        ...current,
        text: sanitizeRuntimeMemoryText(input.update.text, 32_000),
        updatedAt: new Date().toISOString(),
      };
      const updated = await this.provider().updateItem({
        ...this.scope(memory),
        item: next,
      });
      if (updated.kind !== "fact") throw new Error("The Memory provider returned an invalid Fact.");
      await this.repository.recordCurationEvent({
        memoryId: memory.id,
        providerItemId: current.id,
        action: "memory.fact.revised",
        actorId: input.actorId,
        before: safeItemSnapshot(current),
        after: safeItemSnapshot(updated),
      }, transaction);
      return updated;
    });
  }

  async updateExperience(input: {
    actorId: string;
    itemId: string;
    memoryId: string;
    update: MemoryExperienceUpdateInput;
  }): Promise<MemoryExperience> {
    const memory = await this.requireWritableMemory(input.memoryId);
    return this.repository.withMemoryLock(memory.id, async (transaction) => {
      const providerItem = await this.provider().getItem({
        ...this.scope(memory),
        itemId: input.itemId,
      });
      if (providerItem.kind !== "experience") {
        throw new Error("The requested Memory Experience was not found.");
      }
      const projection = await this.repository.getExperienceProjection(
        memory.id,
        providerItem.id,
        transaction,
      );
      const current = projection
        ? this.experienceFromProjection(providerItem, projection)
        : providerItem;
      if (current.version !== input.update.expectedVersion) {
        throw new MemoryVersionConflictError();
      }
      const next: MemoryExperience = {
        ...current,
        title: sanitizeRuntimeMemoryText(input.update.title, 240),
        summary: sanitizeRuntimeMemoryText(input.update.summary, 16_000),
        situation: sanitizeRuntimeMemoryText(input.update.situation, 16_000),
        goal: sanitizeRuntimeMemoryText(input.update.goal, 16_000),
        actions: input.update.actions.map((action) =>
          sanitizeRuntimeMemoryText(action, 4_000)
        ),
        outcome: sanitizeRuntimeMemoryText(input.update.outcome, 16_000),
        lessonLearned: sanitizeRuntimeMemoryText(
          input.update.lessonLearned,
          16_000,
        ),
        occurredStart: input.update.occurredStart,
        occurredEnd: input.update.occurredEnd,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      };
      const updated = await this.provider().updateItem({
        ...this.scope(memory),
        expectedVersion: input.update.expectedVersion,
        item: next,
      });
      if (updated.kind !== "experience") {
        throw new Error("The Memory provider returned an invalid Experience.");
      }
      const projectionData = {
        title: next.title,
        summary: next.summary,
        situation: next.situation,
        goal: next.goal,
        actions: JSON.parse(JSON.stringify(next.actions)) as Prisma.InputJsonValue,
        outcome: next.outcome,
        lessonLearned: next.lessonLearned,
        status: next.status,
        occurredStart: next.occurredStart ? new Date(next.occurredStart) : null,
        occurredEnd: next.occurredEnd ? new Date(next.occurredEnd) : null,
        hindsightMemoryIds: next.hindsightMemoryIds.length
          ? next.hindsightMemoryIds
          : [providerItem.id],
        sourceDocumentIds: next.sourceDocumentIds,
        version: next.version,
      };
      if (projection) {
        const result = await transaction.memoryExperienceProjection.updateMany({
          where: {
            projectId: this.repository.projectId,
            id: projection.id,
            version: input.update.expectedVersion,
          },
          data: projectionData,
        });
        if (!result.count) throw new MemoryVersionConflictError();
      } else {
        await transaction.memoryExperienceProjection.create({
          data: {
            projectId: this.repository.projectId,
            memoryId: memory.id,
            ...projectionData,
          },
        });
      }
      await this.repository.recordCurationEvent({
        memoryId: memory.id,
        providerItemId: providerItem.id,
        action: "memory.experience.revised",
        actorId: input.actorId,
        before: safeItemSnapshot(current),
        after: safeItemSnapshot(next),
      }, transaction);
      return next;
    });
  }

  async invalidateItem(
    memoryId: string,
    itemId: string,
    actorId: string,
  ): Promise<MemoryItem> {
    return this.changeItemStatus(memoryId, itemId, "invalidated", actorId);
  }

  async restoreItem(
    memoryId: string,
    itemId: string,
    actorId: string,
  ): Promise<MemoryItem> {
    return this.changeItemStatus(memoryId, itemId, "active", actorId);
  }

  async deleteConversation(input: {
    actorId: string;
    conversationId: string;
    idempotencyKey: string;
    memoryId: string;
  }): Promise<{ deleted: boolean; invalidatedDerivedItems: number }> {
    const memory = await this.requireWritableMemory(input.memoryId);
    const conversation = await this.provider().getConversation({
      ...this.scope(memory),
      conversationId: input.conversationId,
    });
    const derived = await this.derivedItemsWithOnlySource(memory, input.conversationId);
    const result = await this.provider().deleteConversation({
      ...this.scope(memory),
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!result.verifiedAbsent) {
      throw new MemoryProviderError({
        code: "internal",
        message: "The Memory provider could not verify Conversation deletion.",
        retryable: true,
      });
    }
    await this.repository.recordCurationEvent({
      memoryId: memory.id,
      providerItemId: conversation.id,
      action: "memory.conversation.deleted",
      actorId: input.actorId,
      before: {
        sourceDocumentIds: conversation.sourceDocumentIds,
        messageCount: conversation.messages.length,
      },
      after: { status: "deleted", derivedPolicy: "invalidate_without_evidence" },
    });
    let invalidatedDerivedItems = 0;
    for (const item of derived) {
      try {
        await this.changeItemStatus(memory.id, item.id, "invalidated", input.actorId);
        invalidatedDerivedItems += 1;
      } catch (error) {
        if (!(error instanceof MemoryProviderError && error.code === "not_found")) throw error;
      }
    }
    return { deleted: result.deleted, invalidatedDerivedItems };
  }

  async reextractConversation(input: {
    actorId: string;
    conversationId: string;
    idempotencyKey: string;
    memoryId: string;
  }): Promise<{ acceptedAt: string; operationId: string }> {
    const memory = await this.requireWritableMemory(input.memoryId);
    const conversation = await this.provider().getConversation({
      ...this.scope(memory),
      conversationId: input.conversationId,
    });
    const result = await this.provider().appendConversation({
      ...this.scope(memory),
      conversation,
      idempotencyKey: `reextract:${memory.id}:${conversation.id}:${input.idempotencyKey}`,
    });
    await this.repository.recordCurationEvent({
      memoryId: memory.id,
      providerItemId: conversation.id,
      action: "memory.conversation.reextraction_requested",
      actorId: input.actorId,
      before: { sourceDocumentIds: conversation.sourceDocumentIds },
      after: { operationId: result.operationId, status: "accepted" },
    });
    return { acceptedAt: result.acceptedAt, operationId: result.operationId };
  }

  async exportMemory(memoryId: string, actorId: string): Promise<ProviderExportResult> {
    const memory = await this.requireReadableMemory(memoryId);
    const [conversations, facts, experiences, insights, bindings] = await Promise.all([
      this.collectPages((cursor) => this.listConversations({
        memoryId,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      })),
      this.collectPages((cursor) => this.listFacts({
        memoryId,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      })),
      this.collectPages((cursor) => this.listExperiences({
        memoryId,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      })),
      this.collectPages((cursor) => this.listInsights({
        memoryId,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      })),
      this.repository.bindingHistory(memoryId),
    ]);
    const result: ProviderExportResult = {
      contentType: "application/json",
      filename: `${memory.displayName.replace(/[^A-Za-z0-9._-]/g, "_") || memory.id}.json`,
      content: JSON.stringify({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        memory: {
          id: memory.id,
          displayName: memory.displayName,
          status: memory.status,
          retentionPolicy: jsonRecord(memory.retentionPolicy),
          createdAt: memory.createdAt.toISOString(),
          updatedAt: memory.updatedAt.toISOString(),
          lastActivityAt: memory.lastActivityAt?.toISOString() ?? null,
        },
        bindings: bindings.map(bindingView),
        conversations: conversations.map(sanitizeExportConversation),
        facts: facts.map(sanitizeExportItem),
        experiences: experiences.map(sanitizeExportItem),
        insights: insights.map(sanitizeExportItem),
      }),
    };
    await this.repository.recordCurationEvent({
      memoryId: memory.id,
      providerItemId: memory.id,
      action: "memory.export.downloaded",
      actorId,
      after: { contentType: result.contentType, filename: result.filename },
    });
    return result;
  }

  async recordExportGrant(
    memoryId: string,
    actorId: string,
    expiresAt: string,
  ): Promise<void> {
    const memory = await this.requireReadableMemory(memoryId);
    await this.repository.recordCurationEvent({
      memoryId: memory.id,
      providerItemId: memory.id,
      action: "memory.export.authorized",
      actorId,
      after: { expiresAt },
    });
  }

  async consumeOperationBudget(input: {
    action: "delete" | "export" | "outbox_replay";
    actorId: string;
    limit: number;
    memoryId: string;
    windowMs: number;
  }): Promise<void> {
    await this.requireMemory(input.memoryId, true);
    await this.repository.withMemoryLock(input.memoryId, async (transaction) => {
      const action = `memory.rate_limit.${input.action}`;
      const used = await transaction.memoryCurationEvent.count({
        where: {
          projectId: this.repository.projectId,
          memoryId: input.memoryId,
          actorId: input.actorId,
          action,
          createdAt: { gte: new Date(Date.now() - input.windowMs) },
        },
      });
      if (used >= input.limit) throw new MemoryRateLimitError();
      await this.repository.recordCurationEvent({
        memoryId: input.memoryId,
        providerItemId: input.memoryId,
        action,
        actorId: input.actorId,
        after: { limit: input.limit, windowMs: input.windowMs },
      }, transaction);
    });
  }

  async listOutbox(input: {
    cursor?: string | null;
    limit?: number;
    memoryId: string;
    statuses?: Array<"pending" | "processing" | "retry" | "delivered" | "dead_letter">;
  }): Promise<{ items: MemoryOutboxView[]; nextCursor: string | null; totalCount: number }> {
    const page = await this.repository.listOutbox({
      memoryId: input.memoryId,
      limit: input.limit ?? 25,
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.statuses?.length ? { statuses: input.statuses } : {}),
    });
    return {
      ...page,
      items: page.items.map((item) => ({
        id: item.id,
        conversationId: item.conversationId,
        eventType: item.eventType,
        status: item.status,
        retryCount: item.retryCount,
        nextRetryAt: item.nextRetryAt.toISOString(),
        lastErrorSummary: item.lastErrorSummary,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    };
  }

  async replayOutbox(
    memoryId: string,
    outboxId: string,
    actorId: string,
  ): Promise<void> {
    await this.requireMemory(memoryId);
    const row = await this.repository.db().memoryOutboxRecord.findFirst({
      where: { projectId: this.repository.projectId, memoryId, id: outboxId },
      select: { id: true },
    });
    if (!row) throw new Error("Memory outbox event not found.");
    if (!(await this.repository.replayOutbox(row.id, actorId))) {
      throw new Error("Only failed Memory outbox events can be replayed.");
    }
  }

  async recall(input: {
    actorId?: string;
    memoryId: string;
    query: string;
    maxItems: number;
    timeoutMs: number;
  }): Promise<RecallResult> {
    let memory = await this.repository.getMemory(input.memoryId);
    if (
      !memory?.providerRef
      || !["ready", "degraded"].includes(memory.status)
    ) {
      throw new Error("This Memory is unavailable for recall.");
    }
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutFailure = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new MemoryProviderError({
          code: "timeout",
          message: "The Memory provider recall timed out.",
          retryable: true,
        }));
      }, input.timeoutMs);
    });
    try {
      const result = await Promise.race([
        this.provider().recall({
          ...this.scope(memory),
          query: input.query,
          maxItems: input.maxItems,
          types: ["fact", "experience", "insight"],
          signal: controller.signal,
        }),
        timeoutFailure,
      ]);
      const itemIds = result.items.map(({ item }) => item.id);
      const overrides = await this.repository.itemStatusOverrides(memory.id, itemIds);
      const visibleItems = result.items.filter(({ item }) =>
        (overrides.get(item.id) ?? item.status) !== "invalidated"
      );
      if (memory.status === "degraded") {
        memory = await this.repository.transitionMemory({
          memoryId: memory.id,
          to: "ready",
          actorId: input.actorId ?? SYSTEM_ACTOR,
          action: "memory.provider_recovered",
          lastErrorSummary: null,
        });
      }
      await this.repository.setMemoryActivity(memory.id, new Date(), false);
      return { ...result, items: visibleItems };
    } catch (error) {
      if (memory.status === "ready") {
        await this.repository.transitionMemory({
          memoryId: memory.id,
          to: "degraded",
          actorId: input.actorId ?? SYSTEM_ACTOR,
          action: "memory.recall_degraded",
          lastErrorSummary: safeError(error),
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
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

  private resourceView(
    memory: MemoryRecord,
    activeBinding: MemoryBinding | null,
    counts: MemoryContentCounts | null,
  ): MemoryResourceView {
    return {
      id: memory.id,
      displayName: memory.displayName,
      status: memory.status,
      activeBinding: activeBinding ? bindingView(activeBinding) : null,
      counts,
      lastActivityAt: memory.lastActivityAt?.toISOString() ?? null,
      createdAt: memory.createdAt.toISOString(),
      updatedAt: memory.updatedAt.toISOString(),
    };
  }

  private async contentCountsOrNull(
    memory: MemoryRecord,
  ): Promise<MemoryContentCounts | null> {
    if (!memory.providerRef || ["provisioning", "deleting", "deleted"].includes(memory.status)) {
      return null;
    }
    try {
      const scope = this.scope(memory);
      const [conversations, facts, experiences, insights] = await Promise.all([
        this.provider().listConversations({ ...scope, limit: 1 }),
        this.provider().listFacts({ ...scope, limit: 1 }),
        this.provider().listExperiences({ ...scope, limit: 1 }),
        this.provider().listInsights({ ...scope, limit: 1 }),
      ]);
      return {
        conversations: conversations.totalCount,
        facts: facts.totalCount,
        experiences: experiences.totalCount,
        insights: insights.totalCount,
      };
    } catch (error) {
      if (memory.status !== "degraded") {
        await this.repository.transitionMemory({
          memoryId: memory.id,
          to: "degraded",
          actorId: SYSTEM_ACTOR,
          action: "memory.query_degraded",
          lastErrorSummary: safeError(error),
        }).catch(() => undefined);
      }
      return null;
    }
  }

  private async requireMemory(
    memoryId: string,
    includeDeleted = false,
  ): Promise<MemoryRecord> {
    const memory = await this.repository.getMemory(memoryId, includeDeleted);
    if (!memory) throw new Error("Memory not found.");
    return memory;
  }

  private async requireReadableMemory(memoryId: string): Promise<MemoryRecord> {
    const memory = await this.requireMemory(memoryId);
    if (!memory.providerRef || ["provisioning", "deleting", "deleted"].includes(memory.status)) {
      throw new Error("This Memory is unavailable for content access.");
    }
    return memory;
  }

  private async requireWritableMemory(memoryId: string): Promise<MemoryRecord> {
    const memory = await this.requireReadableMemory(memoryId);
    if (memory.status === "deletion_failed") {
      throw new Error("This Memory is not accepting content changes.");
    }
    return memory;
  }

  private itemPageScope(
    memory: MemoryRecord,
    input: MemoryItemPageInput,
  ): ListMemoryItemsInput {
    return {
      ...this.scope(memory),
      limit: Math.max(1, Math.min(input.limit ?? 25, 100)),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.query ? { query: input.query } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.sourceDocumentId
        ? { sourceDocumentId: input.sourceDocumentId }
        : {}),
    };
  }

  private async overlayStatuses<T extends MemoryItem>(
    memoryId: string,
    items: T[],
  ): Promise<T[]> {
    if (!items.length) return items;
    const overrides = await this.repository.itemStatusOverrides(
      memoryId,
      items.map(({ id }) => id),
    );
    return items.map((item) => ({
      ...item,
      status: overrides.get(item.id) ?? item.status,
    })) as T[];
  }

  private async projectExperience(
    memoryId: string,
    item: MemoryExperience,
  ): Promise<MemoryExperience> {
    const projection = await this.repository.getExperienceProjection(memoryId, item.id);
    return projection ? this.experienceFromProjection(item, projection) : item;
  }

  private experienceFromProjection(
    item: MemoryExperience,
    projection: MemoryExperienceProjection,
  ): MemoryExperience {
    return {
      ...item,
      title: projection.title,
      summary: projection.summary,
      situation: projection.situation,
      goal: projection.goal,
      actions: jsonArray(projection.actions),
      outcome: projection.outcome,
      lessonLearned: projection.lessonLearned,
      status: projection.status,
      occurredStart: projection.occurredStart?.toISOString() ?? null,
      occurredEnd: projection.occurredEnd?.toISOString() ?? null,
      hindsightMemoryIds: projection.hindsightMemoryIds,
      sourceDocumentIds: projection.sourceDocumentIds,
      version: projection.version,
      createdAt: projection.createdAt.toISOString(),
      updatedAt: projection.updatedAt.toISOString(),
    };
  }

  private async changeItemStatus(
    memoryId: string,
    itemId: string,
    status: "active" | "invalidated",
    actorId: string,
  ): Promise<MemoryItem> {
    const memory = await this.requireWritableMemory(memoryId);
    return this.repository.withMemoryLock(memory.id, async (transaction) => {
      let current = await this.provider().getItem({ ...this.scope(memory), itemId });
      const projection = current.kind === "experience"
        ? await this.repository.getExperienceProjection(
            memory.id,
            current.id,
            transaction,
          )
        : null;
      if (current.kind === "experience" && projection) {
        current = this.experienceFromProjection(current, projection);
      }
      const existingOverride = (
        await this.repository.itemStatusOverrides(memory.id, [current.id])
      ).get(current.id);
      if ((existingOverride ?? current.status) === status) {
        return { ...current, status } as MemoryItem;
      }
      if (current.kind !== "insight") {
        if (status === "invalidated") {
          await this.provider().invalidateItem({ ...this.scope(memory), itemId });
        } else {
          await this.provider().restoreItem({ ...this.scope(memory), itemId });
        }
      }
      let next: MemoryItem = { ...current, status } as MemoryItem;
      if (current.kind === "experience") {
        const version = current.version + 1;
        const data = {
          title: current.title,
          summary: current.summary,
          situation: current.situation,
          goal: current.goal,
          actions: JSON.parse(JSON.stringify(current.actions)) as Prisma.InputJsonValue,
          outcome: current.outcome,
          lessonLearned: current.lessonLearned,
          status,
          occurredStart: current.occurredStart ? new Date(current.occurredStart) : null,
          occurredEnd: current.occurredEnd ? new Date(current.occurredEnd) : null,
          hindsightMemoryIds: current.hindsightMemoryIds.length
            ? current.hindsightMemoryIds
            : [current.id],
          sourceDocumentIds: current.sourceDocumentIds,
          version,
        };
        if (projection) {
          await transaction.memoryExperienceProjection.update({
            where: {
              projectId_id: {
                projectId: this.repository.projectId,
                id: projection.id,
              },
            },
            data,
          });
        } else {
          await transaction.memoryExperienceProjection.create({
            data: {
              projectId: this.repository.projectId,
              memoryId: memory.id,
              ...data,
            },
          });
        }
        next = { ...current, status, version, updatedAt: new Date().toISOString() };
      }
      await this.repository.recordCurationEvent({
        memoryId: memory.id,
        providerItemId: current.id,
        action: status === "invalidated"
          ? "memory.item.invalidated"
          : "memory.item.restored",
        actorId,
        before: safeItemSnapshot(current),
        after: safeItemSnapshot(next),
      }, transaction);
      return next;
    });
  }

  private async derivedItemsWithOnlySource(
    memory: MemoryRecord,
    sourceDocumentId: string,
  ): Promise<MemoryItem[]> {
    const input = { memoryId: memory.id, limit: 100, sourceDocumentId };
    const pages = await Promise.all([
      this.collectPages((cursor) => this.listFacts({ ...input, ...(cursor ? { cursor } : {}) })),
      this.collectPages((cursor) => this.listExperiences({ ...input, ...(cursor ? { cursor } : {}) })),
      this.collectPages((cursor) => this.listInsights({ ...input, ...(cursor ? { cursor } : {}) })),
    ]);
    return pages.flat().filter((item) =>
      item.evidence.length > 0
      && item.evidence.every((evidence) =>
        evidence.sourceDocumentId === sourceDocumentId
      )
    );
  }

  private async collectPages<T>(
    load: (cursor: string | null) => Promise<MemoryPage<T>>,
  ): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
      const page = await load(cursor);
      items.push(...page.items);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return items;
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
