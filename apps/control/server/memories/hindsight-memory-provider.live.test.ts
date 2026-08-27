import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HindsightMemoryProvider } from "./hindsight-memory-provider";

const baseUrl = process.env.TALI_HINDSIGHT_INTEGRATION_URL?.trim();
const apiKey = process.env.TALI_HINDSIGHT_INTEGRATION_API_KEY?.trim();
const liveDescribe = baseUrl && apiKey ? describe : describe.skip;

async function eventually<T>(
  action: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      lastValue = await action();
      if (accept(lastValue)) return lastValue;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (lastError) throw lastError;
  throw new Error(`Hindsight did not reach the expected state; last value: ${JSON.stringify(lastValue)}`);
}

async function waitForOperation(providerRef: string, operationId: string): Promise<void> {
  await eventually(
    async () => {
      const response = await fetch(
        `${baseUrl!}/v1/default/banks/${encodeURIComponent(providerRef)}/operations/${encodeURIComponent(operationId)}`,
        { headers: { Authorization: `Bearer ${apiKey!}` } },
      );
      if (!response.ok) throw new Error(`Operation status returned ${response.status}.`);
      return await response.json() as { status?: string; error_message?: string | null };
    },
    (operation) => {
      if (operation.status === "failed" || operation.status === "cancelled") {
        throw new Error(`Hindsight retain ${operation.status}: ${operation.error_message ?? "no reason"}`);
      }
      return operation.status === "completed";
    },
    120_000,
  );
}

liveDescribe("HindsightMemoryProvider live integration", () => {
  it("creates, retains, recalls, curates, pages, and verifies deletion against Hindsight", async () => {
    const provider = new HindsightMemoryProvider({
      baseUrl: baseUrl!,
      apiKey: apiKey!,
      requestTimeoutMs: 15_000,
    });
    const suffix = randomUUID();
    const memoryId = `memory-${suffix}`;
    const reference = await provider.createMemory({
      projectId: `project-${suffix}`,
      memoryId,
      displayName: "Relay live integration",
      idempotencyKey: `create-${suffix}`,
    });
    const scope = {
      projectId: `project-${suffix}`,
      memoryId,
      providerRef: reference.providerRef,
    };
    let deleted = false;

    try {
      const occurredAt = new Date().toISOString();
      for (const index of [1, 2]) {
        const append = await provider.appendConversation({
          ...scope,
          idempotencyKey: `retain-${suffix}-${index}`,
          conversation: {
            id: `conversation-${suffix}-${index}`,
            title: "Hindsight live verification",
            summary: "A deterministic integration conversation.",
            sourceDocumentIds: [`conversation-${suffix}-${index}`],
            startedAt: occurredAt,
            endedAt: occurredAt,
            messages: [{
              id: `message-${suffix}-${index}`,
              role: "user",
              text: `The durable launch marker is relay-${suffix} and attempt ${index}.`,
              occurredAt,
            }],
          },
        });
        await waitForOperation(reference.providerRef, append.operationId);
      }

      const conversations = await eventually(
        () => provider.listConversations({ ...scope, limit: 1 }),
        (page) => page.items.length === 1 && page.nextCursor !== null,
      );
      const secondConversationPage = await provider.listConversations({
        ...scope,
        limit: 1,
        cursor: conversations.nextCursor,
      });
      expect(secondConversationPage.items).toHaveLength(1);

      const facts = await eventually(
        () => provider.listFacts({ ...scope, limit: 20 }),
        (page) => page.items.length > 0,
      );
      const recalled = await eventually(
        () => provider.recall({
          ...scope,
          query: `durable launch marker relay-${suffix}`,
          maxItems: 10,
        }),
        (result) => result.items.length > 0,
      );
      expect(recalled.items.some(({ item }) => item.kind === "fact")).toBe(true);

      const fact = facts.items[0]!;
      await provider.invalidateItem({ ...scope, itemId: fact.id });
      await expect(provider.getItem({ ...scope, itemId: fact.id })).resolves.toMatchObject({
        status: "invalidated",
      });
      await provider.restoreItem({ ...scope, itemId: fact.id });
      await expect(provider.getItem({ ...scope, itemId: fact.id })).resolves.toMatchObject({
        status: "active",
      });

      await expect(provider.deleteConversation({
        ...scope,
        conversationId: `conversation-${suffix}-1`,
        idempotencyKey: `delete-conversation-${suffix}`,
      })).resolves.toEqual({ deleted: true, verifiedAbsent: true });
      await expect(provider.healthCheck({ providerRef: reference.providerRef })).resolves.toMatchObject({
        status: "healthy",
      });
      await expect(provider.deleteMemory({
        ...scope,
        idempotencyKey: `delete-memory-${suffix}`,
      })).resolves.toEqual({ deleted: true, verifiedAbsent: true });
      deleted = true;
    } finally {
      if (!deleted) {
        await provider.deleteMemory({
          ...scope,
          idempotencyKey: `cleanup-${suffix}`,
        }).catch(() => undefined);
      }
    }
  }, 120_000);
});
