import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Box, Eye, ScrollText } from "lucide-react";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { SandboxAuditDrawer } from "@/components/sandboxes/sandbox-audit-drawer";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusDot } from "@/components/shared/status-dot";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getAgentPlatformPresentation } from "@/lib/agent-platforms";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { useCurrentProjectId } from "@/hooks/use-project";

export const Route = createFileRoute("/$projectId/runtime")({ component: OpenShellRuntimePage });

function OpenShellRuntimePage() {
  const projectId = useCurrentProjectId();
  const [selectedId, setSelectedId] = useState<string>();
  const scope = useProjectQueryScope();
  const agents = useQuery({
    queryKey: scope.key("agents"),
    queryFn: api.listInstances,
    refetchInterval: 2_000,
  });
  const runtime = useQuery({
    queryKey: scope.key("runtime-status"),
    queryFn: api.getRuntimeStatus,
    retry: 1,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const policies = useQuery({ queryKey: scope.key("runtime-policies"), queryFn: api.listRuntimePolicies });
  const openShellAvailable =
    runtime.data?.terminal.available &&
    runtime.data.terminal.transport === "openshell";
  const sandboxes = useMemo(() => agents.data ?? [], [agents.data]);
  const selected =
    sandboxes.find((agent) => agent.id === selectedId) ?? sandboxes[0];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="OpenShell runtime"
        description="Inspect the OpenShell isolation boundary for each Agent Instance, then follow its current Sandbox and Pod realization."
        badge={
          <StatusDot
            label={runtime.isPending ? "Checking OpenShell" : openShellAvailable ? "OpenShell connected" : "OpenShell unavailable"}
            tone={runtime.isPending ? "neutral" : openShellAvailable ? "success" : runtime.error ? "danger" : "warning"}
          />
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Sandbox list</CardTitle>
            <CardDescription>
              Instance → OpenShell Sandbox → Pod. Runtime state is observed from
              the stable Sandbox boundary, not inferred from a Pod identity.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {sandboxes.length ? (
              <>
                <div className="hidden grid-cols-[minmax(0,1.4fr)_1fr_0.7fr_auto] gap-3 border-b px-4 py-2 text-xs text-muted-foreground sm:grid">
                  <span>Sandbox</span>
                  <span>Agent instance</span>
                  <span>Revision</span>
                  <span>State</span>
                </div>
                {sandboxes.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    aria-pressed={selected?.id === agent.id}
                    onClick={() => setSelectedId(agent.id)}
                    className={cn(
                      "grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/45 focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:grid-cols-[minmax(0,1.4fr)_1fr_0.7fr_auto]",
                      selected?.id === agent.id &&
                        "bg-muted/70 shadow-[inset_3px_0_0_var(--foreground)]",
                    )}
                  >
                    <span className="min-w-0">
                      <strong className="block truncate font-mono text-xs">
                        {agent.sandboxName}
                      </strong>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        OpenShell Sandbox CR
                      </span>
                    </span>
                    <span className="hidden truncate sm:block">{agent.name}</span>
                    <span className="hidden font-mono text-xs sm:block">
                      {agent.id.slice(0, 8)}
                    </span>
                    <AgentStatusBadge status={agent.status} />
                  </button>
                ))}
              </>
            ) : (
              <EmptyState
                icon={Box}
                title="No Sandboxes observed"
                description="Create a Supervisor to provision its Sandbox boundary."
              />
            )}
          </CardContent>
        </Card>

        {selected ? (
          <Card className="xl:sticky xl:top-24">
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-3">
                <StatusDot
                  label={selected.runtimePhase ?? selected.status}
                  tone={selected.status === "READY" ? "success" : "warning"}
                />
                <span className="text-xs text-muted-foreground">Scoped audit</span>
              </div>
              <CardTitle className="mt-3 break-all font-mono text-sm">
                {selected.sandboxName}
              </CardTitle>
              <CardDescription>
                Agent: {selected.name} · Pod realization:{" "}
                {selected.status === "READY" ? "current" : "unavailable"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="text-xs">
                {[
                  ["Runtime layer", "OpenShell"],
                  ["Agent", getAgentPlatformPresentation(selected.agentPlatform).name],
                  ["Stable identity", selected.sandboxName],
                  ["Instance", selected.id.slice(0, 8)],
                  ["Pod", selected.status === "READY" ? "1 / 1" : "0 / 1"],
                  ["Project", "Persistent PVC"],
                  ["Policy", policies.data?.policies.find((policy) => policy.id === selected.policyId)?.name ?? selected.policyId],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex min-h-10 items-center justify-between gap-3 border-b"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="max-w-[65%] break-all text-right font-medium">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <SandboxAuditDrawer
                sandbox={selected}
                trigger={
                  <Button
                    type="button"
                    className="h-11 w-full"
                    disabled={selected.status !== "READY"}
                  >
                    <ScrollText />
                    Inspect audit log
                  </Button>
                }
              />
              {selected.status !== "READY" ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  Audit events become available when this Sandbox reaches Ready.
                </p>
              ) : null}
              <Button asChild variant="outline" className="h-11 w-full">
                <Link
                  to="/$projectId/instances/$instanceId"
                  params={{ projectId, instanceId: selected.id }}
                >
                  <Eye />
                  Open Agent detail
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
