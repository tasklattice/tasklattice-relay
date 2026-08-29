import type { Instance as Agent } from "@tali/contracts";
import { Download, Maximize2, Minimize2, Search, WrapText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatPlatformDateTime } from "@/lib/platform-preferences";
import { DetailTabIntro } from "./instance-detail-shared";
import {
  auditorLogLevels,
  formatAuditorLogTime,
  serializeAuditorLogs,
  type AuditorLogEntry,
  type AuditorLogLevel,
  type AuditorLogLevelFilter,
  type AuditorLogTimeRange,
} from "./auditor-log-utils";
import { useAuditorLog } from "./use-auditor-log";

const auditorLogStreams = [
  "all",
  "sandbox",
  "runtime",
  "system",
  "control-plane",
] as const;
type AuditorLogStream = (typeof auditorLogStreams)[number];

const streamLabels: Record<AuditorLogStream, string> = {
  all: "All log streams",
  sandbox: "Sandbox",
  runtime: "Runtime",
  system: "System",
  "control-plane": "Control plane",
};

const levelLabels: Record<AuditorLogLevelFilter, string> = {
  all: "All levels",
  info: "Info",
  warning: "Warning",
  error: "Error",
  debug: "Debug",
};

const levelStyles: Record<AuditorLogLevel, string> = {
  info: "text-emerald-400",
  warning: "text-amber-300",
  error: "text-red-400",
  debug: "text-zinc-500",
};

function LiveSwitch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`Live ${checked ? "on" : "off"}`}
      onClick={() => onCheckedChange(!checked)}
      className="inline-flex min-h-11 items-center gap-2 rounded-sm px-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span>Live</span>
      <span
        className={cn(
          "relative h-6 w-11 rounded-full border transition-colors",
          checked ? "border-primary bg-primary" : "border-input bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-[18px] rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[20px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

function AuditorLogToolbar({
  fullScreen,
  level,
  live,
  onDownload,
  onFullScreen,
  onLevelChange,
  onLiveChange,
  onSearchChange,
  onStreamChange,
  onTimeRangeChange,
  onWrapLinesChange,
  search,
  stream,
  timeRange,
  wrapLines,
}: {
  fullScreen: boolean;
  level: AuditorLogLevelFilter;
  live: boolean;
  onDownload: () => void;
  onFullScreen: () => void;
  onLevelChange: (value: AuditorLogLevelFilter) => void;
  onLiveChange: (value: boolean) => void;
  onSearchChange: (value: string) => void;
  onStreamChange: (value: AuditorLogStream) => void;
  onTimeRangeChange: (value: AuditorLogTimeRange) => void;
  onWrapLinesChange: (value: boolean) => void;
  search: string;
  stream: AuditorLogStream;
  timeRange: AuditorLogTimeRange;
  wrapLines: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
      <Select
        value={stream}
        onValueChange={(value) => onStreamChange(value as AuditorLogStream)}
      >
        <SelectTrigger aria-label="Filter by log stream" className="min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {auditorLogStreams.map((value) => (
            <SelectItem key={value} value={value}>
              {streamLabels[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={level}
        onValueChange={(value) => onLevelChange(value as AuditorLogLevelFilter)}
      >
        <SelectTrigger aria-label="Filter by log level" className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["all", ...auditorLogLevels] as AuditorLogLevelFilter[]).map(
            (value) => (
              <SelectItem key={value} value={value}>
                {levelLabels[value]}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
      <Select
        value={timeRange}
        onValueChange={(value) =>
          onTimeRangeChange(value as AuditorLogTimeRange)
        }
      >
        <SelectTrigger aria-label="Filter by time range" className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="15m">Last 15 minutes</SelectItem>
          <SelectItem value="1h">Last 1 hour</SelectItem>
          <SelectItem value="24h">Last 24 hours</SelectItem>
          <SelectItem value="all">All time</SelectItem>
        </SelectContent>
      </Select>
      <label className="relative min-w-52 flex-[1_1_16rem]">
        <span className="sr-only">Search logs</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search logs..."
          className="pl-9"
        />
      </label>
      <LiveSwitch checked={live} onCheckedChange={onLiveChange} />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Download visible logs"
        title="Download visible logs"
        onClick={onDownload}
      >
        <Download />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`${wrapLines ? "Disable" : "Enable"} line wrapping`}
        title={`${wrapLines ? "Disable" : "Enable"} line wrapping`}
        aria-pressed={wrapLines}
        onClick={() => onWrapLinesChange(!wrapLines)}
      >
        <WrapText />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={fullScreen ? "Exit full screen" : "Enter full screen"}
        title={fullScreen ? "Exit full screen" : "Enter full screen"}
        onClick={onFullScreen}
      >
        {fullScreen ? <Minimize2 /> : <Maximize2 />}
      </Button>
    </div>
  );
}

function LogLine({
  entry,
  gridTemplateColumns,
  wrapLines,
}: {
  entry: AuditorLogEntry;
  gridTemplateColumns: string;
  wrapLines: boolean;
}) {
  return (
    <div
      className="grid min-h-7 min-w-[48rem] items-start gap-3 border-b border-white/[0.035] px-4 py-1 text-[12px] leading-5 hover:bg-white/[0.035]"
      style={{ gridTemplateColumns }}
    >
      <span className="text-zinc-500">
        {formatAuditorLogTime(entry.timestamp)}
      </span>
      <span className={cn("font-medium", levelStyles[entry.level])}>
        {entry.level.toUpperCase()}
      </span>
      <span className="truncate text-cyan-400" title={entry.source}>
        {entry.source}
      </span>
      <span
        className={cn(
          "min-w-0 text-zinc-300",
          wrapLines ? "whitespace-pre-wrap break-words" : "whitespace-pre",
          entry.level === "error" && "text-red-300",
        )}
      >
        {entry.message}
      </span>
      <time
        dateTime={entry.timestamp}
        className="text-right text-zinc-500"
        title={formatPlatformDateTime(entry.timestamp)}
      >
        {formatAuditorLogTime(entry.timestamp, false)}
      </time>
    </div>
  );
}

function AuditorLogViewer({
  autoScroll,
  entries,
  error,
  fullScreen,
  isLoading,
  onAutoScrollChange,
  onRetry,
  wrapLines,
}: {
  autoScroll: boolean;
  entries: AuditorLogEntry[];
  error?: Error;
  fullScreen: boolean;
  isLoading: boolean;
  onAutoScrollChange: (value: boolean) => void;
  onRetry: () => void;
  wrapLines: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const gridTemplateColumns = useMemo(() => {
    if (wrapLines) return "7rem 4.75rem 6.5rem minmax(16rem, 1fr) 6.25rem";
    const longestMessage = entries.reduce(
      (length, entry) => Math.max(length, entry.message.length),
      0,
    );
    const messageWidth = Math.max(256, Math.min(1600, longestMessage * 7.2));
    return `7rem 4.75rem 6.5rem ${messageWidth}px 6.25rem`;
  }, [entries, wrapLines]);

  useEffect(() => {
    if (!autoScroll) return;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [autoScroll, entries]);

  return (
    <div
      id="provisioning-logs"
      className={cn(
        "min-w-0 scroll-mt-24 p-3 font-mono sm:p-4",
        fullScreen && "flex min-h-0 flex-1 flex-col",
      )}
    >
      <div
        className={cn(
          "overflow-hidden rounded-sm border border-zinc-800 bg-[#111216] shadow-sm",
          fullScreen && "flex min-h-0 flex-1 flex-col",
        )}
      >
        {error ? (
          <div
            role="alert"
            className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-amber-400/25 bg-amber-400/[0.06] px-4 py-2 text-xs text-amber-200"
          >
            <span>
              Unable to load logs. Existing buffered lines are still available.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="font-sans text-amber-100 hover:bg-amber-300/10 hover:text-amber-50"
              onClick={onRetry}
            >
              Retry
            </Button>
          </div>
        ) : null}
        <div
          ref={viewportRef}
          className={cn(
            "h-[32rem] overflow-auto",
            fullScreen && "h-auto min-h-0 flex-1",
          )}
          onScroll={(event) => {
            const viewport = event.currentTarget;
            onAutoScrollChange(
              viewport.scrollHeight -
                viewport.scrollTop -
                viewport.clientHeight <=
                48,
            );
          }}
        >
          <div
            className="sticky top-0 z-10 grid min-w-[48rem] gap-3 border-b border-zinc-700 bg-[#17181d] px-4 py-2 text-[10px] font-medium tracking-[0.08em] text-zinc-400"
            style={{ gridTemplateColumns }}
          >
            <span>TIME</span>
            <span>LEVEL</span>
            <span>SOURCE</span>
            <span>MESSAGE</span>
            <span className="text-right">TIMESTAMP</span>
          </div>
          <div className="min-w-[48rem]">
            {isLoading ? (
              <div aria-label="Loading logs" className="space-y-2 p-4">
                <span className="sr-only">Loading logs...</span>
                {Array.from({ length: 9 }, (_, index) => (
                  <div
                    key={index}
                    className="h-4 animate-pulse bg-zinc-800"
                    style={{ width: `${72 + (index % 4) * 7}%` }}
                  />
                ))}
              </div>
            ) : entries.length ? (
              entries.map((entry) => (
                <LogLine
                  key={entry.id}
                  entry={entry}
                  gridTemplateColumns={gridTemplateColumns}
                  wrapLines={wrapLines}
                />
              ))
            ) : (
              <div className="grid h-48 place-items-center px-4 text-center text-sm text-zinc-500">
                <div>
                  <p>No logs found</p>
                  <p className="mt-1 text-xs">
                    Try changing the stream, level, time range, or search query.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function InstanceAuditorLogTab({
  agent,
  includeSandboxAudit = true,
}: {
  agent: Agent;
  includeSandboxAudit?: boolean;
}) {
  const moduleRef = useRef<HTMLDivElement>(null);
  const [stream, setStream] = useState<AuditorLogStream>("all");
  const [level, setLevel] = useState<AuditorLogLevelFilter>("all");
  const [timeRange, setTimeRange] = useState<AuditorLogTimeRange>("1h");
  const [live, setLive] = useState(true);
  const [search, setSearch] = useState("");
  const [wrapLines, setWrapLines] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [fullScreen, setFullScreen] = useState(false);
  const streamFilter = useMemo(() => {
    if (stream === "sandbox") return { component: "Sandbox" };
    if (stream === "runtime") return { source: "runtime" };
    if (stream === "system") return { source: "system" };
    if (stream === "control-plane") return { component: "Control plane" };
    return {};
  }, [stream]);
  const filters = useMemo(
    () => ({
      includeSandboxAudit,
      level,
      timeRange,
      live,
      search,
      ...streamFilter,
    }),
    [includeSandboxAudit, level, live, search, streamFilter, timeRange],
  );
  const logs = useAuditorLog(agent, filters);
  const visibleLogs = useMemo(() => logs.data.slice(-200), [logs.data]);

  useEffect(() => {
    const handleFullScreenChange = () =>
      setFullScreen(document.fullscreenElement === moduleRef.current);
    document.addEventListener("fullscreenchange", handleFullScreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullScreenChange);
  }, []);

  const toggleFullScreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await moduleRef.current?.requestFullscreen();
  };

  const download = () => {
    const blob = new Blob([serializeAuditorLogs(visibleLogs)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${agent.name.replace(/[^a-z0-9_-]+/gi, "-")}-auditor-log.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div role="tabpanel" aria-label="Logs" className="space-y-4 pt-5">
      <DetailTabIntro
        title="Agent logs"
        description="Inspect runtime, sandbox, system, and control-plane evidence with one set of filters."
      />
      <Card
        ref={moduleRef}
        className={cn(
          "gap-0 overflow-hidden py-0",
          fullScreen && "h-dvh w-dvw bg-background",
        )}
      >
        <AuditorLogToolbar
          fullScreen={fullScreen}
          level={level}
          live={live}
          search={search}
          stream={stream}
          timeRange={timeRange}
          wrapLines={wrapLines}
          onDownload={download}
          onFullScreen={() => void toggleFullScreen()}
          onLevelChange={setLevel}
          onLiveChange={setLive}
          onSearchChange={setSearch}
          onStreamChange={setStream}
          onTimeRangeChange={setTimeRange}
          onWrapLinesChange={setWrapLines}
        />
        <AuditorLogViewer
          autoScroll={autoScroll}
          entries={visibleLogs}
          fullScreen={fullScreen}
          isLoading={logs.isLoading}
          onAutoScrollChange={setAutoScroll}
          onRetry={() => void logs.refetch()}
          wrapLines={wrapLines}
          {...(logs.error ? { error: logs.error } : {})}
        />
      </Card>
    </div>
  );
}
