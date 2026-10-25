import { complianceDomainCatalog } from "@tali/contracts";
import type { Instance as Agent } from "@tali/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Network,
  ShieldCheck,
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
import type { ReactNode } from "react";
import { DetailCardHeader } from "./instance-detail-shared";
import { InstanceSummaryLink } from "./instance-detail-layout";
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
  agent,
  modelRoutingName,
}: {
  agent: Agent;
  modelRoutingName?: string;
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
  const boundary =
    complianceDomainCatalog.find(
      (domain) => domain.id === agent.modelRoutingComplianceDomain,
    )?.label ?? agent.modelRoutingComplianceDomain;

  return (
    <div role="tabpanel" aria-label="Overview" className="space-y-5 pt-5">
      {agent.status !== "READY" && agent.status !== "DESTROYING" ? (
        <ProvisioningSummary agent={agent} />
      ) : null}

      {agent.description ? (
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {agent.description}
        </p>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card variant="data">
          <DetailCardHeader title="Attached resources" />
          <div>
            <InstanceSummaryLink
              instanceId={agent.id}
              hash="skills"
              icon={Wrench}
              label="Skills"
              value={agent.skillIds?.length ?? 0}
            />
            <InstanceSummaryLink
              instanceId={agent.id}
              hash="mcp-servers"
              icon={Network}
              label="MCP Servers"
              value={
                <>
                  {agent.mcpServerIds?.length ?? 0} ·{" "}
                  {catalog.isError || policies.isError
                    ? "Access unavailable"
                    : toolAccessKnown
                      ? `${allowedTools.length} allowed tools`
                      : "Calculating access…"}
                </>
              }
            />
            <InstanceSummaryLink
              instanceId={agent.id}
              hash="vector-databases"
              icon={BookOpen}
              label="Vector Databases"
              value={agent.knowledgeSourceIds?.length ?? 0}
            />
            <InstanceSummaryLink
              instanceId={agent.id}
              hash="memory"
              icon={BrainCircuit}
              label="Memory"
              value={
                agent.durableMemoryId
                  ? "Durable"
                  : agent.memory?.mode === "hybrid"
                    ? "Hybrid"
                    : agent.memory
                      ? "Native"
                      : "None"
              }
            />
          </div>
          {catalog.isError || policies.isError ? (
            <p
              role="alert"
              className="border-t px-5 py-3 text-xs text-destructive"
            >
              Effective access could not be loaded. Open MCP Servers for details
              and retry.
            </p>
          ) : null}
        </Card>

        <Card>
          <DetailCardHeader
            title="Operating context"
            action={<ShieldCheck className="size-5 text-link" />}
          />
          <CardContent>
            <dl>
              <ContextFact label="Profile" value={roleName} />
              <ContextFact
                label="Model routing"
                value={modelRoutingName ?? "Platform managed"}
              />
              <ContextFact label="Data boundary" value={boundary} />
            </dl>
            <Button asChild variant="link" className="mt-3 min-h-11 px-0">
              <Link
                to="/$projectId/instances/$instanceId"
                params={{ projectId, instanceId: agent.id }}
                search={{ tab: "configuration" }}
              >
                View configuration <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <InstanceCallableAgentsCard agent={agent} />
    </div>
  );
}
