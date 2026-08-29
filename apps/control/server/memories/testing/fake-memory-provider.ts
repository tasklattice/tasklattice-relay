import type {
  MemoryConversation,
  MemoryExperience,
  MemoryFact,
  MemoryInsight,
  MemoryItem,
  MemoryPage,
  MemorySummary,
} from "@tali/contracts";
import {
  MemoryProviderError,
  type AppendConversationInput,
  type AppendConversationResult,
  type ChangeMemoryItemStatusInput,
  type CreateProviderMemoryInput,
  type DeleteConversationInput,
  type DeleteProviderMemoryInput,
  type ExportProviderMemoryInput,
  type GetMemoryConversationInput,
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
} from "../memory-provider";

interface FakeBank {
  conversations: MemoryConversation[];
  items: MemoryItem[];
  summary: MemorySummary | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function page<T>(items: T[], cursor: string | null | undefined, limit: number): MemoryPage<T> {
  const offset = cursor ? Number.parseInt(cursor, 10) : 0;
  const nextOffset = offset + limit;
  return {
    items: clone(items.slice(offset, nextOffset)),
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
    totalCount: items.length,
  };
}

function itemText(item: MemoryItem): string {
  if (item.kind === "experience") {
    return [
      item.title,
      item.summary,
      item.situation,
      item.goal,
      ...item.actions,
      item.outcome,
      item.lessonLearned,
    ].join(" ");
  }
  return item.text;
}

function filteredItems<T extends MemoryItem>(items: T[], input: ListMemoryItemsInput): T[] {
  const query = input.query?.trim().toLocaleLowerCase();
  return items.filter((item) =>
    (!input.status || item.status === input.status)
    && (!query || itemText(item).toLocaleLowerCase().includes(query))
    && (!input.sourceDocumentId
      || item.evidence.some(({ sourceDocumentId }) =>
        sourceDocumentId === input.sourceDocumentId
      ))
  );
}

export class FakeMemoryProvider implements MemoryProvider {
  readonly kind = "fake";
  readonly capabilities: MemoryProviderCapabilities = {
    typedMemory: true,
    evidence: true,
    curation: true,
    invalidation: true,
    export: true,
    asyncRetain: true,
    observations: true,
  };

  private readonly banks = new Map<string, FakeBank>();
  private readonly createOperations = new Map<string, string>();
  private readonly appendOperations = new Map<string, AppendConversationResult>();
  private unavailable = false;

  setUnavailable(unavailable: boolean): void {
    this.unavailable = unavailable;
  }

  bankCount(): number {
    return this.banks.size;
  }

  hasBank(providerRef: string): boolean {
    return this.banks.has(providerRef);
  }

  conversationCount(providerRef: string): number {
    return this.bank(providerRef).conversations.length;
  }

  seedItem(providerRef: string, item: MemoryItem): void {
    this.bank(providerRef).items.push(clone(item));
  }

  seedSummary(providerRef: string, summary: MemorySummary): void {
    this.bank(providerRef).summary = clone(summary);
  }

  async createMemory(input: CreateProviderMemoryInput): Promise<ProviderMemoryRef> {
    this.assertAvailable();
    const operationKey = `${input.projectId}:${input.idempotencyKey}`;
    const existing = this.createOperations.get(operationKey);
    if (existing) return { providerRef: existing };
    const providerRef = `fake-bank-${this.banks.size + 1}`;
    this.banks.set(providerRef, { conversations: [], items: [], summary: null });
    this.createOperations.set(operationKey, providerRef);
    return { providerRef };
  }

  async appendConversation(input: AppendConversationInput): Promise<AppendConversationResult> {
    this.assertAvailable();
    const operationKey = `${input.providerRef}:${input.idempotencyKey}`;
    const existing = this.appendOperations.get(operationKey);
    if (existing) return clone(existing);
    const bank = this.bank(input.providerRef);
    bank.conversations.push(clone(input.conversation));
    const result = {
      conversationId: input.conversation.id,
      operationId: `fake-operation-${this.appendOperations.size + 1}`,
      acceptedAt: new Date().toISOString(),
    };
    this.appendOperations.set(operationKey, result);
    return clone(result);
  }

  async recall(input: RecallInput): Promise<RecallResult> {
    this.assertAvailable();
    const bank = this.bank(input.providerRef);
    const query = input.query.toLocaleLowerCase();
    const allowed = new Set(input.types ?? ["fact", "experience", "insight"]);
    const items = bank.items
      .filter((item) => item.status === "active" && allowed.has(item.kind))
      .map((item) => ({
        item,
        score: itemText(item).toLocaleLowerCase().includes(query) ? 1 : 0,
      }))
      .filter(({ score }) => score > 0)
      .slice(0, input.maxItems);
    return { items: clone(items), summary: clone(bank.summary) };
  }

  async listConversations(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryConversation>> {
    this.assertAvailable();
    return page(this.bank(input.providerRef).conversations, input.cursor, input.limit);
  }

  async getConversation(input: GetMemoryConversationInput): Promise<MemoryConversation> {
    this.assertAvailable();
    const conversation = this.bank(input.providerRef).conversations.find(
      ({ id }) => id === input.conversationId,
    );
    if (!conversation) throw this.notFound();
    return clone(conversation);
  }

  async listFacts(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryFact>> {
    this.assertAvailable();
    return page(
      filteredItems(
        this.bank(input.providerRef).items.filter((item): item is MemoryFact => item.kind === "fact"),
        input,
      ),
      input.cursor,
      input.limit,
    );
  }

  async listExperiences(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryExperience>> {
    this.assertAvailable();
    return page(
      filteredItems(
        this.bank(input.providerRef).items.filter(
          (item): item is MemoryExperience => item.kind === "experience",
        ),
        input,
      ),
      input.cursor,
      input.limit,
    );
  }

  async listInsights(input: ListMemoryItemsInput): Promise<MemoryPage<MemoryInsight>> {
    this.assertAvailable();
    return page(
      filteredItems(
        this.bank(input.providerRef).items.filter((item): item is MemoryInsight => item.kind === "insight"),
        input,
      ),
      input.cursor,
      input.limit,
    );
  }

  async getItem(input: GetMemoryItemInput): Promise<MemoryItem> {
    this.assertAvailable();
    const item = this.bank(input.providerRef).items.find(({ id }) => id === input.itemId);
    if (!item) throw this.notFound();
    return clone(item);
  }

  async updateItem(input: UpdateMemoryItemInput): Promise<MemoryItem> {
    this.assertAvailable();
    const bank = this.bank(input.providerRef);
    const index = bank.items.findIndex(({ id }) => id === input.item.id);
    if (index < 0) throw this.notFound();
    const current = bank.items[index]!;
    if (
      input.expectedVersion !== undefined
      && (current.kind !== "experience" || current.version !== input.expectedVersion)
    ) {
      throw new MemoryProviderError({
        code: "conflict",
        message: "The Memory item changed before this update was applied.",
        retryable: false,
      });
    }
    bank.items[index] = clone(input.item);
    return clone(input.item);
  }

  async invalidateItem(input: ChangeMemoryItemStatusInput): Promise<void> {
    this.changeStatus(input, "invalidated");
  }

  async restoreItem(input: ChangeMemoryItemStatusInput): Promise<void> {
    this.changeStatus(input, "active");
  }

  async deleteConversation(input: DeleteConversationInput): Promise<ProviderDeleteResult> {
    this.assertAvailable();
    const bank = this.bank(input.providerRef);
    const before = bank.conversations.length;
    bank.conversations = bank.conversations.filter(({ id }) => id !== input.conversationId);
    return { deleted: before !== bank.conversations.length, verifiedAbsent: true };
  }

  async exportMemory(input: ExportProviderMemoryInput): Promise<ProviderExportResult> {
    this.assertAvailable();
    const bank = this.bank(input.providerRef);
    return {
      contentType: "application/json",
      filename: `${input.memoryId}.json`,
      content: JSON.stringify(bank),
    };
  }

  async deleteMemory(input: DeleteProviderMemoryInput): Promise<ProviderDeleteResult> {
    this.assertAvailable();
    const deleted = this.banks.delete(input.providerRef);
    return { deleted, verifiedAbsent: !this.banks.has(input.providerRef) };
  }

  async healthCheck(_input: ProviderHealthInput): Promise<ProviderHealth> {
    return {
      status: this.unavailable ? "unavailable" : "healthy",
      checkedAt: new Date().toISOString(),
    };
  }

  private bank(providerRef: string): FakeBank {
    const bank = this.banks.get(providerRef);
    if (!bank) throw this.notFound();
    return bank;
  }

  private changeStatus(
    input: ChangeMemoryItemStatusInput,
    status: "active" | "invalidated",
  ): void {
    this.assertAvailable();
    const bank = this.bank(input.providerRef);
    const index = bank.items.findIndex(({ id }) => id === input.itemId);
    if (index < 0) throw this.notFound();
    bank.items[index] = { ...bank.items[index]!, status } as MemoryItem;
  }

  private assertAvailable(): void {
    if (!this.unavailable) return;
    throw new MemoryProviderError({
      code: "unavailable",
      message: "The Memory provider is temporarily unavailable.",
      retryable: true,
      marksMemoryDegraded: true,
    });
  }

  private notFound(): MemoryProviderError {
    return new MemoryProviderError({
      code: "not_found",
      message: "The requested Memory provider resource was not found.",
      retryable: false,
    });
  }
}
