import { Bot } from "lucide-react";
import type { AgentPlatformPresentation } from "@/lib/agent-platforms";
import { cn } from "@/lib/utils";

export function AgentPlatformIcon({
  className,
  imageClassName,
  platform,
}: {
  className?: string;
  imageClassName?: string;
  platform: AgentPlatformPresentation;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-md border border-border bg-card shadow-xs",
        className,
      )}
    >
      {platform.brandAsset ? (
        <img
          src={platform.brandAsset}
          alt=""
          className={cn("size-8 object-contain", imageClassName)}
        />
      ) : (
        <Bot className="size-5 text-muted-foreground" />
      )}
    </span>
  );
}
