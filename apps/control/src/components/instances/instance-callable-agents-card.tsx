import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  getAgentPlatformDefinition,
  type Instance as Agent,
} from "@tali/contracts";
import { ArrowRight } from "lucide-react";
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
  const canCoordinate = getAgentPlatformDefinition(agent.agentPlatform)
    .capabilities.canDelegate;
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
    .filter(
      ({ definition, instance }) =>
        instance.status === "READY" &&
        definition?.status === "READY" &&
        definition.usageCapabilities.acceptsDelegation &&
        (definition.usageMode === "CALLABLE" ||
          definition.usageMode === "HYBRID"),
    );

  return (
    <Card>
      <DetailCardHeader
        title="Callable A2A Instances"
        description="Ready to accept delegated work in this Project."
        action={
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link
              to="/$projectId/agent-garden"
              params={{ projectId }}
              search={{}}
            >
              Open Agent Garden <ArrowRight />
            </Link>
          </Button>
        }
      />
      <CardContent>
        {garden.isPending ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : garden.isError ? (
          <div role="alert" className="space-y-3 text-sm text-destructive">
            <p>Callable A2A Instances could not be loaded.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void garden.refetch()}
            >
              Try again
            </Button>
          </div>
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
          <p className="text-sm text-muted-foreground">
            No callable A2A Instances. Add one in Agent Garden.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
