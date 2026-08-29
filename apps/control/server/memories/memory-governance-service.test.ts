import type {
  MemoryConversation,
  MemoryExperience,
  MemoryFact,
  MemoryInsight,
} from "@tali/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createTestPrisma } from "../test/prisma";
import { MemoryRepository } from "./memory-repository";
import { MemoryService, MemoryVersionConflictError } from "./memory-service";
import { FakeMemoryProvider } from "./testing/fake-memory-provider";

const databases: PrismaClient[] = [];
const occurredAt = "2026-08-28T01:00:00.000Z";

async function fixture(): Promise<{
  database: PrismaClient;
  memoryId: string;
  provider: FakeMemoryProvider;
  providerRef: string;
  repository: MemoryRepository;
  service: MemoryService;
}> {
  const database = createTestPrisma();
  databases.push(database);
  const provider = new FakeMemoryProvider();
  const repository = new MemoryRepository("individual", database);
  const service = new MemoryService(
    repository,
    () => provider,
    () => "governance-test-outbox-secret-32-characters",
  );
  const memory = await service.provision({
    actorId: "local-admin",
    displayName: "Governed Memory",
    idempotencyKey: "governance-memory",
  });
  await database.agentRecord.create({
    data: {
      projectId: "individual",
      id: "governance-agent",
      ownerUserId: "local-admin",
      createdAt: new Date(occurredAt),
      payload: { agentPlatform: "openclaw" },
    },
  });
  return {
    database,
    memoryId: memory.id,
    provider,
    providerRef: memory.providerRef!,
    repository,
    service,
  };
}

function evidence() {
  return [{
    sourceDocumentId: "conversation-a",
    sourceItemId: "message-a",
    excerpt: "Friday launch",
    occurredAt,
  }];
}

function fact(): MemoryFact {
  return {
    kind: "fact",
    id: "fact-a",
    text: "The launch is Friday.",
    status: "active",
    evidence: evidence(),
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

function experience(): MemoryExperience {
  return {
    kind: "experience",
    id: "experience-a",
    title: "Launch planning",
    summary: "Prepared the Friday launch.",
    situation: "A release needed a plan.",
    goal: "Ship safely.",
    actions: ["Prepared a canary"],
    outcome: "Ready to ship.",
    lessonLearned: "Assign rollback ownership.",
    status: "active",
    occurredStart: occurredAt,
    occurredEnd: occurredAt,
    hindsightMemoryIds: ["experience-a"],
    sourceDocumentIds: ["conversation-a"],
    evidence: evidence(),
    version: 1,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

function insight(): MemoryInsight {
  return {
    kind: "insight",
    id: "insight-a",
    text: "Friday launches need a rollback owner.",
    status: "active",
    evidence: evidence(),
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

const conversation: MemoryConversation = {
  id: "conversation-a",
  title: "Launch",
  summary: "Launch planning",
  sourceDocumentIds: ["conversation-a"],
  startedAt: occurredAt,
  endedAt: occurredAt,
  messages: [{
    id: "message-a",
    role: "user",
    text: "The launch is Friday.",
    occurredAt,
  }],
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.$disconnect()));
});

describe("Memory governance queries", () => {
  it("uses stable server cursors and keeps Project ownership in the repository", async () => {
    const setup = await fixture();
    await setup.service.provision({
      actorId: "local-admin",
      displayName: "Second",
      idempotencyKey: "governance-second",
    });
    await setup.service.provision({
      actorId: "local-admin",
      displayName: "Third",
      idempotencyKey: "governance-third",
    });
    const first = await setup.service.listResources({ limit: 2 });
    const second = await setup.service.listResources({ cursor: first.nextCursor, limit: 2 });
    expect(first.totalCount).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(second.items.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining(first.items.map(({ id }) => id)),
    );
    await expect(new MemoryRepository("another-project", setup.database)
      .getMemory(setup.memoryId)).resolves.toBeNull();
  });

  it("returns real provider counts without exposing the provider reference", async () => {
    const setup = await fixture();
    setup.provider.seedItem(setup.providerRef, fact());
    setup.provider.seedItem(setup.providerRef, experience());
    setup.provider.seedItem(setup.providerRef, insight());
    await setup.provider.appendConversation({
      projectId: "individual",
      memoryId: setup.memoryId,
      providerRef: setup.providerRef,
      conversation,
      idempotencyKey: "append-conversation-a",
    });
    const detail = await setup.service.getResource(setup.memoryId);
    expect(detail.counts).toEqual({
      conversations: 1,
      experiences: 1,
      facts: 1,
      insights: 1,
    });
    expect(JSON.stringify(detail)).not.toContain(setup.providerRef);
    await expect(setup.service.rename(setup.memoryId, "Renamed Memory", "local-admin"))
      .resolves.toMatchObject({ displayName: "Renamed Memory" });
    const settings = await setup.service.providerSettings(setup.memoryId);
    expect(settings).toMatchObject({
      provider: "fake",
      providerHealth: "healthy",
    });
    expect(JSON.stringify(settings)).not.toContain(setup.providerRef);
  });

  it("binds, detaches, and rebinds the same Project Memory explicitly", async () => {
    const setup = await fixture();
    const first = await setup.service.attachExisting({
      actorId: "local-admin",
      idempotencyKey: "bind-first",
      instanceId: "governance-agent",
      memoryId: setup.memoryId,
      runtimeType: "openclaw",
    });
    await expect(setup.service.detachBinding(
      setup.memoryId,
      first.id,
      "local-admin",
    )).resolves.toMatchObject({ status: "unbound", activeBinding: null });
    const rebound = await setup.service.attachExisting({
      actorId: "local-admin",
      idempotencyKey: "bind-second",
      instanceId: "governance-agent",
      memoryId: setup.memoryId,
      runtimeType: "openclaw",
    });
    expect(rebound.id).not.toBe(first.id);
    expect(setup.provider.bankCount()).toBe(1);
  });

  it("applies search and time filters before paginating Conversations", async () => {
    const setup = await fixture();
    for (const [index, title] of ["Alpha", "Beta", "Alpha later"].entries()) {
      const at = new Date(Date.parse(occurredAt) + index * 60_000).toISOString();
      await setup.provider.appendConversation({
        projectId: "individual",
        memoryId: setup.memoryId,
        providerRef: setup.providerRef,
        idempotencyKey: `conversation-filter-${index}`,
        conversation: {
          ...conversation,
          id: `conversation-filter-${index}`,
          title,
          startedAt: at,
          endedAt: at,
        },
      });
    }
    const first = await setup.service.listConversations({
      memoryId: setup.memoryId,
      query: "alpha",
      from: occurredAt,
      limit: 1,
    });
    const second = await setup.service.listConversations({
      memoryId: setup.memoryId,
      query: "alpha",
      from: occurredAt,
      cursor: first.nextCursor,
      limit: 1,
    });
    expect(first.totalCount).toBe(2);
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
  });

  it("retries a degraded provisioning record without creating another Bank", async () => {
    const setup = await fixture();
    await setup.repository.transitionMemory({
      memoryId: setup.memoryId,
      to: "degraded",
      actorId: "test",
      action: "memory.test_degraded",
      providerRef: null,
      lastErrorSummary: "Safe provider failure summary.",
    });
    await expect(setup.service.retryProvisioning(setup.memoryId, "local-admin"))
      .resolves.toMatchObject({ status: "ready", degradedReason: null });
    expect(setup.provider.bankCount()).toBe(1);
  });
});

describe("Memory curation", () => {
  it("revises a Fact with conflict detection, secret filtering, and current recall", async () => {
    const setup = await fixture();
    setup.provider.seedItem(setup.providerRef, fact());
    const revised = await setup.service.updateFact({
      actorId: "local-admin",
      itemId: "fact-a",
      memoryId: setup.memoryId,
      update: {
        expectedUpdatedAt: occurredAt,
        text: "The launch moved to Monday. Authorization: Bearer abcdefghijklmnop",
      },
    });
    expect(revised.text).toContain("Monday");
    expect(revised.text).not.toContain("abcdefghijklmnop");
    await expect(setup.service.updateFact({
      actorId: "local-admin",
      itemId: "fact-a",
      memoryId: setup.memoryId,
      update: { expectedUpdatedAt: occurredAt, text: "Stale overwrite" },
    })).rejects.toBeInstanceOf(MemoryVersionConflictError);
    await expect(setup.service.recall({
      memoryId: setup.memoryId,
      query: "Friday",
      maxItems: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({ items: [] });
    await expect(setup.service.recall({
      memoryId: setup.memoryId,
      query: "Monday",
      maxItems: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({ items: [{ item: { id: "fact-a" } }] });
    const audit = await setup.database.memoryCurationEvent.findFirstOrThrow({
      where: { projectId: "individual", action: "memory.fact.revised" },
    });
    expect(JSON.stringify(audit)).not.toContain("abcdefghijklmnop");
  });

  it("persists structured Experience edits and rejects a stale version", async () => {
    const setup = await fixture();
    setup.provider.seedItem(setup.providerRef, experience());
    const update = {
      title: "Safe launch",
      summary: "Prepared the release.",
      situation: "The release was high risk.",
      goal: "Ship with rollback.",
      actions: ["Canary", "Rollback drill"],
      outcome: "Shipped safely.",
      lessonLearned: "Drill rollback first.",
      occurredStart: occurredAt,
      occurredEnd: occurredAt,
      expectedVersion: 1,
    };
    await expect(setup.service.updateExperience({
      actorId: "local-admin",
      itemId: "experience-a",
      memoryId: setup.memoryId,
      update,
    })).resolves.toMatchObject({ version: 2, actions: update.actions });
    await expect(setup.service.updateExperience({
      actorId: "local-admin",
      itemId: "experience-a",
      memoryId: setup.memoryId,
      update,
    })).rejects.toBeInstanceOf(MemoryVersionConflictError);
    await expect(setup.service.getItem(setup.memoryId, "experience-a"))
      .resolves.toMatchObject({ version: 2, lessonLearned: update.lessonLearned });
  });

  it("excludes invalidated Facts and derived Insights from recall, then restores them", async () => {
    const setup = await fixture();
    setup.provider.seedItem(setup.providerRef, fact());
    setup.provider.seedItem(setup.providerRef, insight());
    await setup.service.invalidateItem(setup.memoryId, "fact-a", "local-admin");
    await setup.service.invalidateItem(setup.memoryId, "insight-a", "local-admin");
    await expect(setup.service.recall({
      memoryId: setup.memoryId,
      query: "Friday",
      maxItems: 10,
      timeoutMs: 500,
    })).resolves.toMatchObject({ items: [] });
    await setup.service.restoreItem(setup.memoryId, "fact-a", "local-admin");
    await setup.service.restoreItem(setup.memoryId, "insight-a", "local-admin");
    const recalled = await setup.service.recall({
      memoryId: setup.memoryId,
      query: "Friday",
      maxItems: 10,
      timeoutMs: 500,
    });
    expect(recalled.items.map(({ item }) => item.id)).toEqual(
      expect.arrayContaining(["fact-a", "insight-a"]),
    );
  });

  it("deletes a Conversation only after provider verification and invalidates orphaned derivations", async () => {
    const setup = await fixture();
    setup.provider.seedItem(setup.providerRef, fact());
    setup.provider.seedItem(setup.providerRef, experience());
    setup.provider.seedItem(setup.providerRef, insight());
    await setup.provider.appendConversation({
      projectId: "individual",
      memoryId: setup.memoryId,
      providerRef: setup.providerRef,
      conversation,
      idempotencyKey: "append-conversation-a",
    });
    await expect(setup.service.deleteConversation({
      actorId: "local-admin",
      conversationId: conversation.id,
      idempotencyKey: "delete-conversation-a",
      memoryId: setup.memoryId,
    })).resolves.toEqual({ deleted: true, invalidatedDerivedItems: 3 });
    await expect(setup.service.listConversations({ memoryId: setup.memoryId }))
      .resolves.toMatchObject({ items: [], totalCount: 0 });
    for (const itemId of ["fact-a", "experience-a", "insight-a"]) {
      await expect(setup.service.getItem(setup.memoryId, itemId))
        .resolves.toMatchObject({ status: "invalidated" });
    }
  });

  it("redacts selected Conversation messages and invalidates orphaned derivations", async () => {
    const setup = await fixture();
    setup.provider.seedItem(setup.providerRef, fact());
    await setup.provider.appendConversation({
      projectId: "individual",
      memoryId: setup.memoryId,
      providerRef: setup.providerRef,
      conversation,
      idempotencyKey: "append-before-redaction",
    });

    await expect(setup.service.redactConversation({
      actorId: "local-admin",
      conversationId: conversation.id,
      idempotencyKey: "redact-message-a",
      memoryId: setup.memoryId,
      messageIds: ["message-a"],
      replacement: "[Sensitive content removed] Authorization: Bearer abcdefghijklmnop",
    })).resolves.toMatchObject({
      redactedMessages: 1,
      invalidatedDerivedItems: 1,
    });

    const redacted = await setup.provider.getConversation({
      projectId: "individual",
      memoryId: setup.memoryId,
      providerRef: setup.providerRef,
      conversationId: conversation.id,
    });
    expect(redacted.messages[0]?.text).toContain("[Sensitive content removed]");
    expect(redacted.messages[0]?.text).not.toContain("abcdefghijklmnop");
    await expect(setup.service.getItem(setup.memoryId, "fact-a"))
      .resolves.toMatchObject({ status: "invalidated" });
    const audit = await setup.database.memoryCurationEvent.findFirstOrThrow({
      where: { projectId: "individual", action: "memory.conversation.redacted" },
    });
    expect(JSON.stringify(audit)).not.toContain("The launch is Friday");
    expect(JSON.stringify(audit)).not.toContain("abcdefghijklmnop");
  });

  it("re-extracts a retained Conversation idempotently and audits the request", async () => {
    const setup = await fixture();
    await setup.provider.appendConversation({
      projectId: "individual",
      memoryId: setup.memoryId,
      providerRef: setup.providerRef,
      conversation,
      idempotencyKey: "append-before-reextract",
    });
    const first = await setup.service.reextractConversation({
      actorId: "local-admin",
      conversationId: conversation.id,
      idempotencyKey: "reextract-a",
      memoryId: setup.memoryId,
    });
    const replay = await setup.service.reextractConversation({
      actorId: "local-admin",
      conversationId: conversation.id,
      idempotencyKey: "reextract-a",
      memoryId: setup.memoryId,
    });
    expect(replay.operationId).toBe(first.operationId);
    await expect(setup.database.memoryCurationEvent.count({
      where: {
        projectId: "individual",
        memoryId: setup.memoryId,
        action: "memory.conversation.reextraction_requested",
      },
    })).resolves.toBe(2);
  });

  it("exports without provider credentials and never returns encrypted outbox payloads", async () => {
    const setup = await fixture();
    setup.provider.seedItem(setup.providerRef, {
      ...fact(),
      text: "Legacy secret Authorization: Bearer abcdefghijklmnop postgres://user:pass@db/memory",
    });
    const exported = await setup.service.exportMemory(setup.memoryId, "local-admin");
    const content = typeof exported.content === "string"
      ? exported.content
      : Buffer.from(exported.content).toString("utf8");
    expect(content).not.toContain(setup.providerRef);
    expect(content).not.toContain("abcdefghijklmnop");
    expect(content).not.toContain("postgres://user:pass");
    await setup.service.recordExportGrant(
      setup.memoryId,
      "local-admin",
      "2026-08-28T02:00:00.000Z",
    );
    await setup.service.enqueueConversation({
      memoryId: setup.memoryId,
      conversation,
      idempotencyKey: "outbox-visible-shape",
    });
    const outbox = await setup.service.listOutbox({ memoryId: setup.memoryId });
    expect(outbox.items).toHaveLength(1);
    expect(JSON.stringify(outbox)).not.toContain("The launch is Friday");
    expect(JSON.stringify(outbox)).not.toContain("encryptedPayload");
    await expect(setup.database.memoryCurationEvent.findMany({
      where: {
        projectId: "individual",
        memoryId: setup.memoryId,
        action: { in: ["memory.export.authorized", "memory.export.downloaded"] },
      },
      select: { action: true },
    })).resolves.toEqual(expect.arrayContaining([
      { action: "memory.export.authorized" },
      { action: "memory.export.downloaded" },
    ]));
  });

  it("rate-limits export, deletion, and replay budgets per actor and Memory", async () => {
    const setup = await fixture();
    for (let index = 0; index < 3; index += 1) {
      await setup.service.consumeOperationBudget({
        action: "export",
        actorId: "local-admin",
        limit: 3,
        memoryId: setup.memoryId,
        windowMs: 60_000,
      });
    }
    await expect(setup.service.consumeOperationBudget({
      action: "export",
      actorId: "local-admin",
      limit: 3,
      memoryId: setup.memoryId,
      windowMs: 60_000,
    })).rejects.toMatchObject({ code: "memory_rate_limit_exceeded", status: 429 });
  });
});
