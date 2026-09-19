import { useMemo, useState, type ReactNode } from "react";
import type {
  TraceAttributeValue,
  TraceDetail,
  TraceEvent,
  TraceScore,
  TraceSpan,
  TraceSpanType,
  TraceStatus,
} from "@tali/contracts";
import {
  Activity,
  AlertTriangle,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Cloud,
  Coins,
  Copy,
  Database,
  ExternalLink,
  GitBranch,
  Link2,
  ListTree,
  Network,
  PlugZap,
  Search,
  ShieldCheck,
  Sparkles,
  Waypoints,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  buildTraceRows,
  formatCost,
  formatDuration,
  formatTokenCount,
  spanTypeLabels,
  statusLabels,
} from "./trace-model";

type WorkbenchView = "execution" | "graph" | "raw";

const spanVisuals: Record<
  TraceSpanType,
  { icon: LucideIcon; text: string; soft: string; bar: string }
> = {
  workflow: {
    icon: Workflow,
    text: "text-link",
    soft: "bg-primary/10",
    bar: "bg-primary",
  },
  agent: {
    icon: Bot,
    text: "text-trace-agent",
    soft: "bg-trace-agent/10",
    bar: "bg-trace-agent",
  },
  generation: {
    icon: Sparkles,
    text: "text-trace-generation",
    soft: "bg-trace-generation/10",
    bar: "bg-trace-generation",
  },
  tool: {
    icon: Wrench,
    text: "text-trace-tool",
    soft: "bg-trace-tool/10",
    bar: "bg-trace-tool",
  },
  mcp: {
    icon: PlugZap,
    text: "text-trace-tool",
    soft: "bg-trace-tool/10",
    bar: "bg-trace-tool",
  },
  retriever: {
    icon: Database,
    text: "text-trace-retriever",
    soft: "bg-trace-retriever/10",
    bar: "bg-trace-retriever",
  },
  guardrail: {
    icon: ShieldCheck,
    text: "text-trace-guardrail",
    soft: "bg-trace-guardrail/10",
    bar: "bg-trace-guardrail",
  },
  external: {
    icon: Cloud,
    text: "text-trace-external",
    soft: "bg-trace-external/10",
    bar: "bg-trace-external",
  },
};

function statusTone(status: TraceStatus) {
  if (status === "error") {
    return {
      icon: CircleAlert,
      text: "text-destructive",
      soft: "bg-destructive/10",
      dot: "bg-destructive",
    };
  }
  if (status === "running") {
    return {
      icon: Activity,
      text: "text-amber-700 dark:text-amber-300",
      soft: "bg-amber-500/10",
      dot: "bg-amber-500",
    };
  }
  return {
    icon: CheckCircle2,
    text: "text-emerald-700 dark:text-emerald-300",
    soft: "bg-emerald-500/10",
    dot: "bg-emerald-500",
  };
}

function StatusBadge({ status }: { status: TraceStatus }) {
  const tone = statusTone(status);
  const Icon = tone.icon;
  return (
    <Badge variant="outline" className={cn("h-6 gap-1.5 border-current/15", tone.text, tone.soft)}>
      <Icon />
      {statusLabels[status]}
    </Badge>
  );
}

function SpanTypeMark({ type, compact = false }: { type: TraceSpanType; compact?: boolean }) {
  const visual = spanVisuals[type];
  const Icon = visual.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm",
        compact ? "size-6" : "size-8",
        visual.soft,
        visual.text,
      )}
      aria-hidden="true"
    >
      <Icon className={compact ? "size-3.5" : "size-4"} />
    </span>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3 first:pl-0">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1 truncate font-mono text-[13px] font-medium text-foreground">{value}</p>
    </div>
  );
}

function scoreLabel(score: TraceScore): string {
  if (typeof score.value === "boolean") return score.value ? "Pass" : "Review";
  if (typeof score.value === "number") {
    const value = score.value <= 1 ? score.value * 100 : score.value;
    return `${Math.round(value)}%`;
  }
  return score.value;
}

function QualitySignals({ scores }: { scores: readonly TraceScore[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-2.5">
      <span className="text-[11px] font-medium text-muted-foreground">Quality signals</span>
      {scores.map((score) => {
        const needsReview = score.value === false ||
          (typeof score.value === "number" && score.value < 0.8);
        return (
          <span key={`${score.name}-${score.source}`} className="inline-flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "size-1.5 rounded-full",
                needsReview ? "bg-destructive" : "bg-emerald-500",
              )}
            />
            <span className="text-muted-foreground">{score.name}</span>
            <strong className={cn("font-mono font-medium", needsReview && "text-destructive")}>
              {scoreLabel(score)}
            </strong>
          </span>
        );
      })}
    </div>
  );
}

function PrimitiveValue({ value }: { value: string | number | boolean | null }) {
  if (value === null) return <span className="font-mono text-muted-foreground">null</span>;
  if (typeof value === "boolean") {
    return (
      <span className={cn("font-mono", value ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>
        {String(value)}
      </span>
    );
  }
  if (typeof value === "number") return <span className="font-mono text-blue-700 dark:text-blue-300">{value}</span>;
  return <span className="break-words font-mono text-foreground">{value || '""'}</span>;
}

function StructuredValue({ value, depth = 0 }: { value: TraceAttributeValue; depth?: number }) {
  if (value === null || typeof value !== "object") return <PrimitiveValue value={value} />;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="font-mono text-muted-foreground">empty list</span>;
    return (
      <div className={cn("grid gap-1.5", depth > 0 && "border-l pl-3")}>
        {value.map((item, index) => (
          <div key={index} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">{index}</span>
            <StructuredValue value={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value);
  if (!entries.length) return <span className="font-mono text-muted-foreground">empty object</span>;
  return (
    <div className={cn("divide-y divide-border/60", depth > 0 && "border-l pl-3")}>
      {entries.map(([key, item]) => (
        <div key={key} className="grid gap-1 py-2 first:pt-0 sm:grid-cols-[minmax(8rem,0.42fr)_minmax(0,1fr)] sm:gap-4">
          <span className="break-all font-mono text-[11px] text-muted-foreground">{key}</span>
          <StructuredValue value={item} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words bg-muted/35 p-3 font-mono text-[11px] leading-5 text-foreground">
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}

function PreviewSection({
  label,
  value,
  raw,
}: {
  label: string;
  value: TraceAttributeValue | undefined;
  raw: boolean;
}) {
  return (
    <section aria-label={label}>
      <div className="flex h-9 items-center justify-between border-b bg-muted/25 px-3">
        <h3 className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </h3>
      </div>
      <div className="min-h-24 p-3">
        {value === undefined ? (
          <p className="text-xs text-muted-foreground">No {label.toLocaleLowerCase()} was captured for this step.</p>
        ) : raw ? (
          <JsonBlock value={value} />
        ) : (
          <StructuredValue value={value} />
        )}
      </div>
    </section>
  );
}

function TraceEventRow({ event }: { event: TraceEvent }) {
  const tone = event.severity === "error"
    ? "bg-destructive"
    : event.severity === "warning"
      ? "bg-amber-500"
      : "bg-blue-500";
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 border-b px-3 py-3 last:border-b-0">
      <span className={cn("mt-1.5 size-2 rounded-full", tone)} />
      <div className="min-w-0">
        <p className="font-mono text-xs font-medium">{event.name}</p>
        {event.attributes ? (
          <div className="mt-2 text-xs">
            <StructuredValue value={event.attributes} />
          </div>
        ) : null}
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">+{formatDuration(event.offsetMs)}</span>
    </li>
  );
}

function SpanInspector({ span, trace }: { span: TraceSpan; trace: TraceDetail }) {
  const [rawPreview, setRawPreview] = useState(false);
  const visual = spanVisuals[span.type];
  const Icon = visual.icon;

  return (
    <aside className="flex min-h-[32rem] min-w-0 flex-col border-t bg-background lg:min-h-0 lg:border-l lg:border-t-0">
      <div className="border-b p-4">
        <div className="flex items-start gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-md", visual.soft, visual.text)}>
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-sans text-[15px] font-semibold">{span.name}</h2>
              <StatusBadge status={span.status} />
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {spanTypeLabels[span.type]} · {span.serviceName}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 divide-x border-y">
          <Metric icon={Clock3} label="Duration" value={formatDuration(span.durationMs)} />
          <Metric
            icon={Sparkles}
            label="Tokens"
            value={span.tokenUsage
              ? formatTokenCount(span.tokenUsage.input + span.tokenUsage.output)
              : "—"}
          />
          <Metric
            icon={Coins}
            label="Cost"
            value={span.costUsd === undefined ? "—" : formatCost(span.costUsd)}
          />
        </div>
      </div>

      <Tabs defaultValue="preview" className="min-h-0 flex-1 gap-0">
        <div className="overflow-x-auto border-b px-1">
          <TabsList variant="line" className="border-b-0">
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="attributes">Attributes</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="quality">Quality</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="preview" className="min-h-0 overflow-auto">
          <div className="flex h-11 items-center justify-between border-b px-3">
            <span className="text-xs text-muted-foreground">
              {span.model ? `Model · ${span.model}` : span.agentName ?? span.serviceName}
            </span>
            <div className="inline-flex rounded-md border bg-muted/20 p-0.5" aria-label="Preview format">
              <Button
                type="button"
                size="sm"
                variant={rawPreview ? "ghost" : "secondary"}
                className="h-8 px-2.5"
                onClick={() => setRawPreview(false)}
              >
                Formatted
              </Button>
              <Button
                type="button"
                size="sm"
                variant={rawPreview ? "secondary" : "ghost"}
                className="h-8 px-2.5"
                onClick={() => setRawPreview(true)}
              >
                JSON
              </Button>
            </div>
          </div>
          <div className="divide-y">
            <PreviewSection label="Input" value={span.input} raw={rawPreview} />
            <PreviewSection label="Output" value={span.output} raw={rawPreview} />
          </div>
        </TabsContent>

        <TabsContent value="attributes" className="min-h-0 overflow-auto p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">OpenTelemetry and TaskLattice Relay attributes</p>
            <Badge variant="secondary" className="font-mono">{Object.keys(span.attributes).length}</Badge>
          </div>
          <div className="border">
            <StructuredValue value={span.attributes} />
          </div>
        </TabsContent>

        <TabsContent value="events" className="min-h-0 overflow-auto p-4">
          {span.events?.length ? (
            <ul className="border">{span.events.map((event, index) => <TraceEventRow key={`${event.name}-${index}`} event={event} />)}</ul>
          ) : (
            <div className="border border-dashed px-4 py-8 text-center">
              <Activity className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No events recorded</p>
              <p className="mt-1 text-xs text-muted-foreground">Exceptions, retries and lifecycle events appear here.</p>
            </div>
          )}
          {span.links?.length ? (
            <section className="mt-4">
              <h3 className="mb-2 text-xs font-medium">Span links</h3>
              <div className="divide-y border">
                {span.links.map((link) => (
                  <div key={`${link.traceId}-${link.spanId}`} className="flex items-start gap-3 p-3">
                    <Link2 className="mt-0.5 size-4 shrink-0 text-link" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{link.relationship.replaceAll("_", " ")}</p>
                      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{link.traceId}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </TabsContent>

        <TabsContent value="quality" className="min-h-0 overflow-auto p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Sample evaluator and reviewer signals attached to this execution.
          </p>
          <div className="divide-y border">
            {trace.scores.map((score) => {
              const needsReview = score.value === false ||
                (typeof score.value === "number" && score.value < 0.8);
              return (
                <div key={`${score.name}-${score.source}`} className="flex min-h-14 items-center gap-3 px-3">
                  <span className={cn("grid size-7 place-items-center rounded-full", needsReview ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
                    {needsReview ? <AlertTriangle className="size-3.5" /> : <Check className="size-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{score.name}</p>
                    <p className="text-[11px] capitalize text-muted-foreground">{score.source}</p>
                  </div>
                  <strong className={cn("font-mono text-xs", needsReview && "text-destructive")}>{scoreLabel(score)}</strong>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function TimelineGrid() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      {[0, 25, 50, 75, 100].map((left) => (
        <span
          key={left}
          className="absolute inset-y-0 border-l border-border/60"
          style={{ left: `${left}%` }}
        />
      ))}
    </span>
  );
}

function ExecutionView({
  trace,
  selectedSpanId,
  onSelect,
}: {
  trace: TraceDetail;
  selectedSpanId: string;
  onSelect: (spanId: string) => void;
}) {
  const parents = useMemo(() => {
    const parentIds = new Set(trace.spans.flatMap((span) => span.parentSpanId ? [span.parentSpanId] : []));
    return new Set(trace.spans.filter((span) => parentIds.has(span.spanId)).map((span) => span.spanId));
  }, [trace.spans]);
  const [expanded, setExpanded] = useState<Set<string>>(parents);
  const [search, setSearch] = useState("");
  const rows = useMemo(
    () => buildTraceRows(trace.spans, expanded, search),
    [expanded, search, trace.spans],
  );

  const toggleExpanded = (spanId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find agent, tool or service"
            aria-label="Search trace steps"
            className="h-11 pl-9 pr-10"
          />
          {search ? (
            <button
              type="button"
              className="absolute right-0 top-0 grid size-11 place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-2"
              onClick={() => setSearch("")}
              aria-label="Clear trace search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          {(["agent", "generation", "tool", "external"] as const).map((type) => (
            <span key={type} className="inline-flex items-center gap-1.5">
              <span className={cn("h-1.5 w-4 rounded-full", spanVisuals[type].bar)} />
              {spanTypeLabels[type]}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[740px]">
          <div className="sticky top-0 z-10 grid h-11 grid-cols-[minmax(330px,0.9fr)_minmax(360px,1.1fr)] border-b bg-background">
            <div className="flex items-center px-3 text-[11px] font-medium text-muted-foreground">Execution step</div>
            <div className="relative grid grid-cols-5 items-end px-3 pb-2 font-mono text-[9px] text-muted-foreground">
              <TimelineGrid />
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                <span key={ratio} className={cn("relative", ratio === 1 && "text-right")}>
                  {formatDuration(trace.durationMs * ratio)}
                </span>
              ))}
            </div>
          </div>

          {rows.length ? rows.map(({ span, depth, hasChildren }) => {
            const selected = span.spanId === selectedSpanId;
            const visual = spanVisuals[span.type];
            const left = Math.min(100, (span.startOffsetMs / trace.durationMs) * 100);
            const width = Math.max(0.8, Math.min(100 - left, (span.durationMs / trace.durationMs) * 100));
            const error = span.status === "error";
            return (
              <div
                key={span.spanId}
                className={cn(
                  "grid min-h-12 grid-cols-[minmax(330px,0.9fr)_minmax(360px,1.1fr)] border-b transition-colors",
                  selected ? "bg-primary/[0.055]" : "hover:bg-muted/30",
                )}
              >
                <div className="flex min-w-0 items-stretch">
                  <span style={{ width: `${Math.min(depth, 6) * 18 + 8}px` }} className="shrink-0" />
                  {hasChildren ? (
                    <button
                      type="button"
                      className="grid size-11 shrink-0 place-items-center self-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2"
                      onClick={() => toggleExpanded(span.spanId)}
                      aria-label={`${expanded.has(span.spanId) ? "Collapse" : "Expand"} ${span.name}`}
                      aria-expanded={expanded.has(span.spanId)}
                    >
                      <ChevronRight className={cn("size-3.5 transition-transform", expanded.has(span.spanId) && "rotate-90")} />
                    </button>
                  ) : (
                    <span className="w-11 shrink-0" />
                  )}
                  <button
                    type="button"
                    onClick={() => onSelect(span.spanId)}
                    className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-3 text-left focus-visible:outline-2"
                    aria-pressed={selected}
                  >
                    <SpanTypeMark type={span.type} compact />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[12px] font-medium", error && "text-destructive")}>{span.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{span.agentName ?? span.serviceName}</span>
                    </span>
                    {span.links?.length ? <Link2 className="size-3.5 shrink-0 text-link" aria-label="Linked span" /> : null}
                    <span className={cn("shrink-0 font-mono text-[10px]", error ? "text-destructive" : "text-muted-foreground")}>
                      {formatDuration(span.durationMs)}
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  className="relative min-h-12 px-3 text-left focus-visible:outline-2"
                  onClick={() => onSelect(span.spanId)}
                  aria-label={`Select ${span.name}, ${formatDuration(span.durationMs)}`}
                >
                  <TimelineGrid />
                  <span
                    className={cn(
                      "absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[2px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)] transition-[height,opacity]",
                      error ? "bg-destructive" : visual.bar,
                      selected ? "h-3.5 opacity-100" : "opacity-80",
                    )}
                    style={{ left: `calc(${left}% + 0.75rem)`, width: `calc(${width}% - 0.15rem)` }}
                  />
                </button>
              </div>
            );
          }) : (
            <div className="grid min-h-56 place-items-center px-6 text-center">
              <div>
                <Search className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">No matching steps</p>
                <p className="mt-1 text-xs text-muted-foreground">Try an agent name, tool, model or service.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface GraphNode {
  span: TraceSpan;
  x: number;
  y: number;
}

function buildGraphNodes(spans: readonly TraceSpan[]): GraphNode[] {
  const spanById = new Map(spans.map((span) => [span.spanId, span]));
  const depthById = new Map<string, number>();
  const depthOf = (span: TraceSpan): number => {
    const cached = depthById.get(span.spanId);
    if (cached !== undefined) return cached;
    const parent = span.parentSpanId ? spanById.get(span.parentSpanId) : undefined;
    const depth = parent ? depthOf(parent) + 1 : 0;
    depthById.set(span.spanId, depth);
    return depth;
  };
  spans.forEach(depthOf);
  const maxDepth = Math.max(1, ...depthById.values());
  const levels = new Map<number, TraceSpan[]>();
  for (const span of spans) {
    const depth = depthById.get(span.spanId) ?? 0;
    const level = levels.get(depth) ?? [];
    level.push(span);
    levels.set(depth, level);
  }
  for (const level of levels.values()) level.sort((left, right) => left.startOffsetMs - right.startOffsetMs);

  return spans.map((span) => {
    const depth = depthById.get(span.spanId) ?? 0;
    const level = levels.get(depth) ?? [span];
    const index = level.findIndex((candidate) => candidate.spanId === span.spanId);
    const y = level.length === 1 ? 50 : 12 + (index * 76) / (level.length - 1);
    return { span, x: 4 + (depth * 73) / maxDepth, y };
  });
}

function GraphView({
  trace,
  selectedSpanId,
  onSelect,
}: {
  trace: TraceDetail;
  selectedSpanId: string;
  onSelect: (spanId: string) => void;
}) {
  const nodes = useMemo(() => buildGraphNodes(trace.spans), [trace.spans]);
  const byId = new Map(nodes.map((node) => [node.span.spanId, node]));
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/15 p-4">
      <div className="relative mx-auto h-[34rem] min-w-[800px] max-w-5xl overflow-hidden border bg-background">
        <div className="absolute inset-x-0 top-0 z-10 flex h-10 items-center justify-between border-b bg-background/95 px-3">
          <p className="text-xs font-medium">Expanded execution graph</p>
          <p className="text-[10px] text-muted-foreground">One node per recorded step</p>
        </div>
        <svg aria-hidden="true" className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {nodes.map((node) => {
            const parent = node.span.parentSpanId ? byId.get(node.span.parentSpanId) : undefined;
            if (!parent) return null;
            return (
              <path
                key={`${parent.span.spanId}-${node.span.spanId}`}
                d={`M ${parent.x + 15} ${parent.y} C ${parent.x + 20} ${parent.y}, ${node.x - 5} ${node.y}, ${node.x} ${node.y}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.25"
                vectorEffect="non-scaling-stroke"
                className="text-border"
              />
            );
          })}
        </svg>
        {nodes.map(({ span, x, y }) => {
          const selected = span.spanId === selectedSpanId;
          const error = span.status === "error";
          const visual = spanVisuals[span.type];
          return (
            <button
              key={span.spanId}
              type="button"
              onClick={() => onSelect(span.spanId)}
              className={cn(
                "absolute z-10 flex min-h-14 w-40 items-center gap-2 border bg-background px-2.5 py-2 text-left shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2",
                selected && "border-primary ring-2 ring-primary/15",
                error && !selected && "border-destructive/40",
              )}
              style={{ left: `${x}%`, top: `${y}%`, transform: "translateY(-50%)" }}
              aria-pressed={selected}
            >
              <SpanTypeMark type={span.type} compact />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[11px] font-medium", error && "text-destructive")}>{span.name}</span>
                <span className={cn("mt-0.5 block truncate font-mono text-[9px]", selected ? visual.text : "text-muted-foreground")}>
                  {spanTypeLabels[span.type]} · {formatDuration(span.durationMs)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RawTraceView({ trace }: { trace: TraceDetail }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b px-3">
        <div>
          <p className="text-xs font-medium">Normalized trace payload</p>
          <p className="text-[10px] text-muted-foreground">The production adapter will map OTLP backend responses into this view model.</p>
        </div>
        <Button type="button" variant="outline" className="h-11" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto bg-muted/25 p-4 font-mono text-[11px] leading-5">
        {JSON.stringify(trace, null, 2)}
      </pre>
    </div>
  );
}

function ViewButton({
  active,
  icon: Icon,
  children,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      className="h-11 rounded-sm px-3"
      onClick={onClick}
      aria-pressed={active}
    >
      <Icon />
      {children}
    </Button>
  );
}

export function TraceWorkbench({ trace }: { trace: TraceDetail }) {
  const rootSpan = trace.spans.find((span) => !span.parentSpanId) ?? trace.spans[0]!;
  const [selectedSpanId, setSelectedSpanId] = useState(rootSpan.spanId);
  const [view, setView] = useState<WorkbenchView>("execution");
  const [traceIdCopied, setTraceIdCopied] = useState(false);
  const selectedSpan = trace.spans.find((span) => span.spanId === selectedSpanId) ?? rootSpan;
  const copiedTraceId = async () => {
    try {
      await navigator.clipboard.writeText(trace.traceId);
      setTraceIdCopied(true);
      window.setTimeout(() => setTraceIdCopied(false), 1800);
    } catch {
      setTraceIdCopied(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-background shadow-[0_1px_3px_rgb(0_0_0/0.035)]" aria-label="Trace workbench">
      <header className="border-b">
        <div className="flex flex-col gap-3 p-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={trace.status} />
              <span className="text-[11px] text-muted-foreground">{trace.rootAgentName}</span>
            </div>
            <h2 className="mt-2 truncate font-sans text-lg font-semibold">{trace.title}</h2>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-[10px] text-muted-foreground">{trace.traceId}</span>
              <button
                type="button"
                onClick={() => void copiedTraceId()}
                className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2"
                aria-label="Copy trace ID"
              >
                {traceIdCopied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/20 p-1" aria-label="Trace view">
            <ViewButton active={view === "execution"} icon={ListTree} onClick={() => setView("execution")}>Execution</ViewButton>
            <ViewButton active={view === "graph"} icon={GitBranch} onClick={() => setView("graph")}>Graph</ViewButton>
            <ViewButton active={view === "raw"} icon={Braces} onClick={() => setView("raw")}>Raw</ViewButton>
          </div>
        </div>

        <div className="overflow-x-auto border-t px-4">
          <div className="grid min-w-[650px] grid-cols-6 divide-x">
            <Metric icon={Clock3} label="Duration" value={formatDuration(trace.durationMs)} />
            <Metric icon={Waypoints} label="Spans" value={String(trace.spanCount)} />
            <Metric icon={Bot} label="Agents" value={String(trace.agentCount)} />
            <Metric icon={Sparkles} label="Tokens" value={formatTokenCount(trace.inputTokens + trace.outputTokens)} />
            <Metric icon={Coins} label="Cost" value={formatCost(trace.costUsd)} />
            <Metric icon={Network} label="Coverage" value={`${trace.coveragePercent}%`} />
          </div>
        </div>
        <QualitySignals scores={trace.scores} />
      </header>

      <div className="grid min-h-[42rem] lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
        <div className="flex min-h-[38rem] min-w-0 flex-col">
          {view === "execution" ? (
            <ExecutionView trace={trace} selectedSpanId={selectedSpan.spanId} onSelect={setSelectedSpanId} />
          ) : view === "graph" ? (
            <GraphView trace={trace} selectedSpanId={selectedSpan.spanId} onSelect={setSelectedSpanId} />
          ) : (
            <RawTraceView trace={trace} />
          )}
        </div>
        <SpanInspector span={selectedSpan} trace={trace} />
      </div>
    </section>
  );
}
