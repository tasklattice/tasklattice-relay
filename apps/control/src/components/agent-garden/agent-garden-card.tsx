import type {
  AgentGardenEntry,
} from "@tali/contracts";
import {
  ArrowRight,
  ExternalLink,
  Play,
} from "lucide-react";
import { AgentGardenIcon } from "./agent-garden-icon";
import {
  agentStatusLabel,
  isPreviewAgent,
  previewAgentLabel,
  usageModeLabel,
} from "./agent-garden-presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AgentGardenCard({
  agent,
  canManage,
  instanceCount,
  onCreateInstance,
  onDetails,
  onTry,
}: {
  agent: AgentGardenEntry;
  canManage: boolean;
  instanceCount: number;
  onCreateInstance: () => void;
  onDetails: () => void;
  onTry: () => void;
}) {
  const ready = agent.status === "READY";
  const interactiveAction =
    agent.usageCapabilities.interactive && ready;
  const callableAction =
    agent.usageCapabilities.acceptsDelegation && ready;
  const preview = isPreviewAgent(agent);
  const language = agent.configuration.language;
  const cardTags = agent.tags
    .filter((tag) => tag !== language && tag !== "Demo")
    .slice(0, language ? 1 : 2);

  return (
    <article
      className={cn(
        "group flex min-h-52 flex-col rounded-lg border bg-card p-4 shadow-xs transition-[border-color,background-color,box-shadow,transform] duration-200",
        "hover:border-primary/25 hover:bg-accent/20",
        agent.status === "COMING_SOON" && "bg-muted/25",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <AgentGardenIcon
          type={agent.integrationType}
          catalogIcon={agent.configuration.icon}
        />
        <div className="text-right">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {agent.source === "BUILT_IN"
              ? "Built-in"
              : agent.source === "PROJECT_DEVELOPED"
                ? "Developed"
                : "Registered"}
          </span>
          {preview ? (
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
              {previewAgentLabel(agent)}
            </span>
          ) : null}
          {instanceCount ? (
            <span className="mt-1 block text-[10px] text-primary">
              {instanceCount} instantiated
            </span>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onDetails}
        className="mt-4 min-h-11 text-left focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <strong className="block text-sm leading-6 group-hover:text-primary">
          {agent.name}
        </strong>
        <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
          {agent.description}
        </span>
      </button>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge
          variant="secondary"
          className="bg-primary/8 text-primary"
        >
          {agent.platformLabel}
        </Badge>
        {agent.a2a ? (
          <Badge variant="outline">
            A2A {agent.a2a.protocolVersion}
          </Badge>
        ) : null}
        {language ? (
          <Badge variant="secondary" className="font-normal">
            {language}
          </Badge>
        ) : null}
        <Badge variant="outline">
          {usageModeLabel(agent.usageMode)}
        </Badge>
        {cardTags.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="font-normal text-muted-foreground"
          >
            {tag}
          </Badge>
        ))}
        {agent.status !== "READY" ? (
          <Badge
            variant={
              agent.status === "UNAVAILABLE"
                ? "destructive"
                : "outline"
            }
          >
            {agentStatusLabel(agent.status)}
          </Badge>
        ) : null}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <Button
          type="button"
          variant="ghost"
          className="h-11 px-2"
          onClick={onDetails}
        >
          Details
        </Button>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {preview ? (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={onTry}
            >
              <Play /> Try demo
            </Button>
          ) : null}
          {interactiveAction &&
          agent.source === "PROJECT_REGISTERED" &&
          agent.endpoint ? (
            <Button
              asChild
              variant="outline"
              className="h-11"
            >
              <a
                href={agent.endpoint}
                target="_blank"
                rel="noreferrer"
              >
                Open Agent <ExternalLink />
              </a>
            </Button>
          ) : null}
          {interactiveAction && agent.source === "BUILT_IN" ? (
            <Button
              type="button"
              className="h-11"
              onClick={onCreateInstance}
            >
              Create Instance <ArrowRight />
            </Button>
          ) : null}
          {agent.source === "PROJECT_DEVELOPED" ? (
            <Button
              type="button"
              className="h-11"
              onClick={onDetails}
            >
              Open Agent <ArrowRight />
            </Button>
          ) : null}
          {callableAction && agent.source !== "PROJECT_DEVELOPED" ? (
            <Button
              type="button"
              className="h-11"
              disabled={!canManage}
              title={
                canManage
                  ? undefined
                  : "Project resource management permission is required."
              }
              onClick={onCreateInstance}
            >
              {instanceCount ? "View Instance" : "Create Instance"} <ArrowRight />
            </Button>
          ) : null}
          {!ready && agent.status === "COMING_SOON" ? (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled
            >
              Coming soon
            </Button>
          ) : null}
          {!ready && agent.status !== "COMING_SOON" ? (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={onDetails}
            >
              Review status
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
