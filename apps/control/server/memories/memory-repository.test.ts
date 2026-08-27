import { afterEach, describe, expect, it } from "vitest";
import { createTestPrisma } from "../test/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { MemoryRepository } from "./memory-repository";

const databases: PrismaClient[] = [];

async function fixture(): Promise<{
  database: PrismaClient;
  repository: MemoryRepository;
}> {
  const database = createTestPrisma();
  databases.push(database);
  await database.agentRecord.createMany({
    data: [
      {
        projectId: "individual",
        id: "memory-agent-a",
        ownerUserId: "local-admin",
        createdAt: new Date("2026-08-27T00:00:00.000Z"),
        payload: {},
      },
      {
        projectId: "individual",
        id: "memory-agent-b",
        ownerUserId: "local-admin",
        createdAt: new Date("2026-08-27T00:00:00.000Z"),
        payload: {},
      },
    ],
  });
  return {
    database,
    repository: new MemoryRepository("individual", database),
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.$disconnect()));
});
describe("MemoryRepository", () => {
  it("replays Memory creation by idempotency key without another record", async () => {
    const { database, repository } = await fixture();
    const first = await repository.createMemory({
      displayName: "Research memory",
      idempotencyKey: "create:agent-a",
    });
    const replay = await repository.createMemory({
      displayName: "A replay cannot rename it",
      idempotencyKey: "create:agent-a",
    });

    expect(replay.id).toBe(first.id);
    expect(replay.displayName).toBe("Research memory");
    await expect(database.memoryRecord.count()).resolves.toBe(1);
  });

  it("replays a primary binding without another history row", async () => {
    const { database, repository } = await fixture();
    const memory = await repository.createMemory({
      displayName: "Research memory",
      idempotencyKey: "create:agent-a",
    });
    await repository.transitionMemory({
      memoryId: memory.id,
      to: "ready",
      actorId: "test",
      providerRef: "bank-research",
    });
    const input = {
      memoryId: memory.id,
      instanceId: "memory-agent-a",
      runtimeType: "hermes" as const,
      idempotencyKey: "bind:agent-a:memory-a",
      attachedAt: new Date("2026-08-27T01:00:00.000Z"),
    };
    const first = await repository.bindPrimary(input);
    const replay = await repository.bindPrimary(input);

    expect(replay.id).toBe(first.id);
    expect(replay.status).toBe("active");
    await expect(database.memoryBinding.count()).resolves.toBe(1);
  });

  it("enforces one active primary binding per Memory and per Instance", async () => {
    const { repository } = await fixture();
    const firstMemory = await repository.createMemory({
      displayName: "First",
      idempotencyKey: "create:first",
    });
    const secondMemory = await repository.createMemory({
      displayName: "Second",
      idempotencyKey: "create:second",
    });
    await repository.transitionMemory({
      memoryId: firstMemory.id,
      to: "ready",
      actorId: "test",
      providerRef: "bank-first",
    });
    await repository.transitionMemory({
      memoryId: secondMemory.id,
      to: "ready",
      actorId: "test",
      providerRef: "bank-second",
    });
    await repository.bindPrimary({
      memoryId: firstMemory.id,
      instanceId: "memory-agent-a",
      runtimeType: "openclaw",
      idempotencyKey: "bind:first:a",
    });

    await expect(repository.bindPrimary({
      memoryId: firstMemory.id,
      instanceId: "memory-agent-b",
      runtimeType: "hermes",
      idempotencyKey: "bind:first:b",
    })).rejects.toThrow();

    await expect(repository.bindPrimary({
      memoryId: secondMemory.id,
      instanceId: "memory-agent-a",
      runtimeType: "openclaw",
      idempotencyKey: "bind:second:a",
    })).rejects.toThrow();
  });

  it("rejects a new binding after deletion owns the Memory lifecycle lock", async () => {
    const { repository } = await fixture();
    const memory = await repository.createMemory({
      displayName: "Deleting",
      idempotencyKey: "create:deleting",
    });
    await repository.transitionMemory({
      memoryId: memory.id,
      to: "ready",
      actorId: "test",
      providerRef: "bank-deleting",
    });
    await repository.startDeletion(memory.id, "test");

    await expect(repository.bindPrimary({
      memoryId: memory.id,
      instanceId: "memory-agent-a",
      runtimeType: "openclaw",
      idempotencyKey: "bind:deleting:a",
    })).rejects.toThrow("ready, unbound Memory");
  });
});
