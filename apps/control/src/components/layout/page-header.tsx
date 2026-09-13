import type { ReactNode } from "react";

interface PageHeaderProps {
  actions?: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  title: string;
}

export function PageHeader({
  actions,
  badge,
  description,
  title,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col items-stretch gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[1.625rem] font-semibold leading-tight tracking-[-0.025em]">{title}</h1>
          {badge}
        </div>
        {description ? (
          <p className="mt-2 max-w-3xl text-[13px] leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </header>
  );
}
