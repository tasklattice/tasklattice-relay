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
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 flex-[1_1_18rem]">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold leading-8 tracking-[-0.025em]">{title}</h1>
          {badge}
        </div>
        {description ? (
          <p className="mt-2 max-w-3xl text-[13px] leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
