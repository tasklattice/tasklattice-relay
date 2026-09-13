import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionHeader({
  actions,
  className,
  description,
  title,
  titleId,
  ...props
}: Omit<ComponentProps<"header">, "title"> & {
  actions?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
  titleId?: string;
}) {
  return (
    <header
      className={cn("mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}
      {...props}
    >
      <div className="min-w-0">
        <h2 id={titleId} className="text-[17px] font-semibold leading-6 tracking-[-0.01em]">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </header>
  );
}
