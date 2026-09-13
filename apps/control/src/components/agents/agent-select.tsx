import type { AgentPlatformId } from "@tali/contracts";
import { AgentPlatformIcon } from "@/components/agents/agent-platform-icon";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { agentPlatformPresentations, getAgentPlatformPresentation } from "@/lib/agent-platforms";

export function AgentSelect({
  id,
  onValueChange,
  required = false,
  value,
}: {
  id?: string;
  onValueChange: (value: AgentPlatformId) => void;
  required?: boolean;
  value: AgentPlatformId;
}) {
  const selected = getAgentPlatformPresentation(value);
  return (
    <Select required={required} value={value} onValueChange={(next) => onValueChange(next as AgentPlatformId)}>
      <SelectTrigger id={id} className="h-auto min-h-16 w-full py-2.5">
        <SelectValue>
          <AgentIdentity platform={selected} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {agentPlatformPresentations.map((platform) => (
          <SelectItem key={platform.id} value={platform.id} className="py-3">
            <AgentIdentity platform={platform} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AgentIdentity({
  platform,
}: {
  platform: ReturnType<typeof getAgentPlatformPresentation>;
}) {
  return (
    <span className="flex min-w-0 items-center gap-3 text-left">
      <AgentPlatformIcon platform={platform} className="size-8 rounded-sm" imageClassName="size-6" />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <strong className="text-sm">{platform.name}</strong>
          {platform.isDefault ? <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Default</span> : null}
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap gap-1.5">
          {platform.catalog.tags.slice(0, 3).map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="h-4 px-1.5 text-[10px] font-normal"
            >
              {tag}
            </Badge>
          ))}
        </span>
      </span>
    </span>
  );
}
