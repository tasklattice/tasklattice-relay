import type { ReactNode } from "react";
import type { MemoryStatus } from "@tali/contracts";
import { AlertTriangle, ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import { StatusDot } from "@/components/shared/status-dot";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const statusLabels: Record<MemoryStatus, string> = {
  provisioning: "Provisioning",
  ready: "Ready",
  degraded: "Degraded",
  unbound: "Unbound",
  deleting: "Deleting",
  deletion_failed: "Deletion failed",
  deleted: "Deleted",
};

export function MemoryStatus({ status }: { status: MemoryStatus }) {
  return (
    <StatusDot
      label={statusLabels[status]}
      tone={status === "ready"
        ? "success"
        : status === "degraded" || status === "provisioning" || status === "deleting"
          ? "warning"
          : status === "deletion_failed"
            ? "danger"
            : "neutral"}
    />
  );
}

export function MemoryNotice({
  action,
  children,
  tone = "info",
}: {
  action?: ReactNode;
  children: ReactNode;
  tone?: "info" | "warning" | "error" | "success";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex min-h-11 flex-wrap items-center justify-between gap-3 border-l-2 px-4 py-3 text-sm",
        tone === "info" && "border-primary bg-primary/5",
        tone === "warning" && "border-amber-500 bg-amber-500/5",
        tone === "error" && "border-destructive bg-destructive/5 text-destructive",
        tone === "success" && "border-emerald-500 bg-emerald-500/5",
      )}
    >
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  );
}

export function MemoryErrorState({
  error,
  onRetry,
  title = "Memory data unavailable",
}: {
  error: unknown;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed px-6 py-14 text-center">
      <div className="max-w-lg">
        <AlertTriangle className="mx-auto size-8 text-destructive" />
        <strong className="mt-4 block">{title}</strong>
        <p role="alert" className="mt-2 text-sm leading-6 text-muted-foreground">
          {errorMessage(error) || "The request could not be completed."}
        </p>
        <Button type="button" variant="outline" className="mt-5 h-11" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      </div>
    </div>
  );
}

export function CursorPagination({
  canNext,
  canPrevious,
  itemCount,
  onNext,
  onPrevious,
  totalCount,
}: {
  canNext: boolean;
  canPrevious: boolean;
  itemCount: number;
  onNext: () => void;
  onPrevious: () => void;
  totalCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing {itemCount} of {totalCount}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11" disabled={!canPrevious} onClick={onPrevious}>
          <ArrowLeft /> Previous
        </Button>
        <Button type="button" variant="outline" className="h-11" disabled={!canNext} onClick={onNext}>
          Next <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

export function formatMemoryDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(date);
}

export function formatRelativeMemoryDate(value: string | null | undefined): string {
  if (!value) return "No activity yet";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Unknown";
  const minutes = Math.round((timestamp - Date.now()) / 60_000);
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return relative.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 60) return relative.format(days, "day");
  return formatMemoryDate(value, { timeStyle: undefined });
}

export function humanizeMemoryAction(value: string): string {
  return value
    .replace(/^memory\./, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

export function saveDownloadedFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
