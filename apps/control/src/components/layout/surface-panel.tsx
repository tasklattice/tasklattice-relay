import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function SurfacePanel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="surface-panel"
      className={cn(
        "overflow-hidden rounded-[var(--radius-panel)] border border-[var(--surface-panel-border)] bg-[var(--surface-panel)] text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function SurfacePanelHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-slot="surface-panel-header"
      className={cn("flex min-h-16 items-start justify-between gap-4 border-b border-[var(--surface-panel-border)] px-5 py-4 sm:px-6", className)}
      {...props}
    />
  );
}

export function SurfacePanelTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      data-slot="surface-panel-title"
      className={cn("text-[15px] font-semibold leading-5 tracking-[-0.005em]", className)}
      {...props}
    />
  );
}

export function SurfacePanelDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="surface-panel-description"
      className={cn("mt-1 text-xs leading-5 text-muted-foreground", className)}
      {...props}
    />
  );
}

export function SurfacePanelContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="surface-panel-content"
      className={cn("px-5 py-5 sm:px-6", className)}
      {...props}
    />
  );
}

export function SurfacePanelFooter({ className, ...props }: ComponentProps<"footer">) {
  return (
    <footer
      data-slot="surface-panel-footer"
      className={cn("flex min-h-14 items-center border-t border-[var(--surface-panel-border)] px-5 py-3 sm:px-6", className)}
      {...props}
    />
  );
}
