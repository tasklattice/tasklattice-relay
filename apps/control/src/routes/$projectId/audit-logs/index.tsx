import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  keepPreviousData,
  useQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type {
  PlatformAuditLogEvent,
  PlatformAuditLogFacets,
  PlatformAuditSortDirection,
} from "@tali/contracts";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AuditLogDetailPanel } from "@/features/audit-logs/audit-log-detail-panel";
import { AuditLogOutcomeMark } from "@/features/audit-logs/audit-log-outcome-mark";
import { AuditLogTable } from "@/features/audit-logs/audit-log-table";
import {
  auditActionLabel,
  auditFiltersToQuery,
  countAdvancedAuditFilters,
  defaultAuditLogFilters,
  type AuditLogFilters,
  type AuditTimeRange,
} from "@/features/audit-logs/audit-log-utils";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useProject } from "@/hooks/use-project";
import { useProjectPermissions } from "@/hooks/use-project-permissions";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";
import { downloadBlob } from "@/lib/csv";
import { formatPlatformDateTime } from "@/lib/platform-preferences";

export const Route = createFileRoute("/$projectId/audit-logs/")({
  component: AuditLogsPage,
});

const pageSize = 50;
const emptyFacets: PlatformAuditLogFacets = {
  actors: [],
  actions: [],
  objectTypes: [],
};
const timeRanges: Array<{ label: string; value: AuditTimeRange }> = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "All time", value: "all" },
];

function AuditFiltersPopover({
  facets,
  filters,
  onChange,
}: {
  facets: PlatformAuditLogFacets;
  filters: AuditLogFilters;
  onChange: (filters: AuditLogFilters) => void;
}) {
  const activeCount = countAdvancedAuditFilters(filters);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-11">
          <Filter />
          Filters
          {activeCount ? (
            <span className="grid size-5 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="w-[min(92vw,22rem)] overflow-y-auto p-4"
        style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Filter activity</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Combine filters to narrow the complete Project trail.
            </p>
          </div>
          <SlidersHorizontal className="size-4 text-muted-foreground" />
        </div>
        <div className="mt-4 grid gap-4">
          <label>
            <span className="mb-1.5 block text-xs text-muted-foreground">Actor</span>
            <Select
              value={filters.actorId}
              onValueChange={(actorId) => onChange({ ...filters, actorId })}
            >
              <SelectTrigger size="lg" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actors</SelectItem>
                {facets.actors.map((actor) => (
                  <SelectItem key={actor.id} value={actor.id}>{actor.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs text-muted-foreground">Action</span>
            <Select
              value={filters.action}
              onValueChange={(action) => onChange({ ...filters, action })}
            >
              <SelectTrigger size="lg" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {facets.actions.map((action) => (
                  <SelectItem key={action} value={action}>{auditActionLabel(action)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs text-muted-foreground">Object type</span>
            <Select
              value={filters.objectType}
              onValueChange={(objectType) => onChange({ ...filters, objectType })}
            >
              <SelectTrigger size="lg" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All object types</SelectItem>
                {facets.objectTypes.map((objectType) => (
                  <SelectItem key={objectType} value={objectType}>{objectType}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs text-muted-foreground">Outcome</span>
            <Select
              value={filters.outcome}
              onValueChange={(outcome) => onChange({
                ...filters,
                outcome: outcome as AuditLogFilters["outcome"],
              })}
            >
              <SelectTrigger size="lg" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="denied">Denied</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="mt-4 w-full"
          disabled={!activeCount}
          onClick={() => onChange({
            ...filters,
            actorId: "all",
            action: "all",
            objectType: "all",
            outcome: "all",
          })}
        >
          <X />
          Clear advanced filters
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function RestrictedAuditLogs() {
  return (
    <section
      className="mx-auto max-w-xl rounded-lg border bg-background p-6"
      aria-labelledby="audit-logs-restricted"
    >
      <ShieldCheck className="size-8 text-muted-foreground" />
      <h1 id="audit-logs-restricted" className="mt-4 font-display text-[1.625rem] font-light leading-tight tracking-[0.005em]">
        Audit Logs are restricted
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Only Project administrators can review user activity, authorization
        decisions, and retained request metadata for this Project.
      </p>
    </section>
  );
}

function MobileAuditLogList({
  events,
  onClose,
  onSelect,
  selectedEventId,
}: {
  events: readonly PlatformAuditLogEvent[];
  onClose: () => void;
  onSelect: (event: PlatformAuditLogEvent) => void;
  selectedEventId: string | undefined;
}) {
  return (
    <ol className="divide-y lg:hidden">
      {events.map((event) => {
        const selected = event.id === selectedEventId;
        return (
          <li key={event.id}>
            <button
              type="button"
              onClick={() => onSelect(event)}
              className="group grid min-h-16 w-full grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-3 px-4 text-left transition-colors hover:bg-muted/25 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
              aria-label={`${selected ? "Close" : "Open"} audit details: ${event.summary}`}
              aria-controls={`audit-event-details-${event.id}-mobile`}
              aria-expanded={selected}
            >
              <span className="min-w-0 py-2.5">
                <span className="flex items-center justify-between gap-3">
                  <time
                    dateTime={event.occurredAt}
                    className="font-mono text-[10px] tabular-nums text-muted-foreground"
                  >
                    {formatPlatformDateTime(event.occurredAt, {
                      dateStyle: "short",
                      timeStyle: "medium",
                    })}
                  </time>
                  <AuditLogOutcomeMark outcome={event.outcome} />
                </span>
                <span className="mt-1.5 block truncate text-[11px] leading-4">
                  <strong className="font-medium">{event.actor.name}</strong>
                  <span className="mx-1.5 font-mono text-[10px] uppercase text-primary">
                    {event.verb}
                  </span>
                  <span className="text-muted-foreground">{event.object.type} / </span>
                  {event.object.name}
                </span>
              </span>
              <ChevronRight
                className={selected
                  ? "size-3.5 rotate-90 justify-self-end text-foreground transition-transform"
                  : "size-3.5 justify-self-end text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"}
              />
            </button>
            {selected ? (
              <AuditLogDetailPanel
                event={event}
                id={`audit-event-details-${event.id}-mobile`}
                onClose={onClose}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function AuditLogsPage() {
  const { currentProject } = useProject();
  const permissions = useProjectPermissions();
  const scope = useProjectQueryScope();
  const [filters, setFilters] = useState(defaultAuditLogFilters);
  const [debouncedQuery, setDebouncedQuery] = useState(filters.query);
  const [direction, setDirection] = useState<PlatformAuditSortDirection>("desc");
  const [cursorHistory, setCursorHistory] = useState([""]);
  const [pageIndex, setPageIndex] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<PlatformAuditLogEvent>();
  const [exporting, setExporting] = useState(false);
  const cursor = cursorHistory[pageIndex] || undefined;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(filters.query), 300);
    return () => window.clearTimeout(timer);
  }, [filters.query]);

  const queryFilters = useMemo(
    () => auditFiltersToQuery(
      { ...filters, query: debouncedQuery },
      Date.now(),
    ),
    [
      debouncedQuery,
      filters.action,
      filters.actorId,
      filters.objectType,
      filters.outcome,
      filters.timeRange,
      refreshTick,
    ],
  );
  const request = useMemo(
    () => ({
      ...queryFilters,
      ...(cursor ? { cursor } : {}),
      direction,
      limit: pageSize,
    }),
    [cursor, direction, queryFilters],
  );
  const logs = useQuery({
    queryKey: scope.key("audit-logs", request),
    queryFn: () => api.listAuditLogs(request),
    enabled: permissions.canViewAuditLogs,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const events = logs.data?.data ?? [];
  const totalCount = logs.data?.totalCount ?? 0;
  const firstVisible = totalCount ? pageIndex * pageSize + 1 : 0;
  const lastVisible = firstVisible ? firstVisible + events.length - 1 : 0;
  const selectEvent = useCallback((event: PlatformAuditLogEvent) => {
    setSelectedEvent((current) => current?.id === event.id ? undefined : event);
  }, []);
  const closeSelectedEvent = useCallback(() => setSelectedEvent(undefined), []);
  const resetPagination = () => {
    setCursorHistory([""]);
    setPageIndex(0);
  };
  const changeFilters = (next: AuditLogFilters) => {
    setFilters(next);
    resetPagination();
  };
  const changeDirection = (next: PlatformAuditSortDirection) => {
    setDirection(next);
    resetPagination();
  };
  const nextPage = () => {
    const nextCursor = logs.data?.nextCursor;
    if (!nextCursor) return;
    setCursorHistory((current) => [
      ...current.slice(0, pageIndex + 1),
      nextCursor,
    ]);
    setPageIndex((current) => current + 1);
  };
  const previousPage = () => setPageIndex((current) => Math.max(0, current - 1));
  const exportLogs = async () => {
    if (!currentProject) return;
    setExporting(true);
    try {
      const exported = await api.exportAuditLogs({
        ...auditFiltersToQuery(filters),
        direction,
      });
      downloadBlob(exported.fileName, exported.blob);
    } finally {
      setExporting(false);
    }
  };
  const resetFilters = () => {
    setFilters(defaultAuditLogFilters);
    setDebouncedQuery("");
    resetPagination();
  };
  const hasFilters =
    filters.query.trim() !== ""
    || filters.timeRange !== defaultAuditLogFilters.timeRange
    || countAdvancedAuditFilters(filters) > 0;

  if (!currentProject) {
    return (
      <div className="grid min-h-72 place-items-center text-sm text-muted-foreground">
        Loading Project audit logs…
      </div>
    );
  }
  if (!permissions.canViewAuditLogs) return <RestrictedAuditLogs />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Review who performed an action, what changed, and whether authorization allowed it."
        badge={<Badge variant="outline" className="gap-1.5"><LockKeyhole />Admin only</Badge>}
        actions={
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={!totalCount || exporting}
            onClick={() => void exportLogs()}
          >
            {exporting ? <Spinner /> : <Download />}
            {exporting ? "Preparing CSV" : "Export CSV"}
          </Button>
        }
      />

      <div className="flex items-start gap-3 border-l-2 border-primary bg-primary/5 px-4 py-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-xs leading-5 text-muted-foreground">
          This is a read-only Project trail. Request bodies are stored as expandable
          attachments with credentials and secrets excluded.
        </p>
      </div>

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="relative w-full lg:max-w-md lg:flex-1">
              <span className="sr-only">Search audit logs</span>
              <Search className="pointer-events-none absolute bottom-3.5 left-3 size-4 text-muted-foreground" />
              <Input
                value={filters.query}
                onChange={(event) => changeFilters({
                  ...filters,
                  query: event.target.value,
                })}
                placeholder="Search actor, action, object, or request ID"
                className="h-11 pl-9"
              />
            </label>
            <div className="ml-auto flex w-full flex-wrap items-end justify-end gap-3 lg:w-auto">
              <label className="w-44">
                <span className="mb-1 block text-xs text-muted-foreground">Time range</span>
                <Select
                  value={filters.timeRange}
                  onValueChange={(timeRange) => changeFilters({
                    ...filters,
                    timeRange: timeRange as AuditTimeRange,
                  })}
                >
                  <SelectTrigger size="lg" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {timeRanges.map((range) => (
                      <SelectItem key={range.value} value={range.value}>{range.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <AuditFiltersPopover
                facets={logs.data?.facets ?? emptyFacets}
                filters={filters}
                onChange={changeFilters}
              />
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                className="size-11"
                disabled={logs.isFetching}
                aria-label="Refresh audit logs"
                onClick={() => setRefreshTick((current) => current + 1)}
              >
                {logs.isFetching ? <Spinner /> : <RefreshCw />}
              </Button>
            </div>
          </div>
          <div className="mt-3 flex min-h-6 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span aria-live="polite" className="tabular-nums">
              {logs.isPending
                ? "Loading events…"
                : totalCount
                  ? `${firstVisible}–${lastVisible} of ${totalCount} events`
                  : "0 events"}
            </span>
            {hasFilters ? (
              <Button type="button" size="xs" variant="ghost" onClick={resetFilters}>
                <X />Clear filters
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="px-0">
          {logs.isPending ? (
            <div className="divide-y" aria-label="Loading audit events">
              {[0, 1, 2, 3, 4].map((item) => (
                <div
                  key={item}
                  className="grid min-h-16 grid-cols-[7rem_1fr_4rem] items-center gap-3 px-4 lg:min-h-11 lg:grid-cols-[10.5rem_1fr_7.25rem_1.4fr_5.5rem]"
                >
                  <span className="h-2.5 animate-pulse rounded-sm bg-muted" />
                  <span className="h-2.5 animate-pulse rounded-sm bg-muted/80" />
                  <span className="h-2.5 animate-pulse rounded-sm bg-muted/70" />
                </div>
              ))}
            </div>
          ) : logs.error ? (
            <div role="alert" className="m-5 border-l-2 border-destructive bg-destructive/5 p-4">
              <p className="text-sm font-medium text-destructive">
                Audit events could not be loaded.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{logs.error.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void logs.refetch()}
              >
                <RefreshCw />Try again
              </Button>
            </div>
          ) : events.length ? (
            <>
              <AuditLogTable
                direction={direction}
                events={events}
                onClose={closeSelectedEvent}
                onDirectionChange={changeDirection}
                onSelect={selectEvent}
                selectedEventId={selectedEvent?.id}
              />
              <MobileAuditLogList
                events={events}
                onClose={closeSelectedEvent}
                onSelect={selectEvent}
                selectedEventId={selectedEvent?.id}
              />
              <div className="flex min-h-14 items-center justify-between gap-3 border-t px-4">
                <p className="text-xs text-muted-foreground">
                  Page {pageIndex + 1}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pageIndex === 0 || logs.isFetching}
                    onClick={previousPage}
                  >
                    <ChevronLeft />
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!logs.data?.nextCursor || logs.isFetching}
                    onClick={nextPage}
                  >
                    Next
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="grid min-h-72 place-items-center px-6 py-12 text-center">
              <div>
                <Filter className="mx-auto size-7 text-muted-foreground" />
                <h2 className="mt-4 font-medium">No matching audit events</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Adjust the search, time range, or advanced filters.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={resetFilters}
                >
                  Clear filters
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
