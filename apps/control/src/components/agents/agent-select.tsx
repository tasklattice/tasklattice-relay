import type { AgentPlatformId } from "@tali/contracts";
import { CircleHelp } from "lucide-react";
import { AgentPlatformIcon } from "@/components/agents/agent-platform-icon";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { agentPlatformPresentations, getAgentPlatformPresentation } from "@/lib/agent-platforms";

export function AgentSelect({
  id,
  onValueChange,
  value,
}: {
  id?: string;
  onValueChange: (value: AgentPlatformId) => void;
  value: AgentPlatformId;
}) {
  const selected = getAgentPlatformPresentation(value);
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as AgentPlatformId)}>
      <SelectTrigger id={id} className="min-h-14 h-auto w-full">
        <SelectValue>
          <AgentIdentity platform={selected} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {agentPlatformPresentations.map((platform) => (
          <SelectItem key={platform.id} value={platform.id} className="py-3">
            <AgentIdentity platform={platform} showDescription />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AgentSelectionDetails({ value }: { value: AgentPlatformId }) {
  const selected = getAgentPlatformPresentation(value);
  const interfaceLabel = selected.interactionSurface === "web-ui"
    ? selected.endpointLabel
    : selected.terminalLabel;

  return (
    <section
      aria-label={`${selected.name} guidance`}
      className="rounded-md border bg-muted/20 p-4"
    >
      <p className="text-sm leading-6">{selected.catalog.description}</p>
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Best for</dt>
          <dd className="mt-1 font-medium">
            {selected.catalog.tags.join(" · ")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Primary interface</dt>
          <dd className="mt-1 font-medium">{interfaceLabel}</dd>
        </div>
      </dl>
    </section>
  );
}

export function AgentTipsPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="min-h-11">
          <CircleHelp /> Agent tips
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="max-h-[min(70vh,30rem)] w-[min(90vw,28rem)] overflow-y-auto p-4"
      >
        <h3 className="text-sm font-semibold">Which Agent should I choose?</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Choose the implementation that best matches the primary work surface
          and level of specialization this Instance needs.
        </p>
        <div className="mt-3">
          {agentPlatformPresentations.map((platform, index) => (
            <section
              key={platform.id}
              className={index ? "border-t py-3" : "pb-3"}
            >
              <div className="flex items-center gap-3">
                <AgentPlatformIcon
                  platform={platform}
                  className="size-8 rounded-sm"
                  imageClassName="size-6"
                />
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold">{platform.name}</h4>
                  <p className="text-xs text-muted-foreground">
                    {platform.catalog.category} · {platform.interactionSurface === "web-ui" ? "Web UI" : "Terminal"}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {platform.catalog.description}
              </p>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AgentIdentity({
  platform,
  showDescription = false,
}: {
  platform: ReturnType<typeof getAgentPlatformPresentation>;
  showDescription?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-3 text-left">
      <AgentPlatformIcon platform={platform} className="size-8 rounded-sm" imageClassName="size-6" />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <strong className="text-sm">{platform.name}</strong>
          {platform.isDefault ? <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Default</span> : null}
        </span>
        {showDescription ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{platform.description}</span> : null}
      </span>
    </span>
  );
}
