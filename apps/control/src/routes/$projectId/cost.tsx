import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { CostBreakdownItem, CostFilters, CostGroupBy, CostQueryParams } from "@tali/contracts";
import { z } from "zod";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { CostBreakdownTable } from "@/features/model-cost/cost-breakdown-table";
import {
  useCostActivity,
  useCostBreakdown,
  useCostInsights,
  useCostRanking,
  useCostSummary,
  useCostTrend,
} from "@/features/model-cost/cost-data";
import { CostFilterBar } from "@/features/model-cost/cost-filter-bar";
import { CostGroupBySelector } from "@/features/model-cost/cost-group-by-selector";
import { CostInsights } from "@/features/model-cost/cost-insights";
import { CostSummaryStrip } from "@/features/model-cost/cost-summary-strip";
import { CostErrorState, CostSkeleton } from "@/features/model-cost/cost-states";
import { DailySpendBreakdown } from "@/features/model-cost/daily-spend-breakdown";
import { SpendActivityHeatmap } from "@/features/model-cost/spend-activity-heatmap";
import { TopSpendRanking } from "@/features/model-cost/top-spend-ranking";
import {
  parseCostFilters,
  resolveCostRange,
  serializeCostFilters,
  type CostRange,
} from "@/features/model-cost/cost-utils";
import { usePlatformTimezone } from "@/hooks/use-platform-timezone";

const groupSearch = z.preprocess(
  (value) => typeof value === "string" && ["instance", "model_endpoint", "provider_account", "virtual_key"].includes(value) ? value : undefined,
  z.enum(["instance", "model_endpoint", "provider_account", "virtual_key"]).optional(),
);
const rangeSearch = z.preprocess(
  (value) => typeof value === "string" && ["7d", "30d", "90d", "current_month", "previous_month", "custom"].includes(value) ? value : undefined,
  z.enum(["7d", "30d", "90d", "current_month", "previous_month", "custom"]).optional(),
);

export const Route = createFileRoute("/$projectId/cost")({
  validateSearch: z.object({
    groupBy: groupSearch,
    range: rangeSearch,
    filters: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  component: ModelCostPage,
});

const rangeLabels: Record<CostRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  current_month: "Current month",
  previous_month: "Previous month",
  custom: "Custom range",
};

function CostRangeSelector({
  value,
  from,
  to,
  onRangeChange,
  onCustomApply,
}: {
  value: CostRange;
  from: string;
  to: string;
  onRangeChange: (range: CostRange) => void;
  onCustomApply: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  useEffect(() => { setDraftFrom(from); setDraftTo(to); }, [from, to]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Select
            value={value}
            onValueChange={(next) => {
              const range = next as CostRange;
              onRangeChange(range);
              setOpen(range === "custom");
            }}
          >
            <SelectTrigger className="h-9 w-48 bg-card pl-9" aria-label="Cost time range"><SelectValue /></SelectTrigger>
            <SelectContent align="end">
              {(Object.entries(rangeLabels) as Array<[CostRange, string]>).map(([range, label]) => (
                <SelectItem key={range} value={range}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-80 p-4">
        <p className="text-sm font-medium">Custom range</p>
        <p className="mt-1 text-xs text-muted-foreground">Dates are interpreted in your current timezone.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-xs font-medium">Start date<Input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} /></label>
          <label className="grid gap-1.5 text-xs font-medium">End date<Input type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} /></label>
        </div>
        <Button className="mt-4 w-full" disabled={!draftFrom || !draftTo} onClick={() => { onCustomApply(draftFrom, draftTo); setOpen(false); }}>Apply range</Button>
      </PopoverContent>
    </Popover>
  );
}

function ModelCostPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const groupBy = (search.groupBy ?? "instance") as CostGroupBy;
  const range = (search.range ?? "30d") as CostRange;
  const filters = useMemo(() => parseCostFilters(search.filters), [search.filters]);
  const dates = useMemo(
    () => resolveCostRange(range, new Date(), {
      ...(search.from ? { from: search.from } : {}),
      ...(search.to ? { to: search.to } : {}),
    }),
    [range, search.from, search.to],
  );
  const timezone = usePlatformTimezone();
  const params = useMemo<CostQueryParams>(() => ({
    startTime: dates.from,
    endTime: dates.to,
    groupBy,
    filters,
    timezone,
  }), [dates.from, dates.to, filters, groupBy, timezone]);

  const summary = useCostSummary(params);
  const activity = useCostActivity(params);
  const insights = useCostInsights(params);
  const ranking = useCostRanking(params);
  const trend = useCostTrend(params);
  const breakdown = useCostBreakdown(params);
  const queries = [summary, activity, insights, ranking, trend, breakdown];
  const isPending = queries.some((query) => query.isPending);
  const isFetching = queries.some((query) => query.isFetching);
  const error = queries.find((query) => query.error)?.error;

  useEffect(() => {
    if (search.groupBy && search.range) return;
    void navigate({
      to: "/$projectId/cost",
      params: { projectId },
      search: (previous) => ({ ...previous, groupBy, range }),
      replace: true,
    });
  }, [groupBy, navigate, range, search.groupBy, search.range]);

  const setSearch = (patch: Partial<typeof search>) => {
    void navigate({
      to: "/$projectId/cost",
      params: { projectId },
      search: (previous) => ({ ...previous, ...patch }),
      replace: true,
    });
  };
  const setFilters = (next: CostFilters) => setSearch({ filters: serializeCostFilters(next) });
  const handleRankingSelect = (item: CostBreakdownItem) =>
    setFilters({ ...filters, [groupBy]: [item.id] });
  const selectedRankingId = filters[groupBy]?.length === 1 ? filters[groupBy]?.[0] : undefined;
  const handleRowClick = (item: CostBreakdownItem) => {
    if (groupBy === "instance") {
      void navigate({ to: "/$projectId/instances/$instanceId", params: { projectId, instanceId: item.id } });
      return;
    }
    if (groupBy === "virtual_key" && item.boundInstanceId && item.boundInstanceId !== "unassigned") {
      void navigate({ to: "/$projectId/instances/$instanceId", params: { projectId, instanceId: item.boundInstanceId } });
      return;
    }
    void navigate({
      to: "/$projectId/setting",
      params: { projectId },
      search: { section: "models" },
    });
  };
  const retry = () => { queries.forEach((query) => void query.refetch()); };
  const priorDays = Math.max(1, Math.round((new Date(`${dates.to}T00:00:00Z`).getTime() - new Date(`${dates.from}T00:00:00Z`).getTime()) / 86_400_000) + 1);

  return (
    <div className="space-y-3 font-sans">
      <header className="pb-1">
        <h1 className="font-display text-[1.625rem] font-light leading-tight tracking-[0.005em]">Model cost</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">
          LiteLLM spend is attributed to the dedicated virtual keys created for each Instance.
          <br className="hidden sm:block" />
          Analyze spend by grouping it across different dimensions.
        </p>
      </header>

      {isPending ? <CostSkeleton /> : error ? (
        <>
          <div className="flex flex-col gap-3 py-1 lg:flex-row lg:items-center lg:justify-between">
            <CostGroupBySelector value={groupBy} onValueChange={(value) => setSearch({ groupBy: value })} />
            <CostRangeSelector
              value={range}
              from={dates.from}
              to={dates.to}
              onRangeChange={(next) => {
                if (next === "custom") setSearch({ range: next, from: dates.from, to: dates.to });
                else setSearch({ range: next, from: undefined, to: undefined });
              }}
              onCustomApply={(from, to) => setSearch({ range: "custom", from, to })}
            />
          </div>
          <CostErrorState message={error.message} onRetry={retry} />
        </>
      ) : summary.data && activity.data && insights.data && ranking.data && trend.data && breakdown.data ? (
        <div className="space-y-3">
          <CostSummaryStrip summary={summary.data} priorLabel={`${priorDays} days`} />
          <div className="flex flex-col gap-3 py-1 lg:flex-row lg:items-center lg:justify-between">
            <CostGroupBySelector value={groupBy} onValueChange={(value) => setSearch({ groupBy: value })} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isFetching ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
              <CostFilterBar filters={filters} options={breakdown.data.filterOptions} onChange={setFilters} />
              <CostRangeSelector
                value={range}
                from={dates.from}
                to={dates.to}
                onRangeChange={(next) => {
                  if (next === "custom") setSearch({ range: next, from: dates.from, to: dates.to });
                  else setSearch({ range: next, from: undefined, to: undefined });
                }}
                onCustomApply={(from, to) => setSearch({ range: "custom", from, to })}
              />
            </div>
          </div>
          <SpendActivityHeatmap activity={activity.data} from={dates.from} to={dates.to} groupBy={groupBy} />
          <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <CostInsights insights={insights.data} />
            <TopSpendRanking groupBy={groupBy} items={ranking.data} selectedId={selectedRankingId} onSelect={handleRankingSelect} />
          </div>
          <DailySpendBreakdown groupBy={groupBy} trend={trend.data} />
          <CostBreakdownTable groupBy={groupBy} items={breakdown.data.items} onRowClick={handleRowClick} />
        </div>
      ) : null}
    </div>
  );
}
