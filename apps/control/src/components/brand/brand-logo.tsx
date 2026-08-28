import { cn } from "@/lib/utils";

export function BrandMark({
  animated = false,
  className,
}: {
  animated?: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn("brand-lattice-mark", className)}
      data-animated={animated || undefined}
      viewBox="0 0 64 64"
    >
      <g className="brand-lattice-lines" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 10h48L32 56 8 10Z" />
        <path d="M32 10v46M16 30h32M8 10l40 20M56 10 16 30M16 30l16 26M48 30 32 56" />
      </g>
      <g className="brand-lattice-nodes" fill="var(--brand-signal)" stroke="var(--brand-surface)" strokeWidth="1.5">
        <circle cx="8" cy="10" r="3.5" />
        <circle cx="32" cy="10" r="3.5" />
        <circle cx="56" cy="10" r="3.5" />
        <circle cx="16" cy="30" r="3.5" />
        <circle cx="32" cy="30" r="3.5" />
        <circle cx="48" cy="30" r="3.5" />
        <circle cx="32" cy="56" r="3.5" />
      </g>
    </svg>
  );
}

export function BrandLogo({
  animated = false,
  className,
  compact = false,
}: {
  animated?: boolean;
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-3", className)}>
      <BrandMark animated={animated} className="size-8 shrink-0" />
      {compact ? null : (
        <span className="min-w-0 leading-none">
          <strong className="block truncate font-sans text-[15px] font-medium tracking-[0.3em]">
            TALI
          </strong>
          <span className="mt-1 block truncate font-mono text-[9px] tracking-[0.12em] text-current opacity-55">
            TaskLattice Relay
          </span>
        </span>
      )}
    </span>
  );
}
