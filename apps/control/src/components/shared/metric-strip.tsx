import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MetricStrip({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="metric-strip"
      className={cn(
        "grid grid-cols-2 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--surface-panel-border)] bg-[var(--surface-panel)] xl:grid-cols-4",
        className,
      )}
      {...props}
    />
  );
}

export function MetricStripItem({
  context,
  label,
  value,
}: {
  context: ReactNode;
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <article className="min-h-32 border-b border-[var(--surface-panel-border)] px-4 py-5 odd:border-r [&:nth-child(3)]:border-b-0 [&:nth-child(4)]:border-b-0 sm:px-5 xl:border-b-0 xl:border-r xl:odd:border-r xl:last:border-r-0">
      <p className="text-xs font-medium leading-5 text-muted-foreground">{label}</p>
      <div className="mt-2.5 flex min-h-9 items-center text-2xl font-medium leading-none tracking-[-0.025em] tabular-nums sm:text-[1.75rem]">
        {value}
      </div>
      <div className="mt-3 min-h-5 text-xs leading-5 text-muted-foreground">{context}</div>
    </article>
  );
}
