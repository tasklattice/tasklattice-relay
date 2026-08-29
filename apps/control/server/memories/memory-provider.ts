import type {
  MemoryConversation,
  MemoryExperience,
  MemoryFact,
  MemoryInsight,
  MemoryItem,
  MemoryPage,
  MemorySummary,
} from "@tali/contracts";

export interface MemoryProviderCapabilities {
  typedMemory: boolean;
  evidence: boolean;
  curation: boolean;
  invalidation: boolean;
  export: boolean;
  asyncRetain: boolean;
  observations: boolean;
}

export interface ProviderMemoryRef {
  providerRef: string;
}

export interface MemoryProviderScope {
  projectId: string;
  memoryId: string;
  providerRef: string;
}

export interface CreateProviderMemoryInput {
  projectId: string;
  memoryId: string;
  displayName: string;
  idempotencyKey: string;
}

export interface AppendConversationInput extends MemoryProviderScope {
  conversation: MemoryConversation;
  idempotencyKey: string;
}

export interface AppendConversationResult {
  conversationId: string;
  operationId: string;
  acceptedAt: string;
}

export interface RecallInput extends MemoryProviderScope {
  query: string;
  maxItems: number;
  types?: Array<"fact" | "experience" | "insight">;
  signal?: AbortSignal;
}

export interface RecalledMemoryItem {
  item: MemoryItem;
  score: number;
}

export interface RecallResult {
  items: RecalledMemoryItem[];
  summary: MemorySummary | null;
}

export interface ListMemoryItemsInput extends MemoryProviderScope {
  cursor?: string | null;
  limit: number;
  query?: string;
  status?: "active" | "invalidated";
  sourceDocumentId?: string;
}

export interface GetMemoryItemInput extends MemoryProviderScope {
  itemId: string;
}

export interface GetMemoryConversationInput extends MemoryProviderScope {
  conversationId: string;
}

export interface UpdateMemoryItemInput extends MemoryProviderScope {
  item: MemoryItem;
  expectedVersion?: number;
}

export interface ChangeMemoryItemStatusInput extends MemoryProviderScope {
  itemId: string;
}

export interface DeleteConversationInput extends MemoryProviderScope {
  conversationId: string;
  idempotencyKey: string;
}

export interface DeleteProviderMemoryInput extends MemoryProviderScope {
  idempotencyKey: string;
}

export interface ProviderDeleteResult {
  deleted: boolean;
  verifiedAbsent: boolean;
}

export interface ExportProviderMemoryInput extends MemoryProviderScope {
  format: "json";
}

export interface ProviderExportResult {
  contentType: "application/json" | "application/zip";
  filename: string;
  content: string | Uint8Array;
}

export interface ProviderHealthInput {
  providerRef?: string;
}

export interface ProviderHealth {
  status: "healthy" | "degraded" | "unavailable";
  checkedAt: string;
}

export const memoryProviderErrorCodes = [
  "unavailable",
  "timeout",
  "not_found",
  "conflict",
  "invalid_request",
  "authentication",
  "internal",
] as const;

export type MemoryProviderErrorCode = (typeof memoryProviderErrorCodes)[number];

/**
 * Stable provider-boundary error. `message` must be safe for Relay logs and UI;
 * adapters keep upstream URLs, bodies, and credentials out of this object.
 */
export class MemoryProviderError extends Error {
  readonly code: MemoryProviderErrorCode;
  readonly retryable: boolean;
  readonly marksMemoryDegraded: boolean;

  constructor(input: {
    code: MemoryProviderErrorCode;
    message: string;
    retryable: boolean;
    marksMemoryDegraded?: boolean;
  }) {
    super(input.message);
    this.name = "MemoryProviderError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.marksMemoryDegraded = input.marksMemoryDegraded ?? input.retryable;
  }
}

export interface MemoryProvider {
  readonly kind: string;
  readonly capabilities: MemoryProviderCapabilities;

  createMemory(input: CreateProviderMemoryInput): Promise<ProviderMemoryRef>;
  appendConversation(input: AppendConversationInput): Promise<AppendConversationResult>;
  recall(input: RecallInput): Promise<RecallResult>;

  listConversations(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryConversation>>;
  getConversation(input: GetMemoryConversationInput): Promise<MemoryConversation>;
  listFacts(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryFact>>;
  listExperiences(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryExperience>>;
  listInsights(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryInsight>>;
  getItem(input: GetMemoryItemInput): Promise<MemoryItem>;

  updateItem(input: UpdateMemoryItemInput): Promise<MemoryItem>;
  invalidateItem(input: ChangeMemoryItemStatusInput): Promise<void>;
  restoreItem(input: ChangeMemoryItemStatusInput): Promise<void>;
  deleteConversation(input: DeleteConversationInput): Promise<ProviderDeleteResult>;

  exportMemory(input: ExportProviderMemoryInput): Promise<ProviderExportResult>;
  deleteMemory(input: DeleteProviderMemoryInput): Promise<ProviderDeleteResult>;
  healthCheck(input: ProviderHealthInput): Promise<ProviderHealth>;
}
