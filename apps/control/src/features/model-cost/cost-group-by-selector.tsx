import type { CostGroupBy } from "@tali/contracts";
import { Box, Boxes, KeyRound, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const options: Array<{ value: CostGroupBy; label: string; icon: LucideIcon }> = [
  { value: "instance", label: "Instance", icon: Boxes },
  { value: "model_endpoint", label: "Model endpoint", icon: SlidersHorizontal },
  { value: "provider_account", label: "Provider", icon: Box },
  { value: "virtual_key", label: "Virtual key", icon: KeyRound },
];

export function CostGroupBySelector({
  value,
  onValueChange,
}: {
  value: CostGroupBy;
  onValueChange: (value: CostGroupBy) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 overflow-x-auto">
      <span className="shrink-0 text-xs font-medium text-foreground">Group by</span>
      <Tabs value={value} onValueChange={(next) => onValueChange(next as CostGroupBy)}>
        <TabsList className="h-9 shrink-0 gap-0 overflow-hidden rounded-md border bg-transparent p-0">
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <TabsTrigger
                key={option.value}
                value={option.value}
                className="h-9 rounded-none border-x border-transparent px-4 first:border-l-0 last:border-r-0 data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:text-primary"
              >
                <Icon className="size-3.5" />
                {option.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </div>
  );
}
