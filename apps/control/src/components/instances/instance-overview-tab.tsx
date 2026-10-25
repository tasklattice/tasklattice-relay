import { complianceDomainCatalog } from "@tali/contracts";
import type {
  Instance as Agent,
} from "@tali/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Network,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { effectiveTools } from "@/components/access/effective-mcp-access";
import { resolveProvisioningState } from "@/components/agents/provisioning-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useCurrentProjectId } from "@/hooks/use-project";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";
import type { AgentPlatformPresentation } from "@/lib/agent-platforms";
import type { ReactNode } from "react";
import type { InstanceAccessState } from "./instance-detail-model";
import { DetailCardHeader } from "./instance-detail-shared";
import { InstanceCallableAgentsCard } from "./instance-callable-agents-card";

function ProvisioningSummary({ agent }: { agent: Agent }) {
  const projectId = useCurrentProjectId();
  const state = resolveProvisioningState({
    status: agent.status,
    ...(agent.provisioningStage ? { stage: agent.provisioningStage } : {}),
  });

  if (agent.status === "FAILED") {
    return (
      <Card className="border-destructive/25 bg-destructive/[0.025]">
        <DetailCardHeader
          title="This Agent could not start"
          description="Its capabilities are preserved, but they cannot be used until provisioning succeeds."
        />
        <CardContent className="space-y-4">
          <p
            role="alert"
            className="border-l-2 border-destructive bg-destructive/5 px-3 py-3 text-sm text-destructive"
          >
            {agent.error ?? "The runtime did not return a failure summary."}
          </p>
          <Button asChild variant="outline" className="min-h-11">
            <Link
              to="/$projectId/instances/$instanceId"
              params={{ projectId, instanceId: agent.id }}
              search={{ tab: "logs" }}
              hash="provisioning-logs"
            >
              Review startup evidence
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20 bg-primary/[0.025]">
      <DetailCardHeader
        title="Preparing this Agent"
        description={`${state.activeIndex} of 6 stages complete · ${state.definition.description}`}
      />
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span>{state.statusLabel}</span>
          <span className="tabular-nums text-muted-foreground">
            {state.progress}%
          </span>
        </div>
        <Progress
          value={state.progress}
          aria-label="Agent preparation progress"
          aria-valuetext={`${state.progress}% complete`}
        />
        <Button asChild variant="link" className="h-auto min-h-11 px-0">
          <Link
            to="/$projectId/instances/$instanceId"
            params={{ projectId, instanceId: agent.id }}
            search={{ tab: "logs" }}
          >
            Follow preparation evidence
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function CapabilitySection({
  action,
  children,
  icon: Icon,
  title,
}: {
  action: ReactNode;
  children: ReactNode;
  icon: typeof Bot;
  title: string;
}) {
  return (
    <section className="grid gap-4 border-b py-5 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto]">
      <span className="grid size-11 place-items-center rounded-md bg-primary/[0.07] text-link">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <h3 className="font-semibold">{title}</h3>
        <div className="mt-3">{children}</div>
      </div>
      <div className="sm:pl-3">{action}</div>
    </section>
  );
}

function NamedCapabilityList({
  empty,
  items,
}: {
  empty: string;
  items: Array<{ description?: string; id: string; name: string }>;
}) {
  if (!items.length) {
    return (
      <p className="border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">
        {empty}
      </p>
    );
  }

  return (
    <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2">
      {items.slice(0, 6).map((item) => (
        <li key={item.id} className="min-w-0 border-l-2 border-primary/25 pl-3">
          <strong className="block truncate text-xs font-semibold">
            {item.name}
          </strong>
          {item.description ? (
            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
              {item.description}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ContextFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-h-12 grid-cols-[minmax(7rem,.8fr)_minmax(0,1.2fr)] items-center gap-4 border-b py-2 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-xs font-semibold">
        {value}
      </dd>
    </div>
  );
}

export function InstanceOverviewTab({
  access,
  agent,
  modelRoutingName,
  platform,
}: {
  access: InstanceAccessState;
  agent: Agent;
  modelRoutingName?: string;
  platform: AgentPlatformPresentation;
}) {
  const projectId = useCurrentProjectId();
  const scope = useProjectQueryScope();
  const catalog = useQuery({
    queryKey: scope.key("resource-catalog"),
    queryFn: api.getResourceCatalog,
  });
  const policies = useQuery({
    queryKey: scope.key("access-policies"),
    queryFn: api.listAccessPolicies,
  });

  const role = catalog.data?.specializations.find(
    (item) => item.id === agent.specializationId,
  );
  const roleName =
    role?.roleLabel ??
    role?.name ??
    (agent.specializationId && agent.specializationId !== "custom"
      ? agent.specializationId
      : "Custom Agent");
  const selectedSkills = (agent.skillIds ?? []).map(
    (id) =>
      catalog.data?.skills.find((item) => item.id === id) ?? {
        id,
        name: id,
        description: "Capability details are currently unavailable.",
      },
  );
  const selectedServers = (agent.mcpServerIds ?? []).map(
    (id) =>
      catalog.data?.mcpServers.find((item) => item.id === id) ?? {
        id,
        name: id,
        tools: [],
      },
  );
  const selectedKnowledge = (agent.knowledgeSourceIds ?? []).map(
    (id) =>
      catalog.data?.vectorDatabases.find((item) => item.id === id) ?? {
        id,
        name: id,
        description: "Vector Database details are currently unavailable.",
      },
  );
  const toolAccessKnown = Boolean(catalog.data && policies.data);
  const allowedTools = toolAccessKnown
    ? effectiveTools(
        agent.accessPolicyIds,
        policies.data ?? [],
        catalog.data?.mcpServers.filter((server) =>
          (agent.mcpServerIds ?? []).includes(server.id),
        ) ?? [],
      ).filter((tool) => tool.decision === "ALLOW")
    : [];
  const allowedToolItems = allowedTools.map((tool) => ({
    id: `${tool.server.id}:${tool.toolName}`,
    name: tool.toolName,
    description: tool.server.name,
  }));
  const boundary =
    complianceDomainCatalog.find(
      (domain) => domain.id === agent.modelRoutingComplianceDomain,
    )?.label ?? agent.modelRoutingComplianceDomain;
  const capabilityHref = {
    to: "/$projectId/instances/$instanceId" as const,
    params: { projectId, instanceId: agent.id },
    search: { tab: "capabilities" as const },
  };
  const terminalFirst = platform.interactionSurface === "terminal";
  const primaryAccessEnabled = terminalFirst
    ? access.terminal.enabled
    : access.webUI.enabled;

  return (
    <div role="tabpanel" aria-label="Overview" className="space-y-5 pt-5">
      {agent.status !== "READY" && agent.status !== "DESTROYING" ? (
        <ProvisioningSummary agent={agent} />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,.55fr)]">
        <Card>
          <DetailCardHeader
            title="Capabilities"
          />
          <CardContent>
            <CapabilitySection
              icon={Sparkles}
              title="Purpose & instructions"
              action={
                <Button asChild variant="link" className="min-h-11 px-0">
                  <Link
                    to="/$projectId/instances/$instanceId"
                    params={{ projectId, instanceId: agent.id }}
                    search={{ tab: "configuration" }}
                  >
                    View instructions
                  </Link>
                </Button>
              }
            >
              <p className="line-clamp-2 border-l-2 border-primary/25 pl-3 text-xs leading-5 text-muted-foreground">
                {agent.systemPrompt || "Instruction content is unavailable."}
              </p>
            </CapabilitySection>

            <CapabilitySection
              icon={Wrench}
              title={`Skills · ${selectedSkills.length}`}
              action={
                <Button asChild variant="link" className="min-h-11 px-0">
                  <Link {...capabilityHref} hash="skills">
                    Review
                  </Link>
                </Button>
              }
            >
              {catalog.isPending && selectedSkills.length ? (
                <p className="text-xs text-muted-foreground">
                  Loading assigned skills…
                </p>
              ) : (
                <NamedCapabilityList
                  items={selectedSkills}
                  empty="No Skills attached."
                />
              )}
            </CapabilitySection>

            <CapabilitySection
              icon={Network}
              title={`Approved tools · ${toolAccessKnown ? allowedTools.length : "—"}`}
              action={
                <Button asChild variant="link" className="min-h-11 px-0">
                  <Link {...capabilityHref} hash="mcp-servers">
                    Review access
                  </Link>
                </Button>
              }
            >
              {catalog.isPending || policies.isPending ? (
                <p className="text-xs text-muted-foreground">
                  Calculating effective tool access…
                </p>
              ) : catalog.isError || policies.isError ? (
                <p role="alert" className="text-xs text-destructive">
                  Effective tool access could not be verified. Review
                  Capabilities for details and recovery.
                </p>
              ) : (
                <NamedCapabilityList
                  items={allowedToolItems}
                  empty={
                    selectedServers.length
                      ? "Connected systems do not currently expose any policy-approved tools."
                      : "No MCP connections."
                  }
                />
              )}
            </CapabilitySection>

            <CapabilitySection
              icon={BookOpen}
              title={`Vector Databases & memory · ${selectedKnowledge.length + (agent.durableMemoryId || agent.memory ? 1 : 0)}`}
              action={
                <Button asChild variant="link" className="min-h-11 px-0">
                  <Link {...capabilityHref} hash="vector-databases">
                    Review context
                  </Link>
                </Button>
              }
            >
              <NamedCapabilityList
                items={[
                  ...selectedKnowledge,
                  ...(agent.durableMemoryId
                    ? [
                        {
                          id: agent.durableMemoryId,
                          name: "Durable Memory",
                          description:
                            "Project-level context that survives Agent replacement.",
                        },
                      ]
                    : agent.memory
                      ? [
                          {
                            id: "memory",
                            name:
                              agent.memory.mode === "hybrid"
                                ? "Hybrid memory"
                                : "Native memory",
                            description:
                              agent.memory.mode === "hybrid"
                                ? "Curated notes with semantic recall."
                                : "Curated memory and dated daily notes.",
                          },
                        ]
                      : []),
                ]}
                empty="No Vector Databases or Durable Memory are attached."
              />
            </CapabilitySection>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <DetailCardHeader
              title="Access & runtime"
              action={<ShieldCheck className="size-5 text-link" />}
            />
            <CardContent>
              <dl>
                <ContextFact label="Profile" value={roleName} />
                <ContextFact
                  label="Access policies"
                  value={agent.accessPolicyIds.length}
                />
                <ContextFact
                  label="Model routing"
                  value={modelRoutingName ?? "Platform managed"}
                />
                <ContextFact label="Data boundary" value={boundary} />
                <ContextFact
                  label="Agent access"
                  value={
                    primaryAccessEnabled
                      ? terminalFirst
                        ? "Protected TUI session"
                        : "Protected session"
                      : (terminalFirst ? access.terminal.disabledReason : access.webUI.disabledReason) ?? "Unavailable"
                  }
                />
                <ContextFact
                  label="Runtime"
                  value={`${platform.name} on ${platform.runtimeName}`}
                />
              </dl>
              <Button
                asChild
                variant="outline"
                className="mt-4 min-h-11 w-full"
              >
                <Link {...capabilityHref}>
                  Inspect effective access <ArrowRight />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <InstanceCallableAgentsCard agent={agent} />
    </div>
  );
}
