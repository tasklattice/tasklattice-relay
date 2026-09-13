import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ProjectStore } from "../projects/project-store";
import { createTestStore } from "../test/store";
import { RunStore } from "../runs/run-store";
import type { LiteLLMAdminClient, LiteLLMSpendLog } from "./litellm-client";
import { CostService, type CostAnalyticsQuery } from "./cost-service";

const query: CostAnalyticsQuery = {
  startTime: "2026-06-01",
  endTime: "2026-06-03",
  timezone: "UTC",
  projectId: "individual",
  filters: {},
};

function hashedKey(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function client(logs: LiteLLMSpendLog[]): LiteLLMAdminClient {
  return {
    baseUrl: "http://litellm:4000",
    registerModel: vi.fn(),
    deleteModelById: vi.fn(async () => undefined),
    deleteModel: vi.fn(),
    probeModel: vi.fn(),
    createInstanceKey: vi.fn(),
    blockKey: vi.fn(),
    revokeKey: vi.fn(),
    listSpendLogs: vi.fn(async () => logs),
  };
}

function addAttribution(
  store: ProjectStore,
  input: {
    id: string;
    instanceId: string;
    instanceName: string;
    key: string;
    validFrom: string;
    validTo?: string;
  },
) {
  store.costAnalytics().saveAttribution({
    id: input.id,
    projectId: store.projectId,
    instanceId: input.instanceId,
    instanceName: input.instanceName,
    hashedToken: hashedKey(input.key),
    virtualKeyAlias: `${input.instanceName} key`,
    validFrom: input.validFrom,
    ...(input.validTo ? { validTo: input.validTo } : {}),
    createdAt: input.validFrom,
    updatedAt: input.validTo ?? input.validFrom,
  });
}

function addEndpoint(store: ProjectStore) {
  store.costAnalytics().saveModelEndpointMapping({
    id: "mapping:model-a",
    modelEndpointId: "model-a",
    modelEndpointName: "GPT 4o",
    liteLLMModelName: "tali/openai/gpt-4o",
    liteLLMModelGroup: "production-chat",
    provider: "OpenAI",
    providerAccountId: "account-production",
    providerAccountName: "production-account",
    validFrom: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

async function configureTeam(store: ProjectStore) {
  await store.database().projectQuotaRecord.update({
    where: { projectId: store.projectId },
    data: { litellmTeamId: "team-project" },
  });
}

function log(
  requestId: string,
  at: string,
  key: string,
  spend: number | undefined,
  promptTokens = 100,
  completionTokens = 50,
): LiteLLMSpendLog {
  return {
    request_id: requestId,
    request_start_time: at,
    api_key_id: key,
    model: "tali/openai/gpt-4o",
    model_group: "production-chat",
    provider: "OpenAI",
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    ...(spend !== undefined ? { spend } : {}),
    status: "success",
    team_id: "team-project",
  };
}

describe("CostService", () => {
  it("deduplicates request IDs and keeps Summary, Ranking, and shares on one fact set", async () => {
    const store = createTestStore();
    addAttribution(store, {
      id: "mapping:instance-a",
      instanceId: "instance-a",
      instanceName: "Chat production",
      key: "key-a",
      validFrom: "2026-01-01T00:00:00.000Z",
    });
    addEndpoint(store);
    await configureTeam(store);
    const runs = new RunStore(store.projectId, store.database());
    const correlatedRun = await runs.ingest({
      instanceId: "instance-a",
      source: "openclaw",
      event: {
        event: "started",
        runId: "run-for-request-2",
        occurredAt: "2026-06-02T11:59:00.000Z",
        triggerType: "USER",
        traceId: "trace-request-2",
      },
    });
    await runs.ingest({
      instanceId: "instance-a",
      source: "openclaw",
      event: {
        event: "finished",
        runId: "run-for-request-2",
        occurredAt: "2026-06-02T12:01:00.000Z",
        status: "SUCCEEDED",
      },
    });
    const service = new CostService(store, client([
      log("request-1", "2026-06-01T12:00:00.000Z", "key-a", 1),
      log("request-1", "2026-06-01T12:00:01.000Z", "key-a", 1),
      log("request-2", "2026-06-02T12:00:00.000Z", "key-a", 2, 200, 100),
    ]));
    await service.sync("2026-05-29T00:00:00.000Z", "2026-06-03T23:59:59.999Z");

    const summary = await service.summary(query);
    const ranking = await service.ranking(query, "instance", 5);
    const endpointRanking = await service.ranking(query, "model_endpoint", 5);
    const accountRanking = await service.ranking(query, "provider_account", 5);
    const keyRanking = await service.ranking(query, "virtual_key", 5);

    expect(summary).toMatchObject({
      currency: "USD",
      totalSpendUsd: 3,
      totalTokens: 450,
      requests: 2,
      unknownCostRequests: 0,
    });
    expect(ranking.totalSpendUsd).toBe(summary.totalSpendUsd);
    expect(ranking.items).toEqual([
      expect.objectContaining({
        id: "instance-a",
        name: "Chat production",
        spendUsd: 3,
        requests: 2,
        share: 1,
      }),
    ]);
    expect(endpointRanking.items[0]).toMatchObject({ id: "model-a", spendUsd: 3 });
    expect(accountRanking.items[0]).toMatchObject({
      id: "account-production",
      name: "production-account",
      spendUsd: 3,
    });
    expect(keyRanking.items[0]?.id).toBe(hashedKey("key-a"));
    expect(JSON.stringify(keyRanking)).not.toContain("key-a");
    expect((await service.dataQuality(query)).duplicateRequests).toBe(1);
    const facts = await store.costAnalytics().listFacts({
      startTime: "2026-06-01T00:00:00.000Z",
      endTime: "2026-06-03T23:59:59.999Z",
      projectId: "individual",
    });
    expect(facts.find((fact) => fact.requestId === "request-2")).toMatchObject({
      runId: correlatedRun.id,
      traceId: "trace-request-2",
    });
  });

  it("uses equal comparison periods and preserves key-rotation attribution by validity", async () => {
    const store = createTestStore();
    addAttribution(store, {
      id: "mapping:key-old",
      instanceId: "instance-a",
      instanceName: "Rotating Instance",
      key: "key-old",
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2026-06-02T00:00:00.000Z",
    });
    addAttribution(store, {
      id: "mapping:key-new",
      instanceId: "instance-a",
      instanceName: "Rotating Instance",
      key: "key-new",
      validFrom: "2026-06-02T00:00:00.000Z",
    });
    addEndpoint(store);
    await configureTeam(store);
    const service = new CostService(store, client([
      log("prior", "2026-05-30T12:00:00.000Z", "key-old", 2),
      log("old-key", "2026-06-01T12:00:00.000Z", "key-old", 2),
      log("new-key", "2026-06-02T12:00:00.000Z", "key-new", 4),
    ]));
    await service.sync("2026-05-29T00:00:00.000Z", "2026-06-03T23:59:59.999Z");

    const summary = await service.summary(query);
    const ranking = await service.ranking(query, "instance", 5);

    expect(summary.totalSpendUsd).toBe(6);
    expect(summary.comparison.spendPercent).toBe(200);
    expect(ranking.items[0]).toMatchObject({
      id: "instance-a",
      spendUsd: 6,
      requests: 2,
    });
  });

  it("fills timezone-local dates and creates a stable Top N plus Others series", async () => {
    const store = createTestStore();
    addEndpoint(store);
    addAttribution(store, {
      id: "mapping:a",
      instanceId: "a",
      instanceName: "A",
      key: "a",
      validFrom: "2026-01-01T00:00:00.000Z",
    });
    addAttribution(store, {
      id: "mapping:b",
      instanceId: "b",
      instanceName: "B",
      key: "b",
      validFrom: "2026-01-01T00:00:00.000Z",
    });
    addAttribution(store, {
      id: "mapping:c",
      instanceId: "c",
      instanceName: "C",
      key: "c",
      validFrom: "2026-01-01T00:00:00.000Z",
    });
    await configureTeam(store);
    const service = new CostService(store, client([
      log("a-1", "2026-06-01T23:30:00.000Z", "a", 9),
      log("b-1", "2026-06-02T01:00:00.000Z", "b", 5),
      log("c-1", "2026-06-03T01:00:00.000Z", "c", 1),
    ]));
    await service.sync("2026-05-29T00:00:00.000Z", "2026-06-03T23:59:59.999Z");
    const shanghai = { ...query, timezone: "Asia/Shanghai" };

    const activity = await service.activity(shanghai, "instance", "daily");
    const trend = await service.trend(shanghai, "instance", "day", 1);

    expect(activity.items.map((item) => [item.date, item.spendUsd])).toEqual([
      ["2026-06-01", 0],
      ["2026-06-02", 14],
      ["2026-06-03", 1],
    ]);
    expect(trend.series.map((series) => series.name)).toEqual(["A", "Others"]);
    expect(trend.series.find((series) => series.name === "Others")?.items
      .reduce((sum, item) => sum + item.spendUsd, 0)).toBe(6);
  });

  it("marks missing prices as unknown instead of silently treating them as priced spend", async () => {
    const store = createTestStore();
    const unknown = log("unknown-price", "2026-06-01T12:00:00.000Z", "unknown-key", undefined);
    unknown.model = "custom/unpriced-model";
    unknown.model_group = "unpriced";
    unknown.metadata = {
      api_key: "sk-plaintext-must-not-survive",
      nested: { authorization: "Bearer plaintext", safe: "retained" },
    };
    await configureTeam(store);
    const service = new CostService(store, client([unknown]));
    await service.sync("2026-05-29T00:00:00.000Z", "2026-06-03T23:59:59.999Z");

    const summary = await service.summary(query);
    const quality = await service.dataQuality(query);

    expect(summary.totalSpendUsd).toBe(0);
    expect(summary.unknownCostRequests).toBe(1);
    expect(quality.unknownCostRequests).toBe(1);
    const [fact] = await store.costAnalytics().listFacts({
      startTime: "2026-06-01T00:00:00.000Z",
      endTime: "2026-06-01T23:59:59.999Z",
      projectId: "individual",
    });
    expect(JSON.stringify(fact?.metadata)).not.toContain("plaintext");
    expect(fact?.metadata).toMatchObject({
      api_key: "[redacted]",
      nested: { authorization: "[redacted]", safe: "retained" },
    });
  });
});
