import { describe, expect, it } from "vitest";
import type { MemoryExperience, MemoryFact, MemoryInsight } from "@tali/contracts";
import { MemoryProviderError } from "./memory-provider";
import { FakeMemoryProvider } from "./testing/fake-memory-provider";

const occurredAt = "2026-08-27T02:00:00.000Z";

async function providerFixture(): Promise<{
  provider: FakeMemoryProvider;
  scope: { projectId: string; memoryId: string; providerRef: string };
}> {
  const provider = new FakeMemoryProvider();
  const reference = await provider.createMemory({
    projectId: "project-a",
    memoryId: "memory-a",
    displayName: "Research memory",
    idempotencyKey: "create-a",
  });
  return {
    provider,
    scope: {
      projectId: "project-a",
      memoryId: "memory-a",
      providerRef: reference.providerRef,
    },
  };
}

function items(): [MemoryFact, MemoryExperience, MemoryInsight] {
  const evidence = [{
    sourceDocumentId: "conversation-a",
    sourceItemId: "message-a",
    excerpt: "The launch date is Friday.",
    occurredAt,
  }];
  return [
    {
      kind: "fact",
      id: "fact-a",
      text: "The launch date is Friday.",
      status: "active",
      evidence,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    {
      kind: "experience",
      id: "experience-a",
      title: "Prepared the launch",
      summary: "Prepared a safe Friday launch.",
      situation: "The release needed a rollout plan.",
      goal: "Ship on Friday.",
      actions: ["Created a canary", "Prepared rollback"],
      outcome: "The release was ready.",
      lessonLearned: "Prepare rollback before the canary.",
      status: "active",
      occurredStart: occurredAt,
      occurredEnd: occurredAt,
      hindsightMemoryIds: ["provider-experience-a"],
      sourceDocumentIds: ["conversation-a"],
      evidence,
      version: 1,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    {
      kind: "insight",
      id: "insight-a",
      text: "Friday launches need an explicit rollback owner.",
      status: "active",
      evidence,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
  ];
}

describe("MemoryProvider contract", () => {
  it("creates and appends idempotently, then pages and deletes conversations", async () => {
    const { provider, scope } = await providerFixture();
    const replay = await provider.createMemory({
      projectId: scope.projectId,
      memoryId: scope.memoryId,
      displayName: "Ignored replay name",
      idempotencyKey: "create-a",
    });
    expect(replay.providerRef).toBe(scope.providerRef);

    const conversation = {
      id: "conversation-a",
      title: "Launch planning",
      summary: "Planned the release.",
      sourceDocumentIds: ["conversation-a"],
      startedAt: occurredAt,
      endedAt: occurredAt,
      messages: [{ id: "message-a", role: "user" as const, text: "Launch Friday", occurredAt }],
    };
    const appendInput = { ...scope, conversation, idempotencyKey: "retain-a" };
    const first = await provider.appendConversation(appendInput);
    const appendReplay = await provider.appendConversation(appendInput);
    expect(appendReplay.operationId).toBe(first.operationId);
    await expect(provider.listConversations({ ...scope, limit: 1 })).resolves.toMatchObject({
      items: [{ id: "conversation-a" }],
      nextCursor: null,
    });
    await expect(provider.deleteConversation({
      ...scope,
      conversationId: conversation.id,
      idempotencyKey: "delete-conversation-a",
    })).resolves.toEqual({ deleted: true, verifiedAbsent: true });
  });

  it("supports typed recall, pagination, curation, export, and verified deletion", async () => {
    const { provider, scope } = await providerFixture();
    const [fact, experience, insight] = items();
    provider.seedItem(scope.providerRef, fact);
    provider.seedItem(scope.providerRef, experience);
    provider.seedItem(scope.providerRef, insight);
    provider.seedSummary(scope.providerRef, { text: "Friday launch memory", generatedAt: occurredAt });

    await expect(provider.recall({ ...scope, query: "Friday", maxItems: 5 })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ item: expect.objectContaining({ id: fact.id }) }),
      ]),
      summary: { text: "Friday launch memory" },
    });
    await expect(provider.listFacts({ ...scope, limit: 10 })).resolves.toMatchObject({
      items: [{ id: fact.id }],
    });
    await expect(provider.listExperiences({ ...scope, limit: 10 })).resolves.toMatchObject({
      items: [{ id: experience.id }],
    });
    await expect(provider.listInsights({ ...scope, limit: 10 })).resolves.toMatchObject({
      items: [{ id: insight.id }],
    });

    await provider.invalidateItem({ ...scope, itemId: fact.id });
    await expect(provider.getItem({ ...scope, itemId: fact.id })).resolves.toMatchObject({
      status: "invalidated",
    });
    await provider.restoreItem({ ...scope, itemId: fact.id });
    await expect(provider.getItem({ ...scope, itemId: fact.id })).resolves.toMatchObject({
      status: "active",
    });
    await expect(provider.updateItem({
      ...scope,
      expectedVersion: 1,
      item: { ...experience, version: 2, outcome: "The release shipped." },
    })).resolves.toMatchObject({ version: 2, outcome: "The release shipped." });
    await expect(provider.exportMemory({ ...scope, format: "json" })).resolves.toMatchObject({
      contentType: "application/json",
    });
    await expect(provider.deleteMemory({
      ...scope,
      idempotencyKey: "delete-memory-a",
    })).resolves.toEqual({ deleted: true, verifiedAbsent: true });
  });

  it("maps provider outages to a safe degraded and retryable error", async () => {
    const { provider, scope } = await providerFixture();
    provider.setUnavailable(true);
    await expect(provider.recall({ ...scope, query: "anything", maxItems: 5 })).rejects.toMatchObject({
      name: "MemoryProviderError",
      code: "unavailable",
      retryable: true,
      marksMemoryDegraded: true,
      message: "The Memory provider is temporarily unavailable.",
    } satisfies Partial<MemoryProviderError>);
    await expect(provider.healthCheck({ providerRef: scope.providerRef })).resolves.toMatchObject({
      status: "unavailable",
    });
  });
});
