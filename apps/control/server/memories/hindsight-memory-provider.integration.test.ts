import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HindsightMemoryProvider } from "./hindsight-memory-provider";
import { MemoryProviderError } from "./memory-provider";

const timestamp = "2026-08-27T02:00:00.000Z";

interface MockDocument {
  id: string;
  bank_id: string;
  original_text: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
  memory_unit_count: number;
}

interface MockMemory {
  id: string;
  text: string;
  type: "world" | "experience" | "observation";
  context: string | null;
  occurred_start: string | null;
  occurred_end: string | null;
  mentioned_at: string;
  document_id: string;
  created_at: string;
  updated_at: string;
  state: "valid" | "invalidated";
  scores?: { final: number };
}

interface MockBank {
  documents: Map<string, MockDocument>;
  memories: Map<string, MockMemory>;
}

interface RetainBody {
  async?: boolean;
  operation_id?: string;
  items?: Array<{ content?: string; document_id?: string }>;
}

class HindsightApiFixture {
  readonly banks = new Map<string, MockBank>();
  readonly authorizationHeaders: string[] = [];
  readonly retainOperationIds: string[] = [];
  unavailable = false;
  server: Server | null = null;
  baseUrl = "";

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        this.json(response, 500, {
          detail: error instanceof Error ? error.message : "fixture failure",
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => error ? reject(error) : resolve());
    });
    this.server = null;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.authorizationHeaders.push(request.headers.authorization ?? "");
    if (this.unavailable) {
      this.json(response, 503, {
        detail: `upstream failure at ${this.baseUrl}; Authorization=${request.headers.authorization}`,
      });
      return;
    }

    const url = new URL(request.url ?? "/", this.baseUrl);
    if (request.method === "GET" && url.pathname === "/version") {
      this.json(response, 200, { api_version: "0.9.2", features: {} });
      return;
    }

    const exportMatch = url.pathname.match(
      /^\/v1\/default\/banks\/([^/]+)\/document-transfer\/export$/,
    );
    if (request.method === "POST" && exportMatch) {
      this.json(response, 200, { operation_id: "export-operation" });
      return;
    }
    const operationMatch = url.pathname.match(
      /^\/v1\/default\/banks\/([^/]+)\/operations\/([^/]+)$/,
    );
    if (request.method === "GET" && operationMatch) {
      this.json(response, 200, {
        operation_id: operationMatch[2],
        status: "completed",
        result_metadata: { download_url: "/v1/default/files/download/memory-export.zip" },
      });
      return;
    }
    if (
      request.method === "GET"
      && url.pathname === "/v1/default/files/download/memory-export.zip"
    ) {
      const archive = Buffer.from("PK\u0003\u0004memory-export");
      response.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": archive.byteLength,
      });
      response.end(archive);
      return;
    }

    const recallMatch = url.pathname.match(
      /^\/v1\/default\/banks\/([^/]+)\/memories\/recall$/,
    );
    if (request.method === "POST" && recallMatch) {
      await this.readJson(request);
      const bank = this.requireBank(recallMatch[1]!);
      const results = [...bank.memories.values()]
        .filter((memory) => memory.state === "valid")
        .map((memory) => ({ ...memory, scores: { final: 0.91 } }));
      this.json(response, 200, { results });
      return;
    }

    const listMemoryMatch = url.pathname.match(
      /^\/v1\/default\/banks\/([^/]+)\/memories\/list$/,
    );
    if (request.method === "GET" && listMemoryMatch) {
      const bank = this.requireBank(listMemoryMatch[1]!);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const type = url.searchParams.get("type");
      const matches = [...bank.memories.values()].filter((memory) => memory.type === type);
      this.json(response, 200, {
        items: matches.slice(offset, offset + limit),
        total: matches.length,
        limit,
        offset,
      });
      return;
    }

    const memoryMatch = url.pathname.match(
      /^\/v1\/default\/banks\/([^/]+)\/memories\/([^/]+)$/,
    );
    if (memoryMatch && request.method === "GET") {
      const memory = this.requireBank(memoryMatch[1]!).memories.get(memoryMatch[2]!);
      this.json(response, memory ? 200 : 404, memory ?? { detail: "not found" });
      return;
    }
    if (memoryMatch && request.method === "PATCH") {
      const bank = this.requireBank(memoryMatch[1]!);
      const memory = bank.memories.get(memoryMatch[2]!);
      if (!memory) {
        this.json(response, 404, { detail: "not found" });
        return;
      }
      const body = await this.readJson(request) as Partial<MockMemory> & { fact_type?: string };
      const updated: MockMemory = {
        ...memory,
        ...(body.text !== undefined ? { text: body.text } : {}),
        ...(body.context !== undefined ? { context: body.context } : {}),
        ...(body.occurred_start !== undefined ? { occurred_start: body.occurred_start } : {}),
        ...(body.occurred_end !== undefined ? { occurred_end: body.occurred_end } : {}),
        ...(body.state !== undefined ? { state: body.state } : {}),
        updated_at: timestamp,
      };
      bank.memories.set(updated.id, updated);
      this.json(response, 200, updated);
      return;
    }

    const documentsMatch = url.pathname.match(/^\/v1\/default\/banks\/([^/]+)\/documents$/);
    if (request.method === "GET" && documentsMatch) {
      const bank = this.requireBank(documentsMatch[1]!);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const documents = [...bank.documents.values()];
      this.json(response, 200, {
        items: documents.slice(offset, offset + limit),
        total: documents.length,
        limit,
        offset,
      });
      return;
    }

    const documentMatch = url.pathname.match(
      /^\/v1\/default\/banks\/([^/]+)\/documents\/([^/]+)$/,
    );
    if (documentMatch && request.method === "GET") {
      const document = this.requireBank(documentMatch[1]!).documents.get(documentMatch[2]!);
      this.json(response, document ? 200 : 404, document ?? { detail: "not found" });
      return;
    }
    if (documentMatch && request.method === "DELETE") {
      const bank = this.requireBank(documentMatch[1]!);
      const documentId = documentMatch[2]!;
      const deleted = bank.documents.delete(documentId);
      for (const [memoryId, memory] of bank.memories) {
        if (memory.document_id === documentId) bank.memories.delete(memoryId);
      }
      this.json(response, deleted ? 200 : 404, { success: deleted });
      return;
    }

    const retainMatch = url.pathname.match(/^\/v1\/default\/banks\/([^/]+)\/memories$/);
    if (request.method === "POST" && retainMatch) {
      const bank = this.requireBank(retainMatch[1]!);
      const body = await this.readJson(request) as RetainBody;
      const operationId = body.operation_id ?? "missing-operation";
      this.retainOperationIds.push(operationId);
      for (const item of body.items ?? []) {
        const documentId = item.document_id ?? `document-${bank.documents.size + 1}`;
        const originalText = item.content ?? "";
        bank.documents.set(documentId, {
          id: documentId,
          bank_id: retainMatch[1]!,
          original_text: originalText,
          content_hash: "fixture-hash",
          created_at: timestamp,
          updated_at: timestamp,
          memory_unit_count: 3,
        });
        for (const [memoryId, memory] of bank.memories) {
          if (memory.document_id === documentId) bank.memories.delete(memoryId);
        }
        this.seedRetainedItems(bank, documentId);
      }
      this.json(response, 200, {
        success: true,
        bank_id: retainMatch[1],
        items_count: body.items?.length ?? 0,
        async: body.async === true,
        operation_id: operationId,
      });
      return;
    }

    const profileMatch = url.pathname.match(/^\/v1\/default\/banks\/([^/]+)\/profile$/);
    if (request.method === "GET" && profileMatch) {
      const exists = this.banks.has(profileMatch[1]!);
      this.json(response, exists ? 200 : 404, exists
        ? {
            bank_id: profileMatch[1],
            name: "Relay Memory",
            mission: "",
            disposition: { skepticism: 3, literalism: 3, empathy: 3 },
          }
        : { detail: "not found" });
      return;
    }

    const bankMatch = url.pathname.match(/^\/v1\/default\/banks\/([^/]+)$/);
    if (bankMatch && request.method === "PUT") {
      await this.readJson(request);
      const bankId = bankMatch[1]!;
      if (!this.banks.has(bankId)) {
        this.banks.set(bankId, { documents: new Map(), memories: new Map() });
      }
      this.json(response, 200, {
        bank_id: bankId,
        name: "Relay Memory",
        mission: "",
        disposition: { skepticism: 3, literalism: 3, empathy: 3 },
      });
      return;
    }
    if (bankMatch && request.method === "DELETE") {
      const deleted = this.banks.delete(bankMatch[1]!);
      this.json(response, deleted ? 200 : 404, { success: deleted });
      return;
    }

    this.json(response, 404, { detail: `${request.method} ${url.pathname} not handled` });
  }

  private seedRetainedItems(bank: MockBank, documentId: string): void {
    const shared = {
      context: "TaskLattice Agent conversation",
      occurred_start: timestamp,
      occurred_end: timestamp,
      mentioned_at: timestamp,
      document_id: documentId,
      created_at: timestamp,
      updated_at: timestamp,
      state: "valid" as const,
    };
    const items: MockMemory[] = [
      { ...shared, id: `fact-${documentId}`, type: "world", text: "The launch is Friday." },
      {
        ...shared,
        id: `experience-${documentId}`,
        type: "experience",
        text: "Prepared a canary and rollback plan.",
      },
      {
        ...shared,
        id: `insight-${documentId}`,
        type: "observation",
        text: "Friday launches need a rollback owner.",
      },
    ];
    for (const item of items) bank.memories.set(item.id, item);
  }

  private requireBank(bankId: string): MockBank {
    const bank = this.banks.get(bankId);
    if (!bank) throw new Error(`Bank ${bankId} was not created.`);
    return bank;
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : {};
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    if (response.headersSent) return;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  }
}

describe("HindsightMemoryProvider HTTP integration", () => {
  let fixture: HindsightApiFixture;
  let provider: HindsightMemoryProvider;

  beforeEach(async () => {
    fixture = new HindsightApiFixture();
    await fixture.start();
    provider = new HindsightMemoryProvider({
      baseUrl: fixture.baseUrl,
      apiKey: "integration-secret",
      requestTimeoutMs: 1_000,
    });
  });

  afterEach(async () => {
    await fixture.stop();
  });

  it("uses the pinned Hindsight API contract for lifecycle, paging, curation, and export", async () => {
    const reference = await provider.createMemory({
      projectId: "project-a",
      memoryId: "memory-a",
      displayName: "Research memory",
      idempotencyKey: "create-a",
    });
    expect(reference.providerRef).toMatch(/^tali_[a-f0-9]{40}$/);
    await expect(provider.createMemory({
      projectId: "project-a",
      memoryId: "memory-a",
      displayName: "Research memory",
      idempotencyKey: "create-a",
    })).resolves.toEqual(reference);

    const scope = {
      projectId: "project-a",
      memoryId: "memory-a",
      providerRef: reference.providerRef,
    };
    const conversation = (id: string) => ({
      id,
      title: "Launch planning",
      summary: "Prepared the release.",
      sourceDocumentIds: [id],
      startedAt: timestamp,
      endedAt: timestamp,
      messages: [{ id: `${id}-message`, role: "user" as const, text: "Launch Friday", occurredAt: timestamp }],
    });
    const first = await provider.appendConversation({
      ...scope,
      conversation: conversation("conversation-a"),
      idempotencyKey: "retain-a",
    });
    const replay = await provider.appendConversation({
      ...scope,
      conversation: conversation("conversation-a"),
      idempotencyKey: "retain-a",
    });
    expect(replay.operationId).toBe(first.operationId);
    expect(fixture.retainOperationIds[0]).toBe(fixture.retainOperationIds[1]);
    await provider.appendConversation({
      ...scope,
      conversation: conversation("conversation-b"),
      idempotencyKey: "retain-b",
    });

    const firstPage = await provider.listConversations({ ...scope, limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    await expect(provider.listConversations({
      ...scope,
      limit: 1,
      cursor: firstPage.nextCursor,
    })).resolves.toMatchObject({ items: [{ id: "conversation-b" }], nextCursor: null });

    const facts = await provider.listFacts({ ...scope, limit: 1 });
    expect(facts.items).toHaveLength(1);
    expect(facts.nextCursor).not.toBeNull();
    await expect(provider.listExperiences({ ...scope, limit: 10 })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ kind: "experience" })]),
    });
    await expect(provider.listInsights({ ...scope, limit: 10 })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ kind: "insight" })]),
    });
    await expect(provider.recall({ ...scope, query: "What happens Friday?", maxItems: 10 }))
      .resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ score: 0.91, item: expect.objectContaining({ kind: "fact" }) }),
        ]),
      });

    const factId = facts.items[0]!.id;
    await provider.invalidateItem({ ...scope, itemId: factId });
    await expect(provider.getItem({ ...scope, itemId: factId })).resolves.toMatchObject({
      status: "invalidated",
    });
    await provider.restoreItem({ ...scope, itemId: factId });
    await expect(provider.getItem({ ...scope, itemId: factId })).resolves.toMatchObject({
      status: "active",
    });

    await expect(provider.exportMemory({ ...scope, format: "json" })).resolves.toMatchObject({
      contentType: "application/zip",
      filename: "memory-a.zip",
      content: expect.any(Uint8Array),
    });
    await expect(provider.deleteConversation({
      ...scope,
      conversationId: "conversation-a",
      idempotencyKey: "delete-conversation-a",
    })).resolves.toEqual({ deleted: true, verifiedAbsent: true });
    await expect(provider.healthCheck({ providerRef: reference.providerRef })).resolves.toMatchObject({
      status: "healthy",
    });
    await expect(provider.deleteMemory({
      ...scope,
      idempotencyKey: "delete-memory-a",
    })).resolves.toEqual({ deleted: true, verifiedAbsent: true });
    expect(fixture.authorizationHeaders.every((header) => header === "Bearer integration-secret"))
      .toBe(true);
  });

  it("maps upstream failures without exposing the deployment URL or credential", async () => {
    fixture.unavailable = true;
    const failure = await provider.recall({
      projectId: "project-a",
      memoryId: "memory-a",
      providerRef: "opaque-bank",
      query: "anything",
      maxItems: 5,
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "MemoryProviderError",
      code: "unavailable",
      retryable: true,
      marksMemoryDegraded: true,
    } satisfies Partial<MemoryProviderError>);
    expect(String((failure as Error).message)).not.toContain(fixture.baseUrl);
    expect(String((failure as Error).message)).not.toContain("integration-secret");
    await expect(provider.healthCheck({ providerRef: "opaque-bank" })).resolves.toMatchObject({
      status: "unavailable",
    });
  });
});
