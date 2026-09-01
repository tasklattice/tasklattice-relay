import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ProjectCapability, ProjectOverviewRange } from "@tali/contracts";
import { LockKeyhole, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SurfacePanel, SurfacePanelContent } from "@/components/layout/surface-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentActivityRanking,
  AttentionList,
  BudgetCard,
  ModelAssignmentCard,
  OverviewKpiGrid,
  ProjectOverviewHeader,
  ProjectResourcesSummary,
  RuntimeHealthCard,
  UsageChartCard,
} from "@/features/project-overview/project-overview";
import { useCurrentProjectId, useProject } from "@/hooks/use-project";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";
import { DeveloperHome } from "@/features/expert-agents/developer-home";
import { useAccessContext } from "@/components/auth/access-context-provider";

export const Route = createFileRoute("/$projectId/")({ component: ProjectHome });

const overviewCapabilities = [
  "CAP_USAGE_VIEW",
  "CAP_COST_VIEW",
  "CAP_PROJECT_QUOTA_VIEW",
  "CAP_AGENT_INSTANCE_CONFIG_VIEW",
  "CAP_AGENT_MEMORY_CONFIG_VIEW",
  "CAP_SKILL_VIEW",
  "CAP_ACCESS_POLICY_VIEW",
] as const satisfies readonly ProjectCapability[];

function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function ProjectHome() {
  const projectId = useCurrentProjectId();
  const { currentProject } = useProject();
  const { active: activeAccess } = useAccessContext();
  const scope = useProjectQueryScope();
  const [range, setRange] = useState<ProjectOverviewRange>("7d");
  const [timezone] = useState(detectedTimezone);
  const granted = new Set(currentProject?.effectiveCapabilities ?? []);
  const canViewOverview = overviewCapabilities.every((capability) => granted.has(capability));
  const overview = useQuery({
    queryKey: scope.key("project-overview", range, timezone),
    queryFn: () => api.getProjectOverview(range, timezone),
    enabled: canViewOverview,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const activeDeveloperContext = activeAccess?.level === "project"
    && activeAccess.resourceId === currentProject?.id
    ? activeAccess.roleId === "ROLE_AGENT_DEVELOPER"
    : currentProject?.activeRole === "developer";

  if (activeDeveloperContext) {
    return <DeveloperHome />;
  }

  if (!canViewOverview) {
    return <RestrictedOverview />;
  }

  if (overview.isPending) {
    return (
      <OverviewLoading
        projectName={currentProject?.name}
        range={range}
        onRangeChange={setRange}
      />
    );
  }

  if (overview.isError || !overview.data) {
    return (
      <div className="space-y-7">
        <ProjectOverviewHeader projectName={currentProject?.name} range={range} onRangeChange={setRange} onRefresh={() => void overview.refetch()} isRefreshing={overview.isFetching} />
        <SurfacePanel>
          <SurfacePanelContent className="flex min-h-60 flex-col items-center justify-center py-10 text-center">
            <p className="text-sm font-medium">Project overview is unavailable</p>
            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              {overview.error instanceof Error
                ? overview.error.message
                : "The Project metrics endpoint could not be reached."}
            </p>
            <Button className="mt-4" variant="outline" onClick={() => void overview.refetch()}>
              <RefreshCw /> Retry overview
            </Button>
          </SurfacePanelContent>
        </SurfacePanel>
      </div>
    );
  }

  const data = overview.data;
  return (
    <div className="space-y-7">
      <ProjectOverviewHeader
        generatedAt={data.generatedAt}
        isRefreshing={overview.isFetching}
        onRefresh={() => void overview.refetch()}
        projectName={currentProject?.name}
        range={range}
        onRangeChange={setRange}
      />

      <OverviewKpiGrid data={data} />

      <section aria-label="Attention and budget" className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <AttentionList generatedAt={data.generatedAt} items={data.attention} />
        <BudgetCard budget={data.budget} generatedAt={data.generatedAt} projectId={projectId} />
      </section>

      <UsageChartCard data={data} />

      <section aria-label="Model assignment and Runtime health" className="grid gap-5 lg:grid-cols-2">
        <ModelAssignmentCard assignment={data.modelAssignment} projectId={projectId} />
        <RuntimeHealthCard data={data.runtime} projectId={projectId} />
      </section>

      <AgentActivityRanking activity={data.agentActivity} projectId={projectId} />
      <ProjectResourcesSummary projectId={projectId} resources={data.resources} />

      <p className="text-right font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Overview generated {new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: data.timezone,
        }).format(new Date(data.generatedAt))} · {data.timezone}
      </p>
    </div>
  );
}

function RestrictedOverview() {
  return (
    <div className="space-y-7">
      <PageHeader
        title="Project Overview"
        description={(
          <>
          <span className="font-medium text-foreground">Project overview.</span>{" "}
          Usage, runtime health, spend, and activity across this Project.
          </>
        )}
      />
      <SurfacePanel>
        <SurfacePanelContent className="flex min-h-60 flex-col items-center justify-center py-10 text-center">
          <span className="grid size-10 place-items-center rounded-md bg-muted text-muted-foreground">
            <LockKeyhole className="size-4" />
          </span>
          <p className="mt-4 text-sm font-medium">Project overview access is restricted</p>
          <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            This overview combines usage, cost, quota, Runtime, Memory, Skill, and Policy summaries. Your Project role does not grant every required read capability.
          </p>
        </SurfacePanelContent>
      </SurfacePanel>
    </div>
  );
}

function OverviewLoading({
  onRangeChange,
  projectName,
  range,
}: {
  onRangeChange: (range: ProjectOverviewRange) => void;
  projectName: string | undefined;
  range: ProjectOverviewRange;
}) {
  return (
    <div className="space-y-7" aria-label="Loading Project overview">
      <ProjectOverviewHeader projectName={projectName} range={range} onRangeChange={onRangeChange} />
      <div className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--surface-panel-border)] xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="min-h-32 border-b p-5 odd:border-r [&:nth-child(3)]:border-b-0 [&:nth-child(4)]:border-b-0 xl:border-b-0 xl:border-r xl:odd:border-r xl:last:border-r-0">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-9 w-28" />
            <Skeleton className="mt-4 h-3 w-40 max-w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <Skeleton className="h-[410px] w-full rounded-lg" />
        <Skeleton className="h-[410px] w-full rounded-lg" />
      </div>
      <Skeleton className="h-[410px] w-full rounded-lg" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-72 w-full rounded-lg" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
