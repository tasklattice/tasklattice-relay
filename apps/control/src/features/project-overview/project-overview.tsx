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
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ServerCog,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  projectName,
  range,
  onRangeChange,
}: {
  projectName: string | undefined;
  range: ProjectOverviewRange;
  onRangeChange: (range: ProjectOverviewRange) => void;
}) {
  return (
    <PageHeader
      title="Project overview"
      description={
        <>
          Operational risk, usage, runtime health, and budget for{" "}
          <span className="font-medium text-foreground">{projectName ?? "this Project"}</span>.
        </>
      }
      actions={
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
            <ToggleGroupItem key={value} value={value}>
              {rangeLabels[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    />
  );
}

export function OverviewKpiGrid({ data }: { data: ProjectOverviewResponse }) {
  const cards = [
    {
      label: "Runs",
      value: number(data.kpis.runs),
      detail: <Trend value={data.kpis.runsChangePercent} />,
    },
    {
      label: "Success rate",
      value: data.kpis.successRate === null
        ? "—"
        : `${(data.kpis.successRate * 100).toFixed(1)}%`,
      detail: data.kpis.successRate === null
        ? <span className="text-xs text-muted-foreground">No completed Runs in this period</span>
        : <Trend value={data.kpis.successRateChangePoints} unit="points" />,
    },
    {
      label: "Runtime",
      value: `${data.kpis.readyInstances} / ${data.kpis.totalInstances}`,
      detail: (
        <span className={cn(
          "text-xs",
          data.runtime.failed > 0 ? "text-destructive" : "text-muted-foreground",
        )}>
          {data.runtime.failed > 0
            ? `${data.runtime.failed} require attention`
            : data.kpis.totalInstances > 0
              ? "No failed Instances"
              : "No Runtime Instances"}
        </span>
      ),
    },
    {
      label: "Spend",
      value: money(data.kpis.spendUsd),
      detail: data.budget.configured && data.budget.usedPercent !== null
        ? (
            <span className="text-xs text-muted-foreground">
              {(data.budget.usedPercent * 100).toFixed(1)}% of current budget
            </span>
          )
        : <Trend value={data.kpis.spendChangePercent} />,
    },
  ];

  return (
    <section aria-label="Project overview metrics" className="grid overflow-hidden rounded-lg border border-border/65 bg-card sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <article
          key={card.label}
          className="min-h-32 border-b p-4 last:border-b-0 sm:odd:border-r sm:[&:nth-child(3)]:border-b-0 xl:border-b-0 xl:border-r xl:odd:border-r xl:last:border-r-0"
        >
          <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
          <p className="mt-3 font-sans text-3xl font-medium tabular-nums tracking-tight">{card.value}</p>
          <div className="mt-3">{card.detail}</div>
        </article>
      ))}
    </section>
  );
}

export function UsageChartCard({ data }: { data: ProjectOverviewResponse }) {
  const [metric, setMetric] = useState<UsageMetric>("tokens");
  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardHeader className="flex min-h-16 flex-col items-stretch justify-between gap-3 border-b px-4 py-3 sm:flex-row sm:items-center">
        <div>
          <CardTitle className="font-sans text-sm font-semibold">Usage trend</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Attributed tokens, Agent Runs, and spend over the selected period.
          </p>
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
            <ToggleGroupItem key={value} value={value}>
              {metricLabels[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardHeader>
      <CardContent className="px-2 pb-2 pt-1 sm:px-4">
        <ClientOnly fallback={<UsageChartSkeleton />}>
          <Suspense fallback={<UsageChartSkeleton />}>
            <UsageChart metric={metric} points={data.usage} range={data.range} />
          </Suspense>
        </ClientOnly>
      </CardContent>
    </Card>
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
      <Card className="h-full">
        <CardHeader className="border-b">
          <CardTitle className="font-sans text-sm font-semibold">Budget forecast</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col justify-center py-8">
          <p className="text-sm font-medium">No budget configured</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            Spend is still tracked. Set a budget to add utilization and forecast signals.
          </p>
        </CardContent>
        <CardFooter className="justify-end">
          <Button asChild variant="ghost" size="sm">
            <Link to="/$projectId/setting" params={{ projectId }} search={{ section: "quota" }}>
              Configure budget <ArrowRight />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }
  const usedPercent = (budget.usedPercent ?? 0) * 100;
  const remaining = remainingTime(budget.resetsAt, generatedAt);
  const forecastOver = budget.forecastUsd !== null && budget.forecastUsd > budget.limitUsd;
  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-sans text-sm font-semibold">Budget forecast</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {budget.duration === "30d" ? "30-day" : budget.duration} budget window
            </p>
          </div>
          <Badge variant={usedPercent >= 100 ? "destructive" : "outline"}>
            {usedPercent.toFixed(1)}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center py-6">
        <p className="font-sans text-3xl font-medium tabular-nums tracking-tight">
          {money(budget.usedUsd)} <span className="text-base text-muted-foreground">/ {money(budget.limitUsd)}</span>
        </p>
        <Progress
          aria-label={`${usedPercent.toFixed(1)} percent of budget used`}
          value={Math.min(100, Math.max(0, usedPercent))}
          className={cn("mt-5 h-1.5", usedPercent >= 100 && "[&_[data-slot=progress-indicator]]:bg-destructive")}
        />
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
      </CardContent>
      <CardFooter className="justify-end">
        <Button asChild variant="ghost" size="sm">
          <Link to="/$projectId/cost" params={{ projectId }}>
            Review spend <ArrowRight />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

const runtimeStates = [
  { key: "ready", label: "Ready", color: "bg-emerald-500/80" },
  { key: "provisioning", label: "Provisioning", color: "bg-amber-500/75" },
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
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-sans text-sm font-semibold">Runtime health</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">Current Instance lifecycle state.</p>
          </div>
          <Badge variant={data.available ? "secondary" : "outline"}>
            {data.available ? "Live" : "Persisted state"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="py-5">
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
      </CardContent>
      <CardFooter className="justify-end">
        <Button asChild variant="ghost" size="sm">
          <Link to="/$projectId/instances" params={{ projectId }}>
            View runtime <ArrowRight />
          </Link>
        </Button>
      </CardFooter>
    </Card>
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
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="font-sans text-sm font-semibold">Model assignment distribution</CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          One count per active Agent&apos;s default route.
        </p>
      </CardHeader>
      <CardContent className="flex min-h-64 flex-col justify-center py-5">
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
      </CardContent>
      <CardFooter>
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
      </CardFooter>
    </Card>
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
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="font-sans text-sm font-semibold">Agent activity ranking</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Actual use in the selected period, including configured Agents with no Runs.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm" className="shrink-0">
            <Link to="/$projectId/traces" params={{ projectId }}>
              View Runs <ArrowRight />
            </Link>
          </Button>
        </div>
      </CardHeader>
      {activity.length ? (
        <CardContent className="overflow-x-auto px-0">
          <table className="w-full min-w-[680px] border-collapse text-xs">
            <caption className="sr-only">
              Agent activity ranked by Runs, active users, success rate, and cost
            </caption>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="w-10 px-4 py-2.5 font-medium">#</th>
                <th scope="col" className="min-w-64 px-3 py-2.5 font-medium">Agent</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Runs</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Active users</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Success rate</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((item, index) => (
                <tr key={item.agentId} className="border-b last:border-b-0">
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{index + 1}</td>
                  <th scope="row" className="px-3 py-2.5 text-left font-medium">
                    <div className="relative min-h-9 overflow-hidden rounded-sm bg-muted/40">
                      <span
                        className="absolute inset-y-0 left-0 bg-[var(--overview-series-1)]/20"
                        style={{ width: `${maximumRuns ? (item.runs / maximumRuns) * 100 : 0}%` }}
                        aria-hidden
                      />
                      <span className="relative flex min-h-9 items-center truncate px-3">{item.agentName}</span>
                    </div>
                  </th>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">{number(item.runs)}</td>
                  <td
                    className="px-3 py-2.5 text-right tabular-nums text-muted-foreground"
                    title={item.activeUsers === null ? "End-user attribution is unavailable" : undefined}
                  >
                    {item.activeUsers === null ? "—" : number(item.activeUsers)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {item.successRate === null ? "—" : `${(item.successRate * 100).toFixed(1)}%`}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{money(item.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      ) : (
        <CardContent className="flex min-h-28 items-center justify-center py-6 text-center">
          <div>
            <p className="text-sm font-medium">No Agents configured</p>
            <p className="mt-1 text-xs text-muted-foreground">Activity will appear after the first Agent is created.</p>
          </div>
        </CardContent>
      )}
    </Card>
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
    <li className="grid gap-4 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start">
      <span className={cn(
        "grid size-9 place-items-center rounded-md",
        item.severity === "critical"
          ? "bg-destructive/10 text-destructive"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
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

export function AttentionListCard({
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
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-sans text-sm font-semibold">Needs attention</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ordered by severity and age; every item names an owner and one next step.
            </p>
          </div>
          {items.length ? (
            <Badge variant="outline" className="shrink-0">
              {critical} critical · {warning} warning
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      {items.length ? (
        <>
          <ul>{visibleItems.map((item) => (
            <AttentionRow key={item.code} generatedAt={generatedAt} item={item} />
          ))}</ul>
          {items.length > 5 ? (
            <CardFooter className="justify-center">
              <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
                {expanded ? "Show fewer" : `Show all ${items.length}`}
                <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
              </Button>
            </CardFooter>
          ) : null}
        </>
      ) : (
        <CardContent className="flex min-h-24 items-center gap-3 py-5">
          <span className="grid size-9 place-items-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">No issues require attention</p>
            <p className="mt-0.5 text-xs text-muted-foreground">No operational or governance thresholds are currently active.</p>
          </div>
        </CardContent>
      )}
    </Card>
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
    label: string;
    value: string;
    icon: typeof ServerCog;
    to: ResourceRoute;
  }> = [
    { label: "Runtime", value: `${resources.runtimeCount} Instances`, icon: ServerCog, to: "/$projectId/instances" },
    { label: "Published skills", value: compact(resources.publishedSkillCount), icon: Sparkles, to: "/$projectId/skills" },
    { label: "Memory", value: `${resources.memoryEnabledInstanceCount} enabled`, icon: BrainCircuit, to: "/$projectId/memory" },
    { label: "Policies", value: `${resources.activePolicyCount} active`, icon: ShieldCheck, to: "/$projectId/access-policies" },
  ];
  return (
    <section aria-labelledby="project-resources-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 id="project-resources-title" className="font-sans text-sm font-semibold">Project resources</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Inventory summary and detailed management entry points.</p>
        </div>
      </div>
      <div className="grid overflow-hidden rounded-lg border border-border/65 bg-card sm:grid-cols-2 xl:grid-cols-4">
        {entries.map(({ icon: Icon, label, to, value }) => (
          <Link
            key={label}
            to={to}
            params={{ projectId }}
            className="group flex min-h-20 items-center gap-3 border-b p-4 transition-colors last:border-b-0 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:odd:border-r sm:[&:nth-child(3)]:border-b-0 xl:border-b-0 xl:border-r xl:odd:border-r xl:last:border-r-0"
          >
            <Icon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">{label}</span>
              <strong className="mt-1 block text-sm font-medium tabular-nums">{value}</strong>
            </span>
            <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </section>
  );
}
