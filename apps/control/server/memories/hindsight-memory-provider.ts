import { createHash } from "node:crypto";
import {
  HindsightClient,
  HindsightError,
  createClient,
  createConfig,
  sdk,
  type Client,
  type DocumentResponse,
  type RecallResult as HindsightRecallResult,
} from "@vectorize-io/hindsight-client";
import {
  memoryConversationSchema,
  type MemoryConversation,
  type MemoryEvidence,
  type MemoryExperience,
  type MemoryFact,
  type MemoryInsight,
  type MemoryItem,
  type MemoryPage,
} from "@tali/contracts";
import { z } from "zod";
import {
  MemoryProviderError,
  type AppendConversationInput,
  type AppendConversationResult,
  type ChangeMemoryItemStatusInput,
  type CreateProviderMemoryInput,
  type DeleteConversationInput,
  type DeleteProviderMemoryInput,
  type ExportProviderMemoryInput,
  type GetMemoryItemInput,
  type ListMemoryItemsInput,
  type MemoryProvider,
  type MemoryProviderCapabilities,
  type ProviderDeleteResult,
  type ProviderExportResult,
  type ProviderHealth,
  type ProviderHealthInput,
  type ProviderMemoryRef,
  type RecallInput,
  type RecallResult,
  type UpdateMemoryItemInput,
} from "./memory-provider";

const rawMemorySchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  type: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
  occurred_start: z.string().nullable().optional(),
  occurred_end: z.string().nullable().optional(),
  mentioned_at: z.string().nullable().optional(),
  document_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  source_fact_ids: z.array(z.string()).nullable().optional(),
}).passthrough();

type RawMemory = z.infer<typeof rawMemorySchema>;

const providerKindMap = {
  fact: "world",
  experience: "experience",
  insight: "observation",
} as const;

export interface HindsightMemoryProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  requestTimeoutMs?: number;
}

function requireConfigured(value: string | undefined, name: string): string {
  const configured = value?.trim();
  if (!configured) throw new Error(`${name} is required for the Hindsight Memory provider.`);
  return configured;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("TALI_HINDSIGHT_URL must use HTTP or HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function providerReference(input: CreateProviderMemoryInput): string {
  const digest = createHash("sha256")
    .update(`${input.projectId}\0${input.memoryId}`)
    .digest("hex")
    .slice(0, 40);
  return `tali_${digest}`;
}

function operationUuid(input: string): string {
  const bytes = Buffer.from(createHash("sha256").update(input).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      offset?: unknown;
    };
    if (typeof value.offset === "number" && Number.isInteger(value.offset) && value.offset >= 0) {
      return value.offset;
    }
  } catch {
    // Mapped to the stable validation error below.
  }
  throw new MemoryProviderError({
    code: "invalid_request",
    message: "The Memory page cursor is invalid.",
    retryable: false,
  });
}

function itemTimestamp(raw: RawMemory): string {
  return raw.updated_at
    ?? raw.created_at
    ?? raw.mentioned_at
    ?? raw.occurred_start
    ?? "1970-01-01T00:00:00.000Z";
}

function evidence(raw: RawMemory): MemoryEvidence[] {
  if (!raw.document_id) return [];
  return [{
    sourceDocumentId: raw.document_id,
    sourceItemId: raw.id,
    excerpt: raw.text,
    occurredAt: raw.mentioned_at ?? raw.occurred_start ?? null,
  }];
}

function itemStatus(raw: RawMemory): "active" | "invalidated" {
  return raw.state === "invalidated" ? "invalidated" : "active";
}

function mapFact(raw: RawMemory): MemoryFact {
  const timestamp = itemTimestamp(raw);
  return {
    kind: "fact",
    id: raw.id,
    text: raw.text,
    status: itemStatus(raw),
    evidence: evidence(raw),
    createdAt: raw.created_at ?? timestamp,
    updatedAt: timestamp,
  };
}

function mapExperience(raw: RawMemory): MemoryExperience {
  const timestamp = itemTimestamp(raw);
  return {
    kind: "experience",
    id: raw.id,
    title: raw.context?.trim() || "Experience",
    summary: raw.text,
    situation: "",
    goal: "",
    actions: [],
    outcome: "",
    lessonLearned: "",
    status: itemStatus(raw),
    occurredStart: raw.occurred_start ?? null,
    occurredEnd: raw.occurred_end ?? null,
    hindsightMemoryIds: [raw.id],
    sourceDocumentIds: raw.document_id ? [raw.document_id] : [],
    evidence: evidence(raw),
    version: 1,
    createdAt: raw.created_at ?? timestamp,
    updatedAt: timestamp,
  };
}

function mapInsight(raw: RawMemory): MemoryInsight {
  const timestamp = itemTimestamp(raw);
  return {
    kind: "insight",
    id: raw.id,
    text: raw.text,
    status: itemStatus(raw),
    evidence: evidence(raw),
    createdAt: raw.created_at ?? timestamp,
    updatedAt: timestamp,
  };
}

function mapItem(value: unknown): MemoryItem {
  const raw = rawMemorySchema.parse(value);
  if (raw.type === "experience") return mapExperience(raw);
  if (raw.type === "observation") return mapInsight(raw);
  return mapFact(raw);
}

function experienceText(item: MemoryExperience): string {
  return [
    item.summary,
    item.situation && `Situation: ${item.situation}`,
    item.goal && `Goal: ${item.goal}`,
    item.actions.length ? `Actions:\n${item.actions.map((action) => `- ${action}`).join("\n")}` : "",
    item.outcome && `Outcome: ${item.outcome}`,
    item.lessonLearned && `Lesson learned: ${item.lessonLearned}`,
  ].filter(Boolean).join("\n\n");
}

function conversationContent(conversation: MemoryConversation): string {
  return JSON.stringify(conversation);
}

function documentConversation(document: DocumentResponse): MemoryConversation {
  if (document.original_text) {
    try {
      return memoryConversationSchema.parse(JSON.parse(document.original_text));
    } catch {
      // Older/external Hindsight documents fall back to a readable projection.
    }
  }
  return {
    id: document.id,
    title: null,
    summary: null,
    sourceDocumentIds: [document.id],
    startedAt: document.created_at,
    endedAt: document.updated_at,
    messages: document.original_text
      ? [{
          id: `${document.id}:source`,
          role: "system",
          text: document.original_text,
          occurredAt: document.created_at,
        }]
      : [],
  };
}

export class HindsightMemoryProvider implements MemoryProvider {
  readonly kind = "hindsight";
  readonly capabilities: MemoryProviderCapabilities = {
    typedMemory: true,
    evidence: true,
    curation: true,
    invalidation: true,
    export: true,
    asyncRetain: true,
    observations: true,
  };

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;
  private readonly client: HindsightClient;
  private readonly rawClient: Client;

  constructor(options: HindsightMemoryProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(requireConfigured(
      options.baseUrl ?? process.env.TALI_HINDSIGHT_URL,
      "TALI_HINDSIGHT_URL",
    ));
    this.apiKey = requireConfigured(
      options.apiKey ?? process.env.TALI_HINDSIGHT_API_KEY,
      "TALI_HINDSIGHT_API_KEY",
    );
    this.requestTimeoutMs = options.requestTimeoutMs ?? 7_000;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": "tasklattice-relay-memory/1",
    };
    this.client = new HindsightClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      userAgent: headers["User-Agent"],
    });
    this.rawClient = createClient(createConfig({ baseUrl: this.baseUrl, headers }));
  }

  async createMemory(input: CreateProviderMemoryInput): Promise<ProviderMemoryRef> {
    const providerRef = providerReference(input);
    await this.withErrors("create", () => this.client.createBank(providerRef, {
      name: input.displayName,
      retainMission: "Retain durable facts, completed work, outcomes, and lessons that help this agent in future conversations.",
      enableObservations: true,
      observationsMission: "Synthesize stable, evidence-backed insights that remain useful across conversations.",
      signal: this.signal(),
    }));
    return { providerRef };
  }

  async appendConversation(input: AppendConversationInput): Promise<AppendConversationResult> {
    const operationId = operationUuid(`${input.providerRef}:${input.idempotencyKey}`);
    const response = await this.withErrors("retain", () => this.client.retain(
      input.providerRef,
      conversationContent(input.conversation),
      {
        async: true,
        operationId,
        documentId: input.conversation.id,
        context: "TaskLattice Agent conversation",
        timestamp: input.conversation.endedAt ?? input.conversation.startedAt,
        metadata: {
          relay_content_type: "conversation",
          relay_conversation_id: input.conversation.id,
        },
        signal: this.signal(),
      },
    ));
    return {
      conversationId: input.conversation.id,
      operationId: response.operation_id ?? operationId,
      acceptedAt: new Date().toISOString(),
    };
  }

  async recall(input: RecallInput): Promise<RecallResult> {
    const response = await this.withErrors("recall", () => this.client.recall(
      input.providerRef,
      input.query,
      {
        ...(input.types
          ? { types: input.types.map((type) => providerKindMap[type]) }
          : {}),
        preferObservations: true,
        includeSourceFacts: true,
        includeChunks: false,
        maxTokens: Math.max(256, Math.min(8_192, input.maxItems * 384)),
        signal: this.signal(),
      },
    ));
    return {
      items: response.results.slice(0, input.maxItems).map((result) => ({
        item: mapItem(result),
        score: this.recallScore(result),
      })),
      summary: null,
    };
  }

  async listConversations(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryConversation>> {
    const offset = decodeCursor(input.cursor);
    const response = await this.withErrors("list conversations", () => this.client.listDocuments(
      input.providerRef,
      { limit: input.limit, offset, signal: this.signal() },
    ));
    const documents = await Promise.all(response.items.map(async (item) => {
      const id = z.object({ id: z.string().min(1) }).passthrough().parse(item).id;
      const document = await this.withErrors("get conversation", () => this.client.getDocument(
        input.providerRef,
        id,
        { signal: this.signal() },
      ));
      if (!document) {
        throw new MemoryProviderError({
          code: "not_found",
          message: "A Memory conversation disappeared while its page was loading.",
          retryable: true,
        });
      }
      return documentConversation(document);
    }));
    const nextOffset = offset + documents.length;
    return {
      items: documents,
      nextCursor: nextOffset < response.total ? encodeCursor(nextOffset) : null,
    };
  }

  async listFacts(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryFact>> {
    return this.listTyped(input, "world", (raw) => mapFact(raw));
  }

  async listExperiences(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryExperience>> {
    return this.listTyped(input, "experience", (raw) => mapExperience(raw));
  }

  async listInsights(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryInsight>> {
    return this.listTyped(input, "observation", (raw) => mapInsight(raw));
  }

  async getItem(input: GetMemoryItemInput): Promise<MemoryItem> {
    const response = await this.withErrors("get item", () => sdk.getMemory({
      client: this.rawClient,
      path: { bank_id: input.providerRef, memory_id: input.itemId },
      signal: this.signal(),
    }));
    return mapItem(this.sdkData(response, "get item"));
  }

  async updateItem(input: UpdateMemoryItemInput): Promise<MemoryItem> {
    const item = input.item;
    if (item.kind === "insight") {
      throw new MemoryProviderError({
        code: "invalid_request",
        message: "Learned Insights are derived and cannot be edited directly.",
        retryable: false,
      });
    }
    await this.withErrors("update item", () => sdk.updateMemory({
      client: this.rawClient,
      path: { bank_id: input.providerRef, memory_id: item.id },
      body: item.kind === "fact"
        ? { text: item.text, state: item.status === "active" ? "valid" : "invalidated" }
        : {
            text: experienceText(item),
            context: item.title,
            occurred_start: item.occurredStart ?? "",
            occurred_end: item.occurredEnd ?? "",
            fact_type: "experience",
            state: item.status === "active" ? "valid" : "invalidated",
          },
      signal: this.signal(),
    }).then((response) => this.sdkData(response, "update item")));
    return item;
  }

  async invalidateItem(input: ChangeMemoryItemStatusInput): Promise<void> {
    await this.changeItemState(input, "invalidated");
  }

  async restoreItem(input: ChangeMemoryItemStatusInput): Promise<void> {
    await this.changeItemState(input, "valid");
  }

  async deleteConversation(input: DeleteConversationInput): Promise<ProviderDeleteResult> {
    const existing = await this.withErrors("get conversation", () => this.client.getDocument(
      input.providerRef,
      input.conversationId,
      { signal: this.signal() },
    ));
    if (!existing) return { deleted: false, verifiedAbsent: true };
    await this.withErrors("delete conversation", () => sdk.deleteDocument({
      client: this.rawClient,
      path: { bank_id: input.providerRef, document_id: input.conversationId },
      signal: this.signal(),
    }).then((response) => this.sdkData(response, "delete conversation")));
    const remaining = await this.withErrors("verify conversation deletion", () =>
      this.client.getDocument(input.providerRef, input.conversationId, { signal: this.signal() })
    );
    return { deleted: true, verifiedAbsent: remaining === null };
  }

  async exportMemory(input: ExportProviderMemoryInput): Promise<ProviderExportResult> {
    const content = await this.withErrors("export", () => this.client.exportDocuments(
      input.providerRef,
      { includeObservations: true, timeoutMs: 300_000, signal: this.signal(300_000) },
    ));
    return {
      contentType: "application/zip",
      filename: `${input.memoryId}.zip`,
      content,
    };
  }

  async deleteMemory(input: DeleteProviderMemoryInput): Promise<ProviderDeleteResult> {
    if (!(await this.bankExists(input.providerRef))) {
      return { deleted: false, verifiedAbsent: true };
    }
    await this.withErrors("delete", () => sdk.deleteBank({
      client: this.rawClient,
      path: { bank_id: input.providerRef },
      signal: this.signal(),
    }).then((response) => this.sdkData(response, "delete")));
    return { deleted: true, verifiedAbsent: !(await this.bankExists(input.providerRef)) };
  }

  async healthCheck(_input: ProviderHealthInput): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await this.client.getVersion({ signal: this.signal() });
      return { status: "healthy", checkedAt };
    } catch (error) {
      const mapped = this.mapError(error, "health check");
      return {
        status: mapped.code === "authentication" ? "degraded" : "unavailable",
        checkedAt,
      };
    }
  }

  private async listTyped<T>(
    input: ListMemoryItemsInput,
    type: "world" | "experience" | "observation",
    project: (raw: RawMemory) => T,
  ): Promise<MemoryPage<T>> {
    const offset = decodeCursor(input.cursor);
    const response = await this.withErrors(`list ${type}`, () => this.client.listMemories(
      input.providerRef,
      { type, limit: input.limit, offset, signal: this.signal() },
    ));
    const items = response.items.map((item) => project(rawMemorySchema.parse(item)));
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < response.total ? encodeCursor(nextOffset) : null,
    };
  }

  private async changeItemState(
    input: ChangeMemoryItemStatusInput,
    state: "valid" | "invalidated",
  ): Promise<void> {
    await this.withErrors("change item state", () => sdk.updateMemory({
      client: this.rawClient,
      path: { bank_id: input.providerRef, memory_id: input.itemId },
      body: { state },
      signal: this.signal(),
    }).then((response) => this.sdkData(response, "change item state")));
  }

  private recallScore(result: HindsightRecallResult): number {
    return result.scores?.final
      ?? result.scores?.reranker
      ?? result.scores?.semantic
      ?? 0;
  }

  private async bankExists(providerRef: string): Promise<boolean> {
    try {
      await this.client.getBankProfile(providerRef, { signal: this.signal() });
      return true;
    } catch (error) {
      if (error instanceof HindsightError && error.statusCode === 404) return false;
      throw this.mapError(error, "verify deletion");
    }
  }

  private sdkData<T extends { data?: unknown; error?: unknown; response?: Response }>(
    result: T,
    operation: string,
  ): unknown {
    if (result.data !== undefined) return result.data;
    throw new HindsightError(
      `${operation} failed`,
      result.response?.status,
      result.error,
    );
  }

  private signal(timeoutMs = this.requestTimeoutMs): AbortSignal {
    return AbortSignal.timeout(timeoutMs);
  }

  private async withErrors<T>(operation: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof MemoryProviderError) throw error;
      throw this.mapError(error, operation);
    }
  }

  private mapError(error: unknown, operation: string): MemoryProviderError {
    if (
      error instanceof DOMException && error.name === "TimeoutError"
      || error instanceof Error && error.name === "AbortError"
    ) {
      return new MemoryProviderError({
        code: "timeout",
        message: `The Memory provider timed out during ${operation}.`,
        retryable: true,
      });
    }
    const status = error instanceof HindsightError ? error.statusCode : undefined;
    if (status === 401 || status === 403) {
      return new MemoryProviderError({
        code: "authentication",
        message: "The Memory provider rejected Relay's service identity.",
        retryable: false,
        marksMemoryDegraded: true,
      });
    }
    if (status === 404) {
      return new MemoryProviderError({
        code: "not_found",
        message: "The requested Memory provider resource was not found.",
        retryable: false,
      });
    }
    if (status === 409) {
      return new MemoryProviderError({
        code: "conflict",
        message: "The Memory provider rejected a conflicting operation.",
        retryable: false,
      });
    }
    if (status === 400 || status === 422) {
      return new MemoryProviderError({
        code: "invalid_request",
        message: "The Memory provider rejected an invalid Relay request.",
        retryable: false,
      });
    }
    if (status === 408 || status === 429 || status !== undefined && status >= 500) {
      return new MemoryProviderError({
        code: "unavailable",
        message: `The Memory provider is temporarily unavailable during ${operation}.`,
        retryable: true,
      });
    }
    return new MemoryProviderError({
      code: "internal",
      message: `The Memory provider could not complete ${operation}.`,
      retryable: false,
      marksMemoryDegraded: true,
    });
  }
}
