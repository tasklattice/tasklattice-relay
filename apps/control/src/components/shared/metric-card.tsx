import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MetricCard({
  disabled,
  icon: Icon,
  label,
  value,
}: {
  disabled?: boolean;
  icon?: LucideIcon;
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <Card className={cn(disabled && "opacity-50")}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
        {Icon ? <CardAction className="grid size-9 place-items-center rounded-md border bg-muted/20 text-link"><Icon className="size-4" /></CardAction> : null}
      </CardHeader>
    </Card>
  );
}
