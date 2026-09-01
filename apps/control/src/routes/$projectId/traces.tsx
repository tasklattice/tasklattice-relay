import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  AlertTriangle,
  Clock3,
  FlaskConical,
  RefreshCw,
  Waypoints,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TraceWorkbench } from "@/features/traces/trace-workbench";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";
import { formatPlatformDateTime } from "@/lib/platform-preferences";

export const Route = createFileRoute("/$projectId/traces")({
  component: TracesPage,
  validateSearch: z.object({
    traceId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  }),
});

function TracePageSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading traces">
      <Skeleton className="h-20 w-full" />
      <div className="overflow-hidden rounded-lg border">
        <Skeleton className="h-40 rounded-none" />
        <div className="grid min-h-[38rem] lg:grid-cols-[1.55fr_0.85fr]">
          <Skeleton className="rounded-none border-r" />
          <Skeleton className="rounded-none" />
        </div>
      </div>
    </div>
  );
}

function TraceLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="grid min-h-80 place-items-center border border-dashed px-6 py-10 text-center" aria-labelledby="trace-load-error">
      <div className="max-w-md">
        <span className="mx-auto grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-4" />
        </span>
        <h2 id="trace-load-error" className="mt-3 font-sans text-base font-semibold">Traces could not be loaded</h2>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <Button type="button" variant="outline" className="mt-4 h-11" onClick={onRetry}>
          <RefreshCw />
          Try again
        </Button>
      </div>
    </section>
  );
}

function TracesPage() {
  const scope = useProjectQueryScope();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [selectedTraceId, setSelectedTraceId] = useState(search.traceId ?? "");
  const traces = useQuery({
    queryKey: scope.key("traces"),
    queryFn: api.listTraces,
    retry: false,
  });

  useEffect(() => {
    if (!selectedTraceId && traces.data?.data[0]) {
      const traceId = traces.data.data[0].traceId;
      setSelectedTraceId(traceId);
      void navigate({ replace: true, search: { traceId } });
    }
  }, [navigate, selectedTraceId, traces.data]);

  useEffect(() => {
    if (search.traceId && search.traceId !== selectedTraceId) {
      setSelectedTraceId(search.traceId);
    }
  }, [search.traceId, selectedTraceId]);

  const selectTrace = (traceId: string) => {
    setSelectedTraceId(traceId);
    void navigate({ replace: true, search: { traceId } });
  };

  const detail = useQuery({
    queryKey: scope.key("trace", selectedTraceId),
    queryFn: () => api.getTrace(selectedTraceId),
    enabled: Boolean(selectedTraceId),
    retry: false,
  });

  const selectedSummary = traces.data?.data.find((trace) => trace.traceId === selectedTraceId);
  const error = traces.error ?? detail.error;
  const retry = () => {
    void traces.refetch();
    if (selectedTraceId) void detail.refetch();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Traces"
        description="Inspect relation-scoped Agent and Playbook runs, including branch outcomes, retries, evidence, latency, and failures."
      />

      {traces.isPending ? (
        <TracePageSkeleton />
      ) : error ? (
        <TraceLoadError message={error.message} onRetry={retry} />
      ) : traces.data?.data.length ? (
        <>
          <section className="flex flex-col gap-3 border border-border/70 bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Trace selection">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                <Waypoints className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium">Agent execution</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  Select one owned or maintained Agent run to inspect its exact execution evidence.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {selectedSummary ? (
                <div className="hidden items-center gap-2 text-[11px] text-muted-foreground xl:flex">
                  <Clock3 className="size-3.5" />
                  {formatPlatformDateTime(selectedSummary.startTime)}
                  {selectedSummary.flowId ? (
                    <Badge variant="secondary" className="font-mono">{selectedSummary.flowId}</Badge>
                  ) : null}
                </div>
              ) : null}
              <Select value={selectedTraceId} onValueChange={selectTrace}>
                <SelectTrigger size="lg" className="h-11 w-full bg-background sm:w-[21rem]" aria-label="Select trace">
                  <SelectValue placeholder="Select trace" />
                </SelectTrigger>
                <SelectContent align="end">
                  {traces.data.data.map((trace) => (
                    <SelectItem key={trace.traceId} value={trace.traceId}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={trace.status === "error" ? "size-2 rounded-full bg-destructive" : "size-2 rounded-full bg-emerald-500"} />
                        <span className="truncate">{trace.title}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          {detail.isPending || !detail.data ? (
            <TracePageSkeleton />
          ) : (
            <TraceWorkbench key={detail.data.traceId} trace={detail.data} />
          )}
        </>
      ) : (
        <section className="grid min-h-80 place-items-center border border-dashed px-6 text-center">
          <div>
            <FlaskConical className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 font-sans text-base font-semibold">No Agent traces yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">Run an Agent you own or maintain; its relation-scoped Trace will appear here.</p>
          </div>
        </section>
      )}
    </div>
  );
}
