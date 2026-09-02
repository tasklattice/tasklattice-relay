import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Plus,
  Search,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateExpertAgentSheet } from "@/features/expert-agents/create-expert-agent-sheet";
import { useCurrentProjectId } from "@/hooks/use-project";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";

export const Route = createFileRoute("/$projectId/agents/")({
  validateSearch: z.object({ define: z.boolean().optional() }),
  component: ExpertAgents,
});

function ExpertAgents() {
  const projectId = useCurrentProjectId();
  const scope = useProjectQueryScope();
  const searchParams = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const agents = useQuery({
    queryKey: scope.key("expert-agents"),
    queryFn: api.listExpertAgents,
  });
  const visibleAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return agents.data ?? [];
    return (agents.data ?? []).filter((agent) =>
      [agent.name, agent.slug, agent.description, agent.executionMode]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [agents.data, query]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Develop an Agent, test its current content, then publish immutable Artifacts to Agent Garden."
        actions={(
          <Button
            className="min-h-11"
            onClick={() => void navigate({
              to: "/$projectId/agents",
              params: { projectId },
              search: { define: true },
            })}
          >
            <Plus /> Define Agent
          </Button>
        )}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-sm">
          <span className="sr-only">Search Agents</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, slug, or mode…"
          />
        </label>
        <p className="text-sm tabular-nums text-muted-foreground">
          {visibleAgents.length} Project Agent{visibleAgents.length === 1 ? "" : "s"}
        </p>
      </div>

      {agents.isPending ? (
        <div className="space-y-px border bg-border">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-20 rounded-none" />)}
        </div>
      ) : agents.isError ? (
        <div className="grid min-h-64 place-items-center border text-center">
          <div className="max-w-md px-6">
            <AlertTriangle className="mx-auto size-6 text-destructive" />
            <h2 className="mt-3 font-semibold">Agents could not be loaded</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {agents.error instanceof Error ? agents.error.message : "Try again."}
            </p>
            <Button className="mt-4" variant="outline" onClick={() => void agents.refetch()}>Retry</Button>
          </div>
        </div>
      ) : visibleAgents.length ? (
        <div className="overflow-x-auto border">
          <table className="w-full min-w-[50rem] text-left text-sm">
            <thead className="bg-muted/35 text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-3 py-3 font-medium">Stage</th>
                <th className="px-3 py-3 font-medium">Latest Version</th>
                <th className="px-3 py-3 text-right font-medium">Instances</th>
                <th className="w-28 px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleAgents.map((agent) => (
                <tr key={agent.id} className="group hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      to="/$projectId/agents/$agentId"
                      params={{ projectId, agentId: agent.id }}
                      className="font-medium text-link hover:underline"
                    >
                      {agent.name}
                    </Link>
                    <span className="mt-0.5 block max-w-md truncate text-xs text-muted-foreground">{agent.description || agent.slug}</span>
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      variant="outline"
                      className={agent.lifecycleState === "PUBLISHED"
                        ? "border-success-border bg-success-surface text-success-foreground"
                        : agent.lifecycleState === "READY_TO_PUBLISH"
                          ? "border-info-border bg-info-surface text-info-foreground"
                          : agent.lifecycleState === "TESTS_FAILED"
                            ? "border-destructive-border bg-destructive-surface text-destructive"
                            : "bg-muted/30 text-muted-foreground"}
                    >
                      {agent.lifecycleState.replaceAll("_", " ").toLowerCase().replace(/^./, (value) => value.toUpperCase())}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{agent.latestVersion?.label ?? "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{agent.instanceCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Button asChild variant="ghost" size="icon">
                      <Link to="/$projectId/agents/$agentId" params={{ projectId, agentId: agent.id }} aria-label={`Develop ${agent.name}`}>
                        <ArrowRight />
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid min-h-72 place-items-center border text-center">
          <div className="max-w-lg px-6">
            <Bot className="mx-auto size-7 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">{query ? "No matching Agents" : "Define your first Agent"}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {query
                ? "Try another search term."
                : "Define the product behavior, test the saved Agent, and publish its first immutable Version."}
            </p>
            {!query ? (
              <Button className="mt-5 min-h-11" onClick={() => void navigate({
                to: "/$projectId/agents",
                params: { projectId },
                search: { define: true },
              })}>
                <Plus /> Define Agent
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <CreateExpertAgentSheet
        open={Boolean(searchParams.define)}
        onOpenChange={(open) => void navigate({
          to: "/$projectId/agents",
          params: { projectId },
          search: open ? { define: true } : {},
          replace: true,
        })}
        onCreated={async (agentId) => {
          await queryClient.invalidateQueries({ queryKey: scope.key("expert-agents") });
          await navigate({
            to: "/$projectId/agents/$agentId",
            params: { projectId, agentId },
          });
        }}
      />
    </div>
  );
}
