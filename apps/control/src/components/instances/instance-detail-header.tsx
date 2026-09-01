import type {
  AgentInstanceCapabilityView,
  AgentInstanceRole,
  AgentProductForm,
  AgentProtocolView,
  Instance as Agent,
} from "@tali/contracts";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  MoreHorizontal,
  Pencil,
  RefreshCw,
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
import { InstanceStatusBadge, RelativeTime } from "./instance-detail-shared";
import { InstanceWorkModeBadges } from "./instance-agent-profile";
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
  capabilities,
  form,
  onDelete,
  platform,
  protocol,
  role,
}: {
  access: InstanceAccessState;
  agent: Agent;
  canDelete: boolean;
  capabilities: AgentInstanceCapabilityView;
  form: AgentProductForm;
  onDelete: () => void;
  platform: AgentPlatformPresentation;
  protocol?: AgentProtocolView;
  role: AgentInstanceRole;
}) {
  const projectId = useCurrentProjectId();
  return (
    <header className="border-b">
      <div className="flex flex-col gap-5 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
          >
            <Link
              to="/$projectId/instances"
              params={{ projectId }}
              aria-label="Back to Instances"
            >
              <ArrowLeft />
            </Link>
          </Button>
          <AgentPlatformIcon
            platform={platform}
            className="size-14"
            imageClassName="size-10"
          />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 max-w-full break-words font-display text-2xl font-light tracking-[0.005em] sm:text-3xl">
                {agent.name}
              </h1>
              <InstanceStatusBadge status={agent.status} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{form === "INTERACTIVE" ? "Interactive Agent" : form === "SERVICE" ? "Service Agent" : "Hybrid Agent"}</span>
              <span aria-hidden="true">·</span>
              <span>{role === "SUPERVISOR" ? "Supervisor role" : role === "SPECIALIST" ? "Specialist role" : "Hybrid role"}</span>
              {protocol ? <><span aria-hidden="true">·</span><span>A2A {protocol.direction.join(" + ")}</span></> : null}
              <span aria-hidden="true">·</span>
              <span>{platform.name} · {platform.runtimeName}</span>
              <span aria-hidden="true">·</span>
              <span>
                Updated <RelativeTime value={agent.updatedAt} />
              </span>
            </p>
            <div className="mt-2">
              <InstanceWorkModeBadges capabilities={capabilities} compact />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-14 sm:pl-[7.5rem] lg:pl-0">
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
              <DropdownMenuItem disabled className="items-start">
                <Pencil className="mt-0.5" />
                <span>
                  <span className="block">Edit configuration</span>
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    Runtime reconciliation is not available.
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled className="items-start">
                <RefreshCw className="mt-0.5" />
                <span>
                  <span className="block">Restart Instance</span>
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    No restart API is configured.
                  </span>
                </span>
              </DropdownMenuItem>
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
        </div>
      </div>
    </header>
  );
}
