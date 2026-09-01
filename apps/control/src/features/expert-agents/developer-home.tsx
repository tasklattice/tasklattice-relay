import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Bot, CircleAlert, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentProjectId, useProject } from "@/hooks/use-project";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";

export function DeveloperHome() {
  const projectId = useCurrentProjectId();
  const { currentProject } = useProject();
  const scope = useProjectQueryScope();
  const agents = useQuery({
    queryKey: scope.key("expert-agents"),
    queryFn: api.listExpertAgents,
  });

  if (agents.isPending) return <div className="space-y-5"><Skeleton className="h-28" /><Skeleton className="h-72" /></div>;
  if (agents.isError) return (
    <div className="grid min-h-72 place-items-center border text-center">
      <div><CircleAlert className="mx-auto size-6 text-destructive" /><h1 className="mt-3 font-semibold">Developer home unavailable</h1><Button className="mt-4" variant="outline" onClick={() => void agents.refetch()}>Retry</Button></div>
    </div>
  );

  const data = agents.data ?? [];
  const actionable = data.filter((agent) => agent.lifecycleState !== "PUBLISHED");
  return (
    <div className="mx-auto max-w-[86rem] space-y-8 pb-8">
      <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{currentProject?.name ?? "Project"}</p><h1 className="mt-2 font-display text-[1.75rem] font-medium tracking-[-0.03em]">Agent Developer</h1><p className="mt-2 text-sm text-muted-foreground">Continue the next concrete step for an Agent you own or maintain.</p></div>
        <Button asChild><Link to="/$projectId/agents" params={{ projectId }} search={{ define: true }}><Plus /> Create Agent</Link></Button>
      </header>

      <section>
        <div className="flex items-end justify-between gap-4 border-b pb-3"><div><h2 className="font-semibold">Continue developing</h2><p className="mt-1 text-sm text-muted-foreground">Define and test an Agent, then publish a Version when it is ready.</p></div><Button asChild variant="ghost" size="sm"><Link to="/$projectId/agents" params={{ projectId }}>All Agents <ArrowRight /></Link></Button></div>
        {actionable.length ? <div className="divide-y">{actionable.slice(0, 8).map((agent) => (
          <Link key={agent.id} to="/$projectId/agents/$agentId" params={{ projectId, agentId: agent.id }} search={{ stage: agent.lifecycleState === "READY_TO_PUBLISH" || agent.lifecycleState === "TESTS_FAILED" ? "test" : "define" }} className="group flex min-h-20 items-center gap-4 py-3 hover:bg-muted/20">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border bg-muted/20"><Bot className="size-4" /></span>
            <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{agent.name}</strong><span className="mt-1 block truncate text-xs text-muted-foreground">{agent.description}</span></span>
            <Badge variant="outline">{agent.lifecycleState.replaceAll("_", " ").toLowerCase()}</Badge><ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}</div> : <div className="grid min-h-36 place-items-center border-b text-center text-sm text-muted-foreground">All current Agents are published.</div>}
      </section>

      <section className="grid gap-px border bg-border sm:grid-cols-3">
        <Metric label="Agents" value={data.length} />
        <Metric label="Ready to publish" value={data.filter((agent) => agent.lifecycleState === "READY_TO_PUBLISH").length} />
        <Metric label="Published Versions" value={data.reduce((total, agent) => total + agent.versionCount, 0)} />
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="bg-background p-5"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-medium tabular-nums">{value}</p></div>;
}
