import { lazy, Suspense, useMemo, useState } from "react";
import { ClientOnly, Link } from "@tanstack/react-router";
import {
  type ProjectOverviewAttentionItem,
  type ProjectOverviewRange,
  type ProjectOverviewResponse,
} from "@tali/contracts";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  CircleAlert,
  Clock3,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import {
  SurfacePanel,
  SurfacePanelContent,
  SurfacePanelDescription,
  SurfacePanelFooter,
  SurfacePanelHeader,
  SurfacePanelTitle,
} from "@/components/layout/surface-panel";
import { MetricStrip, MetricStripItem } from "@/components/shared/metric-strip";
import { StatusBadge, StatusIcon, type StatusTone } from "@/components/shared/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { UsageMetric } from "./usage-chart";

const UsageChart = lazy(() =>
  import("./usage-chart").then((module) => ({ default: module.UsageChart })),
);

const rangeLabels: Record<ProjectOverviewRange, string> = {
  "24h": "Last 24h",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

const metricLabels: Record<UsageMetric, string> = {
  tokens: "Tokens",
  runs: "Runs",
  cost: "Cost",
};

const BUDGET_WARNING_THRESHOLD_PERCENT = 80;

function number(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function trendText(value: number | null, unit: "percent" | "points" = "percent") {
  if (value === null) return "No comparable previous period";
  if (value === 0) return "No change vs previous period";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}${unit === "percent" ? "%" : " pts"} vs previous period`;
}

function Trend({
  value,
  unit,
}: {
  value: number | null;
  unit?: "percent" | "points";
}) {
  const Icon = value !== null && value < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      {value !== null && value !== 0 ? <Icon className="size-3.5" aria-hidden /> : null}
      {trendText(value, unit)}
    </span>
  );
}

export function ProjectOverviewHeader({
  generatedAt,
  isRefreshing,
  onRefresh,
  projectName,
  range,
  onRangeChange,
}: {
  generatedAt?: string;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  projectName: string | undefined;
  range: ProjectOverviewRange;
  onRangeChange: (range: ProjectOverviewRange) => void;
}) {
  return (
    <PageHeader
      title="Project Overview"
      description={
        <>
          Operational risk, usage, runtime health, and budget for{" "}
          <span className="font-medium text-foreground">{projectName ?? "this Project"}</span>.
        </>
      }
      actions={
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" aria-hidden />
            <span>
              {isRefreshing
                ? "Refreshing overview…"
                : generatedAt
                  ? `Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(generatedAt))}`
                  : "Auto-refresh every 30 seconds"}
            </span>
            {onRefresh ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-11"
                onClick={onRefresh}
                disabled={isRefreshing}
                aria-label="Refresh Project overview"
              >
                <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin motion-reduce:animate-none")} />
              </Button>
            ) : null}
          </div>
          <ToggleGroup
            aria-label="Overview time range"
            type="single"
            variant="outline"
            spacing={0}
            size="lg"
            value={range}
            onValueChange={(value) => {
              if (value) onRangeChange(value as ProjectOverviewRange);
            }}
          >
            {(Object.keys(rangeLabels) as ProjectOverviewRange[]).map((value) => (
              <ToggleGroupItem key={value} value={value} className="min-h-11">
                {rangeLabels[value]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      }
    />
  );
}

export function getRuntimeSummary(
  data: ProjectOverviewResponse["runtime"],
): {
  description: string;
  label: string;
  tone: StatusTone;
} {
  if (data.failed > 0) {
    return {
      description: `${data.failed} Instance${data.failed === 1 ? "" : "s"} failed and require diagnosis.`,
      label: "Needs attention",
      tone: "danger",
    };
  }

  if (data.provisioning > 0 || data.destroying > 0) {
    const changing = data.provisioning + data.destroying;
    return {
      description: `${changing} Instance${changing === 1 ? " is" : "s are"} changing lifecycle state.`,
      label: "Changing",
      tone: "warning",
    };
  }

  if (data.total > 0 && data.ready === data.total) {
    return {
      description: "Every persisted Instance is ready; no runtime failure is active.",
      label: "Healthy",
      tone: "success",
    };
  }

  return {
    description: "Create a Supervisor or publish an Agent Version to establish runtime health signals.",
    label: "No runtime",
    tone: "neutral",
  };
}

export function OverviewKpiGrid({ data }: { data: ProjectOverviewResponse }) {
  const runtimeSummary = getRuntimeSummary(data.runtime);
  return (
    <MetricStrip aria-label="Project overview metrics">
      <MetricStripItem
        label="Runs"
        value={number(data.kpis.runs)}
        context={<Trend value={data.kpis.runsChangePercent} />}
      />
      <MetricStripItem
        label="Success rate"
        value={data.kpis.successRate === null
          ? "—"
          : `${(data.kpis.successRate * 100).toFixed(1)}%`}
        context={data.kpis.successRate === null
          ? "No completed Runs in this period"
          : <Trend value={data.kpis.successRateChangePoints} unit="points" />}
      />
      <MetricStripItem
        label="Runtime health"
        value={`${data.kpis.readyInstances} / ${data.kpis.totalInstances}`}
        context={(
          <span className="flex items-center gap-2">
            <StatusBadge label={runtimeSummary.label} tone={runtimeSummary.tone} />
          </span>
        )}
      />
      <MetricStripItem
        label="Spend / budget"
        value={money(data.kpis.spendUsd)}
        context={data.budget.configured && data.budget.usedPercent !== null
          ? `${(data.budget.usedPercent * 100).toFixed(1)}% of current budget`
          : <Trend value={data.kpis.spendChangePercent} />}
      />
    </MetricStrip>
  );
}

export function UsageChartCard({ data }: { data: ProjectOverviewResponse }) {
  const [metric, setMetric] = useState<UsageMetric>("tokens");
  return (
    <SurfacePanel>
      <SurfacePanelHeader className="flex-col items-stretch sm:flex-row sm:items-center">
        <div>
          <SurfacePanelTitle>Usage trend</SurfacePanelTitle>
          <SurfacePanelDescription>
            Attributed tokens, Agent Runs, and spend over the selected period.
          </SurfacePanelDescription>
        </div>
        <ToggleGroup
          aria-label="Usage metric"
          type="single"
          variant="outline"
          spacing={0}
          value={metric}
          onValueChange={(value) => {
            if (value) setMetric(value as UsageMetric);
          }}
        >
          {(Object.keys(metricLabels) as UsageMetric[]).map((value) => (
            <ToggleGroupItem key={value} value={value} className="min-h-11">
              {metricLabels[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SurfacePanelHeader>
      <SurfacePanelContent className="px-2 pb-2 pt-1 sm:px-4">
        <ClientOnly fallback={<UsageChartSkeleton />}>
          <Suspense fallback={<UsageChartSkeleton />}>
            <UsageChart metric={metric} points={data.usage} range={data.range} />
          </Suspense>
        </ClientOnly>
      </SurfacePanelContent>
    </SurfacePanel>
  );
}

function UsageChartSkeleton() {
  return (
    <div className="relative h-[300px] overflow-hidden sm:h-[330px]" aria-label="Loading Usage chart" role="status">
      <div className="absolute inset-x-14 bottom-10 top-5 grid grid-rows-4">
        {Array.from({ length: 5 }, (_, index) => <span key={index} className="border-b" />)}
      </div>
      <Skeleton className="absolute inset-x-14 bottom-10 h-1/3" />
    </div>
  );
}

function remainingTime(resetsAt: string | null, generatedAt: string): string | null {
  if (!resetsAt) return null;
  const milliseconds = Math.max(0, new Date(resetsAt).getTime() - new Date(generatedAt).getTime());
  const hours = Math.ceil(milliseconds / (60 * 60 * 1_000));
  return hours > 48 ? `${Math.ceil(hours / 24)} days remaining` : `${hours} hours remaining`;
}

export function BudgetCard({
  budget,
  generatedAt,
  projectId,
}: {
  budget: ProjectOverviewResponse["budget"];
  generatedAt: string;
  projectId: string;
}) {
  if (!budget.configured || budget.limitUsd === null) {
    return (
      <SurfacePanel className="flex h-full flex-col">
        <SurfacePanelHeader>
          <SurfacePanelTitle>Budget forecast</SurfacePanelTitle>
        </SurfacePanelHeader>
        <SurfacePanelContent className="flex flex-1 flex-col justify-center py-8">
          <p className="text-sm font-medium">No budget configured</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            Spend is still tracked. Set a budget to add utilization and forecast signals.
          </p>
        </SurfacePanelContent>
        <SurfacePanelFooter className="justify-end">
          <Button asChild variant="ghost" size="sm">
            <Link to="/$projectId/setting" params={{ projectId }} search={{ section: "quota" }}>
              Configure budget <ArrowRight />
            </Link>
          </Button>
        </SurfacePanelFooter>
      </SurfacePanel>
    );
  }
  const usedPercent = (budget.usedPercent ?? 0) * 100;
  const remaining = remainingTime(budget.resetsAt, generatedAt);
  const forecastOver = budget.forecastUsd !== null && budget.forecastUsd > budget.limitUsd;
  const budgetWarning = usedPercent >= BUDGET_WARNING_THRESHOLD_PERCENT;
  return (
    <SurfacePanel className="flex h-full flex-col">
      <SurfacePanelHeader>
        <div className="flex w-full items-start justify-between gap-3">
          <div>
            <SurfacePanelTitle>Budget forecast</SurfacePanelTitle>
            <SurfacePanelDescription>
              {budget.duration === "30d" ? "30-day" : budget.duration} budget window
            </SurfacePanelDescription>
          </div>
          <Badge variant={usedPercent >= 100 ? "destructive" : "outline"}>
            {usedPercent.toFixed(1)}%
          </Badge>
        </div>
      </SurfacePanelHeader>
      <SurfacePanelContent className="flex flex-1 flex-col justify-center py-6">
        <p className="font-sans text-3xl font-medium tabular-nums tracking-tight">
          {money(budget.usedUsd)} <span className="text-base text-muted-foreground">/ {money(budget.limitUsd)}</span>
        </p>
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-3 text-[11px] leading-4">
            <span className="text-muted-foreground">Budget used</span>
            <span className="font-medium text-warning-foreground">
              Warning at {BUDGET_WARNING_THRESHOLD_PERCENT}%
            </span>
          </div>
          <div className="relative">
            <Progress
              aria-label={`${usedPercent.toFixed(1)} percent of budget used; warning threshold at ${BUDGET_WARNING_THRESHOLD_PERCENT} percent`}
              value={Math.min(100, Math.max(0, usedPercent))}
              className={cn(
                "h-2",
                budgetWarning && "[&_[data-slot=progress-indicator]]:bg-warning",
                usedPercent >= 100 && "[&_[data-slot=progress-indicator]]:bg-destructive",
              )}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-1 -top-1 left-[80%] w-0.5 -translate-x-1/2 rounded-full bg-warning-foreground ring-2 ring-[var(--surface-panel)]"
            />
          </div>
        </div>
        <dl className="mt-6 divide-y border-y text-xs">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <dt className="text-muted-foreground">Forecast</dt>
            <dd className={cn("font-medium tabular-nums", forecastOver && "text-destructive")}>
              {budget.forecastUsd === null ? "Awaiting cost sync" : money(budget.forecastUsd)}
            </dd>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <dt className="text-muted-foreground">Remaining</dt>
            <dd className="font-medium tabular-nums">{money(budget.remainingUsd ?? 0)}</dd>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <dt className="text-muted-foreground">Window</dt>
            <dd className="font-medium">{remaining ?? "Reset unavailable"}</dd>
          </div>
        </dl>
      </SurfacePanelContent>
      <SurfacePanelFooter className="justify-end">
        <Button asChild variant="ghost" size="sm">
          <Link to="/$projectId/cost" params={{ projectId }}>
            Review spend <ArrowRight />
          </Link>
        </Button>
      </SurfacePanelFooter>
    </SurfacePanel>
  );
}

const runtimeStates = [
  { key: "ready", label: "Ready", color: "bg-success" },
  { key: "provisioning", label: "Provisioning", color: "bg-warning" },
  { key: "failed", label: "Failed", color: "bg-destructive" },
  { key: "destroying", label: "Destroying", color: "bg-muted-foreground/45" },
] as const;

export function RuntimeHealthCard({
  data,
  projectId,
}: {
  data: ProjectOverviewResponse["runtime"];
  projectId: string;
}) {
  const summary = getRuntimeSummary(data);
  return (
    <SurfacePanel>
      <SurfacePanelHeader>
        <div className="flex w-full items-start justify-between gap-3">
          <div>
            <SurfacePanelTitle>Runtime health</SurfacePanelTitle>
            <SurfacePanelDescription>Current Instance lifecycle state.</SurfacePanelDescription>
          </div>
          <StatusBadge
            tone={summary.tone}
            label={summary.label}
          />
        </div>
      </SurfacePanelHeader>
      <SurfacePanelContent>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-sans text-3xl font-medium tabular-nums">{data.ready}</p>
            <p className="mt-1 text-xs text-muted-foreground">Ready of {data.total} total</p>
          </div>
          {data.failed > 0 ? (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <CircleAlert className="size-3.5" /> {data.failed} failed
            </span>
          ) : null}
        </div>
        <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          {data.total > 0 ? runtimeStates.map((state) => (
            <span
              key={state.key}
              className={state.color}
              style={{ width: `${(data[state.key] / data.total) * 100}%` }}
            />
          )) : null}
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3">
          {runtimeStates.map((state) => (
            <div key={state.key} className="flex items-center justify-between gap-3 border-b pb-2 text-xs">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <span className={cn("size-2 rounded-full", state.color)} /> {state.label}
              </dt>
              <dd className="font-medium tabular-nums">{data[state.key]}</dd>
            </div>
          ))}
        </dl>
      </SurfacePanelContent>
      <SurfacePanelFooter className="justify-end">
        <Button asChild variant="ghost" size="sm">
          <Link to="/$projectId/instances" params={{ projectId }}>
            View runtime <ArrowRight />
          </Link>
        </Button>
      </SurfacePanelFooter>
    </SurfacePanel>
  );
}

const overviewSeriesColors = [
  "var(--overview-series-1)",
  "var(--overview-series-2)",
  "var(--overview-series-3)",
  "var(--overview-series-4)",
  "var(--overview-series-5)",
] as const;

export function ModelAssignmentCard({
  assignment,
  projectId,
}: {
  assignment: ProjectOverviewResponse["modelAssignment"];
  projectId: string;
}) {
  const circumference = 2 * Math.PI * 48;
  const arcs = useMemo(() => {
    let offset = 0;
    return assignment.segments.map((segment, index) => {
      const arc = { segment, index, offset };
      offset += segment.percentage;
      return arc;
    });
  }, [assignment.segments]);

  return (
    <SurfacePanel>
      <SurfacePanelHeader>
        <div>
          <SurfacePanelTitle>Model assignment distribution</SurfacePanelTitle>
          <SurfacePanelDescription>
          One count per active Agent&apos;s default route.
          </SurfacePanelDescription>
        </div>
      </SurfacePanelHeader>
      <SurfacePanelContent className="flex min-h-64 flex-col justify-center">
        {assignment.totalAgents > 0 ? (
          <div className="grid items-center gap-6 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <div className="relative mx-auto size-44">
              <svg viewBox="0 0 128 128" className="size-full -rotate-90" aria-hidden>
                <circle cx="64" cy="64" r="48" fill="none" stroke="var(--muted)" strokeWidth="16" />
                {arcs.map(({ index, offset, segment }) => (
                  <circle
                    key={segment.key}
                    cx="64"
                    cy="64"
                    r="48"
                    fill="none"
                    stroke={overviewSeriesColors[index % overviewSeriesColors.length]}
                    strokeDasharray={`${segment.percentage * circumference} ${circumference}`}
                    strokeDashoffset={-offset * circumference}
                    strokeWidth="16"
                  />
                ))}
              </svg>
              <div className="absolute inset-0 grid place-content-center text-center">
                <strong className="font-sans text-3xl font-medium tabular-nums">
                  {assignment.totalAgents}
                </strong>
                <span className="text-xs text-muted-foreground">active Agents</span>
              </div>
            </div>
            <ul className="divide-y">
              {assignment.segments.map((segment, index) => (
                <li key={segment.key} className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-xs">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: overviewSeriesColors[index % overviewSeriesColors.length] }}
                    aria-hidden
                  />
                  <span className="truncate font-medium">{segment.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {segment.agents} · {(segment.percentage * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
            <ul className="sr-only">
              {assignment.segments.map((segment) => (
                <li key={segment.key}>
                  {segment.label}: {segment.agents} Agent{segment.agents === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm font-medium">No active Agents</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Model assignment will appear after an Agent is configured.
            </p>
          </div>
        )}
      </SurfacePanelContent>
      <SurfacePanelFooter>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Resolved-model calls remain in Cost and Usage.
          </p>
          <Button asChild variant="ghost" size="sm" className="shrink-0">
            <Link to="/$projectId/setting" params={{ projectId }} search={{ section: "routing" }}>
              Manage routing <ArrowRight />
            </Link>
          </Button>
        </div>
      </SurfacePanelFooter>
    </SurfacePanel>
  );
}

export function AgentActivityRanking({
  activity,
  projectId,
}: {
  activity: ProjectOverviewResponse["agentActivity"];
  projectId: string;
}) {
  const maximumRuns = Math.max(0, ...activity.map((item) => item.runs));
  return (
    <SurfacePanel>
      <SurfacePanelHeader>
        <div className="flex w-full items-start justify-between gap-4">
          <div>
            <SurfacePanelTitle>Agent activity distribution</SurfacePanelTitle>
            <SurfacePanelDescription>
              Actual use in the selected period, including configured Agents with no Runs.
            </SurfacePanelDescription>
          </div>
          <Button asChild variant="ghost" size="sm" className="shrink-0">
            <Link to="/$projectId/traces" params={{ projectId }}>
              View Runs <ArrowRight />
            </Link>
          </Button>
        </div>
      </SurfacePanelHeader>
      {activity.length ? (
        <SurfacePanelContent className="py-0">
          <ol aria-label="Agent activity ranked by Runs" className="divide-y divide-[var(--surface-panel-border)]">
            {activity.map((item, index) => (
              <li key={item.agentId} className="grid gap-3 py-4 lg:grid-cols-[1.2rem_minmax(12rem,1fr)_minmax(20rem,2fr)_auto] lg:items-center">
                <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.agentName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.activeUsers === null ? "Users unavailable" : `${number(item.activeUsers)} active users`}
                    {" · "}
                    {item.successRate === null ? "Success unavailable" : `${(item.successRate * 100).toFixed(1)}% success`}
                  </p>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span
                      className="block h-full rounded-full bg-[var(--overview-series-1)]"
                      style={{ width: `${maximumRuns ? (item.runs / maximumRuns) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs font-medium tabular-nums">
                    {number(item.runs)} Runs
                  </span>
                </div>
                <span className="text-right text-xs tabular-nums text-muted-foreground">{money(item.costUsd)}</span>
              </li>
            ))}
          </ol>
        </SurfacePanelContent>
      ) : (
        <SurfacePanelContent className="flex min-h-28 items-center justify-center py-6 text-center">
          <div>
            <p className="text-sm font-medium">No Agents configured</p>
            <p className="mt-1 text-xs text-muted-foreground">Activity will appear after the first Agent is created.</p>
          </div>
        </SurfacePanelContent>
      )}
    </SurfacePanel>
  );
}

function durationSince(openedAt: string, generatedAt: string): string {
  const seconds = Math.max(0, Math.floor((new Date(generatedAt).getTime() - new Date(openedAt).getTime()) / 1_000));
  if (seconds < 60) return "just opened";
  if (seconds < 60 * 60) return `open ${Math.floor(seconds / 60)}m`;
  if (seconds < 24 * 60 * 60) return `open ${Math.floor(seconds / 3_600)}h`;
  return `open ${Math.floor(seconds / 86_400)}d`;
}

function AttentionRow({
  generatedAt,
  item,
}: {
  generatedAt: string;
  item: ProjectOverviewAttentionItem;
}) {
  const Icon = item.severity === "critical" ? CircleAlert : TriangleAlert;
  return (
    <li className={cn(
      "grid gap-4 border-b border-[var(--surface-panel-border)] px-5 py-4 last:border-b-0 sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center",
      item.severity === "critical" ? "bg-destructive-surface/55" : "bg-warning-surface/45",
    )}>
      <span className={cn(
        "grid size-9 place-items-center rounded-md",
        item.severity === "critical"
          ? "bg-destructive/10 text-destructive"
          : "bg-warning-surface text-warning-foreground",
      )}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={item.severity === "critical" ? "destructive" : "outline"}>
            {item.severity === "critical" ? "Critical" : "Warning"}
          </Badge>
          <p className="text-sm font-medium">{item.title}</p>
        </div>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">{item.reason}</p>
        <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <div className="flex min-w-0 gap-1.5">
            <dt className="text-muted-foreground">Impact</dt>
            <dd className="max-w-64 truncate font-medium">{item.impact.label}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Owner</dt>
            <dd className="font-medium">{item.owner}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="sr-only">Duration</dt>
            <dd className="text-muted-foreground">{durationSince(item.openedAt, generatedAt)}</dd>
          </div>
        </dl>
      </div>
      <Button asChild variant="outline" size="sm" className="min-h-11 justify-self-start lg:justify-self-end">
        <a href={item.nextStep.href}>{item.nextStep.label} <ArrowRight /></a>
      </Button>
    </li>
  );
}

export function AttentionList({
  generatedAt,
  items,
}: {
  generatedAt: string;
  items: ProjectOverviewAttentionItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const critical = items.filter((item) => item.severity === "critical").length;
  const warning = items.length - critical;
  const visibleItems = expanded ? items : items.slice(0, 5);
  return (
    <SurfacePanel aria-labelledby="needs-attention-title">
      <SurfacePanelHeader>
        <div className="flex w-full items-start justify-between gap-3">
          <div>
            <SurfacePanelTitle id="needs-attention-title">Needs attention</SurfacePanelTitle>
            <SurfacePanelDescription>
              Ordered by severity and age; every item names an owner and one next step.
            </SurfacePanelDescription>
          </div>
          {items.length ? (
            <Badge variant="outline" className="shrink-0">
              {critical} critical · {warning} warning
            </Badge>
          ) : null}
        </div>
      </SurfacePanelHeader>
      {items.length ? (
        <>
          <ul>{visibleItems.map((item) => (
            <AttentionRow key={item.code} generatedAt={generatedAt} item={item} />
          ))}</ul>
          {items.length > 5 ? (
            <SurfacePanelFooter className="justify-center">
              <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
                {expanded ? "Show fewer" : `Show all ${items.length}`}
                <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
              </Button>
            </SurfacePanelFooter>
          ) : null}
        </>
      ) : (
        <SurfacePanelContent className="flex min-h-20 items-center gap-3 py-4">
          <StatusIcon tone="success" />
          <div>
            <p className="text-sm font-medium">No issues require attention</p>
            <p className="mt-0.5 text-xs text-muted-foreground">No operational or governance thresholds are currently active.</p>
          </div>
        </SurfacePanelContent>
      )}
    </SurfacePanel>
  );
}

type ResourceRoute =
  | "/$projectId/access-policies"
  | "/$projectId/instances"
  | "/$projectId/memory"
  | "/$projectId/skills";

export function ProjectResourcesSummary({
  projectId,
  resources,
}: {
  projectId: string;
  resources: ProjectOverviewResponse["resources"];
}) {
  const entries: Array<{
    description: string;
    label: string;
    value: string;
    to: ResourceRoute;
  }> = [
    { description: "Persisted compute and Agent execution environments.", label: "Runtime", value: `${resources.runtimeCount} Instances`, to: "/$projectId/instances" },
    { description: "Reusable capabilities available to configured Agents.", label: "Published skills", value: compact(resources.publishedSkillCount), to: "/$projectId/skills" },
    { description: "Instances with durable Project Memory enabled.", label: "Memory", value: `${resources.memoryEnabledInstanceCount} enabled`, to: "/$projectId/memory" },
    { description: "Active access rules protecting Project resources.", label: "Policies", value: `${resources.activePolicyCount} active`, to: "/$projectId/access-policies" },
  ];
  return (
    <section aria-labelledby="project-resources-title">
      <SectionHeader
        titleId="project-resources-title"
        title="Project resources"
        description="Inventory summary and detailed management entry points."
      />
      <div className="border-y border-[var(--surface-panel-border)]">
        {entries.map(({ description, label, to, value }) => (
          <Link
            key={label}
            to={to}
            params={{ projectId }}
            className="group grid min-h-16 gap-2 border-b border-[var(--surface-panel-border)] px-2 py-3.5 transition-colors last:border-b-0 hover:bg-[var(--surface-panel)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:grid-cols-[minmax(10rem,0.7fr)_minmax(14rem,1.5fr)_auto_auto] sm:items-center sm:gap-5 sm:px-3"
          >
            <strong className="text-sm font-medium">{label}</strong>
            <span className="text-xs leading-5 text-muted-foreground">{description}</span>
            <span className="text-xs font-medium tabular-nums sm:text-right">{value}</span>
            <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </section>
  );
}
