import type { Instance as Agent, ModelDeployment, ModelRouting } from "@tali/contracts";
import { describe, expect, it, vi } from "vitest";
import type { ModelUsageFact } from "../providers/cost-analytics-store";
import { ProjectStore } from "../projects/project-store";
import { createTestPrisma } from "../test/prisma";
import { RunStore } from "../runs/run-store";
import { ProjectOverviewService } from "./project-overview-service";

const now = new Date("2026-08-13T12:00:00.000Z");
const instanceId = "11111111-1111-4111-8111-111111111111";

function instance(
  status: Agent["status"],
  platform: Agent["agentPlatform"],
  id = instanceId,
  overrides: Partial<Agent> = {},
): Agent {
  return {
    id,
    name: `Agent ${id.slice(0, 4)}`,
    status,
    agentPlatform: platform,
    modelRoutingId: "missing-routing",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  } as Agent;
}

function usageFact(input: {
  requestId: string;
  at: string;
  spend: number;
  tokens: number;
  instanceId?: string;
  endUserId?: string;
}): ModelUsageFact {
  return {
    eventId: `litellm:${input.requestId}`,
    requestId: input.requestId,
    requestStartTime: input.at,
    usageDate: input.at.slice(0, 10),
    usageHour: new Date(input.at).getUTCHours(),
    projectId: "individual",
    instanceId: input.instanceId ?? instanceId,
    instanceName: "Research",
    requestedModel: "tali/research",
    resolvedModel: "tali/research",
    modelGroup: "research",
    provider: "LiteLLM",
    callType: "chat",
    ...(input.endUserId ? { endUserId: input.endUserId } : {}),
    promptTokens: input.tokens,
    completionTokens: 0,
    totalTokens: input.tokens,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningTokens: 0,
    totalCostUsd: input.spend,
    costStatus: "known",
    costSource: "litellm:spend",
    priceVersion: "test",
    requestCount: 1,
    successCount: 1,
    failureCount: 0,
    retryCount: 0,
    cacheHit: false,
    fallbackUsed: false,
    status: "success",
    tags: [],
    metadata: {},
    sourceRecordHash: input.requestId,
    createdAt: input.at,
  };
}

async function recordRun(
  store: ProjectStore,
  input: {
    runId: string;
    at: string;
    status: "SUCCEEDED" | "FAILED" | "TIMED_OUT";
    platform?: "openclaw" | "hermes";
    instanceId?: string;
  },
) {
  const platform = input.platform ?? "openclaw";
  const runs = new RunStore(store.projectId, store.database());
  await runs.ingest({
    instanceId: input.instanceId ?? instanceId,
    source: platform,
    event: {
      event: "started",
      runId: input.runId,
      occurredAt: input.at,
      triggerType: "USER",
    },
  });
  await runs.ingest({
    instanceId: input.instanceId ?? instanceId,
    source: platform,
    event: {
      event: "finished",
      runId: input.runId,
      occurredAt: new Date(new Date(input.at).getTime() + 1_000).toISOString(),
      status: input.status,
      terminalReason: input.status === "SUCCEEDED" ? "COMPLETED" : "RUNTIME_ERROR",
    },
  });
}

describe("ProjectOverviewService", () => {
  it("aggregates real Run, usage, budget, Runtime, workload, and attention facts", async () => {
    const db = createTestPrisma();
    const store = new ProjectStore("individual", db);
    const currentStatuses = [
      "SUCCEEDED",
      "SUCCEEDED",
      "SUCCEEDED",
      "SUCCEEDED",
      "FAILED",
      "TIMED_OUT",
    ] as const;
    for (const [index, status] of currentStatuses.entries()) {
      await recordRun(store, {
        runId: `current-${index}`,
        at: `2026-08-${10 + Math.floor(index / 2)}T0${index}:00:00.000Z`,
        status,
        platform: index < 4 ? "openclaw" : "hermes",
      });
    }
    await recordRun(store, {
      runId: "previous-1",
      at: "2026-08-03T10:00:00.000Z",
      status: "SUCCEEDED",
    });
    await recordRun(store, {
      runId: "previous-2",
      at: "2026-08-04T10:00:00.000Z",
      status: "SUCCEEDED",
    });
    await store.costAnalytics().insertFact(usageFact({
      requestId: "current-cost-1",
      at: "2026-08-11T10:00:00.000Z",
      spend: 25,
      tokens: 200,
    }));
    await store.costAnalytics().insertFact(usageFact({
      requestId: "current-cost-2",
      at: "2026-08-12T10:00:00.000Z",
      spend: 15,
      tokens: 100,
    }));
    await store.costAnalytics().insertFact(usageFact({
      requestId: "previous-cost",
      at: "2026-08-04T10:00:00.000Z",
      spend: 10,
      tokens: 50,
    }));
    await db.projectQuotaRecord.update({
      where: { projectId: "individual" },
      data: {
        hardBudgetUsd: 50,
        budgetDuration: "7d",
        budgetPeriodStartedAt: new Date("2026-08-07T12:00:00.000Z"),
        budgetResetsAt: new Date("2026-08-14T12:00:00.000Z"),
      },
    });
    await db.costSyncCheckpointRecord.create({
      data: {
        projectId: "individual",
        source: "litellm",
        lastSyncAt: new Date("2026-08-13T11:59:00.000Z"),
        lastSuccessfulEndTime: new Date("2026-08-13T11:59:00.000Z"),
        syncLagSeconds: 60,
      },
    });
    const service = new ProjectOverviewService(
      store,
      {
        list: async () => [
          instance("READY", "openclaw"),
          instance("FAILED", "hermes", "22222222-2222-4222-8222-222222222222"),
        ],
      },
      () => now,
    );

    const overview = await service.overview("7d", "UTC");

    expect(overview.kpis).toMatchObject({
      runs: 6,
      runsChangePercent: 200,
      successRate: 4 / 6,
      successRateChangePoints: (4 / 6 - 1) * 100,
      readyInstances: 1,
      totalInstances: 2,
      spendUsd: 40,
      spendChangePercent: 300,
    });
    expect(overview.usage).toHaveLength(7);
    expect(overview.usage.reduce((sum, point) => sum + point.runs, 0)).toBe(6);
    expect(overview.usage.reduce((sum, point) => sum + point.tokens, 0)).toBe(300);
    expect(overview.budget).toMatchObject({
      configured: true,
      duration: "7d",
      limitUsd: 50,
      usedUsd: 40,
      usedPercent: 0.8,
      remainingUsd: 10,
      periodStartedAt: "2026-08-07T12:00:00.000Z",
      resetsAt: "2026-08-14T12:00:00.000Z",
    });
    expect(overview.budget.forecastUsd).toBeCloseTo(46.67, 1);
    expect(overview.workload).toEqual([
      { runtimeType: "hermes", runs: 2, percentage: 2 / 6 },
      { runtimeType: "openclaw", runs: 4, percentage: 4 / 6 },
    ]);
    expect(overview.attention.map((item) => item.code)).toEqual(expect.arrayContaining([
      "BUDGET_THRESHOLD",
      "INSTANCE_FAILED:22222222-2222-4222-8222-222222222222",
      "RUN_SUCCESS_RATE",
    ]));
    expect(overview.attention.every((item) =>
      item.owner && item.openedAt && item.reason && item.impact.label
      && item.nextStep.label && item.nextStep.href,
    )).toBe(true);
    expect(overview.freshness).toMatchObject({
      costLastSyncedAt: "2026-08-13T11:59:00.000Z",
      costSyncLagSeconds: 60,
      runtimeObservedAt: now.toISOString(),
    });
  });

  it("returns honest zero and null values instead of synthetic data", async () => {
    const db = createTestPrisma();
    const store = new ProjectStore("individual", db);
    const service = new ProjectOverviewService(
      store,
      { list: async () => [] },
      () => now,
    );

    const overview = await service.overview("24h", "Asia/Shanghai");

    expect(overview.kpis).toMatchObject({
      runs: 0,
      runsChangePercent: 0,
      successRate: null,
      successRateChangePoints: null,
      readyInstances: 0,
      totalInstances: 0,
      spendUsd: 0,
      spendChangePercent: 0,
    });
    expect(overview.usage).toHaveLength(24);
    expect(overview.workload).toEqual([]);
    expect(overview.modelAssignment).toEqual({ totalAgents: 0, segments: [] });
    expect(overview.agentActivity).toEqual([]);
    expect(overview.attention).toEqual([]);
  });

  it("counts each active Agent once in model assignment and ranks actual activity", async () => {
    const db = createTestPrisma();
    const store = new ProjectStore("individual", db);
    const modelId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const secondModelId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const researchId = "33333333-3333-4333-8333-333333333333";
    const routedId = "44444444-4444-4444-8444-444444444444";
    const idleId = "55555555-5555-4555-8555-555555555555";
    const destroyingId = "66666666-6666-4666-8666-666666666666";
    vi.spyOn(store, "listModelRoutings").mockResolvedValue([
      {
        id: "single-routing",
        name: "Research default",
        routingPolicy: {
          version: 1,
          mode: "SINGLE",
          modelDeploymentId: modelId,
          fallbackModelDeploymentIds: [],
          retries: 2,
        },
      } as unknown as ModelRouting,
      {
        id: "auto-routing",
        name: "Adaptive route",
        routingPolicy: {
          version: 1,
          mode: "COMPLEXITY",
          simpleModelDeploymentId: modelId,
          complexModelDeploymentId: secondModelId,
          fallbackModelDeploymentIds: [],
          retries: 2,
        },
      } as unknown as ModelRouting,
    ]);
    vi.spyOn(store, "listModelDeployments").mockResolvedValue([
      { id: modelId, displayName: "Model A" } as ModelDeployment,
      { id: secondModelId, displayName: "Model B" } as ModelDeployment,
    ]);

    await recordRun(store, {
      runId: "research-success",
      at: "2026-08-12T08:00:00.000Z",
      status: "SUCCEEDED",
      instanceId: researchId,
    });
    await recordRun(store, {
      runId: "research-failed",
      at: "2026-08-12T09:00:00.000Z",
      status: "FAILED",
      instanceId: researchId,
    });
    await recordRun(store, {
      runId: "routed-success",
      at: "2026-08-12T10:00:00.000Z",
      status: "SUCCEEDED",
      instanceId: routedId,
    });
    await store.costAnalytics().insertFact(usageFact({
      requestId: "research-user-1",
      at: "2026-08-12T08:00:00.000Z",
      spend: 1,
      tokens: 100,
      instanceId: researchId,
      endUserId: "user-1",
    }));
    await store.costAnalytics().insertFact(usageFact({
      requestId: "research-user-2",
      at: "2026-08-12T09:00:00.000Z",
      spend: 2,
      tokens: 200,
      instanceId: researchId,
      endUserId: "user-2",
    }));
    await store.costAnalytics().insertFact(usageFact({
      requestId: "routed-user-1",
      at: "2026-08-12T10:00:00.000Z",
      spend: 4,
      tokens: 300,
      instanceId: routedId,
      endUserId: "user-1",
    }));
    const service = new ProjectOverviewService(
      store,
      {
        list: async () => [
          instance("READY", "openclaw", researchId, { name: "Research", modelRoutingId: "single-routing" }),
          instance("READY", "hermes", routedId, { name: "Router", modelRoutingId: "auto-routing" }),
          instance("READY", "openclaw", idleId, { name: "Idle", modelRoutingId: "single-routing" }),
          instance("DESTROYING", "hermes", destroyingId, { name: "Deleting", modelRoutingId: "single-routing" }),
        ],
      },
      () => now,
    );

    const overview = await service.overview("7d", "UTC");

    expect(overview.modelAssignment).toEqual({
      totalAgents: 3,
      segments: [
        { key: `model:${modelId}`, label: "Model A", kind: "model", agents: 2, percentage: 2 / 3 },
        { key: "auto-route", label: "Auto route", kind: "auto", agents: 1, percentage: 1 / 3 },
      ],
    });
    expect(overview.modelAssignment.segments.reduce((sum, item) => sum + item.agents, 0)).toBe(3);
    expect(overview.agentActivity).toEqual([
      { agentId: researchId, agentName: "Research", runs: 2, activeUsers: 2, successRate: 0.5, costUsd: 3 },
      { agentId: routedId, agentName: "Router", runs: 1, activeUsers: 1, successRate: 1, costUsd: 4 },
      { agentId: idleId, agentName: "Idle", runs: 0, activeUsers: 0, successRate: null, costUsd: 0 },
    ]);
  });
});
