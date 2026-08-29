import { useQuery } from "@tanstack/react-query";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import type {
  CostBreakdownItem,
  CostComparison,
  CostInsight,
  CostQueryParams,
  CostSummary,
  CostTrendPoint,
  ModelCostBreakdownItem,
  ModelCostInsightsResponse,
  ModelCostObjectSpend,
  ModelCostSummaryResponse,
  ModelCostTrendResponse,
} from "@tali/contracts";
import { api } from "@/lib/api";

function comparison(current: number, changePercent: number | undefined): CostComparison {
  if (changePercent === undefined) return { current, previous: 0 };
  const divisor = 1 + changePercent / 100;
  return {
    current,
    previous: divisor > 0 ? current / divisor : 0,
    changePercent,
  };
}

function identity(item: ModelCostObjectSpend | undefined): CostBreakdownItem | undefined {
  if (!item) return undefined;
  return {
    id: item.id,
    label: item.name,
    detail: "",
    spend: item.spendUsd,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    share: item.share,
  };
}

function summary(response: ModelCostSummaryResponse): CostSummary {
  return {
    totalSpend: comparison(response.totalSpendUsd, response.comparison.spendPercent),
    totalTokens: comparison(response.totalTokens, response.comparison.tokensPercent),
    requests: comparison(response.requests, response.comparison.requestsPercent),
    ...(response.highestCostInstance
      ? { highestCostInstance: identity(response.highestCostInstance)! }
      : {}),
    ...(response.highestCostModel
      ? { highestCostModel: identity(response.highestCostModel)! }
      : {}),
  };
}

function breakdownItem(item: ModelCostBreakdownItem): CostBreakdownItem {
  return {
    id: item.id,
    label: item.name,
    detail: item.detail,
    spend: item.spendUsd,
    requests: item.requests,
    inputTokens: item.promptTokens,
    outputTokens: item.completionTokens,
    share: item.share,
    ...(item.lastActive ? { lastActive: item.lastActive } : {}),
    ...(item.provider ? { provider: item.provider } : {}),
    ...(item.providerAccount ? { providerAccount: item.providerAccount } : {}),
    ...(item.modelsUsed !== undefined ? { modelsUsed: item.modelsUsed } : {}),
    ...(item.boundInstance ? { boundInstance: item.boundInstance } : {}),
    ...(item.boundInstanceId ? { boundInstanceId: item.boundInstanceId } : {}),
    ...(item.user ? { user: item.user } : {}),
    ...(item.team ? { team: item.team } : {}),
  };
}

function insightRows(response: ModelCostInsightsResponse, params: CostQueryParams): CostInsight[] {
  const group = params.groupBy === "instance"
    ? ["Active Instances", response.activeInstances]
    : params.groupBy === "model_endpoint"
      ? ["Active model endpoints", response.activeModelEndpoints]
      : params.groupBy === "provider_account"
        ? ["Active Providers", response.activeProviderAccounts]
        : ["Active virtual keys", response.activeVirtualKeys];
  return [
    {
      id: "highest_spend_day",
      label: "Highest spend day",
      ...(response.highestSpendDay ? { subject: response.highestSpendDay.date } : {}),
      value: response.highestSpendDay?.spendUsd ?? 0,
      valueKind: "currency",
    },
    {
      id: "average_daily_spend",
      label: "Average daily spend",
      value: response.averageDailySpendUsd,
      valueKind: "currency",
    },
    {
      id: "active_group",
      label: String(group[0]),
      value: Number(group[1]),
      valueKind: "count",
    },
    {
      id: "active_model_endpoints",
      label: "Active model endpoints",
      value: response.activeModelEndpoints,
      valueKind: "count",
    },
    {
      id: "most_expensive_provider",
      label: "Most expensive provider",
      ...(response.mostExpensiveProvider ? { subject: response.mostExpensiveProvider.provider } : {}),
      value: response.mostExpensiveProvider?.spendUsd ?? 0,
      valueKind: "currency",
    },
    {
      id: "peak_tokens_day",
      label: "Peak tokens day",
      ...(response.peakTokensDay ? { subject: response.peakTokensDay.date } : {}),
      value: response.peakTokensDay?.tokens ?? 0,
      valueKind: "tokens",
    },
  ];
}

function trend(response: ModelCostTrendResponse): CostTrendPoint[] {
  return response.dates.map((date) => ({
    date,
    series: response.series.map((series) => {
      const item = series.items.find((point) => point.date === date);
      return {
        id: series.id,
        label: series.name,
        spend: item?.spendUsd ?? 0,
        tokens: item?.tokens ?? 0,
        requests: item?.requests ?? 0,
      };
    }),
  }));
}

export function useCostSummary(params: CostQueryParams) {
  const scope = useProjectQueryScope();
  return useQuery({
    queryKey: scope.key("cost-summary", params),
    queryFn: () => api.getCostSummary(params),
    select: summary,
    retry: false,
  });
}

export function useCostActivity(params: CostQueryParams) {
  const scope = useProjectQueryScope();
  return useQuery({
    queryKey: scope.key("cost-activity", params, "daily"),
    queryFn: () => api.getCostActivity(params, "daily"),
    select: (response) => response.items.map((item) => ({
      date: item.date,
      spend: item.spendUsd,
      tokens: item.tokens,
      requests: item.requests,
      active: item.activeObjects,
    })),
    retry: false,
  });
}

export function useCostInsights(params: CostQueryParams) {
  const scope = useProjectQueryScope();
  return useQuery({
    queryKey: scope.key("cost-insights", params),
    queryFn: () => api.getCostInsights(params),
    select: (response) => insightRows(response, params),
    retry: false,
  });
}

export function useCostRanking(params: CostQueryParams) {
  const scope = useProjectQueryScope();
  return useQuery({
    queryKey: scope.key("cost-ranking", params, 5),
    queryFn: () => api.getCostRanking(params, 5),
    select: (response) => response.items.map((item): CostBreakdownItem => ({
      id: item.id,
      label: item.name,
      detail: "",
      spend: item.spendUsd,
      requests: item.requests,
      inputTokens: item.tokens,
      outputTokens: 0,
      share: item.share,
    })),
    retry: false,
  });
}

export function useCostTrend(params: CostQueryParams) {
  const scope = useProjectQueryScope();
  return useQuery({
    queryKey: scope.key("cost-trend", params, "day", 5),
    queryFn: () => api.getCostTrend(params, "day", 5),
    select: trend,
    retry: false,
  });
}

export function useCostBreakdown(params: CostQueryParams) {
  const scope = useProjectQueryScope();
  return useQuery({
    queryKey: scope.key("cost-breakdown", params, 1, 200),
    queryFn: () => api.getCostBreakdown(params),
    select: (response) => ({
      items: response.items.map(breakdownItem),
      filterOptions: response.filterOptions,
      currency: response.currency,
      total: response.total,
    }),
    retry: false,
  });
}
