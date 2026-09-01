import type { LucideIcon } from "lucide-react";
import { Activity, CheckCircle2, CircleAlert, CircleHelp, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "danger" | "info" | "neutral" | "success" | "warning";

const systemStatusTones: Record<string, StatusTone> = {
  READY: "success",
  READY_TO_PUBLISH: "success",
  HEALTHY: "success",
  SUCCEEDED: "success",
  PASSED: "success",
  VALIDATED: "success",
  PUBLISHED: "success",
  SYNCHRONIZED: "success",
  CONNECTED: "success",
  DISCOVERABLE: "success",
  AVAILABLE: "success",
  REGISTERED: "success",
  DELIVERED: "success",
  OK: "success",
  COMPLETE: "success",
  COMPLETED: "success",
  FAILED: "danger",
  ERROR: "danger",
  REJECTED: "danger",
  BLOCKED: "danger",
  DELETION_FAILED: "danger",
  UNAVAILABLE: "danger",
  NON_COMPLIANT: "danger",
  UNSUPPORTED: "danger",
  TIMED_OUT: "danger",
  DEAD_LETTER: "danger",
  DEGRADED: "warning",
  DRIFTED: "warning",
  VALIDATION_REQUIRED: "warning",
  NEEDS_WORK: "warning",
  ATTENTION_REQUIRED: "warning",
  PERMISSION_REQUIRED: "warning",
  PARTIAL: "warning",
  RETRY: "warning",
  INVALIDATED: "warning",
  PROVISIONING: "info",
  ACTIVATING: "info",
  RUNNING: "info",
  PENDING: "info",
  QUEUED: "info",
  SYNCING: "info",
  PROCESSING: "info",
  CREATING: "info",
  CHECKING: "info",
  IN_PROGRESS: "info",
  VALIDATING: "info",
  ACTIVE: "info",
  ENABLED: "info",
  INACTIVE: "neutral",
  DRAFT: "neutral",
  DISABLED: "neutral",
  PAUSED: "neutral",
  NOT_RUN: "neutral",
  UNKNOWN: "neutral",
  DESTROYING: "neutral",
  DELETING: "neutral",
  UNBOUND: "neutral",
  CANCELLED: "neutral",
  DELETED: "neutral",
  DETACHED: "neutral",
  SUSPENDED: "neutral",
  UNCHECKED: "neutral",
  COMING_SOON: "neutral",
};

const animatedSystemStatuses = new Set([
  "ACTIVATING",
  "CHECKING",
  "CREATING",
  "IN_PROGRESS",
  "PROCESSING",
  "PROVISIONING",
  "QUEUED",
  "RUNNING",
  "SYNCING",
  "VALIDATING",
]);

const toneStyles: Record<StatusTone, {
  badge: string;
  border: string;
  dot: string;
  icon: string;
  surface: string;
}> = {
  danger: {
    badge: "border-destructive-border bg-destructive-surface text-destructive",
    border: "border-destructive-border",
    dot: "bg-destructive",
    icon: "bg-destructive-surface text-destructive",
    surface: "bg-destructive-surface",
  },
  info: {
    badge: "border-info-border bg-info-surface text-info-foreground",
    border: "border-info-border",
    dot: "bg-info",
    icon: "bg-info-surface text-info-foreground",
    surface: "bg-info-surface",
  },
  neutral: {
    badge: "border-border bg-muted/65 text-foreground",
    border: "border-border",
    dot: "bg-muted-foreground/55",
    icon: "bg-muted text-muted-foreground",
    surface: "bg-muted/35",
  },
  success: {
    badge: "border-success-border bg-success-surface text-success-foreground",
    border: "border-success-border",
    dot: "bg-success",
    icon: "bg-success-surface text-success-foreground",
    surface: "bg-success-surface",
  },
  warning: {
    badge: "border-warning-border bg-warning-surface text-warning-foreground",
    border: "border-warning-border",
    dot: "bg-warning",
    icon: "bg-warning-surface text-warning-foreground",
    surface: "bg-warning-surface",
  },
};

const defaultIcons: Record<StatusTone, LucideIcon> = {
  danger: CircleAlert,
  info: Info,
  neutral: CircleHelp,
  success: CheckCircle2,
  warning: Activity,
};

export function statusToneClass(tone: StatusTone, role: keyof (typeof toneStyles)[StatusTone]): string {
  return toneStyles[tone][role];
}

export function normalizeSystemStatus(status: string): string {
  return status.trim().replace(/[\s-]+/g, "_").toUpperCase();
}

export function systemStatusTone(status: string): StatusTone {
  return systemStatusTones[normalizeSystemStatus(status)] ?? "neutral";
}

export function formatSystemStatus(status: string): string {
  return normalizeSystemStatus(status)
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (value) => value.toUpperCase());
}

export function StatusBadge({
  className,
  label,
  pulse = false,
  tone = "neutral",
}: {
  className?: string;
  label: string;
  pulse?: boolean;
  tone?: StatusTone;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 px-2", toneStyles[tone].badge, className)}
    >
      <span className="relative flex size-2" aria-hidden>
        {pulse ? <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-35 motion-reduce:animate-none", toneStyles[tone].dot)} /> : null}
        <span className={cn("relative inline-flex size-2 rounded-full", toneStyles[tone].dot)} />
      </span>
      {label}
    </Badge>
  );
}

export function RuntimeStatusBadge({ status }: { status: string }) {
  return <SystemStatusBadge status={status} />;
}

export function SystemStatusBadge({
  label,
  pulse,
  status,
  tone,
}: {
  label?: string;
  pulse?: boolean;
  status: string;
  tone?: StatusTone;
}) {
  const normalized = normalizeSystemStatus(status);
  return (
    <StatusBadge
      label={label ?? formatSystemStatus(normalized)}
      tone={tone ?? systemStatusTone(normalized)}
      pulse={pulse ?? animatedSystemStatuses.has(normalized)}
    />
  );
}

export function StatusIcon({
  className,
  icon,
  tone = "neutral",
}: {
  className?: string;
  icon?: LucideIcon;
  tone?: StatusTone;
}) {
  const Icon = icon ?? defaultIcons[tone];
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-md", toneStyles[tone].icon, className)}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

export function StatusSummaryCard({
  action,
  description,
  eyebrow,
  label,
  tone = "neutral",
  value,
}: {
  action?: ReactNode;
  description: ReactNode;
  eyebrow: string;
  label: string;
  tone?: StatusTone;
  value: ReactNode;
}) {
  return (
    <article className={cn("flex min-h-36 flex-col justify-between rounded-lg border p-5", toneStyles[tone].border, toneStyles[tone].surface)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-3xl font-medium tracking-tight tabular-nums">{value}</p>
            <StatusBadge label={label} tone={tone} />
          </div>
        </div>
        <StatusIcon tone={tone} />
      </div>
      <div className="mt-4 flex flex-col gap-3 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-md">{description}</p>
        {action}
      </div>
    </article>
  );
}

export function StatusBanner({
  action,
  children,
  className,
  title,
  tone = "neutral",
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  title: string;
  tone?: StatusTone;
}) {
  return (
    <section
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center", toneStyles[tone].border, toneStyles[tone].surface, className)}
    >
      <StatusIcon tone={tone} />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{children}</div>
      </div>
      {action}
    </section>
  );
}
