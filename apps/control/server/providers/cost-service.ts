import { createHash } from "node:crypto";
import type {
  CostFilterKey,
  CostFilterOption,
  CostFilters,
  CostGroupBy,
  ModelCostActivityResponse,
  ModelCostBreakdownItem,
  ModelCostBreakdownResponse,
  ModelCostDataQualityResponse,
  ModelCostGranularity,
  ModelCostInsightsResponse,
  ModelCostRankingResponse,
  ModelCostSortDirection,
  ModelCostSummaryResponse,
  ModelCostTrendGranularity,
  ModelCostTrendResponse,
} from "@tali/contracts";
import { ProjectStore } from "../projects/project-store";
import {
  type CostAttributionMapping,
  type ModelEndpointCostMapping,
  type ModelUsageDailyRow,
  type ModelUsageFact,
} from "./cost-analytics-store";
import { LiteLLMClient, type LiteLLMAdminClient, type LiteLLMSpendLog } from "./litellm-client";

export interface CostAnalyticsQuery {
  startTime: string;
  endTime: string;
  timezone: string;
  projectId: string;
  filters: CostFilters;
}

export interface CostBreakdownQuery extends CostAnalyticsQuery {
  groupBy: CostGroupBy;
  page: number;
  pageSize: number;
  sort: string;
  direction: ModelCostSortDirection;
  search: string;
}

type GroupedUsage = {
  id: string;
  name: string;
  detail: string;
  spendUsd: number;
  promptTokens: number;
  completionTokens: number;
  requests: number;
  firstRequestAt: string;
  lastRequestAt: string;
  provider: string;
  providerAccount: string;
  models: Set<string>;
  boundInstance: string;
  boundInstanceId?: string;
  user: string;
  team: string;
};

type ResolvedUsdCost = {
  total?: number;
  prompt?: number;
  completion?: number;
  source: string;
  version: string;
};

const groupLabels: Record<CostGroupBy, string> = {
  work: "No Work attribution",
  task: "No Task attribution",
  instance: "Unmapped Instance",
  model_endpoint: "Unmapped model endpoint",
  provider_account: "Unmapped Provider Account",
  virtual_key: "Unmapped virtual key",
};
const filterKeys: CostFilterKey[] = [
  "work", "task", "instance", "model_endpoint", "provider", "provider_account",
  "virtual_key", "project",
];

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function count(value: unknown): number {
  return Math.max(0, Math.trunc(finite(value) ?? 0));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeMetadata(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(api[_-]?key|authorization|bearer|credential|password|secret|token)/i.test(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = safeMetadata(item, depth + 1);
    }
  }
  return output;
}

export function tokenIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.startsWith("sha256:") ? value : `sha256:${hash(value)}`;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateInTimezone(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid request timestamp: ${value}`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function hourInTimezone(value: string, timezone: string): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value)).find((item) => item.type === "hour")?.value;
  return Number(part ?? 0);
}

function timezoneOffsetMs(value: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const represented = Date.UTC(
    read("year"), read("month") - 1, read("day"),
    read("hour"), read("minute"), read("second"),
  );
  return represented - Math.trunc(value.getTime() / 1_000) * 1_000;
}

function localBoundary(date: string, timezone: string, end: boolean): string {
  if (date.includes("T")) {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid time boundary: ${date}`);
    return parsed.toISOString();
  }
  const time = end ? "23:59:59.999" : "00:00:00.000";
  const initial = new Date(`${date}T${time}Z`);
  let result = new Date(initial.getTime() - timezoneOffsetMs(initial, timezone));
  result = new Date(initial.getTime() - timezoneOffsetMs(result, timezone));
  return result.toISOString();
}

function normalizedQuery(query: CostAnalyticsQuery) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: query.timezone }).format();
  } catch {
    throw new Error(`Invalid timezone: ${query.timezone}`);
  }
  const start = localBoundary(query.startTime, query.timezone, false);
  const end = localBoundary(query.endTime, query.timezone, true);
  if (start > end) throw new Error("start_time must be before end_time.");
  return { ...query, start, end, from: dateInTimezone(start, query.timezone), to: dateInTimezone(end, query.timezone) };
}

function days(from: string, to: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    result.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function previousPeriod(start: string, end: string) {
  const duration = new Date(end).getTime() - new Date(start).getTime() + 1;
  const previousEnd = new Date(new Date(start).getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration + 1);
  return { start: previousStart.toISOString(), end: previousEnd.toISOString() };
}

function percent(current: number, previous: number): number | undefined {
  return previous > 0 ? ((current - previous) / previous) * 100 : undefined;
}

function factDimension(fact: ModelUsageFact, groupBy: CostGroupBy) {
  if (groupBy === "work") return { id: fact.workId ?? "unmapped-work", name: fact.workName ?? fact.workId ?? groupLabels.work, detail: fact.workId ?? "" };
  if (groupBy === "task") return {
    // R-1 is only unique inside its Work.
    id: fact.workId ? `${fact.workId}/${fact.taskId ?? "__planning__"}` : "unmapped-task",
    name: fact.taskId ? `${fact.taskName ?? fact.taskId}` : fact.workId ? "Work planning" : groupLabels.task,
    detail: [fact.workName ?? fact.workId, fact.taskId].filter(Boolean).join(" · "),
  };
  if (groupBy === "instance") return {
    id: fact.instanceId ?? "unmapped-instance",
    name: fact.instanceName ?? groupLabels.instance,
    detail: fact.resolvedModel,
  };
  if (groupBy === "model_endpoint") return {
    id: fact.modelEndpointId ?? "unmapped-model-endpoint",
    name: fact.modelEndpointName ?? groupLabels.model_endpoint,
    detail: `${fact.provider} · ${fact.resolvedModel}`,
  };
  if (groupBy === "provider_account") return {
    id: fact.providerAccountId ?? "unmapped-provider-account",
    name: fact.providerAccountName ?? groupLabels.provider_account,
    detail: fact.provider,
  };
  return {
    id: fact.virtualKeyId ?? "unmapped-virtual-key",
    name: fact.virtualKeyAlias ?? groupLabels.virtual_key,
    detail: fact.instanceName ? `Bound to ${fact.instanceName}` : "No Instance mapping",
  };
}

function filterValue(fact: ModelUsageFact, key: CostFilterKey): string {
  if (key === "work" || key === "task") return factDimension(fact, key).id;
  if (key === "instance") return fact.instanceId ?? "unmapped-instance";
  if (key === "model_endpoint") return fact.modelEndpointId ?? "unmapped-model-endpoint";
  if (key === "provider") return fact.provider;
  if (key === "provider_account") return fact.providerAccountId ?? "unmapped-provider-account";
  if (key === "virtual_key") return fact.virtualKeyId ?? "unmapped-virtual-key";
  return fact.projectId;
}

function applyFilters(facts: ModelUsageFact[], filters: CostFilters): ModelUsageFact[] {
  return facts.filter((fact) =>
    filterKeys.every((key) => !filters[key]?.length || filters[key]!.includes(filterValue(fact, key))),
  );
}

function groupFacts(facts: ModelUsageFact[], groupBy: CostGroupBy): GroupedUsage[] {
  const groups = new Map<string, GroupedUsage>();
  for (const fact of facts) {
    const dimension = factDimension(fact, groupBy);
    const current = groups.get(dimension.id) ?? {
      ...dimension,
      spendUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
      requests: 0,
      firstRequestAt: fact.requestStartTime,
      lastRequestAt: fact.requestStartTime,
      provider: fact.provider,
      providerAccount: fact.providerAccountName ?? groupLabels.provider_account,
      models: new Set<string>(),
      boundInstance: fact.instanceName ?? groupLabels.instance,
      ...(fact.instanceId ? { boundInstanceId: fact.instanceId } : {}),
      user: fact.liteLLMUserId ?? "—",
      team: fact.liteLLMTeamId ?? "—",
    };
    current.spendUsd += fact.totalCostUsd ?? 0;
    current.promptTokens += fact.promptTokens;
    current.completionTokens += fact.completionTokens;
    current.requests += 1;
    current.firstRequestAt = current.firstRequestAt < fact.requestStartTime ? current.firstRequestAt : fact.requestStartTime;
    current.lastRequestAt = current.lastRequestAt > fact.requestStartTime ? current.lastRequestAt : fact.requestStartTime;
    current.models.add(fact.modelEndpointId ?? fact.resolvedModel);
    groups.set(dimension.id, current);
  }
  return [...groups.values()].sort((a, b) => b.spendUsd - a.spendUsd || a.name.localeCompare(b.name));
}

function periodKey(date: string, granularity: ModelCostTrendGranularity): string {
  if (granularity === "day") return date;
  const value = new Date(`${date}T00:00:00.000Z`);
  if (granularity === "month") return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
}

function sourceTimestamp(log: LiteLLMSpendLog): string {
  const value = log.request_start_time ?? log.startTime ?? log.start_time;
  if (!value) throw new Error("LiteLLM spend record is missing request_start_time.");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid request timestamp: ${value}`);
  return parsed.toISOString();
}

function canonicalLog(left: LiteLLMSpendLog, right: LiteLLMSpendLog): LiteLLMSpendLog {
  const leftCost = finite(left.spend) ?? -1;
  const rightCost = finite(right.spend) ?? -1;
  if (rightCost !== leftCost) return rightCost > leftCost ? right : left;
  const leftEnd = left.response_end_time ?? left.end_time ?? left.startTime ?? left.start_time ?? "";
  const rightEnd = right.response_end_time ?? right.end_time ?? right.startTime ?? right.start_time ?? "";
  return rightEnd > leftEnd ? right : left;
}

export class CostService {
  private syncPromise: Promise<void> | undefined;

  constructor(
    readonly store = new ProjectStore(),
    readonly litellm: LiteLLMAdminClient = new LiteLLMClient(),
  ) {}

  private analytics() {
    return this.store.costAnalytics();
  }

  private async refreshMappings(): Promise<void> {
    const analytics = this.analytics();
    const projectId = this.store.projectId;
    for (const agent of await this.store.listAgentsForReporting()) {
      const full = await this.store.get(agent.id);
      const binding = await this.store.getModelRoutingBindingForAgent(agent.id);
      const routing = binding ? await this.store.getModelRouting(binding.modelRoutingId) : undefined;
      const virtualKeyId = binding?.liteLLMTokenId
        ? tokenIdentifier(binding.liteLLMTokenId)
        : undefined;
      await analytics.saveAttribution({
        id: binding ? `binding:${binding.id}` : `agent:${agent.id}:${full?.createdAt ?? "unknown"}`,
        projectId,
        instanceId: agent.id,
        instanceName: agent.name,
        ...(virtualKeyId ? { liteLLMVirtualKeyId: virtualKeyId } : {}),
        hashedToken: agent.modelRoutingKeyFingerprint,
        virtualKeyAlias: binding?.keyAlias ?? agent.costKeyAlias,
        liteLLMUserId: agent.id,
        ...(binding?.liteLLMTeamId ? { liteLLMTeamId: binding.liteLLMTeamId } : {}),
        ...(routing?.gatewayId ?? full?.providerAccountId
          ? { providerAccountId: routing?.gatewayId ?? full!.providerAccountId! }
          : {}),
        validFrom: binding?.createdAt ?? full?.createdAt ?? new Date(0).toISOString(),
        ...(binding?.revokedAt ? { validTo: binding.revokedAt } : {}),
        createdAt: binding?.createdAt ?? full?.createdAt ?? new Date(0).toISOString(),
        updatedAt: binding?.revokedAt ?? full?.updatedAt ?? new Date().toISOString(),
      });
    }
    for (const deployment of await this.store.listModelDeploymentsForReporting()) {
      const account = await this.store.getProviderAccount(deployment.providerAccountId);
      await analytics.saveModelEndpointMapping({
        id: `deployment:${deployment.id}:${deployment.createdAt}`,
        modelEndpointId: deployment.id,
        modelEndpointName: deployment.displayName,
        liteLLMModelName: deployment.litellmModelName,
        liteLLMModelGroup: deployment.litellmModelName,
        liteLLMModelId: deployment.modelId,
        provider: deployment.providerName,
        providerAccountId: deployment.providerAccountId,
        providerAccountName: account?.name ?? deployment.providerAccountId,
        validFrom: deployment.createdAt,
        createdAt: deployment.createdAt,
        updatedAt: deployment.updatedAt,
      });
    }
    for (const routing of await this.store.listModelRoutings()) {
      const gateway = await this.store.getInferenceGateway(routing.gatewayId);
      await analytics.saveModelEndpointMapping({
        id: `model-routing:${routing.id}:${routing.createdAt}`,
        modelEndpointId: `model-routing:${routing.id}`,
        modelEndpointName: routing.name,
        liteLLMModelName: routing.publicModelAlias,
        liteLLMModelGroup: routing.publicModelAlias,
        provider: "LiteLLM",
        providerAccountId: routing.gatewayId,
        providerAccountName: gateway?.name ?? routing.gatewayId,
        validFrom: routing.createdAt,
        createdAt: routing.createdAt,
        updatedAt: routing.updatedAt,
      });
    }
  }

  private async endpointPrice(mapping: ModelEndpointCostMapping | undefined) {
    if (!mapping) return undefined;
    const deployment = await this.store.getModelDeployment(mapping.modelEndpointId);
    if (!deployment) return undefined;
    return {
      input: deployment.inputFeePerMillionTokens,
      output: deployment.outputFeePerMillionTokens,
      version: deployment.updatedAt,
    };
  }

  private async usdCost(log: LiteLLMSpendLog, mapping: ModelEndpointCostMapping | undefined): Promise<ResolvedUsdCost> {
    const currency = (log.currency ?? "USD").toUpperCase();
    let rate = currency === "USD" ? 1 : undefined;
    const prompt = finite(log.prompt_cost);
    const completion = finite(log.completion_cost);
    const spend = finite(log.spend);
    if (rate && spend !== undefined) return {
      total: spend * rate,
      ...(prompt !== undefined ? { prompt: prompt * rate } : {}),
      ...(completion !== undefined ? { completion: completion * rate } : {}),
      source: `litellm:${log.cost_source ?? "spend"}`,
      version: log.price_version ?? "litellm-current",
    };
    const price = await this.endpointPrice(mapping);
    if (price?.input !== undefined && price.output !== undefined) {
      const promptCost = count(log.prompt_tokens) * price.input / 1_000_000;
      const completionCost = count(log.completion_tokens) * price.output / 1_000_000;
      return {
        total: promptCost + completionCost,
        prompt: promptCost,
        completion: completionCost,
        source: "tali-model-endpoint",
        version: price.version,
      };
    }
    return { source: currency === "USD" ? "unknown-price" : `unknown-fx:${currency}`, version: log.price_version ?? "unknown" };
  }

  private async runCorrelation(instanceId: string | undefined, timestamp: string) {
    if (!instanceId) return undefined;
    const at = new Date(timestamp);
    const candidates = await this.store.database().projectRunRecord.findMany({
      where: {
        projectId: this.store.projectId,
        instanceId,
        startedAt: { lte: at },
        OR: [{ endedAt: null }, { endedAt: { gte: at } }],
      },
      orderBy: { startedAt: "desc" },
      take: 2,
      select: { id: true, traceId: true },
    });
    // Concurrent Runs on one Instance are legal. Time containment is used
    // only when it identifies exactly one Run; ambiguity remains explicit.
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  private async factFromLog(log: LiteLLMSpendLog): Promise<ModelUsageFact> {
    const timestamp = sourceTimestamp(log);
    const requestId = log.request_id || `generated:${hash(JSON.stringify(log))}`;
    const normalizedKey = tokenIdentifier(log.api_key_id ?? log.hashed_token ?? log.api_key);
    const userId = log.user_id ?? log.user ?? log.end_user;
    const attribution = await this.analytics().findAttribution(normalizedKey
      ? { virtualKeyId: normalizedKey, hashedToken: normalizedKey, at: timestamp }
      : {
          ...(userId ? { userId } : {}),
          ...(log.team_id ? { teamId: log.team_id } : {}),
          at: timestamp,
        });
    const modelName = log.model ?? log.resolved_model;
    const modelGroup = log.model_group ?? log.requested_model;
    const modelId = log.model_id ?? log.deployment_id;
    const endpoint = await this.analytics().findModelEndpoint({
      ...(modelName ? { modelName } : {}),
      ...(modelGroup ? { modelGroup } : {}),
      ...(modelId ? { modelId } : {}),
      at: timestamp,
    });
    const cost = await this.usdCost(log, endpoint);
    const promptTokens = count(log.prompt_tokens);
    const completionTokens = count(log.completion_tokens);
    const totalTokens = finite(log.total_tokens) !== undefined
      ? count(log.total_tokens)
      : promptTokens + completionTokens;
    const status = log.status ?? ((log.http_status_code ?? 200) >= 400 ? "failed" : "success");
    const success = status === "success" || status === "completed" || (log.http_status_code !== undefined && log.http_status_code < 400);
    const virtualKeyId = normalizedKey ?? attribution?.hashedToken ?? attribution?.liteLLMVirtualKeyId;
    const virtualKeyAlias = attribution?.virtualKeyAlias ?? log.virtual_key_alias ??
      (virtualKeyId ? `Virtual key ••••${virtualKeyId.slice(-4)}` : undefined);
    const sourceHash = hash(JSON.stringify(log));
    const correlation = attribution?.workRunId ? undefined : await this.runCorrelation(attribution?.instanceId, timestamp);
    return {
      eventId: `litellm:${requestId}`,
      requestId,
      requestStartTime: timestamp,
      ...(log.first_token_time ? { firstTokenTime: new Date(log.first_token_time).toISOString() } : {}),
      ...(log.response_end_time ?? log.end_time ? { responseEndTime: new Date(log.response_end_time ?? log.end_time!).toISOString() } : {}),
      usageDate: dateInTimezone(timestamp, "UTC"),
      usageHour: hourInTimezone(timestamp, "UTC"),
      // The upstream query is scoped to this Project's LiteLLM Team. A
      // missing Instance mapping is a data-quality problem, not permission to
      // assign the record to a fabricated/default Project.
      projectId: this.store.projectId,
      ...(attribution?.workId ? { workId: attribution.workId } : {}),
      ...(attribution?.workName ? { workName: attribution.workName } : {}),
      ...(attribution?.taskId ? { taskId: attribution.taskId } : {}),
      ...(attribution?.taskName ? { taskName: attribution.taskName } : {}),
      ...(attribution?.workRunId ? { workRunId: attribution.workRunId } : {}),
      ...(attribution?.instanceId ? { instanceId: attribution.instanceId, instanceName: attribution.instanceName } : {}),
      ...(endpoint ? { modelEndpointId: endpoint.modelEndpointId, modelEndpointName: endpoint.modelEndpointName } : {}),
      ...(endpoint?.providerAccountId ?? attribution?.providerAccountId ? {
        providerAccountId: endpoint?.providerAccountId ?? attribution!.providerAccountId!,
        providerAccountName: endpoint?.providerAccountName ?? attribution!.providerAccountId!,
      } : {}),
      ...(virtualKeyId ? { virtualKeyId } : {}),
      ...(virtualKeyAlias ? { virtualKeyAlias } : {}),
      ...(userId ? { liteLLMUserId: userId } : {}),
      ...(log.team_id ? { liteLLMTeamId: log.team_id } : {}),
      ...(log.organization_id ? { organizationId: log.organization_id } : {}),
      ...(log.end_user_id ?? log.end_user ? { endUserId: log.end_user_id ?? log.end_user! } : {}),
      ...(correlation ? {
        runId: correlation.id,
        ...(correlation.traceId ? { traceId: correlation.traceId } : {}),
      } : {}),
      requestedModel: log.requested_model ?? log.model_group ?? log.model ?? "unknown-model",
      resolvedModel: log.resolved_model ?? log.model ?? log.model_group ?? "unknown-model",
      modelGroup: log.model_group ?? log.requested_model ?? "",
      provider: endpoint?.provider ?? log.provider ?? "unknown-provider",
      callType: log.call_type ?? "unknown",
      promptTokens,
      completionTokens,
      totalTokens,
      cachedInputTokens: count(log.cached_input_tokens),
      cacheCreationInputTokens: count(log.cache_creation_input_tokens),
      reasoningTokens: count(log.reasoning_tokens),
      ...(cost.prompt !== undefined ? { promptCostUsd: cost.prompt } : {}),
      ...(cost.completion !== undefined ? { completionCostUsd: cost.completion } : {}),
      ...(cost.total !== undefined ? { totalCostUsd: cost.total } : {}),
      ...(finite(log.provider_reported_cost) !== undefined ? { providerReportedCostUsd: finite(log.provider_reported_cost)! } : {}),
      ...(finite(log.litellm_calculated_cost) !== undefined ? { liteLLMCalculatedCostUsd: finite(log.litellm_calculated_cost)! } : {}),
      costStatus: cost.total !== undefined ? "known" : "unknown",
      costSource: cost.source,
      priceVersion: cost.version,
      requestCount: 1,
      successCount: success ? 1 : 0,
      failureCount: success ? 0 : 1,
      ...(finite(log.latency_ms) !== undefined ? { latencyMs: finite(log.latency_ms)! } : {}),
      ...(finite(log.time_to_first_token_ms) !== undefined ? { timeToFirstTokenMs: finite(log.time_to_first_token_ms)! } : {}),
      ...(finite(log.http_status_code) !== undefined ? { httpStatusCode: finite(log.http_status_code)! } : {}),
      ...(log.error_type ? { errorType: log.error_type } : {}),
      retryCount: count(log.retry_count),
      cacheHit: Boolean(log.cache_hit),
      fallbackUsed: Boolean(log.fallback_used),
      status,
      tags: Array.isArray(log.request_tags) ? log.request_tags.filter((tag): tag is string => typeof tag === "string") : [],
      metadata: log.metadata && typeof log.metadata === "object"
        ? safeMetadata(log.metadata) as Record<string, unknown>
        : {},
      sourceRecordHash: sourceHash,
      createdAt: new Date().toISOString(),
    };
  }

  async sync(startTime: string, endTime: string): Promise<void> {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.performSync(startTime, endTime).finally(() => {
      this.syncPromise = undefined;
    });
    return this.syncPromise;
  }

  private async performSync(startTime: string, endTime: string): Promise<void> {
    await this.refreshMappings();
    const analytics = this.analytics();
    const checkpoint = await analytics.checkpoint();
    const quota = await this.store.database().projectQuotaRecord.findUnique({
      where: { projectId: this.store.projectId },
      select: { litellmTeamId: true },
    });
    if (!quota?.litellmTeamId) {
      throw new Error(
        `Project ${this.store.projectId} has no LiteLLM Team; cost ingestion cannot establish ownership.`,
      );
    }
    const overlapStart = checkpoint.lastSuccessfulEndTime
      ? new Date(new Date(checkpoint.lastSuccessfulEndTime).getTime() - 172_800_000).toISOString()
      : startTime;
    const syncStart = startTime < overlapStart ? startTime : overlapStart;
    const logs = await this.litellm.listSpendLogs(
      syncStart.slice(0, 10),
      endTime.slice(0, 10),
      quota.litellmTeamId,
    );
    const canonical = new Map<string, LiteLLMSpendLog>();
    let duplicateRecords = 0;
    for (const log of logs) {
      const requestId = log.request_id || `generated:${hash(JSON.stringify(log))}`;
      const current = canonical.get(requestId);
      if (current) {
        duplicateRecords += 1;
        await analytics.recordObservation({
          observationId: `duplicate:${requestId}:${hash(JSON.stringify(log))}`,
          requestId,
          observedAt: new Date().toISOString(),
          reason: "duplicate_request_id",
          payload: { sourceRecordHash: hash(JSON.stringify(log)), retryCount: log.retry_count ?? 0 },
        });
        canonical.set(requestId, canonicalLog(current, log));
      } else canonical.set(requestId, log);
    }
    let processedRecords = 0;
    let failedRecords = 0;
    let lateArrivingRecords = 0;
    for (const log of canonical.values()) {
      try {
        if (log.team_id !== quota.litellmTeamId) {
          throw new Error("LiteLLM returned a spend record outside the requested Project Team.");
        }
        const fact = await this.factFromLog(log);
        if (checkpoint.lastSuccessfulEndTime && fact.requestStartTime < checkpoint.lastSuccessfulEndTime)
          lateArrivingRecords += 1;
        if (!await analytics.insertFact(fact)) {
          duplicateRecords += 1;
          await analytics.recordObservation({
            observationId: `replay:${fact.requestId}:${fact.sourceRecordHash}`,
            requestId: fact.requestId,
            observedAt: new Date().toISOString(),
            reason: "idempotent_replay",
            payload: { sourceRecordHash: fact.sourceRecordHash },
          });
        } else processedRecords += 1;
      } catch (error) {
        failedRecords += 1;
        const requestId = log.request_id ?? `invalid:${hash(JSON.stringify(log))}`;
        await analytics.recordObservation({
          observationId: `invalid:${requestId}:${hash(JSON.stringify(log))}`,
          requestId,
          observedAt: new Date().toISOString(),
          reason: "invalid_source_record",
          payload: { message: error instanceof Error ? error.message : "Unknown ingestion error" },
        });
      }
    }
    const lastSyncAt = new Date().toISOString();
    await analytics.saveCheckpoint({
      source: "litellm",
      cursor: endTime,
      lastSuccessfulEndTime: endTime,
      lastSyncAt,
      syncLagSeconds: Math.max(0, (Date.now() - new Date(endTime).getTime()) / 1000),
      processedRecords,
      failedRecords,
      duplicateRecords,
      lateArrivingRecords,
      sourceSpendUsd: logs.reduce((sum, log) => sum + (finite(log.spend) ?? 0), 0),
    });
  }

  private async facts(query: CostAnalyticsQuery, includePrevious = false) {
    const normalized = normalizedQuery(query);
    const previous = previousPeriod(normalized.start, normalized.end);
    const start = includePrevious ? previous.start : normalized.start;
    const all = await this.analytics().listFacts({
      startTime: start,
      endTime: normalized.end,
      projectId: query.projectId,
    });
    return { normalized, previous, all, current: applyFilters(all.filter((fact) => fact.requestStartTime >= normalized.start), query.filters) };
  }

  private filterOptions(facts: ModelUsageFact[]): Record<CostFilterKey, CostFilterOption[]> {
    const maps = Object.fromEntries(filterKeys.map((key) => [key, new Map<string, string>()])) as Record<CostFilterKey, Map<string, string>>;
    for (const fact of facts) {
      for (const key of ["work", "task"] as const) maps[key].set(filterValue(fact, key), factDimension(fact, key).name);
      maps.instance.set(filterValue(fact, "instance"), fact.instanceName ?? groupLabels.instance);
      maps.model_endpoint.set(filterValue(fact, "model_endpoint"), fact.modelEndpointName ?? groupLabels.model_endpoint);
      maps.provider.set(fact.provider, fact.provider);
      maps.provider_account.set(filterValue(fact, "provider_account"), fact.providerAccountName ?? groupLabels.provider_account);
      maps.virtual_key.set(filterValue(fact, "virtual_key"), fact.virtualKeyAlias ?? groupLabels.virtual_key);
      maps.project.set(fact.projectId, fact.projectId);
    }
    return Object.fromEntries(filterKeys.map((key) => [
      key,
      [...maps[key]].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ])) as Record<CostFilterKey, CostFilterOption[]>;
  }

  async summary(query: CostAnalyticsQuery): Promise<ModelCostSummaryResponse> {
    const { normalized, previous, all, current } = await this.facts(query, true);
    const prior = applyFilters(all.filter((fact) =>
      fact.requestStartTime >= previous.start && fact.requestStartTime <= previous.end,
    ), query.filters);
    const spend = current.reduce((sum, fact) => sum + (fact.totalCostUsd ?? 0), 0);
    const tokens = current.reduce((sum, fact) => sum + fact.totalTokens, 0);
    const priorSpend = prior.reduce((sum, fact) => sum + (fact.totalCostUsd ?? 0), 0);
    const priorTokens = prior.reduce((sum, fact) => sum + fact.totalTokens, 0);
    const instances = groupFacts(current, "instance");
    const models = groupFacts(current, "model_endpoint");
    const object = (item: GroupedUsage | undefined) => item && item.spendUsd > 0 ? {
      id: item.id,
      name: item.name,
      spendUsd: item.spendUsd,
      share: spend > 0 ? item.spendUsd / spend : 0,
    } : undefined;
    const highestCostInstance = object(instances[0]);
    const highestCostModel = object(models[0]);
    const spendPercent = percent(spend, priorSpend);
    const tokensPercent = percent(tokens, priorTokens);
    const requestsPercent = percent(current.length, prior.length);
    void normalized;
    return {
      currency: "USD",
      totalSpendUsd: spend,
      totalTokens: tokens,
      promptTokens: current.reduce((sum, fact) => sum + fact.promptTokens, 0),
      completionTokens: current.reduce((sum, fact) => sum + fact.completionTokens, 0),
      requests: current.length,
      unknownCostRequests: current.filter((fact) => fact.costStatus === "unknown").length,
      uncorrelatedRunRequests: current.filter((fact) => fact.instanceId && !fact.runId && !fact.workRunId).length,
      ...(highestCostInstance ? { highestCostInstance } : {}),
      ...(highestCostModel ? { highestCostModel } : {}),
      comparison: {
        ...(spendPercent !== undefined ? { spendPercent } : {}),
        ...(tokensPercent !== undefined ? { tokensPercent } : {}),
        ...(requestsPercent !== undefined ? { requestsPercent } : {}),
      },
    };
  }

  private dailyRows(facts: ModelUsageFact[], query: ReturnType<typeof normalizedQuery>): ModelUsageDailyRow[] {
    const map = new Map<string, ModelUsageDailyRow>();
    for (const fact of facts) {
      const usageDate = dateInTimezone(fact.requestStartTime, query.timezone);
      for (const groupType of ["work", "task", "instance", "model_endpoint", "provider_account", "virtual_key"] as CostGroupBy[]) {
        const dimension = factDimension(fact, groupType);
        const key = `${usageDate}|${groupType}|${dimension.id}`;
        const current = map.get(key) ?? {
          usageDate,
          timezone: query.timezone,
          projectId: fact.projectId,
          groupType,
          groupId: dimension.id,
          groupName: dimension.name,
          spendUsd: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          requests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          activeObjectCount: 1,
          firstRequestAt: fact.requestStartTime,
          lastRequestAt: fact.requestStartTime,
        };
        current.spendUsd += fact.totalCostUsd ?? 0;
        current.promptTokens += fact.promptTokens;
        current.completionTokens += fact.completionTokens;
        current.totalTokens += fact.totalTokens;
        current.requests += 1;
        current.successfulRequests += fact.successCount;
        current.failedRequests += fact.failureCount;
        current.firstRequestAt = current.firstRequestAt < fact.requestStartTime ? current.firstRequestAt : fact.requestStartTime;
        current.lastRequestAt = current.lastRequestAt > fact.requestStartTime ? current.lastRequestAt : fact.requestStartTime;
        map.set(key, current);
      }
    }
    return [...map.values()];
  }

  private intensity(items: Array<{ spendUsd: number }>) {
    const max = Math.max(0, ...items.map((item) => item.spendUsd));
    const thresholds: [number, number, number, number, number] = [0, max * 0.25, max * 0.5, max * 0.75, max];
    const level = (value: number): 0 | 1 | 2 | 3 | 4 =>
      value <= 0 ? 0 : value <= thresholds[1] ? 1 : value <= thresholds[2] ? 2 : value <= thresholds[3] ? 3 : 4;
    return { max, thresholds, level };
  }

  async activity(query: CostAnalyticsQuery, groupBy: CostGroupBy, granularity: ModelCostGranularity): Promise<ModelCostActivityResponse> {
    const { normalized, current } = await this.facts(query);
    const unfiltered = await this.analytics().listFacts({
      startTime: normalized.start,
      endTime: normalized.end,
      projectId: query.projectId,
    });
    const dailyRows = this.dailyRows(unfiltered, normalized);
    await this.analytics().replaceDailyRows({
      projectId: query.projectId,
      timezone: query.timezone,
      from: normalized.from,
      to: normalized.to,
      rows: dailyRows,
    });
    const daily = days(normalized.from, normalized.to).map((date) => {
      const records = current.filter((fact) => dateInTimezone(fact.requestStartTime, query.timezone) === date);
      return {
        date,
        spendUsd: records.reduce((sum, fact) => sum + (fact.totalCostUsd ?? 0), 0),
        tokens: records.reduce((sum, fact) => sum + fact.totalTokens, 0),
        requests: records.length,
        activeObjects: new Set(records.map((fact) => factDimension(fact, groupBy).id)).size,
      };
    });
    let items = daily;
    if (granularity === "weekly") {
      const weeks = new Map<string, typeof daily>();
      for (const item of daily) {
        const key = periodKey(item.date, "week");
        weeks.set(key, [...(weeks.get(key) ?? []), item]);
      }
      items = [...weeks].map(([date, rows]) => ({
        date,
        spendUsd: rows.reduce((sum, row) => sum + row.spendUsd, 0),
        tokens: rows.reduce((sum, row) => sum + row.tokens, 0),
        requests: rows.reduce((sum, row) => sum + row.requests, 0),
        activeObjects: new Set(current.filter((fact) =>
          periodKey(dateInTimezone(fact.requestStartTime, query.timezone), "week") === date,
        ).map((fact) => factDimension(fact, groupBy).id)).size,
      }));
    } else if (granularity === "cumulative") {
      let spendUsd = 0, tokens = 0, requests = 0;
      const active = new Set<string>();
      items = daily.map((item) => {
        spendUsd += item.spendUsd; tokens += item.tokens; requests += item.requests;
        current.filter((fact) => dateInTimezone(fact.requestStartTime, query.timezone) === item.date)
          .forEach((fact) => active.add(factDimension(fact, groupBy).id));
        return { date: item.date, spendUsd, tokens, requests, activeObjects: active.size };
      });
    }
    const scale = this.intensity(items);
    return {
      currency: "USD",
      granularity,
      items: items.map((item) => ({ ...item, intensity: scale.level(item.spendUsd) })),
      legend: { min: 0, max: scale.max, thresholds: scale.thresholds },
    };
  }

  async insights(query: CostAnalyticsQuery): Promise<ModelCostInsightsResponse> {
    const { normalized, current } = await this.facts(query);
    const perDay = days(normalized.from, normalized.to).map((date) => {
      const records = current.filter((fact) => dateInTimezone(fact.requestStartTime, query.timezone) === date);
      return {
        date,
        spendUsd: records.reduce((sum, fact) => sum + (fact.totalCostUsd ?? 0), 0),
        tokens: records.reduce((sum, fact) => sum + fact.totalTokens, 0),
      };
    });
    const highestSpendDay = [...perDay].sort((a, b) => b.spendUsd - a.spendUsd)[0];
    const peakTokensDay = [...perDay].sort((a, b) => b.tokens - a.tokens)[0];
    const providers = new Map<string, number>();
    current.forEach((fact) => providers.set(fact.provider, (providers.get(fact.provider) ?? 0) + (fact.totalCostUsd ?? 0)));
    const mostExpensiveProvider = [...providers].sort((a, b) => b[1] - a[1])[0];
    const spend = current.reduce((sum, fact) => sum + (fact.totalCostUsd ?? 0), 0);
    return {
      currency: "USD",
      ...(highestSpendDay?.spendUsd ? { highestSpendDay } : {}),
      averageDailySpendUsd: spend / Math.max(1, perDay.length),
      activeWorks: new Set(current.flatMap(fact => fact.workId ? [fact.workId] : [])).size,
      activeTasks: new Set(current.flatMap(fact => fact.workId && fact.taskId ? [`${fact.workId}/${fact.taskId}`] : [])).size,
      activeInstances: new Set(current.map((fact) => fact.instanceId).filter(Boolean)).size,
      activeModelEndpoints: new Set(current.map((fact) => fact.modelEndpointId).filter(Boolean)).size,
      activeProviderAccounts: new Set(current.map((fact) => fact.providerAccountId).filter(Boolean)).size,
      activeVirtualKeys: new Set(current.map((fact) => fact.virtualKeyId).filter(Boolean)).size,
      ...(mostExpensiveProvider ? { mostExpensiveProvider: { provider: mostExpensiveProvider[0], spendUsd: mostExpensiveProvider[1] } } : {}),
      ...(peakTokensDay?.tokens ? { peakTokensDay } : {}),
      unknownCostRequests: current.filter((fact) => fact.costStatus === "unknown").length,
    };
  }

  async ranking(query: CostAnalyticsQuery, groupBy: CostGroupBy, limit: number): Promise<ModelCostRankingResponse> {
    const { current } = await this.facts(query);
    const totalSpendUsd = current.reduce((sum, fact) => sum + (fact.totalCostUsd ?? 0), 0);
    return {
      currency: "USD",
      totalSpendUsd,
      items: groupFacts(current, groupBy).filter((item) => item.spendUsd > 0).slice(0, limit).map((item, index) => ({
        id: item.id,
        name: item.name,
        spendUsd: item.spendUsd,
        tokens: item.promptTokens + item.completionTokens,
        requests: item.requests,
        share: totalSpendUsd > 0 ? item.spendUsd / totalSpendUsd : 0,
        rank: index + 1,
      })),
    };
  }

  async trend(query: CostAnalyticsQuery, groupBy: CostGroupBy, granularity: ModelCostTrendGranularity, topN: number): Promise<ModelCostTrendResponse> {
    const { normalized, current } = await this.facts(query);
    const top = groupFacts(current, groupBy).slice(0, topN);
    const topIds = new Set(top.map((item) => item.id));
    const dates = [...new Set(days(normalized.from, normalized.to).map((date) => periodKey(date, granularity)))];
    const series = [...top.map((item) => ({ id: item.id, name: item.name })), { id: "others", name: "Others" }]
      .map((entry) => ({
        ...entry,
        items: dates.map((date) => {
          const records = current.filter((fact) => {
            const group = factDimension(fact, groupBy);
            const matchesSeries = entry.id === "others" ? !topIds.has(group.id) : group.id === entry.id;
            return matchesSeries && periodKey(dateInTimezone(fact.requestStartTime, query.timezone), granularity) === date;
          });
          return {
            date,
            spendUsd: records.reduce((sum, fact) => sum + (fact.totalCostUsd ?? 0), 0),
            tokens: records.reduce((sum, fact) => sum + fact.totalTokens, 0),
            requests: records.length,
          };
        }),
      }))
      .filter((entry) => entry.id !== "others" || entry.items.some((item) => item.requests > 0));
    return { currency: "USD", dates, series };
  }

  async breakdown(query: CostBreakdownQuery): Promise<ModelCostBreakdownResponse> {
    const { normalized, current } = await this.facts(query);
    const totalSpend = current.reduce((sum, fact) => sum + (fact.totalCostUsd ?? 0), 0);
    const search = query.search.trim().toLowerCase();
    const all = groupFacts(current, query.groupBy).map<ModelCostBreakdownItem>((item) => ({
      id: item.id,
      name: item.name,
      detail: item.detail,
      spendUsd: item.spendUsd,
      promptTokens: item.promptTokens,
      completionTokens: item.completionTokens,
      totalTokens: item.promptTokens + item.completionTokens,
      requests: item.requests,
      averageCostPerRequest: item.requests ? item.spendUsd / item.requests : 0,
      share: totalSpend > 0 ? item.spendUsd / totalSpend : 0,
      lastActive: item.lastRequestAt,
      provider: item.provider,
      providerAccount: item.providerAccount,
      modelsUsed: item.models.size,
      boundInstance: item.boundInstance,
      ...(item.boundInstanceId ? { boundInstanceId: item.boundInstanceId } : {}),
      user: item.user,
      team: item.team,
    })).filter((item) => !search || `${item.name} ${item.detail}`.toLowerCase().includes(search));
    const sortValue = (item: ModelCostBreakdownItem): string | number => {
      const key = query.sort.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) as keyof ModelCostBreakdownItem;
      return item[key] as string | number | undefined ?? "";
    };
    all.sort((left, right) => {
      const a = sortValue(left), b = sortValue(right);
      const order = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
      return query.direction === "asc" ? order : -order;
    });
    const start = (query.page - 1) * query.pageSize;
    const unfiltered = await this.analytics().listFacts({
      startTime: normalized.start,
      endTime: normalized.end,
      projectId: query.projectId,
    });
    return {
      currency: "USD",
      items: all.slice(start, start + query.pageSize),
      total: all.length,
      page: query.page,
      pageSize: query.pageSize,
      filterOptions: this.filterOptions(unfiltered),
    };
  }

  async dataQuality(query: CostAnalyticsQuery): Promise<ModelCostDataQualityResponse> {
    const { current } = await this.facts(query);
    const checkpoint = await this.analytics().checkpoint();
    const taliSpend = current.reduce((sum, fact) => sum + (fact.totalCostUsd ?? 0), 0);
    const litellmSpend = current.reduce((sum, fact) => sum + (
      fact.liteLLMCalculatedCostUsd ??
      (fact.costSource.startsWith("litellm") ? fact.totalCostUsd ?? 0 : 0)
    ), 0);
    return {
      unmappedRequests: current.filter((fact) => !fact.instanceId || !fact.modelEndpointId || !fact.providerAccountId).length,
      unmappedInstances: current.filter((fact) => !fact.instanceId).length,
      unmappedModelEndpoints: current.filter((fact) => !fact.modelEndpointId).length,
      unmappedProviderAccounts: current.filter((fact) => !fact.providerAccountId).length,
      tokenMismatchRequests: current.filter((fact) => fact.totalTokens !== fact.promptTokens + fact.completionTokens).length,
      negativeSpendRequests: current.filter((fact) => (fact.totalCostUsd ?? 0) < 0).length,
      unknownCostRequests: current.filter((fact) => fact.costStatus === "unknown").length,
      duplicateRequests: await this.analytics().countDuplicateRequests(),
      uncorrelatedRunRequests: current.filter((fact) => fact.instanceId && !fact.runId && !fact.workRunId).length,
      lateArrivingRequests: checkpoint.lateArrivingRecords,
      ...(checkpoint.lastSyncAt ? { lastSyncAt: checkpoint.lastSyncAt } : {}),
      ...(checkpoint.syncLagSeconds !== undefined ? { syncLagSeconds: checkpoint.syncLagSeconds } : {}),
      litellmSpend,
      taliSpend,
      spendDifference: litellmSpend - taliSpend,
    };
  }
}
