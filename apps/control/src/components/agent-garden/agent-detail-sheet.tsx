import type {
  A2aAgentInstance,
  AgentGardenEntry,
} from "@tali/contracts";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Boxes,
  Check,
  ExternalLink,
  Play,
  Trash2,
  X,
} from "lucide-react";
import {
  EntityDetailList,
  EntitySheet,
} from "@/components/shared/entity-sheet";
import { StatusDot } from "@/components/shared/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentProjectId } from "@/hooks/use-project";
import { formatPlatformDateTime } from "@/lib/platform-preferences";
import { AgentGardenIcon } from "./agent-garden-icon";
import {
  agentStatusLabel,
  isPreviewAgent,
  previewAgentLabel,
  usageModeLabel,
} from "./agent-garden-presentation";

export function AgentDetailSheet({
  agent,
  canManage,
  instance,
  onCreateInstance,
  onOpenChange,
  onRefresh,
  onRemove,
  onTry,
  open,
  refreshing,
}: {
  agent: AgentGardenEntry | undefined;
  canManage: boolean;
  instance: A2aAgentInstance | undefined;
  onCreateInstance: () => void;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onRemove: () => void;
  onTry: () => void;
  open: boolean;
  refreshing: boolean;
}) {
  const projectId = useCurrentProjectId();
  const preview = agent ? isPreviewAgent(agent) : false;
  const managedContainer =
    agent?.configuration.onboardingSource === "CONTAINER_IMAGE";
  const statusTone =
    agent?.status === "READY"
      ? "success"
      : agent?.status === "UNAVAILABLE"
        ? "danger"
        : agent?.status === "COMING_SOON"
          ? "neutral"
          : "warning";

  return (
    <EntitySheet
      open={open && Boolean(agent)}
      onOpenChange={onOpenChange}
      eyebrow={
        agent && preview
          ? `${previewAgentLabel(agent)} Agent`
          : agent?.source === "BUILT_IN"
          ? "Built-in Agent"
          : agent?.source === "PROJECT_DEVELOPED"
            ? "Project-developed Agent"
            : "Project-registered Agent"
      }
      title={agent?.name ?? "Agent details"}
      description="Usage capabilities, discovery evidence, and runtime availability."
      width="lg"
      footer={(
        <>
          {agent?.source === "PROJECT_REGISTERED" && canManage ? (
            <Button
              type="button"
              variant="destructive"
              onClick={onRemove}
            >
              <Trash2 /> Remove
            </Button>
          ) : null}
          {agent?.source === "PROJECT_REGISTERED" ? (
            <Button
              type="button"
              variant="outline"
              disabled={refreshing || !canManage}
              onClick={onRefresh}
            >
              <Activity />
              {refreshing
                ? managedContainer
                  ? "Reconciling runtime…"
                  : "Discovering…"
                : managedContainer
                  ? "Reconcile & validate"
                  : "Refresh discovery"}
            </Button>
          ) : null}
          {instance ? (
            <Button asChild variant="outline">
              <Link
                to="/$projectId/instances/$instanceId"
                params={{ projectId, instanceId: instance.id }}
              >
                <Boxes /> View Instance
              </Link>
            </Button>
          ) : null}
          {agent?.usageCapabilities.interactive &&
          agent.status === "READY" &&
          agent.source === "PROJECT_REGISTERED" &&
          agent.endpoint ? (
            <Button asChild variant="outline">
              <a href={agent.endpoint} target="_blank" rel="noreferrer">
                Open Agent <ExternalLink />
              </a>
            </Button>
          ) : null}
          {agent?.usageCapabilities.interactive &&
          agent.status === "READY" &&
          agent.source === "BUILT_IN" ? (
            <Button type="button" onClick={onCreateInstance}>
              Create Instance <ArrowRight />
            </Button>
          ) : null}
          {agent?.usageCapabilities.acceptsDelegation && !instance ? (
            <Button
              type="button"
              disabled={
                !canManage ||
                agent.status !== "READY"
              }
              onClick={onCreateInstance}
            >
              Create Instance <ArrowRight />
            </Button>
          ) : null}
          {agent && preview ? (
            <Button type="button" variant="outline" onClick={onTry}>
              <Play /> Try demo
            </Button>
          ) : null}
        </>
      )}
    >
      {agent ? (
        <div className="space-y-6">
          <div className="flex items-start gap-4 border bg-muted/20 p-4">
            <AgentGardenIcon
              type={agent.integrationType}
              catalogIcon={agent.configuration.icon}
              className="size-12"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className="bg-primary/8 text-primary"
                >
                  {agent.platformLabel}
                </Badge>
                <Badge variant="outline">
                  {usageModeLabel(agent.usageMode)}
                </Badge>
                {agent.a2a ? (
                  <Badge variant="outline">
                    A2A {agent.a2a.protocolVersion}
                  </Badge>
                ) : null}
                <StatusDot
                  label={agentStatusLabel(agent.status)}
                  tone={statusTone}
                />
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {agent.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {agent.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="font-normal text-muted-foreground"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <EntityDetailList
            items={[
              {
                label: "Source",
                value:
                  agent.source === "BUILT_IN"
                    ? agent.configuration.catalogKind === "EXAMPLE_BLUEPRINT"
                      ? "Database-backed example blueprint"
                      : "TaskLattice Relay built-in"
                    : managedContainer
                      ? "Project-managed container image"
                      : "Existing external Agent",
              },
              {
                label: "Owner",
                value: agent.owner,
              },
              {
                label: "Category",
                value: agent.category,
              },
              {
                label: "Endpoint",
                value: agent.endpoint ?? "Managed by TaskLattice Relay",
                mono: Boolean(agent.endpoint),
              },
              {
                label: "Agent Card",
                value: agent.agentCardUrl ?? "Not advertised",
                mono: Boolean(agent.agentCardUrl),
              },
              ...(agent.a2a
                ? [
                    {
                      label: "A2A interface",
                      value: `${agent.a2a.protocolBinding} ${agent.a2a.protocolVersion}`,
                    },
                    {
                      label: "A2A capabilities",
                      value: [
                        agent.a2a.streaming ? "Streaming" : null,
                        agent.a2a.pushNotifications ? "Push notifications" : null,
                        agent.a2a.extendedAgentCard ? "Extended card" : null,
                      ].filter(Boolean).join(", ") || "Request / response",
                    },
                  ]
                : []),
              ...(managedContainer
                ? [
                    {
                      label: "Image",
                      value:
                        agent.configuration.imageDigest
                        ?? agent.configuration.imageReference
                        ?? "Pending image resolution",
                      mono: true,
                    },
                    {
                      label: "Instance",
                      value:
                        agent.configuration.managedInstanceId
                        ?? "Pending Instance allocation",
                      mono: true,
                    },
                    {
                      label: "Runtime Namespace",
                      value:
                        agent.configuration.runtimeNamespace
                        ?? "Pending workload",
                      mono: true,
                    },
                    {
                      label: "Workload",
                      value:
                        agent.configuration.deploymentName
                        ?? "Pending workload",
                      mono: true,
                    },
                    {
                      label: "Service",
                      value:
                        agent.configuration.serviceName
                        ?? "Pending Service",
                      mono: true,
                    },
                    {
                      label: "Pod",
                      value:
                        agent.configuration.podName
                        ?? "Pending Pod",
                      mono: true,
                    },
                  ]
                : []),
              {
                label: "Last discovered",
                value: agent.lastDiscoveredAt
                  ? formatPlatformDateTime(agent.lastDiscoveredAt)
                  : "Never",
              },
            ]}
          />

          {preview ? (
            <p className="border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-xs leading-5 text-muted-foreground">
              <strong className="block text-foreground">
                {previewAgentLabel(agent)} interaction preview
              </strong>
              Agent Card discovery, task submission, and the response path are
              implemented. The task result uses deterministic sample data and
              has no external side effects.
            </p>
          ) : null}

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Participation model</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Main/secondary behavior is enforced from these independent
                capabilities, not inferred from the Agent name.
              </p>
            </div>
            <div className="divide-y border">
              <CapabilityRow
                label="Interactive workbench"
                enabled={agent.usageCapabilities.interactive}
              />
              <CapabilityRow
                label="Can delegate to callable Instances"
                enabled={agent.usageCapabilities.canDelegate}
              />
              <CapabilityRow
                label="Can receive delegated tasks"
                enabled={agent.usageCapabilities.acceptsDelegation}
              />
            </div>
          </section>

          {agent.lastDiscoveryError ? (
            <p
              role="alert"
              className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm leading-6"
            >
              <strong className="block">Latest discovery failed</strong>
              <span className="mt-1 block text-muted-foreground">
                {agent.lastDiscoveryError}
              </span>
            </p>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Discovered skills</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Skills advertised by the Agent's A2A Agent Card.
                </p>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {agent.skills.length}
              </span>
            </div>
            {agent.skills.length ? (
              <div className="divide-y border">
                {agent.skills.map((skill) => (
                  <div key={skill.id} className="px-4 py-3">
                    <strong className="text-sm">{skill.name}</strong>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {skill.description || skill.id}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                No individual skills were published in the Agent Card.
              </div>
            )}
          </section>

        </div>
      ) : null}
    </EntitySheet>
  );
}

function CapabilityRow({
  enabled,
  label,
}: {
  enabled: boolean;
  label: string;
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm">
      <span
        className={
          enabled
            ? "grid size-6 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "grid size-6 place-items-center rounded-full bg-muted text-muted-foreground"
        }
      >
        {enabled ? (
          <Check className="size-3.5" />
        ) : (
          <X className="size-3.5" />
        )}
      </span>
      <span>{label}</span>
      <span className="ml-auto text-xs text-muted-foreground">
        {enabled ? "Supported" : "Not supported"}
      </span>
    </div>
  );
}
