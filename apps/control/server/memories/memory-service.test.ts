import type { MemoryConversation } from "@tali/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createTestPrisma } from "../test/prisma";
import { MemoryRepository } from "./memory-repository";
import { MemoryService } from "./memory-service";
import { FakeMemoryProvider } from "./testing/fake-memory-provider";

const databases: PrismaClient[] = [];
const OUTBOX_SECRET = "test-memory-outbox-secret-with-32-characters";

async function fixture(): Promise<{
  database: PrismaClient;
  provider: FakeMemoryProvider;
  repository: MemoryRepository;
  service: MemoryService;
}> {
  const database = createTestPrisma();
  databases.push(database);
  await database.agentRecord.createMany({
    data: ["agent-a", "agent-b"].map((id) => ({
      projectId: "individual",
      id,
      ownerUserId: "local-admin",
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      payload: {},
    })),
  });
  const provider = new FakeMemoryProvider();
  const repository = new MemoryRepository("individual", database);
  return {
    database,
    provider,
    repository,
    service: new MemoryService(
      repository,
      () => provider,
      () => OUTBOX_SECRET,
    ),
  };
}

const conversation: MemoryConversation = {
  id: "conversation-a",
  title: "Release planning",
  summary: "The release is ready.",
  sourceDocumentIds: [],
  startedAt: "2026-08-27T01:00:00.000Z",
  endedAt: "2026-08-27T01:01:00.000Z",
  messages: [
    {
      id: "message-a",
      role: "user",
      text: "The private launch marker is sapphire.",
      occurredAt: "2026-08-27T01:00:00.000Z",
    },
  ],
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.$disconnect()));
});

describe("MemoryService lifecycle", () => {
  it("provisions and binds idempotently without creating another provider Bank", async () => {
    const { database, provider, service } = await fixture();
    const input = {
      actorId: "local-admin",
      displayName: "Research Agent",
      instanceId: "agent-a",
      requestIdempotencyKey: "request-a",
      runtimeType: "openclaw" as const,
    };

    const first = await service.prepareForAgent(input);
    const replay = await service.prepareForAgent(input);

    expect(replay.memory.id).toBe(first.memory.id);
    expect(replay.binding.id).toBe(first.binding.id);
    expect(first.memory).toMatchObject({ status: "ready", provider: "fake" });
    expect(first.binding.status).toBe("active");
    expect(provider.bankCount()).toBe(1);
    await expect(database.memoryRecord.count()).resolves.toBe(1);
    await expect(database.memoryBinding.count()).resolves.toBe(1);
  });

  it("detaches without deleting the Bank and rebinds the same Memory across runtimes", async () => {
    const { database, provider, repository, service } = await fixture();
    const first = await service.prepareForAgent({
      actorId: "local-admin",
      displayName: "Research Agent",
      instanceId: "agent-a",
      requestIdempotencyKey: "request-a",
      runtimeType: "hermes",
    });

    const retained = await service.detachFromAgent("agent-a", "local-admin");
    expect(retained?.status).toBe("unbound");
    expect(provider.hasBank(first.memory.providerRef!)).toBe(true);

    const rebound = await service.prepareForAgent({
      actorId: "local-admin",
      displayName: "Replacement Agent",
      existingMemoryId: first.memory.id,
      instanceId: "agent-b",
      requestIdempotencyKey: "request-b",
      runtimeType: "openclaw",
    });
    expect(rebound.memory.id).toBe(first.memory.id);
    expect(rebound.memory.providerRef).toBe(first.memory.providerRef);
    expect(rebound.binding).toMatchObject({
      instanceId: "agent-b",
      runtimeType: "openclaw",
      status: "active",
    });
    expect(provider.bankCount()).toBe(1);
    await expect(repository.countBindings(first.memory.id, "detached")).resolves.toBe(1);
    const auditActions = (
      await database.memoryCurationEvent.findMany({
        where: { projectId: "individual", memoryId: first.memory.id },
        orderBy: { createdAt: "asc" },
        select: { action: true },
      })
    ).map(({ action }) => action);
    expect(auditActions).toEqual(expect.arrayContaining([
      "memory.provisioned",
      "memory.binding.attached",
      "memory.binding.detached",
      "memory.unbound",
      "memory.rebinding_started",
    ]));
  });

  it("blocks bound deletion and records provider deletion failure before verified success", async () => {
    const { provider, repository, service } = await fixture();
    const prepared = await service.prepareForAgent({
      actorId: "local-admin",
      displayName: "Research Agent",
      instanceId: "agent-a",
      requestIdempotencyKey: "request-a",
      runtimeType: "openclaw",
    });

    await expect(service.delete(prepared.memory.id, "local-admin"))
      .rejects.toThrow("Detach");
    await service.detachFromAgent("agent-a", "local-admin");
    provider.setUnavailable(true);
    await expect(service.delete(prepared.memory.id, "local-admin")).rejects.toThrow(
      "temporarily unavailable",
    );
    await expect(repository.getMemory(prepared.memory.id, true)).resolves
      .toMatchObject({ status: "deletion_failed" });

    provider.setUnavailable(false);
    const deleted = await service.delete(prepared.memory.id, "local-admin");
    expect(deleted).toMatchObject({
      status: "deleted",
      providerRef: null,
      deletedAt: expect.any(Date),
    });
    expect(provider.hasBank(prepared.memory.providerRef!)).toBe(false);
  });
});

describe("MemoryService retain outbox", () => {
  it("fails open into encrypted retry state and later delivers exactly once", async () => {
    const { database, provider, repository, service } = await fixture();
    const prepared = await service.prepareForAgent({
      actorId: "local-admin",
      displayName: "Research Agent",
      instanceId: "agent-a",
      requestIdempotencyKey: "request-a",
      runtimeType: "openclaw",
    });
    const first = await service.enqueueConversation({
      memoryId: prepared.memory.id,
      conversation,
      idempotencyKey: "retain:conversation-a",
    });
    const replay = await service.enqueueConversation({
      memoryId: prepared.memory.id,
      conversation,
      idempotencyKey: "retain:conversation-a",
    });
    expect(replay.id).toBe(first.id);
    expect(first.encryptedPayload).not.toContain("sapphire");

    provider.setUnavailable(true);
    expect(await service.processDueOutbox(10)).toMatchObject({
      claimed: 1,
      delivered: 0,
      retried: 1,
    });
    await expect(repository.getMemory(prepared.memory.id)).resolves.toMatchObject({
      status: "degraded",
    });
    await database.memoryOutboxRecord.update({
      where: {
        projectId_id: { projectId: "individual", id: first.id },
      },
      data: { nextRetryAt: new Date(0) },
    });

    provider.setUnavailable(false);
    expect(await service.processDueOutbox(10)).toMatchObject({
      claimed: 1,
      delivered: 1,
      retried: 0,
    });
    expect(provider.conversationCount(prepared.memory.providerRef!)).toBe(1);
    await database.memoryOutboxRecord.update({
      where: {
        projectId_id: { projectId: "individual", id: first.id },
      },
      data: { nextRetryAt: new Date(0) },
    });
    expect(await service.processDueOutbox(10)).toMatchObject({
      claimed: 0,
      delivered: 0,
    });
    expect(provider.conversationCount(prepared.memory.providerRef!)).toBe(1);
  });

  it("dead-letters an unauthentic payload and supports explicit replay", async () => {
    const { database, repository, service } = await fixture();
    const prepared = await service.prepareForAgent({
      actorId: "local-admin",
      displayName: "Research Agent",
      instanceId: "agent-a",
      requestIdempotencyKey: "request-a",
      runtimeType: "openclaw",
    });
    const outbox = await service.enqueueConversation({
      memoryId: prepared.memory.id,
      conversation,
      idempotencyKey: "retain:tampered",
    });
    await database.memoryOutboxRecord.update({
      where: {
        projectId_id: { projectId: "individual", id: outbox.id },
      },
      data: { encryptedPayload: `${outbox.encryptedPayload}tampered` },
    });

    await expect(service.processDueOutbox()).resolves.toMatchObject({
      claimed: 1,
      deadLettered: 0,
      retried: 1,
    });
    for (let retry = 1; retry < 8; retry += 1) {
      await database.memoryOutboxRecord.update({
        where: {
          projectId_id: { projectId: "individual", id: outbox.id },
        },
        data: { nextRetryAt: new Date(0) },
      });
      await service.processDueOutbox();
    }
    await expect(database.memoryOutboxRecord.findUnique({
      where: {
        projectId_id: { projectId: "individual", id: outbox.id },
      },
    })).resolves.toMatchObject({ status: "dead_letter", retryCount: 8 });

    await expect(repository.replayOutbox(outbox.id)).resolves.toBe(true);
    await expect(database.memoryOutboxRecord.findUnique({
      where: {
        projectId_id: { projectId: "individual", id: outbox.id },
      },
    })).resolves.toMatchObject({
      status: "pending",
      retryCount: 0,
      lastErrorSummary: null,
    });
    await expect(database.memoryCurationEvent.findFirst({
      where: {
        projectId: "individual",
        memoryId: prepared.memory.id,
        action: "memory.outbox_replayed",
      },
    })).resolves.toMatchObject({
      actorId: "memory-service",
      providerItemId: outbox.id,
    });
  });
});
