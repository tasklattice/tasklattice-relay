import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  getAgentPlatformDefinition,
  type Instance as Agent,
} from "@tali/contracts";
import { ArrowRight, Radio, ShieldCheck, Waypoints } from "lucide-react";
import { AgentGardenIcon } from "@/components/agent-garden/agent-garden-icon";
import { DetailCardHeader } from "@/components/instances/instance-detail-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentProjectId } from "@/hooks/use-project";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";

export function InstanceCallableAgentsCard({ agent }: { agent: Agent }) {
  const projectId = useCurrentProjectId();
  const scope = useProjectQueryScope();
  const canCoordinate = getAgentPlatformDefinition(
    agent.agentPlatform,
  ).capabilities.canDelegate;
  const garden = useQuery({
    queryKey: scope.key("agent-garden"),
    queryFn: api.getAgentGarden,
    enabled: canCoordinate,
    staleTime: 15_000,
  });

  if (!canCoordinate) return null;

  const discoverableInstances = (garden.data?.instances ?? [])
    .map((instance) => ({
      instance,
      definition: garden.data?.agents.find(
        (candidate) => candidate.id === instance.agentId,
      ),
    }))
    .filter(({ definition, instance }) =>
      instance.status === "READY"
      && definition?.status === "READY"
      && definition.usageCapabilities.acceptsDelegation
      && (definition.usageMode === "CALLABLE" || definition.usageMode === "HYBRID")
    );

  return (
    <Card>
      <DetailCardHeader
        title="Callable A2A Instances"
        description="READY service Instances dynamically discovered from this Project's Instance Registry."
        action={(
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link
              to="/$projectId/agent-garden"
              params={{ projectId }}
              search={{}}
            >
              Open Agent Garden <ArrowRight />
            </Link>
          </Button>
        )}
      />
      <CardContent>
        <div className="mb-4 flex items-start gap-3 border-l-2 border-primary bg-primary/[0.035] px-4 py-3">
          <Waypoints className="mt-0.5 size-4 shrink-0 text-link" />
          <p className="text-xs leading-5 text-muted-foreground">
            <strong className="text-foreground">{agent.name}</strong> discovers
            only READY callable Instances in this Project. The Runtime Bridge
            preserves Project isolation and proxies each A2A invocation.
          </p>
        </div>

        {garden.isPending ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : garden.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Callable A2A Instances could not be loaded.
          </p>
        ) : discoverableInstances.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {discoverableInstances.map(({ definition, instance }) =>
              definition ? (
                <Link
                  key={instance.id}
                  to="/$projectId/instances/$instanceId"
                  params={{ projectId, instanceId: instance.id }}
                  className="flex min-h-20 items-start gap-3 border bg-muted/15 p-3"
                >
                  <AgentGardenIcon
                    type={definition.integrationType}
                    className="size-9"
                  />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">
                      {instance.name}
                    </strong>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="secondary">
                        <Radio className="size-3" /> Discoverable
                      </Badge>
                      <Badge variant="outline">
                        A2A {instance.a2a?.protocolVersion ?? "1.0"}
                      </Badge>
                    </span>
                  </span>
                </Link>
              ) : null,
            )}
          </div>
        ) : (
          <div className="flex min-h-28 flex-col items-center justify-center border border-dashed px-5 py-6 text-center">
            <ShieldCheck className="size-5 text-muted-foreground" />
            <strong className="mt-3 text-sm">No callable A2A Instances</strong>
            <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
              Create or onboard a READY callable Instance from Agent Garden.
              It will become discoverable through the Project Registry.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
