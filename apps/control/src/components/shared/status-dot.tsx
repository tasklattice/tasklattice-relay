import { cn } from "@/lib/utils";
import { statusToneClass, type StatusTone } from "@/components/shared/status";

export function StatusDot({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: StatusTone;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium">
      <span
        className={cn(
          "size-2 rounded-full",
          statusToneClass(tone, "dot"),
        )}
      />
      {label}
    </span>
  );
}
