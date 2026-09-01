import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ExpertAgentDefinitionInput, ExpertAgentExecutionSpec } from "@tali/contracts";
import { z } from "zod";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  CircleAlert,
  Database,
  ExternalLink,
  FileArchive,
  FlaskConical,
  History,
  MoreHorizontal,
  PackageCheck,
  PencilLine,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteEntitySheet } from "@/components/shared/delete-entity-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { PlaybookWorkflowCanvas } from "@/features/expert-agents/playbook-workflow-canvas";
import type { AgentLifecycleState, AgentVersion } from "@/features/expert-agents/expert-agent-types";
import { useCurrentProjectId } from "@/hooks/use-project";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const stages = ["define", "test-data", "test", "versions"] as const;
type Stage = (typeof stages)[number];

export const Route = createFileRoute("/$projectId/agents/$agentId")({
  validateSearch: z.object({ stage: z.enum(stages).optional().default("define") }),
  component: AgentDeveloper,
});

const stageMeta: Record<Stage, { label: string }> = {
  define: { label: "Edit" },
  "test-data": { label: "Test data" },
  test: { label: "Evaluate" },
  versions: { label: "Versions" },
};

const lifecycleLabel: Record<AgentLifecycleState, string> = {
  NEEDS_TESTING: "Needs testing",
  TESTS_FAILED: "Tests failed",
  READY_TO_PUBLISH: "Ready to publish",
  PUBLISHED: "Published",
};

function lines(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function shortDigest(value: string): string {
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}

type AgenticExecution = Extract<ExpertAgentExecutionSpec, { mode: "AGENTIC" }>;
type WorkflowExecution = Extract<ExpertAgentExecutionSpec, { mode: "WORKFLOW" }>;
type WorkflowNode = WorkflowExecution["nodes"][number];

function patchAgenticExecution(
  definition: ExpertAgentDefinitionInput,
  patch: Partial<AgenticExecution>,
): ExpertAgentDefinitionInput {
  if (definition.execution.mode !== "AGENTIC") return definition;
  return { ...definition, execution: { ...definition.execution, ...patch } };
}

function AgentDeveloper() {
  const { agentId } = Route.useParams();
  const { stage } = Route.useSearch();
  const navigate = Route.useNavigate();
  const projectId = useCurrentProjectId();
  const scope = useProjectQueryScope();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: scope.key("agent", agentId),
    queryFn: () => api.getExpertAgent(agentId),
  });
  const [definition, setDefinition] = useState<ExpertAgentDefinitionInput | null>(null);
  const [publicationNotes, setPublicationNotes] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishResult, setPublishResult] = useState<AgentVersion | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    setDefinition(detail.data.definition);
  }, [detail.data]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: scope.key("agent", agentId) }),
      queryClient.invalidateQueries({ queryKey: scope.key("expert-agents") }),
      queryClient.invalidateQueries({ queryKey: scope.key("agent-garden") }),
    ]);
  };
  const save = useMutation({
    mutationFn: () => api.updateExpertAgent(agentId, definition!),
    onSuccess: invalidate,
  });
  const test = useMutation({
    mutationFn: () => api.testExpertAgent(agentId),
    onSuccess: invalidate,
  });
  const publish = useMutation({
    mutationFn: () => api.publishExpertAgent(agentId, {
      expectedRevision: detail.data!.revision,
      publicationNotes: publicationNotes.trim() || null,
    }),
    onSuccess: async (version) => {
      setPublishResult(version);
      setPublicationNotes("");
      await invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteExpertAgent(agentId),
    onSuccess: async () => {
      setDeleteOpen(false);
      queryClient.removeQueries({ queryKey: scope.key("agent", agentId) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scope.key("expert-agents") }),
        queryClient.invalidateQueries({ queryKey: scope.key("agent-garden") }),
      ]);
      await navigate({ to: "/$projectId/agents", params: { projectId } });
    },
  });

  if (detail.isPending || !definition) return <AgentSkeleton />;
  if (detail.isError || !detail.data) {
    return (
      <div className="grid min-h-[32rem] place-items-center border text-center">
        <div className="max-w-md px-6">
          <CircleAlert className="mx-auto size-6 text-destructive" />
          <h1 className="mt-4 text-lg font-semibold">Agent could not be loaded</h1>
          <p className="mt-2 text-sm text-muted-foreground">{detail.error instanceof Error ? detail.error.message : "Try again."}</p>
          <Button className="mt-5" variant="outline" onClick={() => void detail.refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  const agent = detail.data;
  const dirty = JSON.stringify(definition) !== JSON.stringify(agent.definition);
  const currentTest = agent.testRuns.find((run) => run.contentDigest === agent.contentDigest) ?? null;
  const publishedCurrentDigest = agent.latestVersion?.contentDigest === agent.contentDigest;
  const go = (next: Stage) => void navigate({ search: { stage: next }, replace: true });
  const openPublishReview = () => {
    setPublishResult(null);
    setPublishOpen(true);
  };
  const currentTestPassed = currentTest?.status === "PASSED";
  const lifecycle = dirty
    ? { label: "Unsaved changes", tone: "neutral" as const }
    : publishedCurrentDigest
      ? { label: `Published as ${agent.latestVersion?.label ?? "Version"}`, tone: "success" as const }
      : agent.lifecycleState === "READY_TO_PUBLISH"
        ? { label: "Tests passed", tone: "info" as const }
        : agent.lifecycleState === "TESTS_FAILED"
          ? { label: "Tests failed", tone: "danger" as const }
          : { label: lifecycleLabel[agent.lifecycleState], tone: "neutral" as const };

  const headerActions = dirty ? (
    <Button disabled={save.isPending} onClick={() => save.mutate()}>
      {save.isPending ? <Spinner /> : <Save />}{save.isPending ? "Saving…" : "Save changes"}
    </Button>
  ) : (
    <>
      <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
        {test.isPending ? <Spinner /> : <FlaskConical />}{test.isPending ? "Evaluating…" : "Run evaluation"}
      </Button>
      {publishedCurrentDigest ? (
        <Button asChild>
          <Link to="/$projectId/agent-garden" params={{ projectId }}>Open published Version <ExternalLink /></Link>
        </Button>
      ) : (
        <Button
          disabled={!currentTestPassed || !agent.publishReadiness.ready}
          onClick={openPublishReview}
          title={!currentTestPassed ? "Run a passing evaluation before publishing." : undefined}
        >
          <PackageCheck /> Publish
        </Button>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-[96rem] space-y-7 pb-10">
      <header className="border-b pb-6">
        <Link
          to="/$projectId/agents"
          params={{ projectId }}
          className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Agents
        </Link>
        <div className="mt-2 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[1.75rem] font-medium tracking-[-0.03em]">{agent.name}</h1>
              <Badge variant="outline">{agent.executionMode === "WORKFLOW" ? "Workflow Agent" : "Adaptive Agent"}</Badge>
              <span className={cn(
                "inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
                lifecycle.tone === "success" && "border-success-border bg-success-surface text-success-foreground",
                lifecycle.tone === "info" && "border-info-border bg-info-surface text-info-foreground",
                lifecycle.tone === "danger" && "border-destructive-border bg-destructive-surface text-destructive",
                lifecycle.tone === "neutral" && "border-border bg-muted/40 text-muted-foreground",
              )}>
                {lifecycle.label}
              </span>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{agent.description}</p>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">r{agent.revision} · {shortDigest(agent.contentDigest)}</p>
          </div>
          <div className="flex w-full shrink-0 items-start gap-2 xl:w-auto xl:items-center">
            <div className="grid min-w-0 flex-1 gap-2 sm:flex sm:items-center sm:justify-end">
              {headerActions}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-11" aria-label="More Agent actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => {
                    remove.reset();
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 /> Delete Agent
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <nav aria-label="Agent development workspace" className="grid min-h-11 grid-cols-4 items-end border-b sm:flex sm:gap-1">
        {stages.map((item) => {
          const active = stage === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => go(item)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative inline-flex min-h-11 min-w-0 items-center justify-center gap-2 px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 sm:px-4 sm:text-sm",
                "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-link after:opacity-0 after:transition-opacity",
                active && "text-foreground after:opacity-100",
              )}
            >
              {item === "test" && currentTestPassed ? <CheckCircle2 className="hidden size-3.5 text-success-foreground sm:block" /> : null}
              {item === "test" && currentTest?.status === "FAILED" ? <CircleAlert className="hidden size-3.5 text-destructive sm:block" /> : null}
              {item === "define" ? <PencilLine className="hidden size-3.5 sm:block" /> : null}
              {item === "test-data" ? <Database className="hidden size-3.5 sm:block" /> : null}
              {item === "versions" ? <History className="hidden size-3.5 sm:block" /> : null}
              {stageMeta[item].label}
            </button>
          );
        })}
      </nav>

      {dirty && stage !== "define" && stage !== "test-data" ? (
        <div className="flex items-start gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          Save your changes before evaluating or publishing. Results are bound to the saved content digest.
        </div>
      ) : null}

      {stage === "define" ? (
        <DefineStage
          definition={definition}
          selectedNode={selectedNode}
          onChange={setDefinition}
          onSelectNode={setSelectedNode}
        />
      ) : stage === "test-data" ? (
        <TestDataStage definition={definition} onChange={setDefinition} />
      ) : stage === "test" ? (
        <TestStage agent={agent} currentTest={currentTest} error={test.error} />
      ) : stage === "versions" ? (
        <VersionsStage agent={agent} />
      ) : null}

      <PublishVersionSheet
        agent={agent}
        currentTest={currentTest}
        open={publishOpen}
        pending={publish.isPending}
        error={publish.error}
        publicationNotes={publicationNotes}
        result={publishResult}
        onOpenChange={(open) => {
          if (publish.isPending) return;
          setPublishOpen(open);
          if (!open) setPublishResult(null);
        }}
        onPublicationNotes={setPublicationNotes}
        onPublish={() => publish.mutate()}
      />

      <DeleteEntitySheet
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${agent.name}?`}
        description={agent.instanceCount > 0
          ? "This Agent still has runtime Instances. Delete those Instances before removing its development assets."
          : "This permanently removes the Agent and all of its development assets from this Project."}
        entityName={agent.name}
        blocked={agent.instanceCount > 0}
        blockedAction={() => void navigate({ to: "/$projectId/instances", params: { projectId } })}
        blockedActionLabel="Open Instances"
        deleting={remove.isPending}
        {...(remove.error instanceof Error ? { error: remove.error.message } : {})}
        confirmLabel="Delete Agent"
        pendingLabel="Deleting Agent…"
        impactDescription={agent.versions.length > 0
          ? `${agent.versions.length} published Version${agent.versions.length === 1 ? "" : "s"} and their Artifacts will also be removed from Agent Garden. This cannot be undone.`
          : "The definition and its Test history will be permanently removed. This cannot be undone."}
        onConfirm={() => remove.mutate()}
      >
        <dl className="divide-y border-y text-sm">
          <Stat label="Agent definition" value="1" />
          <Stat label="Test runs" value={String(agent.testRuns.length)} />
          <Stat label="Published Versions" value={String(agent.versions.length)} />
          <Stat label="Runtime Instances" value={String(agent.instanceCount)} />
        </dl>
      </DeleteEntitySheet>

      {(save.error || publish.error) ? (
        <div role="alert" className="border border-destructive-border bg-destructive-surface px-4 py-3 text-sm text-destructive">
          {(save.error ?? publish.error) instanceof Error ? (save.error ?? publish.error)?.message : "The action failed."}
        </div>
      ) : null}
    </div>
  );
}

function DefineStage({
  definition,
  onChange,
  onSelectNode,
  selectedNode,
}: {
  definition: ExpertAgentDefinitionInput;
  onChange: (definition: ExpertAgentDefinitionInput) => void;
  onSelectNode: (id: string | null) => void;
  selectedNode: string | null;
}) {
  const product = definition.product;
  const patchProduct = (patch: Partial<typeof product>) => onChange({
    ...definition,
    product: { ...product, ...patch },
  });
  const workflow = definition.execution.mode === "WORKFLOW" ? definition.execution : null;
  const agentic = definition.execution.mode === "AGENTIC" ? definition.execution : null;
  const selectedWorkflowNode = workflow?.nodes.find((node) => node.id === selectedNode) ?? null;
  const patchWorkflow = (next: WorkflowExecution) => onChange({ ...definition, execution: next });
  const addWorkflowNode = () => {
    if (!workflow) return;
    let ordinal = workflow.nodes.length + 1;
    while (workflow.nodes.some((node) => node.id === `step-${ordinal}`)) ordinal += 1;
    const node: WorkflowNode = {
      id: `step-${ordinal}`,
      type: "TRANSFORM",
      configuration: {},
      timeoutMs: 30_000,
    };
    patchWorkflow({ ...workflow, nodes: [...workflow.nodes, node] });
    onSelectNode(node.id);
  };
  return (
    <div className="space-y-10">
      <section aria-labelledby="agent-editor-heading">
        <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="agent-editor-heading" className="text-[1.05rem] font-semibold tracking-[-0.01em]">
              {workflow ? "Workflow editor" : "Agent editor"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {workflow
                ? "Design the executable LangGraph. Select a node to edit its operator, configuration, timeout, and outcomes."
                : "Shape the adaptive reasoning instructions and model route used by this Agent."}
            </p>
          </div>
          {workflow ? <Button type="button" variant="outline" size="sm" onClick={addWorkflowNode}><Plus /> Add step</Button> : null}
        </div>
        {workflow ? (
          <div className="mt-4 grid min-h-[40rem] overflow-hidden border xl:grid-cols-[minmax(0,1fr)_22rem]">
            <PlaybookWorkflowCanvas
              execution={workflow}
              selectedId={selectedNode}
              onSelect={onSelectNode}
              onConnect={(source, target) => {
                const ordinal = workflow.transitions.filter((item) => item.from === source).length + 1;
                patchWorkflow({
                  ...workflow,
                  transitions: [...workflow.transitions, { from: source, to: target, outcome: `NEXT_${ordinal}` }],
                });
              }}
            />
            <WorkflowNodeInspector
              execution={workflow}
              node={selectedWorkflowNode}
              onChange={patchWorkflow}
              onSelectNode={onSelectNode}
            />
          </div>
        ) : (
          <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Field label="Instructions"><Textarea className="min-h-[26rem] font-mono text-sm leading-6" value={agentic?.instruction ?? ""} onChange={(event) => onChange(patchAgenticExecution(definition, { instruction: event.target.value }))} /></Field>
            <aside className="space-y-5 border bg-surface-subtle/30 p-5">
              <SectionHeading title="Runtime reasoning" description="These settings guide adaptive execution. Delivery channels are selected later when a Version becomes an Instance." compact />
              <Field label="Model routing"><Input value={agentic?.modelRoutingId ?? ""} onChange={(event) => onChange(patchAgenticExecution(definition, { modelRoutingId: event.target.value }))} /></Field>
              <dl className="divide-y border-y text-sm">
                <Stat label="Tools and resources" value={String(definition.resources.length)} />
                <Stat label="Delegations" value={String(definition.delegations.filter((item) => item.enabled).length)} />
              </dl>
            </aside>
          </div>
        )}
      </section>

      <div className="grid gap-8 border-t pt-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0">
          <SectionHeading title="Agent definition" description="Describe the stable product promise independently from its implementation." />
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label="Name"><Input value={product.name} onChange={(event) => patchProduct({ name: event.target.value })} /></Field>
            <Field label="Target users"><Textarea className="min-h-24" value={product.targetUsers.join("\n")} onChange={(event) => patchProduct({ targetUsers: lines(event.target.value) })} /></Field>
          </div>
          <Field className="mt-5" label="Purpose"><Textarea className="min-h-28" value={product.purpose} onChange={(event) => patchProduct({ purpose: event.target.value })} /></Field>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field label="Capabilities" hint="One observable capability per line"><Textarea className="min-h-40" value={product.capabilities.join("\n")} onChange={(event) => patchProduct({ capabilities: lines(event.target.value) })} /></Field>
            <Field label="Out of scope" hint="One explicit boundary per line"><Textarea className="min-h-40" value={product.outOfScope.join("\n")} onChange={(event) => patchProduct({ outOfScope: lines(event.target.value) })} /></Field>
          </div>
        </section>
        <aside className="space-y-6">
          <section className="border p-5">
            <SectionHeading title="Publish contract" description="Frozen into every published Version." compact />
            <dl className="mt-5 divide-y text-sm">
              <Stat label="Test cases" value={String(definition.acceptance.cases.length)} />
              <Stat label="Required guardrails" value={String(definition.safety.guardrails.filter((item) => item.required).length)} />
              <Stat label="Resource bindings" value={String(definition.resources.length)} />
              <Stat label="Delegations" value={String(definition.delegations.filter((item) => item.enabled).length)} />
            </dl>
          </section>
          <section className="border p-5">
            <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" /><h2 className="text-sm font-semibold">Safety behavior</h2></div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Without evidence, return <strong className="text-foreground">{definition.safety.noEvidenceBehavior}</strong>. General model fallback is {definition.safety.allowGeneralModelFallback ? "allowed" : "disabled"}.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

const workflowNodeTypes: WorkflowNode["type"][] = [
  "NORMALIZE_INPUT", "CLASSIFY_INTENT", "RETRIEVE_EVIDENCE", "DECISION",
  "REASON", "KNOWLEDGE", "TOOL", "TRANSFORM", "VERIFY", "DELEGATE",
  "APPROVAL", "RESPONSE", "RENDER_TEMPLATE", "ESCALATE", "END",
];

function WorkflowNodeInspector({ execution, node, onChange, onSelectNode }: {
  execution: WorkflowExecution;
  node: WorkflowNode | null;
  onChange: (execution: WorkflowExecution) => void;
  onSelectNode: (id: string | null) => void;
}) {
  if (!node) {
    return (
      <aside className="grid min-h-64 place-items-center border-t bg-surface-subtle/45 p-6 text-center xl:border-l xl:border-t-0">
        <div><Workflow className="mx-auto size-5 text-muted-foreground" /><h3 className="mt-3 text-sm font-semibold">Select a workflow step</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Inspect its operator, configuration, timeout, and outgoing outcomes.</p></div>
      </aside>
    );
  }
  const nodeIndex = execution.nodes.findIndex((item) => item.id === node.id);
  const outgoing = execution.transitions
    .map((transition, index) => ({ transition, index }))
    .filter(({ transition }) => transition.from === node.id);
  const patchNode = (patch: Partial<WorkflowNode>) => onChange({
    ...execution,
    nodes: execution.nodes.map((item, index) => index === nodeIndex ? { ...item, ...patch } : item),
  });
  const removeNode = () => {
    if (node.id === execution.entrypoint || execution.nodes.length <= 2) return;
    onChange({
      ...execution,
      nodes: execution.nodes.filter((item) => item.id !== node.id),
      transitions: execution.transitions.filter((transition) => transition.from !== node.id && transition.to !== node.id),
    });
    onSelectNode(null);
  };
  return (
    <aside className="overflow-y-auto border-t bg-background xl:border-l xl:border-t-0">
      <div className="flex items-start justify-between gap-4 border-b p-4">
        <div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Selected step</p><h3 className="mt-1 truncate font-mono text-sm font-medium">{node.id}</h3></div>
        <Button type="button" variant="ghost" size="icon" disabled={node.id === execution.entrypoint || execution.nodes.length <= 2} onClick={removeNode} aria-label={`Delete ${node.id}`}><Trash2 /></Button>
      </div>
      <div className="space-y-5 p-4">
        <Field label="Operator">
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" value={node.type} onChange={(event) => patchNode({ type: event.target.value as WorkflowNode["type"] })}>
            {workflowNodeTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ").toLowerCase()}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Timeout (ms)"><Input type="number" min={100} value={node.timeoutMs ?? ""} onChange={(event) => patchNode({ timeoutMs: event.target.value ? Number(event.target.value) : undefined })} /></Field>
          <div><Label>Entrypoint</Label><Button type="button" className="mt-2 w-full" variant={node.id === execution.entrypoint ? "secondary" : "outline"} disabled={node.id === execution.entrypoint} onClick={() => onChange({ ...execution, entrypoint: node.id })}>{node.id === execution.entrypoint ? "Current" : "Set"}</Button></div>
        </div>
        <WorkflowConfigurationEditor key={node.id} value={node.configuration} onChange={(configuration) => patchNode({ configuration })} />
        <div>
          <div className="flex items-center justify-between gap-3"><Label>Outcomes</Label><span className="text-[11px] text-muted-foreground">{outgoing.length}</span></div>
          <div className="mt-2 divide-y border">
            {outgoing.length ? outgoing.map(({ transition, index }) => (
              <div key={`${transition.from}:${index}`} className="space-y-2 p-3">
                <div className="flex gap-2"><Input className="h-9 font-mono text-xs" value={transition.outcome} onChange={(event) => onChange({ ...execution, transitions: execution.transitions.map((item, itemIndex) => itemIndex === index ? { ...item, outcome: event.target.value } : item) })} /><Button type="button" variant="ghost" size="icon" className="size-9" onClick={() => onChange({ ...execution, transitions: execution.transitions.filter((_item, itemIndex) => itemIndex !== index) })} aria-label={`Delete ${transition.outcome} transition`}><Trash2 /></Button></div>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring" value={transition.to} onChange={(event) => onChange({ ...execution, transitions: execution.transitions.map((item, itemIndex) => itemIndex === index ? { ...item, to: event.target.value } : item) })}>
                  {execution.nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
                </select>
              </div>
            )) : <p className="p-3 text-xs leading-5 text-muted-foreground">Drag the node handle to another step to add an outcome.</p>}
          </div>
        </div>
      </div>
    </aside>
  );
}

function WorkflowConfigurationEditor({ value, onChange }: { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(JSON.stringify(value, null, 2)); setError(null); }, [value]);
  const commit = () => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Configuration must be a JSON object.");
      onChange(parsed as Record<string, unknown>);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid JSON configuration.");
    }
  };
  return (
    <Field label="Configuration" hint="JSON object">
      <Textarea className="min-h-44 font-mono text-xs leading-5" value={text} aria-invalid={Boolean(error)} onChange={(event) => setText(event.target.value)} onBlur={commit} />
      {error ? <p className="mt-1.5 text-xs text-destructive">{error}</p> : null}
    </Field>
  );
}

type AcceptanceCase = ExpertAgentDefinitionInput["acceptance"]["cases"][number];

function TestDataStage({ definition, onChange }: {
  definition: ExpertAgentDefinitionInput;
  onChange: (definition: ExpertAgentDefinitionInput) => void;
}) {
  const cases = definition.acceptance.cases;
  const [selectedId, setSelectedId] = useState<string | null>(cases[0]?.id ?? null);
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0] ?? null;

  useEffect(() => {
    if (selected || !cases[0]) return;
    setSelectedId(cases[0].id);
  }, [cases, selected]);

  const replaceCases = (next: AcceptanceCase[]) => onChange({
    ...definition,
    acceptance: { ...definition.acceptance, cases: next },
  });
  const patchCase = (id: string, patch: Partial<AcceptanceCase>) => replaceCases(
    cases.map((item) => item.id === id ? { ...item, ...patch } : item),
  );
  const addCase = () => {
    let ordinal = cases.length + 1;
    while (cases.some((item) => item.id === `case-${ordinal}`)) ordinal += 1;
    const testCase: AcceptanceCase = {
      id: `case-${ordinal}`,
      title: "Untitled test case",
      kind: "HAPPY_PATH",
      given: "The Agent has access to its required Project resources.",
      when: "A representative request is submitted.",
      then: ["The Agent returns the expected observable outcome."],
      required: true,
    };
    replaceCases([...cases, testCase]);
    setSelectedId(testCase.id);
  };
  const removeCase = (id: string) => {
    if (cases.length <= 1) return;
    const next = cases.filter((item) => item.id !== id);
    replaceCases(next);
    setSelectedId(next[0]?.id ?? null);
  };

  return (
    <section aria-labelledby="test-data-heading">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="test-data-heading" className="text-[1.05rem] font-semibold tracking-[-0.01em]">Test data</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Maintain representative requests and expected outcomes before running an Evaluation.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addCase}><Plus /> Add case</Button>
      </div>

      <div className="mt-4 grid min-h-[38rem] overflow-hidden border xl:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="border-b bg-surface-subtle/30 xl:border-b-0 xl:border-r">
          <div className="border-b px-4 py-3 text-xs font-medium text-muted-foreground">
            {cases.length} case{cases.length === 1 ? "" : "s"} · {cases.filter((item) => item.required).length} required
          </div>
          <div className="divide-y">
            {cases.map((item) => {
              const active = item.id === selected?.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    "flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30",
                    active && "border-l-2 border-l-primary bg-background",
                  )}
                >
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-muted-foreground/35" />
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-medium">{item.title}</strong>
                    <span className="mt-1 block text-[11px] text-muted-foreground">{item.kind.replaceAll("_", " ").toLowerCase()}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {selected ? (
          <div className="min-w-0 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4 border-b pb-4">
              <div>
                <p className="font-mono text-[11px] text-muted-foreground">{selected.id}</p>
                <h3 className="mt-1 font-semibold">Evaluation case</h3>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={cases.length <= 1}
                onClick={() => removeCase(selected.id)}
                aria-label={`Delete ${selected.title}`}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <Field label="Case name"><Input value={selected.title} onChange={(event) => patchCase(selected.id, { title: event.target.value })} /></Field>
              <Field label="Path">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  value={selected.kind}
                  onChange={(event) => patchCase(selected.id, { kind: event.target.value as AcceptanceCase["kind"] })}
                >
                  <option value="HAPPY_PATH">Happy path</option>
                  <option value="EDGE_CASE">Edge case</option>
                  <option value="FAILURE_PATH">Failure path</option>
                </select>
              </Field>
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <Field label="Given"><Textarea className="min-h-32" value={selected.given} onChange={(event) => patchCase(selected.id, { given: event.target.value })} /></Field>
              <Field label="When"><Textarea className="min-h-32" value={selected.when} onChange={(event) => patchCase(selected.id, { when: event.target.value })} /></Field>
            </div>
            <Field className="mt-5" label="Expected outcomes" hint="One assertion per line">
              <Textarea className="min-h-40" value={selected.then.join("\n")} onChange={(event) => patchCase(selected.id, { then: lines(event.target.value) })} />
            </Field>
            <label className="mt-5 flex min-h-11 cursor-pointer items-center gap-3 border-t pt-4 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={selected.required}
                onChange={(event) => patchCase(selected.id, { required: event.target.checked })}
              />
              <span><strong className="font-medium">Required for Publish</strong><span className="ml-2 text-muted-foreground">A failure blocks publishing this digest.</span></span>
            </label>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TestStage({ agent, currentTest, error }: {
  agent: Awaited<ReturnType<typeof api.getExpertAgent>>;
  currentTest: Awaited<ReturnType<typeof api.getExpertAgent>>["testRuns"][number] | null;
  error: Error | null;
}) {
  const passed = currentTest?.status === "PASSED";
  const suiteCount = agent.definition.acceptance.suites?.length ?? 0;
  const caseCount = agent.definition.acceptance.cases.length;
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section>
        <SectionHeading title="Evaluate Agent" description="Run the saved definition against its Test data, safety policy, resources, and A2A contract." />
        <div className={cn("mt-4 border-l-4 p-5", passed ? "border-success bg-success-surface" : currentTest?.status === "FAILED" ? "border-destructive bg-destructive-surface" : "border-border bg-muted/20")}>
          <div className="flex items-start gap-3">
            {passed ? <CheckCircle2 className="mt-0.5 size-5 text-success-foreground" /> : currentTest?.status === "FAILED" ? <CircleAlert className="mt-0.5 size-5 text-destructive" /> : <FlaskConical className="mt-0.5 size-5 text-muted-foreground" />}
            <div>
              <h2 className="font-semibold">{passed ? "Current Agent passed" : currentTest?.status === "FAILED" ? "Current Agent failed" : "Current Agent has not been tested"}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{currentTest?.evidence.summary ?? "Run the required test suite before publishing a Version."}</p>
            </div>
          </div>
        </div>
        {currentTest ? (
          <div className="mt-6 divide-y border-y">
            {currentTest.evidence.assertions.map((assertion) => (
              <div key={assertion.id} className="flex gap-3 py-3.5">
                {assertion.passed ? <Check className="mt-0.5 size-4 text-success-foreground" /> : <X className="mt-0.5 size-4 text-destructive" />}
                <div><p className="text-sm font-medium">{assertion.id.replaceAll(":", " · ")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{assertion.message}</p></div>
              </div>
            ))}
          </div>
        ) : null}
        {error ? <p className="mt-4 text-sm text-destructive">{error.message}</p> : null}
      </section>
      <aside className="border p-5">
        <h2 className="text-sm font-semibold">Evaluation scope</h2>
        <dl className="mt-4 divide-y border-y text-sm">
          <Stat label="Test cases" value={String(caseCount)} />
          <Stat label="Evaluation suites" value={String(suiteCount)} />
          <Stat label="Required pass rate" value={`${Math.round(agent.definition.acceptance.minimumRequiredPassRate * 100)}%`} />
        </dl>
        <h3 className="mt-6 text-sm font-semibold">What it proves</h3>
        <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
          {["Required Test data passes", "Guardrails and resource pins are valid", "The execution path is inspectable", "The A2A contract is executable"].map((item) => <li key={item} className="flex gap-2"><Circle className="mt-1 size-2.5 shrink-0 fill-current" />{item}</li>)}
        </ul>
        <p className="mt-5 border-t pt-4 font-mono text-[11px] text-muted-foreground">Digest {shortDigest(agent.contentDigest)}</p>
      </aside>
    </div>
  );
}

function VersionsStage({ agent }: { agent: Awaited<ReturnType<typeof api.getExpertAgent>> }) {
  const projectId = useCurrentProjectId();
  return (
    <section aria-labelledby="versions-heading">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="versions-heading" className="text-[1.05rem] font-semibold tracking-[-0.01em]">Published Versions</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Immutable Artifacts available in Agent Garden. Instances always reference one of these Versions.</p>
        </div>
        {agent.versions.length ? <Button asChild variant="outline" size="sm"><Link to="/$projectId/agent-garden" params={{ projectId }}>Open Agent Garden <ExternalLink /></Link></Button> : null}
      </div>

      {agent.versions.length ? (
        <div className="mt-4 overflow-x-auto border">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Version</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Artifacts</th>
                <th className="px-4 py-3 font-medium">Published</th>
                <th className="px-4 py-3 font-medium">Garden</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {agent.versions.map((version) => (
                <tr key={version.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <strong className="font-medium">{version.label}</strong>
                      {agent.latestVersion?.id === version.id ? <Badge variant="outline" className="border-success-border bg-success-surface text-success-foreground">Latest</Badge> : null}
                    </div>
                    {version.publicationNotes ? <p className="mt-1 max-w-md truncate text-xs text-muted-foreground">{version.publicationNotes}</p> : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">r{version.sourceRevision}</td>
                  <td className="px-4 py-3 tabular-nums">{version.artifacts.length}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(version.publishedAt).toLocaleString()}</td>
                  <td className="px-4 py-3"><Badge variant="outline">{version.gardenStatus === "PUBLISHED" ? "Available" : "Withdrawn"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 grid min-h-72 place-items-center border text-center">
          <div className="max-w-md px-6">
            <FileArchive className="mx-auto size-7 text-muted-foreground" />
            <h3 className="mt-4 font-semibold">No published Version yet</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Run a passing Evaluation, then Publish the tested definition to Agent Garden.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function PublishVersionSheet({
  agent,
  currentTest,
  error,
  onOpenChange,
  onPublicationNotes,
  onPublish,
  open,
  pending,
  publicationNotes,
  result,
}: {
  agent: Awaited<ReturnType<typeof api.getExpertAgent>>;
  currentTest: Awaited<ReturnType<typeof api.getExpertAgent>>["testRuns"][number] | null;
  error: Error | null;
  onOpenChange: (open: boolean) => void;
  onPublicationNotes: (value: string) => void;
  onPublish: () => void;
  open: boolean;
  pending: boolean;
  publicationNotes: string;
  result: AgentVersion | null;
}) {
  const projectId = useCurrentProjectId();
  const assertionCount = currentTest?.evidence.assertions.length ?? 0;
  const passedAssertionCount = currentTest?.evidence.assertions.filter((assertion) => assertion.passed).length ?? 0;
  const plannedArtifacts = [
    ["Agent definition", "Product promise, inputs, outputs, and safety boundaries"],
    [agent.executionMode === "WORKFLOW" ? "LangGraph playbook" : "Agent instructions", agent.executionMode === "WORKFLOW" ? "Executable nodes, transitions, and operator configuration" : "Model routing and adaptive execution instructions"],
    ["Resource lock", `${agent.definition.resources.length} resource binding${agent.definition.resources.length === 1 ? "" : "s"} pinned to this Version`],
    ["Test report", `${passedAssertionCount} of ${assertionCount} required assertions passed for this digest`],
  ] as const;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="!w-full gap-0 overflow-hidden bg-background p-0 sm:!w-[min(96vw,42rem)] sm:!max-w-[42rem] [&>button]:size-11">
        <SheetHeader className="shrink-0 border-b px-5 py-5 pr-16 sm:px-6">
          <SheetTitle>{result ? `${result.label} published` : "Publish version"}</SheetTitle>
          <SheetDescription>
            {result
              ? "The immutable Version and its Artifacts are now available in Agent Garden."
              : "Review the tested definition, then publish an immutable Version to Agent Garden."}
          </SheetDescription>
        </SheetHeader>

        {result ? (
          <div className="flex-1 overflow-y-auto p-5 sm:p-6">
            <div className="border-l-4 border-success bg-success-surface p-5">
              <CheckCircle2 className="size-6 text-success-foreground" />
              <h2 className="mt-4 text-lg font-semibold">Version published</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{result.label} is discoverable in Agent Garden. Publishing did not create a runtime Instance.</p>
            </div>
            <dl className="mt-6 divide-y border-y text-sm">
              <Stat label="Version" value={result.label} />
              <Stat label="Source revision" value={`r${result.sourceRevision}`} />
              <Stat label="Artifacts" value={String(result.artifacts.length)} />
              <Stat label="Published" value={new Date(result.publishedAt).toLocaleString()} />
            </dl>
            <div className="mt-6 divide-y border-y">
              {result.artifacts.map((artifact) => (
                <div key={artifact.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <span>{artifact.kind.replaceAll("_", " ")}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{shortDigest(artifact.digest)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 sm:p-6">
            <section className="border-l-4 border-info bg-info-surface p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-info-foreground" />
                <div>
                  <h2 className="font-semibold">Ready to publish</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">The saved definition and its passing test evidence share the same content digest.</p>
                </div>
              </div>
            </section>

            <section className="mt-7">
              <div className="flex items-end justify-between gap-4 border-b pb-3">
                <div>
                  <h2 className="font-semibold">Artifacts</h2>
                  <p className="mt-1 text-sm text-muted-foreground">These objects will be frozen into the new Version.</p>
                </div>
                <FileArchive className="size-5 text-muted-foreground" />
              </div>
              <div className="divide-y">
                {plannedArtifacts.map(([name, description]) => (
                  <div key={name} className="py-3.5">
                    <p className="text-sm font-medium">{name}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
                  </div>
                ))}
              </div>
            </section>

            <Field className="mt-7" label="Version notes" hint="Optional">
              <Textarea className="min-h-28" value={publicationNotes} onChange={(event) => onPublicationNotes(event.target.value)} placeholder="Describe the product behavior that changed in this Version." />
            </Field>

            <div className="mt-7 border-t pt-5 text-sm leading-6 text-muted-foreground">
              <strong className="text-foreground">No Instance is created.</strong> After publishing, choose this Version in Agent Garden to release a runtime Instance.
            </div>
            <p className="mt-3 font-mono text-[11px] text-muted-foreground">Digest {shortDigest(agent.contentDigest)}</p>
            {error ? <div role="alert" className="mt-5 border border-destructive-border bg-destructive-surface px-4 py-3 text-sm text-destructive">{error.message}</div> : null}
          </div>
        )}

        <SheetFooter className="shrink-0 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button asChild><Link to="/$projectId/agent-garden" params={{ projectId }}>Open Agent Garden <ExternalLink /></Link></Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={pending || !agent.publishReadiness.ready} onClick={onPublish}>
                {pending ? <Spinner /> : <PackageCheck />}{pending ? "Publishing…" : "Publish to Agent Garden"}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SectionHeading({ compact = false, description, title }: { compact?: boolean; description: string; title: string }) {
  return <div className={cn(!compact && "border-b pb-3")}><h2 className="text-[1.05rem] font-semibold tracking-[-0.01em]">{title}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p></div>;
}

function Field({ children, className, hint, label }: { children: React.ReactNode; className?: string; hint?: string; label: string }) {
  return <div className={className}><div className="mb-2 flex items-baseline justify-between gap-3"><Label>{label}</Label>{hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}</div>{children}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>;
}

function AgentSkeleton() {
  return <div className="space-y-6"><Skeleton className="h-32" /><Skeleton className="h-20" /><Skeleton className="h-[36rem]" /></div>;
}
