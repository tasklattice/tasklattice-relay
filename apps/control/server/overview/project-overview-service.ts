import {
  projectRunSources,
  type Instance as Agent,
  type ModelDeployment,
  type ModelRouting,
  type ProjectOverviewAttentionItem,
  type ProjectOverviewRange,
  type ProjectOverviewResponse,
  type ProjectOverviewUsagePoint,
  type ProjectRunSource,
} from "@tali/contracts";
import type { PrismaClient } from "../generated/prisma/client";
import { ProjectStore } from "../projects/project-store";
import { nextBudgetWindow } from "../quotas/budget-window";

const rangeMilliseconds: Record<ProjectOverviewRange, number> = {
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

const provisioningTimeoutMs = 15 * 60 * 1_000;

function issueOpenedAt(value: Date | string | null | undefined, now: Date): string {
  if (!value) return now.toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? now.toISOString() : date.toISOString();
}

function quotaRatio(used: number, limit: number | bigint | null | undefined): number | null {
  if (limit === null || limit === undefined) return null;
  const numericLimit = Number(limit);
  if (numericLimit === 0) return used > 0 ? Number.POSITIVE_INFINITY : 0;
  return used / numericLimit;
}

function activeConfiguredInstances(
  observed: Agent[],
  stored: Agent[],
): Agent[] {
  const storedById = new Map(stored.map((instance) => [instance.id, instance]));
  return observed
    .map((instance) => ({ ...storedById.get(instance.id), ...instance }) as Agent)
    .filter((instance) => instance.status !== "DESTROYING");
}

function modelAssignmentDistribution(
  instances: Agent[],
  routings: ModelRouting[],
  models: ModelDeployment[],
): ProjectOverviewResponse["modelAssignment"] {
  const routingById = new Map(routings.map((routing) => [routing.id, routing]));
  const modelById = new Map(models.map((model) => [model.id, model]));
  const counts = new Map<string, {
    key: string;
    label: string;
    kind: "model" | "auto" | "unavailable";
    agents: number;
  }>();

  for (const instance of instances) {
    const routing = routingById.get(instance.modelRoutingId);
    let definition: Omit<NonNullable<ReturnType<typeof counts.get>>, "agents">;
    if (!routing) {
      definition = {
        key: "unavailable-route",
        label: "Unavailable route",
        kind: "unavailable",
      };
    } else if (routing.routingPolicy.mode !== "SINGLE") {
      definition = { key: "auto-route", label: "Auto route", kind: "auto" };
    } else {
      const model = modelById.get(routing.routingPolicy.modelDeploymentId);
      definition = {
        key: `model:${routing.routingPolicy.modelDeploymentId}`,
        label: model?.displayName ?? routing.name,
        kind: model ? "model" : "unavailable",
      };
    }
    const current = counts.get(definition.key);
    counts.set(definition.key, {
      ...definition,
      agents: (current?.agents ?? 0) + 1,
    });
  }

  const totalAgents = instances.length;
  return {
    totalAgents,
    segments: [...counts.values()]
      .map((segment) => ({
        ...segment,
        percentage: totalAgents ? segment.agents / totalAgents : 0,
      }))
      .sort((left, right) => right.agents - left.agents || left.label.localeCompare(right.label)),
  };
}

function agentActivityRanking(
  instances: Agent[],
  runs: Array<{ instanceId: string; status: string }>,
  facts: Array<{
    instanceId: string | null;
    endUserId: string | null;
    totalCostUsd: unknown;
  }>,
): ProjectOverviewResponse["agentActivity"] {
  const runsByAgent = new Map<string, Array<{ status: string }>>();
  for (const run of runs) {
    runsByAgent.set(run.instanceId, [
      ...(runsByAgent.get(run.instanceId) ?? []),
      { status: run.status },
    ]);
  }
  const costByAgent = new Map<string, number>();
  const usersByAgent = new Map<string, Set<string>>();
  const factsByAgent = new Set<string>();
  for (const fact of facts) {
    if (!fact.instanceId) continue;
    factsByAgent.add(fact.instanceId);
    costByAgent.set(
      fact.instanceId,
      (costByAgent.get(fact.instanceId) ?? 0) + Number(fact.totalCostUsd ?? 0),
    );
    if (fact.endUserId) {
      const users = usersByAgent.get(fact.instanceId) ?? new Set<string>();
      users.add(fact.endUserId);
      usersByAgent.set(fact.instanceId, users);
    }
  }

  return instances
    .map((instance) => {
      const agentRuns = runsByAgent.get(instance.id) ?? [];
      return {
        agentId: instance.id,
        agentName: instance.name || instance.id,
        runs: agentRuns.length,
        activeUsers: usersByAgent.get(instance.id)?.size
          ?? (factsByAgent.has(instance.id) || agentRuns.length > 0 ? null : 0),
        successRate: successRate(agentRuns),
        costUsd: costByAgent.get(instance.id) ?? 0,
      };
    })
    .sort((left, right) =>
      right.runs - left.runs
      || (right.activeUsers ?? -1) - (left.activeUsers ?? -1)
      || right.costUsd - left.costUsd
      || left.agentName.localeCompare(right.agentName),
    );
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function successRate(rows: Array<{ status: string }>): number | null {
  const eligible = rows.filter((row) =>
    row.status === "SUCCEEDED" || row.status === "FAILED" || row.status === "TIMED_OUT",
  );
  if (!eligible.length) return null;
  return eligible.filter((row) => row.status === "SUCCEEDED").length / eligible.length;
}

function localDate(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
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

function localDayStart(date: string, timezone: string): Date {
  const initial = new Date(`${date}T00:00:00.000Z`);
  let result = new Date(initial.getTime() - timezoneOffsetMs(initial, timezone));
  result = new Date(initial.getTime() - timezoneOffsetMs(result, timezone));
  return result;
}

function recentLocalDates(end: Date, count: number, timezone: string): string[] {
  const dates: string[] = [];
  for (let offset = 0; dates.length < count; offset += 1) {
    const date = localDate(new Date(end.getTime() - offset * 24 * 60 * 60 * 1_000), timezone);
    if (!dates.includes(date)) dates.push(date);
  }
  return dates.reverse();
}

function bucket(value: Date, range: ProjectOverviewRange, timezone: string): string {
  if (range !== "24h") return localDate(value, timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:00`;
}

function buckets(start: Date, end: Date, range: ProjectOverviewRange, timezone: string): string[] {
  const step = range === "24h" ? 60 * 60 * 1_000 : 24 * 60 * 60 * 1_000;
  const values: string[] = [];
  for (let at = start.getTime(); at < end.getTime(); at += step) {
    const key = bucket(new Date(at), range, timezone);
    if (values.at(-1) !== key) values.push(key);
  }
  const final = bucket(new Date(end.getTime() - 1), range, timezone);
  if (values.at(-1) !== final) values.push(final);
  return values;
}

function runtimeCounts(instances: Agent[]) {
  return {
    ready: instances.filter((instance) => instance.status === "READY").length,
    provisioning: instances.filter((instance) => instance.status === "PROVISIONING").length,
    failed: instances.filter((instance) => instance.status === "FAILED").length,
    destroying: instances.filter((instance) => instance.status === "DESTROYING").length,
    total: instances.length,
  };
}

export interface ProjectInstanceSource {
  list(): Promise<Agent[]>;
}

export class ProjectOverviewService {
  private readonly db: PrismaClient;

  constructor(
    readonly store: ProjectStore,
    private readonly instances: ProjectInstanceSource,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.db = store.database();
  }

  async overview(range: ProjectOverviewRange, timezone: string): Promise<ProjectOverviewResponse> {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(this.clock());
    const now = this.clock();
    const duration = rangeMilliseconds[range];
    const dayCount = range === "7d" ? 7 : range === "30d" ? 30 : undefined;
    const currentDayBuckets = dayCount ? recentLocalDates(now, dayCount, timezone) : undefined;
    const start = currentDayBuckets
      ? localDayStart(currentDayBuckets[0]!, timezone)
      : new Date(now.getTime() - duration);
    const previousDayBuckets = dayCount
      ? recentLocalDates(new Date(start.getTime() - 1), dayCount, timezone)
      : undefined;
    const previousStart = previousDayBuckets
      ? localDayStart(previousDayBuckets[0]!, timezone)
      : new Date(start.getTime() - duration);

    const [
      runs,
      facts,
      quota,
      checkpoint,
      liveInstances,
      storedInstances,
      skills,
      mcpServers,
      knowledgeSources,
      policies,
      providerAccounts,
      modelRoutings,
      modelDeployments,
      memories,
      vectorJobs,
    ] = await Promise.all([
      this.db.projectRunRecord.findMany({
        where: {
          projectId: this.store.projectId,
          startedAt: { gte: previousStart, lt: now },
        },
        orderBy: { startedAt: "asc" },
      }),
      this.db.modelUsageFactRecord.findMany({
        where: {
          projectId: this.store.projectId,
          requestStartTime: { gte: previousStart, lt: now },
        },
        orderBy: { requestStartTime: "asc" },
      }),
      this.db.projectQuotaRecord.findUnique({ where: { projectId: this.store.projectId } }),
      this.db.costSyncCheckpointRecord.findUnique({
        where: { projectId_source: { projectId: this.store.projectId, source: "litellm" } },
      }),
      this.instances.list().then(
        (value) => ({ available: true as const, value }),
        () => ({ available: false as const, value: [] as Agent[] }),
      ),
      this.store.list(),
      this.store.listSkillDefinitions(),
      this.store.listMcpServerDefinitions(),
      this.store.listKnowledgeSourceDefinitions(),
      this.db.accessPolicyRecord.findMany({
        where: { projectId: this.store.projectId, deletedAt: null },
        select: { id: true, payload: true, updatedAt: true },
      }),
      this.store.listProviderAccounts(),
      this.store.listModelRoutings(),
      this.store.listModelDeployments(),
      this.db.memoryRecord.findMany({
        where: {
          projectId: this.store.projectId,
          deletedAt: null,
          status: { in: ["degraded", "deletion_failed"] },
        },
        orderBy: { updatedAt: "asc" },
      }),
      this.db.vectorIngestionJob.findMany({
        where: { projectId: this.store.projectId },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    const currentRuns = runs.filter((run) => run.startedAt >= start);
    const previousRuns = runs.filter((run) => run.startedAt < start);
    const currentFacts = facts.filter((fact) => fact.requestStartTime >= start);
    const previousFacts = facts.filter((fact) => fact.requestStartTime < start);
    const currentSpend = currentFacts.reduce((sum, fact) => sum + Number(fact.totalCostUsd ?? 0), 0);
    const previousSpend = previousFacts.reduce((sum, fact) => sum + Number(fact.totalCostUsd ?? 0), 0);
    const currentSuccess = successRate(currentRuns);
    const previousSuccess = successRate(previousRuns);

    const points = new Map<string, ProjectOverviewUsagePoint>(
      (currentDayBuckets ?? buckets(start, now, range, timezone)).map((key) => [key, {
        bucket: key,
        runs: 0,
        tokens: 0,
        costUsd: 0,
      }]),
    );
    for (const run of currentRuns) {
      const point = points.get(bucket(run.startedAt, range, timezone));
      if (point) point.runs += 1;
    }
    for (const fact of currentFacts) {
      const point = points.get(bucket(fact.requestStartTime, range, timezone));
      if (!point) continue;
      point.tokens += Number(fact.totalTokens);
      point.costUsd += Number(fact.totalCostUsd ?? 0);
    }

    const observedInstances = liveInstances.available ? liveInstances.value : storedInstances;
    const activeInstances = activeConfiguredInstances(observedInstances, storedInstances);
    const runtime = runtimeCounts(observedInstances);
    const workloadCounts = new Map<ProjectRunSource, number>();
    for (const run of currentRuns) {
      const source = run.agentPlatform as ProjectRunSource;
      workloadCounts.set(source, (workloadCounts.get(source) ?? 0) + 1);
    }
    const totalWorkload = currentRuns.length;
    const workload = projectRunSources
      .map((runtimeType) => ({
        runtimeType,
        runs: workloadCounts.get(runtimeType) ?? 0,
        percentage: totalWorkload ? (workloadCounts.get(runtimeType) ?? 0) / totalWorkload : 0,
      }))
      .filter((item) => item.runs > 0);
    const modelAssignment = modelAssignmentDistribution(
      activeInstances,
      modelRoutings,
      modelDeployments,
    );
    const agentActivity = agentActivityRanking(activeInstances, currentRuns, currentFacts);

    const budgetDuration = quota?.budgetDuration as "1d" | "7d" | "30d" | null | undefined;
    const budgetLimit = quota?.hardBudgetUsd === null || quota?.hardBudgetUsd === undefined
      ? null
      : Number(quota.hardBudgetUsd);
    const budgetWindow = budgetDuration && budgetLimit !== null
      ? nextBudgetWindow(
          now,
          budgetDuration,
          quota?.budgetPeriodStartedAt,
          quota?.budgetResetsAt,
        )
      : null;
    const budgetStart = budgetWindow?.startedAt ?? start;
    const budgetFacts = budgetStart >= previousStart
      ? facts.filter((fact) => fact.requestStartTime >= budgetStart)
      : await this.db.modelUsageFactRecord.findMany({
          where: {
            projectId: this.store.projectId,
            requestStartTime: { gte: budgetStart, lt: now },
          },
        });
    const budgetUsed = budgetFacts.reduce((sum, fact) => sum + Number(fact.totalCostUsd ?? 0), 0);
    const budgetPercent = budgetLimit && budgetLimit > 0 ? budgetUsed / budgetLimit : null;
    const budgetElapsedMs = budgetWindow ? now.getTime() - budgetWindow.startedAt.getTime() : 0;
    const budgetWindowMs = budgetWindow
      ? budgetWindow.resetsAt.getTime() - budgetWindow.startedAt.getTime()
      : 0;
    const budgetForecast = budgetWindow && checkpoint?.lastSyncAt && budgetElapsedMs > 0
      ? budgetUsed * budgetWindowMs / budgetElapsedMs
      : null;

    const attention: ProjectOverviewAttentionItem[] = [];
    const projectId = encodeURIComponent(this.store.projectId);
    const latestCostObservation = currentFacts.at(-1)?.requestStartTime ?? checkpoint?.lastSyncAt;

    for (const instance of activeInstances.filter((item) => item.status === "FAILED")) {
      const name = instance.name || instance.id;
      attention.push({
        code: `INSTANCE_FAILED:${instance.id}`,
        source: "runtime",
        severity: "critical",
        title: `${name} is unavailable`,
        impact: { kind: "Runtime Instance", id: instance.id, label: name },
        owner: instance.createdBy?.displayName ?? "Agent Platform",
        openedAt: issueOpenedAt(instance.updatedAt, now),
        reason: instance.error || "The Runtime reported a failed lifecycle state and cannot accept new work.",
        nextStep: {
          label: "Investigate instance",
          href: `/${projectId}/instances/${encodeURIComponent(instance.id)}`,
        },
      });
    }
    for (const instance of activeInstances.filter((item) =>
      item.status === "PROVISIONING"
      && now.getTime() - new Date(item.createdAt || item.updatedAt).getTime() >= provisioningTimeoutMs,
    )) {
      const openedAt = issueOpenedAt(instance.createdAt || instance.updatedAt, now);
      const elapsedMs = now.getTime() - new Date(openedAt).getTime();
      const name = instance.name || instance.id;
      attention.push({
        code: `INSTANCE_PROVISIONING_TIMEOUT:${instance.id}`,
        source: "runtime",
        severity: elapsedMs >= 60 * 60 * 1_000 ? "critical" : "warning",
        title: `${name} provisioning is delayed`,
        impact: { kind: "Runtime Instance", id: instance.id, label: name },
        owner: instance.createdBy?.displayName ?? "Agent Platform",
        openedAt,
        reason: `Provisioning has exceeded the ${provisioningTimeoutMs / 60_000}-minute operational threshold${instance.provisioningStage ? ` at ${instance.provisioningStage}` : ""}.`,
        nextStep: {
          label: "Review provisioning",
          href: `/${projectId}/instances/${encodeURIComponent(instance.id)}`,
        },
      });
    }

    if (budgetPercent !== null && budgetPercent >= 1) {
      attention.push({
        code: "BUDGET_LIMIT",
        source: "budget",
        severity: "critical",
        title: "Project budget has been reached",
        impact: { kind: "Budget", label: `$${budgetUsed.toFixed(2)} / $${budgetLimit?.toFixed(2)}` },
        owner: "Project Admin",
        openedAt: issueOpenedAt(latestCostObservation, now),
        reason: `Recorded spend is ${(budgetPercent * 100).toFixed(1)}% of the active ${budgetDuration ?? "configured"} budget.`,
        nextStep: { label: "Review budget", href: `/${projectId}/cost` },
      });
    } else if (budgetLimit !== null && budgetForecast !== null && budgetForecast > budgetLimit) {
      attention.push({
        code: "BUDGET_FORECAST",
        source: "budget",
        severity: "warning",
        title: "Forecast exceeds the project budget",
        impact: { kind: "Budget", label: `$${budgetForecast.toFixed(2)} forecast / $${budgetLimit.toFixed(2)} limit` },
        owner: "Project Admin",
        openedAt: issueOpenedAt(latestCostObservation, now),
        reason: `At the current spend rate, this budget window is projected to exceed its limit by $${(budgetForecast - budgetLimit).toFixed(2)}.`,
        nextStep: { label: "Review forecast", href: `/${projectId}/cost` },
      });
    } else if (budgetPercent !== null && budgetPercent >= 0.8) {
      attention.push({
        code: "BUDGET_THRESHOLD",
        source: "budget",
        severity: "warning",
        title: "Budget usage is nearing its limit",
        impact: { kind: "Budget", label: `$${budgetUsed.toFixed(2)} / $${budgetLimit?.toFixed(2)}` },
        owner: "Project Admin",
        openedAt: issueOpenedAt(latestCostObservation, now),
        reason: `Recorded spend is ${(budgetPercent * 100).toFixed(1)}% of the active ${budgetDuration ?? "configured"} budget.`,
        nextStep: { label: "Review budget", href: `/${projectId}/cost` },
      });
    }

    const addQuotaAttention = (
      code: string,
      label: string,
      used: number,
      limit: number | bigint | null | undefined,
    ) => {
      const ratio = quotaRatio(used, limit);
      if (ratio === null || ratio < 0.8) return;
      const numericLimit = Number(limit);
      attention.push({
        code,
        source: "quota",
        severity: ratio >= 1 ? "critical" : "warning",
        title: `${label} quota ${ratio >= 1 ? "has been reached" : "is nearing its limit"}`,
        impact: { kind: "Quota", label: `${used.toLocaleString()} / ${numericLimit.toLocaleString()} ${label}` },
        owner: "Project Admin",
        openedAt: issueOpenedAt(quota?.updatedAt, now),
        reason: `${(Math.min(ratio, 9.99) * 100).toFixed(1)}% of the configured ${label.toLowerCase()} quota is currently in use.`,
        nextStep: { label: "Review quota", href: `/${projectId}/setting?section=quota` },
      });
    };
    const trailingMinuteTokens = currentFacts
      .filter((fact) => fact.requestStartTime >= new Date(now.getTime() - 60_000))
      .reduce((sum, fact) => sum + Number(fact.totalTokens), 0);
    addQuotaAttention("QUOTA_INSTANCES", "Instances", activeInstances.length, quota?.maxInstances);
    addQuotaAttention("QUOTA_TPM", "TPM", trailingMinuteTokens, quota?.tpmLimit);
    addQuotaAttention("QUOTA_MCP", "MCP integrations", mcpServers.length, quota?.maxMcpIntegrations);
    addQuotaAttention(
      "QUOTA_KNOWLEDGE",
      "Knowledge integrations",
      knowledgeSources.length,
      quota?.maxKnowledgeBaseIntegrations,
    );

    if (quota?.syncStatus === "failed") {
      attention.push({
        code: "QUOTA_SYNC_FAILED",
        source: "quota",
        severity: "warning",
        title: "Quota reconciliation failed",
        impact: { kind: "Quota", label: "Project quota" },
        owner: "Project Admin",
        openedAt: issueOpenedAt(quota.updatedAt, now),
        reason: quota.lastSyncError || "The latest quota configuration was not reconciled to LiteLLM.",
        nextStep: { label: "Retry quota sync", href: `/${projectId}/setting?section=quota` },
      });
    }

    for (const account of providerAccounts.filter((item) =>
      item.checks.some((check) => check.id === "credentials" && check.status === "FAIL"),
    )) {
      attention.push({
        code: `PROVIDER_CREDENTIAL_FAILED:${account.id}`,
        source: "provider",
        severity: "critical",
        title: `${account.name} credentials are invalid`,
        impact: { kind: "Provider", id: account.id, label: account.name },
        owner: "Project Admin",
        openedAt: issueOpenedAt(account.updatedAt, now),
        reason: account.validationMessage || "The Provider rejected the stored credential during validation.",
        nextStep: { label: "Revalidate provider", href: `/${projectId}/setting?section=models` },
      });
    }

    const eligibleRunCount = currentRuns.filter((run) =>
      run.status === "SUCCEEDED" || run.status === "FAILED" || run.status === "TIMED_OUT",
    ).length;
    if (eligibleRunCount >= 5 && currentSuccess !== null && currentSuccess < 0.95) {
      attention.push({
        code: "RUN_SUCCESS_RATE",
        source: "runs",
        severity: currentSuccess < 0.8 ? "critical" : "warning",
        title: "Run success rate is below target",
        impact: { kind: "Runs", label: `${eligibleRunCount} completed Runs` },
        owner: "Agent Platform",
        openedAt: issueOpenedAt(currentRuns.find((run) => run.status !== "SUCCEEDED")?.startedAt, now),
        reason: `Run success rate is ${(currentSuccess * 100).toFixed(1)}% for the selected period, below the 95% operating target.`,
        nextStep: { label: "Inspect failed runs", href: `/${projectId}/traces` },
      });
    }
    const staleRunRows = currentRuns.filter((run) =>
      run.status === "RUNNING" && run.startedAt < new Date(now.getTime() - 60 * 60 * 1_000),
    );
    if (staleRunRows.length > 0) {
      attention.push({
        code: "RUN_STALE",
        source: "runs",
        severity: "warning",
        title: `${staleRunRows.length} Run${staleRunRows.length === 1 ? " is" : "s are"} still open`,
        impact: { kind: "Runs", label: `${staleRunRows.length} long-running` },
        owner: "Agent Platform",
        openedAt: staleRunRows[0]!.startedAt.toISOString(),
        reason: "Run telemetry has not received a terminal event for more than one hour.",
        nextStep: { label: "Find stalled runs", href: `/${projectId}/traces` },
      });
    }
    const costSyncAgeMs = checkpoint?.lastSyncAt
      ? now.getTime() - checkpoint.lastSyncAt.getTime()
      : null;
    if (quota?.litellmTeamId && (costSyncAgeMs === null || costSyncAgeMs > 5 * 60 * 1_000)) {
      attention.push({
        code: "COST_DATA_STALE",
        source: "telemetry",
        severity: costSyncAgeMs !== null && costSyncAgeMs > 30 * 60 * 1_000 ? "critical" : "warning",
        title: "Cost telemetry is delayed",
        impact: { kind: "Telemetry", label: "LiteLLM cost sync" },
        owner: "Platform operations",
        openedAt: issueOpenedAt(checkpoint?.lastSyncAt ?? quota.createdAt, now),
        reason: checkpoint?.lastSyncAt
          ? "LiteLLM cost facts have not refreshed in the last five minutes."
          : "No successful LiteLLM cost ingestion has completed for this Project.",
        nextStep: { label: "Inspect cost sync", href: `/${projectId}/cost` },
      });
    }
    const costQualityIssues = currentFacts.filter((fact) =>
      fact.costStatus !== "known" || !fact.instanceId,
    ).length;
    if (costQualityIssues > 0) {
      attention.push({
        code: "COST_DATA_QUALITY",
        source: "telemetry",
        severity: "warning",
        title: "Cost attribution needs review",
        impact: { kind: "Telemetry", label: `${costQualityIssues} model request${costQualityIssues === 1 ? "" : "s"}` },
        owner: "Platform operations",
        openedAt: issueOpenedAt(
          currentFacts.find((fact) => fact.costStatus !== "known" || !fact.instanceId)?.requestStartTime,
          now,
        ),
        reason: `${costQualityIssues} model request${costQualityIssues === 1 ? "" : "s"} lack a known price or Instance attribution.`,
        nextStep: { label: "Fix attribution", href: `/${projectId}/cost` },
      });
    }

    for (const memory of memories) {
      attention.push({
        code: `MEMORY_INDEX_FAILED:${memory.id}`,
        source: "memory",
        severity: memory.status === "deletion_failed" ? "critical" : "warning",
        title: `${memory.displayName} memory needs recovery`,
        impact: { kind: "Memory", id: memory.id, label: memory.displayName },
        owner: "Agent Platform",
        openedAt: memory.updatedAt.toISOString(),
        reason: memory.lastErrorSummary || "The Memory provider reported a degraded indexing or delivery state.",
        nextStep: {
          label: "Review memory recovery",
          href: `/${projectId}/memory/${encodeURIComponent(memory.id)}`,
        },
      });
    }
    const latestVectorJobByDocument = new Map<string, (typeof vectorJobs)[number]>();
    for (const job of vectorJobs) {
      const key = `${job.databaseId}:${job.documentId}`;
      if (!latestVectorJobByDocument.has(key)) latestVectorJobByDocument.set(key, job);
    }
    for (const job of [...latestVectorJobByDocument.values()].filter((item) => item.status === "FAILED")) {
      attention.push({
        code: `MEMORY_INDEX_JOB_FAILED:${job.id}`,
        source: "memory",
        severity: "warning",
        title: "Vector index update failed",
        impact: { kind: "Vector database", id: job.databaseId, label: job.documentId },
        owner: "Agent Platform",
        openedAt: job.updatedAt.toISOString(),
        reason: job.error || "The most recent document ingestion job did not complete its index update.",
        nextStep: {
          label: "Review indexing job",
          href: `/${projectId}/vector-databases/${encodeURIComponent(job.databaseId)}`,
        },
      });
    }
    for (const policyRow of policies) {
      const policy = policyRow.payload as Record<string, unknown>;
      if (typeof policy.lastReconciliationError !== "string" || !policy.lastReconciliationError) continue;
      const name = typeof policy.name === "string" ? policy.name : policyRow.id;
      attention.push({
        code: `POLICY_RECONCILIATION_FAILED:${policyRow.id}`,
        source: "policy",
        severity: "critical",
        title: `${name} policy is not reconciled`,
        impact: { kind: "Access Policy", id: policyRow.id, label: name },
        owner: "Project Admin",
        openedAt: issueOpenedAt(
          typeof policy.lastReconciledAt === "string" ? policy.lastReconciledAt : policyRow.updatedAt,
          now,
        ),
        reason: policy.lastReconciliationError,
        nextStep: {
          label: "Reconcile policy",
          href: `/${projectId}/access-policies/${encodeURIComponent(policyRow.id)}`,
        },
      });
    }

    attention.sort((left, right) =>
      (left.severity === right.severity ? 0 : left.severity === "critical" ? -1 : 1)
      || new Date(left.openedAt).getTime() - new Date(right.openedAt).getTime()
      || left.title.localeCompare(right.title),
    );

    const runtimeObservedAt = observedInstances
      .map((instance) => instance.updatedAt)
      .sort()
      .at(-1) ?? null;
    return {
      projectId: this.store.projectId,
      range,
      timezone,
      generatedAt: now.toISOString(),
      freshness: {
        costLastSyncedAt: checkpoint?.lastSyncAt?.toISOString() ?? null,
        costSyncLagSeconds: checkpoint?.syncLagSeconds ?? null,
        runtimeObservedAt,
      },
      kpis: {
        runs: currentRuns.length,
        runsChangePercent: percentChange(currentRuns.length, previousRuns.length),
        successRate: currentSuccess,
        successRateChangePoints: currentSuccess === null || previousSuccess === null
          ? null
          : (currentSuccess - previousSuccess) * 100,
        readyInstances: runtime.ready,
        totalInstances: runtime.total,
        spendUsd: currentSpend,
        spendChangePercent: percentChange(currentSpend, previousSpend),
      },
      usage: [...points.values()],
      budget: {
        configured: budgetLimit !== null && budgetDuration != null,
        duration: budgetDuration ?? null,
        limitUsd: budgetLimit,
        usedUsd: budgetUsed,
        usedPercent: budgetPercent,
        remainingUsd: budgetLimit === null ? null : Math.max(0, budgetLimit - budgetUsed),
        forecastUsd: budgetForecast,
        periodStartedAt: budgetWindow?.startedAt.toISOString() ?? null,
        resetsAt: budgetWindow?.resetsAt.toISOString() ?? null,
      },
      runtime: { available: liveInstances.available, ...runtime },
      workload,
      modelAssignment,
      agentActivity,
      attention,
      resources: {
        runtimeCount: observedInstances.length,
        publishedSkillCount: skills.filter((skill) => skill.status === "PUBLISHED").length,
        memoryEnabledInstanceCount: observedInstances.filter((instance) => Boolean(instance.memory)).length,
        activePolicyCount: policies.filter((policy) =>
          policy.payload
          && typeof policy.payload === "object"
          && !Array.isArray(policy.payload)
          && (policy.payload as Record<string, unknown>).status === "ACTIVE",
        ).length,
      },
    };
  }
}
