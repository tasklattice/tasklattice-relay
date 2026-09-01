import { useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  formatAbsoluteTime,
  formatRelativeTime,
  getInstanceDisplayStatus,
  instanceStatusConfig,
} from "./instance-detail-model";
import type { Instance as Agent } from "@tali/contracts";

export function InstanceStatusBadge({ status }: { status: Agent["status"] }) {
  const config = instanceStatusConfig[getInstanceDisplayStatus(status)];
  return <StatusBadge label={config.label} tone={config.tone} pulse={config.tone === "info"} />;
}

export function RelativeTime({ value }: { value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={value}>{formatRelativeTime(value)}</time>
      </TooltipTrigger>
      <TooltipContent>{formatAbsoluteTime(value)}</TooltipContent>
    </Tooltip>
  );
}

export function DetailCardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <CardHeader className="border-b">
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
    </CardHeader>
  );
}

export function DetailTabIntro({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

export function DefinitionList({
  items,
  columns = 1,
}: {
  items: Array<{ label: string; value: ReactNode }>;
  columns?: 1 | 2;
}) {
  return (
    <dl className={cn("grid gap-x-8", columns === 2 && "sm:grid-cols-2")}>
      {items.map(({ label, value }) => (
        <div
          key={label}
          className="grid min-h-11 grid-cols-[minmax(7rem,.8fr)_minmax(0,1.2fr)] items-center gap-4 border-b py-2 last:border-b-0"
        >
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words text-right text-xs font-medium sm:text-left">
            {value ?? "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CopyableValue({
  value,
  displayValue,
  externalUrl,
}: {
  value?: string | null | undefined;
  displayValue?: string | undefined;
  externalUrl?: string | undefined;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  if (!value) return <span className="text-muted-foreground">—</span>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  };

  return (
    <span className="flex min-w-0 items-center justify-end gap-1 sm:justify-start">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="min-w-0 truncate font-mono text-[11px]">
            {displayValue ?? value}
          </span>
        </TooltipTrigger>
        <TooltipContent>{value}</TooltipContent>
      </Tooltip>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => void copy()}
        aria-label={`Copy ${displayValue ?? value}`}
      >
        {copyState === "copied" ? (
          <Check className="text-emerald-600" />
        ) : (
          <Copy />
        )}
      </Button>
      {externalUrl ? (
        <Button asChild variant="ghost" size="icon">
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open endpoint in a new tab"
          >
            <ExternalLink />
          </a>
        </Button>
      ) : null}
      <span
        className={cn(
          "sr-only",
          copyState !== "idle" &&
            "not-sr-only text-[10px] text-muted-foreground",
        )}
        role="status"
      >
        {copyState === "copied"
          ? "Copied"
          : copyState === "failed"
            ? "Copy failed"
            : ""}
      </span>
    </span>
  );
}
