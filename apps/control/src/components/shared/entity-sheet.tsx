import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const widthClasses = {
  memory: "!w-full sm:!w-[min(96vw,35rem)] sm:!max-w-[35rem]",
  md: "!w-full sm:!w-[min(96vw,40rem)] sm:!max-w-[40rem]",
  lg: "!w-full sm:!w-[min(96vw,48rem)] sm:!max-w-[48rem]",
  xl: "!w-full sm:!w-[min(96vw,56rem)] sm:!max-w-[56rem]",
} as const;

export function EntityDetailList({
  items,
}: {
  items: readonly {
    label: string;
    value: ReactNode;
    mono?: boolean;
  }[];
}) {
  return (
    <dl className="divide-y border-y text-sm">
      {items.map((item) => (
        <div key={item.label} className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className={cn("min-w-0 break-words font-medium", item.mono && "font-mono text-xs")}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function EntitySheet({
  bodyClassName,
  children,
  description,
  eyebrow,
  footer,
  onOpenChange,
  open,
  title,
  width = "lg",
}: {
  bodyClassName?: string;
  children: ReactNode;
  description: ReactNode;
  eyebrow?: string;
  footer: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: ReactNode;
  width?: keyof typeof widthClasses;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "gap-0 overflow-hidden bg-background [&>button]:size-11",
          widthClasses[width],
        )}
      >
        <SheetHeader className="shrink-0 gap-1.5 border-b px-5 py-5 pr-14 sm:px-6">
          {eyebrow ? (
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <SheetTitle className="text-2xl">{title}</SheetTitle>
          <SheetDescription className="max-w-2xl leading-5">
            {description}
          </SheetDescription>
        </SheetHeader>

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-5 sm:px-6",
            bodyClassName,
          )}
        >
          {children}
        </div>

        <SheetFooter className="shrink-0 flex-col-reverse items-stretch justify-end gap-2 border-t px-5 py-4 sm:flex-row sm:items-center sm:px-6 [&_[data-slot=button]]:h-11">
          {footer}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
