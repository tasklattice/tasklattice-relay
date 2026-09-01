import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  useNavigate,
} from "@tanstack/react-router";
import {
  getAgentPlatformDefinition,
  isAgentPlatformId,
  type AgentGardenEntry,
} from "@tali/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  CircleCheck,
  Code2,
  FileInput,
  FileOutput,
  Play,
  ShieldCheck,
  Sparkles,
  Store,
  Waypoints,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { AgentGardenIcon } from "@/components/agent-garden/agent-garden-icon";
import { agentMarketplaceBrief } from "@/components/agent-garden/agent-marketplace-profile";
import {
  agentStatusLabel,
  isPreviewAgent,
  previewAgentLabel,
  usageModeLabel,
} from "@/components/agent-garden/agent-garden-presentation";
import { TryDemoAgentSheet } from "@/components/agent-garden/try-demo-agent-sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusDot } from "@/components/shared/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { formatPlatformDateTime } from "@/lib/platform-preferences";
import { useCurrentProjectId } from "@/hooks/use-project";
import { useProjectPermissions } from "@/hooks/use-project-permissions";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";

export const Route = createFileRoute(
  "/$projectId/agent-garden/$agentId",
)({
  component: AgentMarketplaceDetail,
});

function parseStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function AgentMarketplaceDetail() {
  const { agentId } = Route.useParams();
  const projectId = useCurrentProjectId();
  const permissions = useProjectPermissions();
  const scope = useProjectQueryScope();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const garden = useQuery({
    queryKey: scope.key("agent-garden"),
    queryFn: api.getAgentGarden,
  });
  const [tryOpen, setTryOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const agent = garden.data?.agents.find(
    (candidate) => candidate.id === agentId,
  );
  const instance = garden.data?.instances.find(
    (candidate) => candidate.agentId === agentId,
  );
  const brief = agent ? agentMarketplaceBrief(agent) : undefined;
  const preview = agent ? isPreviewAgent(agent) : false;
  const versionBundle = agent?.distribution?.type === "VERSION_BUNDLE"
    ? agent.distribution
    : null;
  useEffect(() => {
    if (versionBundle && !selectedVersionId) {
      setSelectedVersionId(versionBundle.defaultVersionId);
    }
  }, [selectedVersionId, versionBundle]);
  const workflow = parseStringArray(agent?.configuration.workflow);
  const exampleTasks = useMemo(
    () =>
      agent
        ? [
            agent.configuration.examplePrompt1,
            agent.configuration.examplePrompt2,
            ...(brief?.useCases ?? []),
          ]
            .filter(
              (value): value is string =>
                typeof value === "string" && Boolean(value),
            )
            .filter(
              (value, index, values) =>
                values.indexOf(value) === index,
            )
            .slice(0, 4)
        : [],
    [agent, brief?.useCases],
  );

  const instantiate = useMutation({
    mutationFn: ({ id, versionId }: { id: string; versionId?: string }) =>
      api.instantiateGardenAgent(id, versionId),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({
        queryKey: scope.key("agent-garden"),
      });
      await navigate({
        to: "/$projectId/instances/$instanceId",
        params: { projectId, instanceId: created.id },
      });
    },
  });

  const createInstance = () => {
    if (!agent) return;
    if (agent.integrationType === "a2a") {
      if (instance && agent.source !== "PROJECT_DEVELOPED") {
        void navigate({
          to: "/$projectId/instances/$instanceId",
          params: { projectId, instanceId: instance.id },
        });
        return;
      }
      instantiate.mutate({
        id: agent.id,
        ...(versionBundle ? { versionId: selectedVersionId || versionBundle.defaultVersionId } : {}),
      });
      return;
    }
    if (!isAgentPlatformId(agent.integrationType)) return;
    if (!getAgentPlatformDefinition(agent.integrationType).capabilities.interactive)
      return;
    void navigate({
      to: "/$projectId/instances",
      params: { projectId },
      search: {
        create: "instance",
        platform: agent.integrationType,
        specialization: agent.specializationId ?? undefined,
      },
    });
  };

  if (garden.isPending) return <MarketplaceDetailSkeleton />;
  if (!agent || !brief) {
    return (
      <EmptyState
        icon={Store}
        title="Agent not found"
        description="This Agent is no longer available in the current Project catalog."
        action={(
          <Button asChild variant="outline">
            <Link
              to="/$projectId/agent-garden"
              params={{ projectId }}
              search={{}}
            >
              Back to Agent Garden
            </Link>
          </Button>
        )}
      />
    );
  }

  const statusTone =
    agent.status === "READY"
      ? "success"
      : agent.status === "UNAVAILABLE"
        ? "danger"
        : agent.status === "COMING_SOON"
          ? "neutral"
          : "warning";

  return (
    <div className="space-y-7 pb-12">
      <Link
        to="/$projectId/agent-garden"
        params={{ projectId }}
        search={{}}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <ArrowLeft className="size-4" />
        Back to Agent Garden
      </Link>

      {instantiate.error ? (
        <p
          role="alert"
          className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {instantiate.error.message}
        </p>
      ) : null}

      <header className="grid gap-6 border-b pb-7 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 items-start gap-5">
          <AgentGardenIcon
            type={agent.integrationType}
            catalogIcon={agent.configuration.icon}
            className="size-16 shrink-0"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className="bg-primary/8 text-primary"
              >
                {agent.platformLabel}
              </Badge>
              {preview ? (
                <Badge variant="outline">
                  {previewAgentLabel(agent)}
                </Badge>
              ) : null}
              <Badge variant="outline">{agent.category}</Badge>
              <StatusDot
                label={agentStatusLabel(agent.status)}
                tone={statusTone}
              />
            </div>
            <h1 className="mt-4 font-display text-3xl font-light tracking-[0.005em] sm:text-4xl">
              {agent.name}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">
              {brief.tagline}
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Published by{" "}
              <strong className="font-medium text-foreground">
                {agent.owner}
              </strong>
              <span aria-hidden="true"> · </span>
              Version{" "}
              {versionBundle
                ? `v${versionBundle.versions.find((version) => version.id === versionBundle.defaultVersionId)?.versionNumber ?? 1}`
                : agent.configuration.marketplaceVersion ?? "1.0.0"}
              <span aria-hidden="true"> · </span>
              Updated{" "}
              {agent.updatedAt
                ? formatPlatformDateTime(agent.updatedAt)
                : "with the catalog"}
            </p>
          </div>
        </div>

        <MarketplaceActions
          agent={agent}
          canManage={permissions.canManageResources || agent.source === "PROJECT_DEVELOPED"}
          instanceId={instance?.id}
          selectedVersionId={selectedVersionId}
          onSelectVersion={setSelectedVersionId}
          onCreateInstance={createInstance}
          onTry={() => setTryOpen(true)}
        />
      </header>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <main className="min-w-0 space-y-9">
          <MarketplaceSection
            icon={Sparkles}
            title="About this Agent"
            description={brief.overview}
          >
            {preview ? (
              <div className="mt-5 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-muted-foreground">
                <strong className="block text-foreground">
                  Interaction-ready blueprint
                </strong>
                Discovery, preview requests, trace rendering, and Instance
                Registry integration are implemented. The result uses deterministic
                sample data and does not call the named external systems.
              </div>
            ) : null}
          </MarketplaceSection>

          <MarketplaceSection
            icon={CircleCheck}
            title="What teams use it for"
            description="Representative outcomes this Agent is designed to support."
          >
            <ul className="mt-5 grid gap-3 md:grid-cols-3">
              {brief.useCases.map((useCase) => (
                <li
                  key={useCase}
                  className="flex gap-3 border bg-muted/10 p-4 text-sm leading-6"
                >
                  <Check className="mt-1 size-4 shrink-0 text-emerald-600" />
                  {useCase}
                </li>
              ))}
            </ul>
          </MarketplaceSection>

          {workflow.length ? (
            <MarketplaceSection
              icon={Workflow}
              title="How it works"
              description="A transparent preview of the execution path returned with each sample task."
            >
              <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {workflow.map((step, index) => (
                  <li
                    key={`${step}-${index}`}
                    className="border bg-card p-4"
                  >
                    <span className="grid size-7 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    <strong className="mt-4 block text-sm">
                      {step}
                    </strong>
                  </li>
                ))}
              </ol>
            </MarketplaceSection>
          ) : null}

          <section className="grid gap-5 lg:grid-cols-2">
            <MarketplaceList
              icon={FileInput}
              title="Typical inputs"
              items={brief.inputs}
            />
            <MarketplaceList
              icon={FileOutput}
              title="Expected outputs"
              items={brief.outputs}
            />
          </section>

          <MarketplaceSection
            icon={Waypoints}
            title="Published capabilities"
            description="Skills advertised through the Agent Card and exposed when a callable Instance is discovered."
          >
            <div className="mt-5 divide-y border">
              {agent.skills.length ? (
                agent.skills.map((skill) => (
                  <div
                    key={skill.id}
                    className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div>
                      <strong className="text-sm">{skill.name}</strong>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {skill.description || skill.id}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-start gap-1.5">
                      {skill.tags.map((tag) => (
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
                ))
              ) : (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  This adapter publishes a single generic task endpoint.
                </p>
              )}
            </div>
          </MarketplaceSection>

          <MarketplaceSection
            icon={Play}
            title="Example tasks"
            description="Start with one of these tasks in the safe interaction preview."
          >
            <div className="mt-5 divide-y border">
              {exampleTasks.map((task) => (
                <button
                  key={task}
                  type="button"
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                  onClick={() => setTryOpen(true)}
                >
                  <Play className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">{task}</span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </MarketplaceSection>
        </main>

        <aside className="space-y-5 xl:sticky xl:top-20 xl:self-start">
          <MarketplaceFactCard agent={agent} />
          <MarketplaceList
            icon={ShieldCheck}
            title="Before you instantiate"
            items={brief.requirements}
          />
          <div className="border bg-muted/15 p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              <strong className="text-sm">Participation model</strong>
            </div>
            <div className="mt-4 divide-y border-y">
              <CapabilityFact
                label="Interactive"
                enabled={agent.usageCapabilities.interactive}
              />
              <CapabilityFact
                label="Can delegate"
                enabled={agent.usageCapabilities.canDelegate}
              />
              <CapabilityFact
                label="Receives tasks"
                enabled={agent.usageCapabilities.acceptsDelegation}
              />
            </div>
          </div>
        </aside>
      </div>

      <TryDemoAgentSheet
        open={tryOpen}
        onOpenChange={setTryOpen}
        agent={agent}
      />
    </div>
  );
}

function MarketplaceActions({
  agent,
  canManage,
  instanceId,
  onSelectVersion,
  onCreateInstance,
  onTry,
  selectedVersionId,
}: {
  agent: AgentGardenEntry;
  canManage: boolean;
  instanceId: string | undefined;
  onSelectVersion: (versionId: string) => void;
  onCreateInstance: () => void;
  onTry: () => void;
  selectedVersionId: string;
}) {
  const projectId = useCurrentProjectId();
  const versionBundle = agent.distribution?.type === "VERSION_BUNDLE"
    ? agent.distribution
    : null;
  return (
    <div className="border bg-muted/15 p-4">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{usageModeLabel(agent.usageMode)} Agent</span>
        {instanceId ? (
          <span className="font-medium text-primary">
            Instantiated
          </span>
        ) : (
          <span>Not instantiated</span>
        )}
      </div>
      <div className="mt-4 grid gap-2">
        {versionBundle ? (
          <div className="mb-2 space-y-2">
            <Label htmlFor="garden-version">Version</Label>
            <Select value={selectedVersionId || versionBundle.defaultVersionId} onValueChange={onSelectVersion}>
              <SelectTrigger id="garden-version" className="h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{versionBundle.versions.map((version) => (
                <SelectItem key={version.id} value={version.id}>v{version.versionNumber} · {version.instanceCount} instance{version.instanceCount === 1 ? "" : "s"}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
        ) : null}
        {instanceId ? (
          <Button asChild variant="outline" className="h-11 w-full">
            <Link
              to="/$projectId/instances/$instanceId"
              params={{ projectId, instanceId }}
            >
              <Boxes /> View managed Instance
            </Link>
          </Button>
        ) : null}
        {agent.usageCapabilities.acceptsDelegation && (!instanceId || agent.source === "PROJECT_DEVELOPED") ? (
          <Button
            type="button"
            className="h-11 w-full"
            disabled={!canManage || agent.status !== "READY"}
            onClick={onCreateInstance}
          >
            {agent.source === "PROJECT_DEVELOPED" ? "Release Instance" : "Create Instance"} <ArrowRight />
          </Button>
        ) : null}
        {isPreviewAgent(agent) ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={onTry}
          >
            <Play />
            Try preview
          </Button>
        ) : null}
        {agent.source === "BUILT_IN" &&
        !instanceId &&
        agent.usageCapabilities.interactive ? (
          <Button
            type="button"
            className="h-11 w-full"
            disabled={agent.status !== "READY"}
            onClick={onCreateInstance}
          >
            Create Instance
            <ArrowRight />
          </Button>
        ) : null}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Release creates a running Instance pinned to the selected published Version.
        READY callable Instances are discoverable through the Project Runtime Bridge.
      </p>
    </div>
  );
}

function MarketplaceSection({
  children,
  description,
  icon: Icon,
  title,
}: {
  children?: ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <section>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center border bg-muted/20 text-primary">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function MarketplaceList({
  icon: Icon,
  items,
  title,
}: {
  icon: LucideIcon;
  items: string[];
  title: string;
}) {
  return (
    <section className="border bg-card p-5">
      <div className="flex items-center gap-3">
        <Icon className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li
            key={item}
            className="flex gap-3 text-sm leading-6 text-muted-foreground"
          >
            <Check className="mt-1 size-4 shrink-0 text-emerald-600" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MarketplaceFactCard({
  agent,
}: {
  agent: AgentGardenEntry;
}) {
  const facts = [
    ["Publisher", agent.owner],
    ["Framework", agent.configuration.framework ?? agent.platformLabel],
    ["Language", agent.configuration.language ?? "Not specified"],
    ["Protocol", agent.configuration.transport ?? agent.platformLabel],
    ["Release", agent.configuration.releaseStage ?? agentStatusLabel(agent.status)],
    ["Support", agent.configuration.supportLevel ?? "Project managed"],
    ["License", agent.configuration.license ?? "Project registration"],
    ...(agent.configuration.onboardingSource === "CONTAINER_IMAGE"
      ? [
          ["Instance", agent.configuration.managedInstanceId ?? "Pending"],
          ["Namespace", agent.configuration.runtimeNamespace ?? "Pending"],
          ["Pod", agent.configuration.podName ?? "Pending"],
          ["Service", agent.configuration.serviceName ?? "Pending"],
        ]
      : []),
  ];
  return (
    <section className="border bg-card p-4">
      <div className="flex items-center gap-2">
        <Code2 className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">At a glance</h2>
      </div>
      <dl className="mt-4 divide-y border-y text-xs">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-3"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CapabilityFact({
  enabled,
  label,
}: {
  enabled: boolean;
  label: string;
}) {
  return (
    <div className="flex min-h-11 items-center gap-2 text-xs">
      {enabled ? (
        <Check className="size-3.5 text-emerald-600" />
      ) : (
        <X className="size-3.5 text-muted-foreground" />
      )}
      <span>{label}</span>
      <span className="ml-auto text-muted-foreground">
        {enabled ? "Yes" : "No"}
      </span>
    </div>
  );
}

function MarketplaceDetailSkeleton() {
  return (
    <div className="space-y-7">
      <Skeleton className="h-11 w-44" />
      <div className="grid gap-6 border-b pb-7 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex gap-5">
          <Skeleton className="size-16" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-10 w-80 max-w-full" />
            <Skeleton className="h-5 w-full max-w-2xl" />
          </div>
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-8">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}
