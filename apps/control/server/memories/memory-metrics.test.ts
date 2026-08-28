import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createTestPrisma } from "../test/prisma";
import {
  MemoryMetrics,
  metricsRequestAuthorized,
  renderMemoryMetrics,
} from "./memory-metrics";

const databases: PrismaClient[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.$disconnect()));
});

describe("Memory metrics", () => {
  it("requires a constant-time bearer token and stays disabled without one", () => {
    const request = new Request("http://control.test/api/metrics", {
      headers: { authorization: "Bearer metrics-secret" },
    });
    expect(metricsRequestAuthorized(request, "metrics-secret")).toBe(true);
    expect(metricsRequestAuthorized(request, "wrong-secret")).toBe(false);
    expect(metricsRequestAuthorized(request, undefined)).toBe(false);
  });

  it("exports low-cardinality lifecycle, latency, health, and outbox signals", async () => {
    const database = createTestPrisma();
    databases.push(database);
    const memory = await database.memoryRecord.create({
      data: {
        projectId: "individual",
        displayName: "Metrics Memory",
        idempotencyKey: "metrics-memory",
        providerRef: "private-bank-reference",
        status: "ready",
      },
    });
    await database.agentRecord.create({
      data: {
        projectId: "individual",
        id: "metrics-agent",
        ownerUserId: "local-admin",
        createdAt: new Date("2026-08-28T00:00:00.000Z"),
        payload: {},
      },
    });
    await database.memoryBinding.create({
      data: {
        projectId: "individual",
        memoryId: memory.id,
        instanceId: "metrics-agent",
        runtimeType: "openclaw",
        idempotencyKey: "metrics-binding",
        status: "active",
        attachedAt: new Date("2026-08-28T00:00:00.000Z"),
      },
    });
    await database.memoryOutboxRecord.create({
      data: {
        projectId: "individual",
        memoryId: memory.id,
        conversationId: "metrics-conversation",
        eventType: "conversation.completed",
        encryptedPayload: "encrypted",
        idempotencyKey: "metrics-outbox",
        status: "retry",
        createdAt: new Date("2026-08-28T00:00:00.000Z"),
        nextRetryAt: new Date("2026-08-28T00:01:00.000Z"),
      },
    });
    const registry = new MemoryMetrics();
    registry.observeRecall("success", 0.2);
    registry.observeRecall("timeout", 2.5);
    registry.observeRetain("failure", 0.5, "retry");
    registry.recordLifecycleFailure("deletion");
    registry.recordProviderHealth("degraded");

    const output = await renderMemoryMetrics(
      database,
      registry,
      new Date("2026-08-28T00:10:00.000Z"),
    );

    expect(output).toContain('tali_memory_resources{status="ready"} 1');
    expect(output).toContain('tali_memory_bindings{state="active"} 1');
    expect(output).toContain('tali_memory_recall_total{outcome="timeout"} 1');
    expect(output).toContain('tali_memory_recall_duration_seconds_bucket{outcome="success",le="0.25"} 1');
    expect(output).toContain('tali_memory_provider_health{status="degraded"} 1');
    expect(output).toContain('tali_memory_outbox_events{status="retry"} 1');
    expect(output).toContain("tali_memory_outbox_backlog 1");
    expect(output).toContain("tali_memory_outbox_oldest_event_age_seconds 600");
    expect(output).not.toContain("individual");
    expect(output).not.toContain(memory.id);
    expect(output).not.toContain("private-bank-reference");
  });
});
