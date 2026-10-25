import type { Instance as Agent } from "@tali/contracts";
import { Link } from "@tanstack/react-router";
import {
  ExternalLink,
  FileText,
  MoreHorizontal,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { AgentPlatformIcon } from "@/components/agents/agent-platform-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentPlatformPresentation } from "@/lib/agent-platforms";
import type { InstanceAccessState } from "./instance-detail-model";
import { RelativeTime } from "./instance-detail-shared";
import { InstanceDetailHeader } from "./instance-detail-layout";
import { useCurrentProjectId } from "@/hooks/use-project";

function DisabledAction({
  children,
  reason,
}: {
  children: React.ReactElement;
  reason: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function InstanceHeader({
  access,
  agent,
  canDelete,
  onDelete,
  platform,
}: {
  access: InstanceAccessState;
  agent: Agent;
  canDelete: boolean;
  onDelete: () => void;
  platform: AgentPlatformPresentation;
}) {
  const projectId = useCurrentProjectId();
  return (
    <InstanceDetailHeader
      name={agent.name}
      status={agent.status}
      icon={
        <AgentPlatformIcon
          platform={platform}
          className="size-11 shrink-0"
          imageClassName="size-8"
        />
      }
      metadata={
        <>
          <span>
            {platform.name} · {platform.runtimeName}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Updated <RelativeTime value={agent.updatedAt} />
          </span>
        </>
      }
      actions={
        <>
          {platform.interactionSurface === "terminal" &&
          access.terminal.enabled ? (
            <Button asChild className="min-h-11">
              <Link
                to="/$projectId/instances/$instanceId"
                params={{ projectId, instanceId: agent.id }}
                search={{ tab: "terminal" }}
              >
                Open TUI <SquareTerminal />
              </Link>
            </Button>
          ) : platform.interactionSurface === "terminal" ? (
            <DisabledAction
              reason={access.terminal.disabledReason ?? "Terminal unavailable"}
            >
              <Button disabled className="min-h-11">
                Open TUI <SquareTerminal />
              </Button>
            </DisabledAction>
          ) : access.webUI.enabled && access.webUI.url ? (
            <Button asChild className="min-h-11">
              <a
                href={access.webUI.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Agent <ExternalLink />
              </a>
            </Button>
          ) : (
            <DisabledAction
              reason={access.webUI.disabledReason ?? "Agent unavailable"}
            >
              <Button disabled className="min-h-11">
                Open Agent <ExternalLink />
              </Button>
            </DisabledAction>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="min-h-11">
                More <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem asChild>
                <Link
                  to="/$projectId/instances/$instanceId"
                  params={{ projectId, instanceId: agent.id }}
                  search={{ tab: "logs" }}
                  hash="provisioning-logs"
                >
                  <FileText />
                  View provisioning logs
                </Link>
              </DropdownMenuItem>
              {canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    disabled={agent.status === "DESTROYING"}
                    onSelect={onDelete}
                  >
                    <Trash2 />
                    {agent.status === "DESTROYING"
                      ? "Deletion in progress"
                      : "Delete Instance"}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}
