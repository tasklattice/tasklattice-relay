import { providerPresets, type ProviderKind } from "@tali/contracts";
import { ServerCog } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProviderIcon({
  presetId,
  className,
}: {
  presetId: ProviderKind;
  className?: string;
}) {
  const preset = providerPresets.find((item) => item.id === presetId);
  if (!preset) return <ServerCog aria-hidden="true" className={cn("size-6", className)} />;
  return (
    <span className={cn("grid size-11 shrink-0 place-items-center rounded-md border border-border bg-card shadow-xs", className)}>
      <img src={preset.icon} alt="" className="size-7 rounded-[5px] object-contain" />
    </span>
  );
}
