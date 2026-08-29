import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  hasValidatedEmbeddingModel,
  type Instance,
  type MemoryActivityView,
  type MemoryConversation,
  type MemoryExperience,
  type MemoryFact,
  type MemoryInsight,
  type MemoryItemStatus,
  type MemoryResourceDetailView,
} from "@tali/contracts";
import { EmbeddingModelSetupNotice } from "@/components/providers/embedding-model-setup-notice";
import {
  Activity,
  ArrowLeft,
  BrainCircuit,
  Download,
  FileText,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Unlink,
} from "lucide-react";
import { DeleteEntitySheet } from "@/components/shared/delete-entity-sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentProjectId } from "@/hooks/use-project";
import { useProjectPermissions } from "@/hooks/use-project-permissions";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";
import { ConversationSheet, ExperienceSheet, FactSheet } from "./memory-item-sheets";
import {
  CursorPagination,
  errorMessage,
  formatMemoryDate,
  formatRelativeMemoryDate,
  humanizeMemoryAction,
  MemoryErrorState,
  MemoryNotice,
  MemoryStatus,
  saveDownloadedFile,
} from "./memory-ui";

type DetailTab = "overview" | "conversations" | "facts" | "experiences" | "settings";
const PAGE_SIZE = 20;

export function MemoryDetailPage({ memoryId }: { memoryId: string }) {
  const projectId = useCurrentProjectId();
  const permissions = useProjectPermissions();
  const scope = useProjectQueryScope();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [notice, setNotice] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const detail = useQuery({
    queryKey: scope.key("durable-memory", memoryId),
    queryFn: () => api.getMemory(memoryId),
    enabled: permissions.canViewMemories,
    refetchInterval: (result) => ["provisioning", "degraded", "deleting"].includes(result.state.data?.status ?? "") ? 5_000 : false,
  });
  const agents = useQuery({
    queryKey: scope.key("agents"),
    queryFn: api.listInstances,
    enabled: permissions.canViewMemories,
  });
  const models = useQuery({
    queryKey: scope.key("model-deployments"),
    queryFn: api.listModelDeployments,
    enabled: permissions.canViewMemories,
  });
  const embeddingModelReady = hasValidatedEmbeddingModel(models.data ?? []);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: scope.key("durable-memory", memoryId) }),
      queryClient.invalidateQueries({ queryKey: scope.key("durable-memories") }),
    ]);
  };
  const rename = useMutation({
    mutationFn: () => api.renameMemory(memoryId, renameName),
    onSuccess: async (memory) => { setRenameOpen(false); setNotice(`Memory renamed to “${memory.displayName}”.`); await refresh(); },
  });
  const exportMemory = useMutation({
    mutationFn: async () => {
      const memory = detail.data;
      if (!memory) throw new Error("Memory is unavailable.");
      const grant = await api.authorizeMemoryExport(memory.id);
      const file = await api.downloadMemoryExport(grant.downloadUrl, `${memory.displayName}.json`);
      saveDownloadedFile(file.blob, file.fileName);
      return file.fileName;
    },
    onSuccess: (fileName) => setNotice(`${fileName} was downloaded.`),
  });
  const remove = useMutation({
    mutationFn: () => {
      if (!detail.data) throw new Error("Memory is unavailable.");
      return api.deleteMemory(memoryId, detail.data.displayName);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scope.key("durable-memories") });
      await navigate({ to: "/$projectId/memory", params: { projectId } });
    },
  });

  if (!permissions.canViewMemories) {
    return <div className="space-y-5"><BackLink projectId={projectId} /><MemoryNotice tone="warning">Your active Project role cannot view this Memory.</MemoryNotice></div>;
  }
  if (detail.isPending) return <DetailSkeleton />;
  if (detail.error || !detail.data) return <div className="space-y-5"><BackLink projectId={projectId} /><MemoryErrorState title="Memory unavailable" error={detail.error} onRetry={() => void detail.refetch()} /></div>;

  const memory = detail.data;
  const bindingAgent = agents.data?.find(({ id }) => id === memory.activeBinding?.instanceId);
  const attention = memory.status === "degraded" || memory.status === "deletion_failed";

  return (
    <div className="space-y-5 pb-10">
      <BackLink projectId={projectId} />
      <header className="flex flex-col gap-5 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl border bg-muted/30 text-muted-foreground"><BrainCircuit className="size-5" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h1 className="truncate font-display text-[1.625rem] font-light leading-tight tracking-[0.005em]">{memory.displayName}</h1><MemoryStatus status={memory.status} /></div>
            <p className="mt-1 text-sm text-muted-foreground">
              {memory.activeBinding ? `Bound to ${bindingAgent?.name ?? memory.activeBinding.instanceId} · ${memory.activeBinding.runtimeType}` : "Unbound and available to attach"}
              {" · "}{formatRelativeMemoryDate(memory.lastActivityAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.canExportMemories ? <Button variant="outline" className="h-11" disabled={exportMemory.isPending} onClick={() => exportMemory.mutate()}><Download />{exportMemory.isPending ? "Preparing…" : "Export"}</Button> : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="size-11" aria-label={`Actions for ${memory.displayName}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {permissions.canManageMemories ? <DropdownMenuItem onSelect={() => { rename.reset(); setRenameName(memory.displayName); setRenameOpen(true); }}><Pencil />Rename</DropdownMenuItem> : null}
              <DropdownMenuItem onSelect={() => setTab("settings")}><Settings />Settings</DropdownMenuItem>
              {permissions.canPurgeMemories ? <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { remove.reset(); setDeleteOpen(true); }}><Trash2 />Delete Memory</DropdownMenuItem></> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {notice ? <MemoryNotice tone="success">{notice}</MemoryNotice> : null}
      {models.error ? (
        <MemoryNotice tone="error">
          Embedding model availability could not be loaded: {models.error.message}
        </MemoryNotice>
      ) : !models.isPending && !embeddingModelReady ? (
        <EmbeddingModelSetupNotice
          canManageProject={permissions.canManageProject}
          projectId={projectId}
        />
      ) : null}
      {attention ? <MemoryNotice tone={memory.status === "deletion_failed" ? "error" : "warning"} action={<Button variant="outline" className="h-11" onClick={() => setTab("settings")}>Review recovery</Button>}>{memory.status === "deletion_failed" ? "Provider deletion could not be verified. The Memory has not been reported as deleted." : memory.degradedReason || "Memory is temporarily degraded; Agent work can continue while retain delivery recovers."}</MemoryNotice> : null}
      {exportMemory.error ? <MemoryNotice tone="error">{errorMessage(exportMemory.error)}</MemoryNotice> : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)} className="gap-5">
        <div className="overflow-x-auto border-b">
          <TabsList variant="line" className="min-w-max border-b-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="conversations">Conversations</TabsTrigger>
            <TabsTrigger value="facts">Facts</TabsTrigger>
            <TabsTrigger value="experiences">Experiences</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview"><OverviewTab active={tab === "overview"} memoryId={memoryId} canViewContent={permissions.canViewMemoryContent} /></TabsContent>
        <TabsContent value="conversations"><ConversationsTab active={tab === "conversations"} memoryId={memoryId} canView={permissions.canViewMemoryContent} canCurate={permissions.canCurateMemory} canDelete={permissions.canDeleteMemoryContent} canReextract={permissions.canReextractMemory} onNotice={setNotice} /></TabsContent>
        <TabsContent value="facts"><FactsTab active={tab === "facts"} memoryId={memoryId} canView={permissions.canViewMemoryContent} canCurate={permissions.canCurateMemory} /></TabsContent>
        <TabsContent value="experiences"><ExperiencesTab active={tab === "experiences"} memoryId={memoryId} canView={permissions.canViewMemoryContent} canCurate={permissions.canCurateMemory} /></TabsContent>
        <TabsContent value="settings"><SettingsTab active={tab === "settings"} memory={memory} agents={agents.data ?? []} embeddingModelReady={embeddingModelReady} embeddingModelsPending={models.isPending} permissions={permissions} onDelete={() => setDeleteOpen(true)} onExport={() => exportMemory.mutate()} onNotice={setNotice} onRefresh={refresh} /></TabsContent>
      </Tabs>

      <EntitySheet open={renameOpen} onOpenChange={(open) => { if (!rename.isPending) setRenameOpen(open); }} eyebrow="Durable Memory" title="Rename Memory" description="This changes the product name without changing content or the provider-side Bank." width="md" footer={<><Button variant="outline" disabled={rename.isPending} onClick={() => setRenameOpen(false)}>Cancel</Button><Button disabled={!renameName.trim() || rename.isPending} onClick={() => rename.mutate()}>{rename.isPending ? "Saving…" : "Save name"}</Button></>}>
        <div className="space-y-2"><Label htmlFor="memory-detail-name">Name</Label><Input id="memory-detail-name" autoFocus className="h-11" value={renameName} onChange={(event) => setRenameName(event.target.value)} maxLength={120} /></div>
        {rename.error ? <div className="mt-4"><MemoryNotice tone="error">{errorMessage(rename.error)}</MemoryNotice></div> : null}
      </EntitySheet>

      <DeleteEntitySheet
        open={deleteOpen}
        onOpenChange={(open) => { if (!remove.isPending) setDeleteOpen(open); }}
        title="Delete Memory"
        description={<>Permanently delete <strong>{memory.displayName}</strong> and all retained content.</>}
        entityName={memory.displayName}
        confirmLabel={memory.status === "deletion_failed" ? "Retry deletion" : "Delete Memory"}
        deleting={remove.isPending}
        blocked={Boolean(memory.activeBinding)}
        blockedActionLabel="Review binding"
        blockedAction={() => setTab("settings")}
        impactDescription="Deletion is shown as complete only after the provider verifies that the Memory no longer exists. Audit tombstones retain no content."
        onConfirm={() => remove.mutate()}
        {...(errorMessage(remove.error) ? { error: errorMessage(remove.error) } : {})}
      >
        {memory.activeBinding ? <MemoryNotice tone="warning">Detach the active Agent binding before deleting this Memory.</MemoryNotice> : null}
      </DeleteEntitySheet>
    </div>
  );
}

function OverviewTab({ active, canViewContent, memoryId }: { active: boolean; canViewContent: boolean; memoryId: string }) {
  const scope = useProjectQueryScope();
  const query = useQuery({ queryKey: scope.key("durable-memory", memoryId, "overview"), queryFn: () => api.getMemoryOverview(memoryId), enabled: active && canViewContent });
  if (!canViewContent) return <RestrictedContent />;
  if (query.isPending) return <TabSkeleton />;
  if (query.error || !query.data) return <MemoryErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const counts = query.data.memory.counts;
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Conversations" value={counts?.conversations ?? 0} description="Retained source history" />
      <Metric label="Facts" value={counts?.facts ?? 0} description="Current world knowledge" />
      <Metric label="Experiences" value={counts?.experiences ?? 0} description="Structured outcomes" />
      <Metric label="Insights" value={counts?.insights ?? 0} description="Learned observations" />
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
      <Card><CardHeader className="border-b"><CardTitle>What this Memory has learned</CardTitle><CardDescription>Stable observations synthesized from retained evidence.</CardDescription></CardHeader><CardContent className="p-0">{query.data.learnedInsights.length ? query.data.learnedInsights.map((insight) => <InsightRow key={insight.id} insight={insight} />) : <EmptyPanel icon={BrainCircuit} title="No learned Insights yet" description="Insights appear after evidence-rich Conversations have been retained and consolidated." />}</CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>Recent activity</CardTitle><CardDescription>Lifecycle and curation events without Memory content.</CardDescription></CardHeader><CardContent className="p-0">{query.data.recentActivity.length ? query.data.recentActivity.map((event) => <ActivityRow key={event.id} event={event} />) : <EmptyPanel icon={Activity} title="No activity yet" description="Create or bind this Memory to begin its auditable history." />}</CardContent></Card>
    </div>
  </div>;
}

function ConversationsTab({ active, canCurate, canDelete, canReextract, canView, memoryId, onNotice }: { active: boolean; canCurate: boolean; canDelete: boolean; canReextract: boolean; canView: boolean; memoryId: string; onNotice: (message: string) => void }) {
  const scope = useProjectQueryScope();
  const [queryDraft, setQueryDraft] = useState("");
  const [queryText, setQueryText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<MemoryConversation | null>(null);
  const query = useQuery({
    queryKey: scope.key("durable-memory", memoryId, "conversations", cursor ?? "first", queryText, from, to),
    queryFn: () => api.listMemoryConversations(memoryId, { ...(cursor ? { cursor } : {}), limit: PAGE_SIZE, ...(queryText ? { query: queryText } : {}), ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}), ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}) }),
    enabled: active && canView,
  });
  const apply = () => { setQueryText(queryDraft.trim()); setCursor(undefined); setHistory([]); };
  if (!canView) return <RestrictedContent />;
  return <div className="space-y-4">
    <FilterBar onSubmit={apply}><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input aria-label="Search Conversations" className="h-11 pl-9" placeholder="Search messages and summaries" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} /></div><Input aria-label="Conversations from date" type="date" className="h-11 w-full sm:w-44" value={from} onChange={(event) => { setFrom(event.target.value); setCursor(undefined); setHistory([]); }} /><Input aria-label="Conversations to date" type="date" className="h-11 w-full sm:w-44" value={to} onChange={(event) => { setTo(event.target.value); setCursor(undefined); setHistory([]); }} /><Button type="submit" variant="outline" className="h-11">Search</Button></FilterBar>
    {query.isPending ? <TabSkeleton /> : query.error ? <MemoryErrorState error={query.error} onRetry={() => void query.refetch()} /> : query.data?.items.length ? <Card className="overflow-hidden"><CardContent className="p-0">{query.data.items.map((conversation) => <button key={conversation.id} type="button" className="grid min-h-24 w-full gap-3 border-b px-5 py-4 text-left outline-none last:border-b-0 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35 sm:grid-cols-[minmax(0,1fr)_10rem_6rem] sm:items-center" onClick={() => setSelected(conversation)}><span className="min-w-0"><strong className="block truncate text-sm">{conversation.title || "Untitled conversation"}</strong><span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{conversation.summary || conversation.messages.at(0)?.text || "No summary available."}</span></span><span className="text-xs"><span className="block text-muted-foreground">Started</span><span className="mt-1 block">{formatMemoryDate(conversation.startedAt, { timeStyle: undefined })}</span></span><span className="text-xs tabular-nums"><span className="block text-muted-foreground">Messages</span><strong className="mt-1 block">{conversation.messages.length}</strong></span></button>)}<PageControls page={query.data} cursor={cursor} history={history} setCursor={setCursor} setHistory={setHistory} /></CardContent></Card> : <EmptyState icon={FileText} title="No Conversations" description={queryText || from || to ? "No retained Conversation matches these filters." : "Conversations appear after an attached Agent completes a retained turn."} />}
    <ConversationSheet conversation={selected} memoryId={memoryId} canCurate={canCurate} canDelete={canDelete} canReextract={canReextract} onNotice={onNotice} onOpenChange={(open) => { if (!open) setSelected(null); }} onUpdated={async () => { await query.refetch(); }} />
  </div>;
}

function FactsTab({ active, canCurate, canView, memoryId }: { active: boolean; canCurate: boolean; canView: boolean; memoryId: string }) {
  const scope = useProjectQueryScope();
  const [queryDraft, setQueryDraft] = useState("");
  const [queryText, setQueryText] = useState("");
  const [status, setStatus] = useState<"all" | MemoryItemStatus>("all");
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<MemoryFact | null>(null);
  const query = useQuery({ queryKey: scope.key("durable-memory", memoryId, "facts", cursor ?? "first", queryText, status), queryFn: () => api.listMemoryFacts(memoryId, { ...(cursor ? { cursor } : {}), limit: PAGE_SIZE, ...(queryText ? { query: queryText } : {}), ...(status === "all" ? {} : { status }) }), enabled: active && canView });
  if (!canView) return <RestrictedContent />;
  return <div className="space-y-4">
    <FilterBar onSubmit={() => { setQueryText(queryDraft.trim()); setCursor(undefined); setHistory([]); }}><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input aria-label="Search Facts" className="h-11 pl-9" placeholder="Search Fact statements" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} /></div><StatusSelect value={status} onChange={(next) => { setStatus(next); setCursor(undefined); setHistory([]); }} /><Button type="submit" variant="outline" className="h-11">Search</Button></FilterBar>
    {query.isPending ? <TabSkeleton /> : query.error ? <MemoryErrorState error={query.error} onRetry={() => void query.refetch()} /> : query.data?.items.length ? <Card className="overflow-hidden"><CardContent className="p-0">{query.data.items.map((fact) => <button key={fact.id} type="button" className="grid min-h-24 w-full gap-3 border-b px-5 py-4 text-left outline-none last:border-b-0 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:items-center" onClick={() => setSelected(fact)}><span className="line-clamp-3 text-sm leading-6">{fact.text}</span><ItemStatus status={fact.status} /><span className="text-xs tabular-nums"><span className="block text-muted-foreground">Evidence</span><strong className="mt-1 block">{fact.evidence.length}</strong></span></button>)}<PageControls page={query.data} cursor={cursor} history={history} setCursor={setCursor} setHistory={setHistory} /></CardContent></Card> : <EmptyState icon={ShieldCheck} title="No Facts" description={queryText || status !== "all" ? "No Fact matches these filters." : "Facts are extracted from retained Conversations and remain linked to evidence."} />}
    <FactSheet fact={selected} memoryId={memoryId} canCurate={canCurate} onOpenChange={(open) => { if (!open) setSelected(null); }} onUpdated={async (next) => { setSelected(next); await query.refetch(); }} />
  </div>;
}

function ExperiencesTab({ active, canCurate, canView, memoryId }: { active: boolean; canCurate: boolean; canView: boolean; memoryId: string }) {
  const scope = useProjectQueryScope();
  const [queryDraft, setQueryDraft] = useState("");
  const [queryText, setQueryText] = useState("");
  const [status, setStatus] = useState<"all" | MemoryItemStatus>("all");
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<MemoryExperience | null>(null);
  const query = useQuery({ queryKey: scope.key("durable-memory", memoryId, "experiences", cursor ?? "first", queryText, status), queryFn: () => api.listMemoryExperiences(memoryId, { ...(cursor ? { cursor } : {}), limit: PAGE_SIZE, ...(queryText ? { query: queryText } : {}), ...(status === "all" ? {} : { status }) }), enabled: active && canView });
  if (!canView) return <RestrictedContent />;
  return <div className="space-y-4">
    <FilterBar onSubmit={() => { setQueryText(queryDraft.trim()); setCursor(undefined); setHistory([]); }}><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input aria-label="Search Experiences" className="h-11 pl-9" placeholder="Search outcomes and lessons" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} /></div><StatusSelect value={status} onChange={(next) => { setStatus(next); setCursor(undefined); setHistory([]); }} /><Button type="submit" variant="outline" className="h-11">Search</Button></FilterBar>
    {query.isPending ? <TabSkeleton /> : query.error ? <MemoryErrorState error={query.error} onRetry={() => void query.refetch()} /> : query.data?.items.length ? <Card className="overflow-hidden"><CardContent className="p-0">{query.data.items.map((experience) => <button key={experience.id} type="button" className="grid min-h-28 w-full gap-3 border-b px-5 py-4 text-left outline-none last:border-b-0 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35 lg:grid-cols-[minmax(0,1.25fr)_9rem_10rem_7rem] lg:items-center" onClick={() => setSelected(experience)}><span className="min-w-0"><strong className="block truncate text-sm">{experience.title}</strong><span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{experience.summary}</span></span><span className="text-xs"><span className="block text-muted-foreground">Occurred</span><span className="mt-1 block">{formatMemoryDate(experience.occurredStart ?? experience.createdAt, { timeStyle: undefined })}</span></span><span className="min-w-0 text-xs"><span className="block text-muted-foreground">Outcome</span><span className="mt-1 line-clamp-2">{experience.outcome || "Not recorded"}</span></span><span className="text-xs tabular-nums"><span className="block text-muted-foreground">Sources</span><strong className="mt-1 block">{experience.sourceDocumentIds.length}</strong></span></button>)}<PageControls page={query.data} cursor={cursor} history={history} setCursor={setCursor} setHistory={setHistory} /></CardContent></Card> : <EmptyState icon={BrainCircuit} title="No Experiences" description={queryText || status !== "all" ? "No Experience matches these filters." : "Experiences appear when the Agent extracts a reusable outcome and lesson."} />}
    <ExperienceSheet experience={selected} memoryId={memoryId} canCurate={canCurate} onOpenChange={(open) => { if (!open) setSelected(null); }} onUpdated={async (next) => { setSelected(next); await query.refetch(); }} />
  </div>;
}

function SettingsTab({ active, agents, embeddingModelReady, embeddingModelsPending, memory, onDelete, onExport, onNotice, onRefresh, permissions }: { active: boolean; agents: Instance[]; embeddingModelReady: boolean; embeddingModelsPending: boolean; memory: MemoryResourceDetailView; onDelete: () => void; onExport: () => void; onNotice: (message: string) => void; onRefresh: () => Promise<unknown>; permissions: ReturnType<typeof useProjectPermissions> }) {
  const scope = useProjectQueryScope();
  const [instanceId, setInstanceId] = useState("");
  const settings = useQuery({ queryKey: scope.key("durable-memory", memory.id, "settings"), queryFn: () => api.getMemorySettings(memory.id), enabled: active && permissions.canViewMemorySettings });
  const outbox = useQuery({ queryKey: scope.key("durable-memory", memory.id, "outbox"), queryFn: () => api.listMemoryOutbox(memory.id, { limit: 20, statuses: ["pending", "processing", "retry", "dead_letter"] }), enabled: active && permissions.canViewMemoryOutbox });
  const availableAgents = useMemo(() => agents.filter((agent) => (agent.agentPlatform === "openclaw" || agent.agentPlatform === "hermes") && !agent.durableMemoryId && agent.status !== "DESTROYING"), [agents]);
  const bind = useMutation({ mutationFn: () => { if (!embeddingModelReady) throw new Error("Configure a validated embedding model before attaching Durable Memory."); const agent = availableAgents.find(({ id }) => id === instanceId); if (!agent || (agent.agentPlatform !== "openclaw" && agent.agentPlatform !== "hermes")) throw new Error("Choose an available OpenClaw or Hermes Agent."); return api.bindMemory(memory.id, { instanceId: agent.id, runtimeType: agent.agentPlatform }); }, onSuccess: async () => { setInstanceId(""); onNotice("Memory binding is active."); await onRefresh(); } });
  const unbind = useMutation({ mutationFn: () => { if (!memory.activeBinding) throw new Error("No active binding exists."); return api.unbindMemory(memory.id, memory.activeBinding.id); }, onSuccess: async () => { onNotice("Agent detached. Memory content was retained and is available to reattach."); await onRefresh(); } });
  const retry = useMutation({ mutationFn: () => api.retryMemory(memory.id), onSuccess: async () => { onNotice("Memory recovery completed."); await onRefresh(); await settings.refetch(); } });
  const replay = useMutation({ mutationFn: (outboxId: string) => api.replayMemoryOutbox(memory.id, outboxId), onSuccess: async () => { onNotice("Retain event was queued for replay."); await outbox.refetch(); } });
  const provider = settings.data?.provider;
  const actionError = bind.error ?? unbind.error ?? retry.error ?? replay.error;
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,.72fr)]">
    <div className="space-y-5">
      <Card><CardHeader className="border-b"><CardTitle>Runtime binding</CardTitle><CardDescription>One Memory can have one active primary Agent binding. Detached history is retained.</CardDescription></CardHeader><CardContent className="space-y-4 p-5">{memory.activeBinding ? <div className="flex flex-wrap items-center justify-between gap-4"><div><strong className="text-sm">{agents.find(({ id }) => id === memory.activeBinding?.instanceId)?.name ?? memory.activeBinding.instanceId}</strong><p className="mt-1 text-xs capitalize text-muted-foreground">{memory.activeBinding.runtimeType} · attached {formatMemoryDate(memory.activeBinding.attachedAt)}</p></div>{permissions.canManageMemories ? <Button variant="outline" className="h-11" disabled={unbind.isPending} onClick={() => unbind.mutate()}><Unlink />{unbind.isPending ? "Detaching…" : "Detach"}</Button> : null}</div> : <div className="space-y-4"><MemoryNotice>Unbound. This Memory remains intact and can be attached to another Agent.</MemoryNotice>{permissions.canManageMemories ? <div className="flex flex-col gap-3 sm:flex-row"><Select value={instanceId} onValueChange={setInstanceId} disabled={embeddingModelsPending || !embeddingModelReady}><SelectTrigger aria-label="Choose Agent for Memory" className="h-11 min-w-0 flex-1"><SelectValue placeholder={embeddingModelsPending ? "Checking embedding model…" : embeddingModelReady ? "Choose an available Agent" : "Embedding model required"} /></SelectTrigger><SelectContent>{availableAgents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}<span className="ml-2 capitalize text-muted-foreground">{agent.agentPlatform}</span></SelectItem>)}</SelectContent></Select><Button className="h-11" disabled={embeddingModelsPending || !embeddingModelReady || !instanceId || bind.isPending} onClick={() => bind.mutate()}><Link2 />{bind.isPending ? "Attaching…" : "Attach"}</Button></div> : null}{permissions.canManageMemories && embeddingModelReady && !availableAgents.length ? <p className="text-xs text-muted-foreground">No unbound OpenClaw or Hermes Agent is currently available.</p> : null}</div>}<div className="border-t pt-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Binding history</h3>{memory.bindingHistory.length ? <div className="mt-3 divide-y border-y">{memory.bindingHistory.map((binding) => <div key={binding.id} className="grid gap-2 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_7rem_8rem]"><span className="truncate font-mono">{binding.instanceId}</span><span className="capitalize">{binding.runtimeType}</span><span className="capitalize text-muted-foreground">{binding.status}</span></div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">No binding history.</p>}</div></CardContent></Card>

      <Card><CardHeader className="border-b"><CardTitle>Retention</CardTitle><CardDescription>Project policy stored with this Durable Memory.</CardDescription></CardHeader><CardContent className="p-5">{Object.keys(memory.retentionPolicy).length ? <dl className="divide-y border-y">{Object.entries(memory.retentionPolicy).map(([key, value]) => <div key={key} className="grid gap-1 py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="text-muted-foreground">{key}</dt><dd className="break-words font-medium">{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl> : <p className="text-sm text-muted-foreground">The Project default retention policy applies.</p>}</CardContent></Card>

      {permissions.canViewMemoryOutbox ? <Card><CardHeader className="border-b"><CardTitle>Retain delivery</CardTitle><CardDescription>Pending, retrying, and dead-letter events. Payload content is never exposed.</CardDescription></CardHeader><CardContent className="p-0">{outbox.isPending ? <div className="space-y-2 p-5"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : outbox.error ? <div className="p-5"><MemoryNotice tone="error">{errorMessage(outbox.error)}</MemoryNotice></div> : outbox.data?.items.length ? outbox.data.items.map((event) => <div key={event.id} className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b px-5 py-3 last:border-b-0"><span className="min-w-0"><strong className="block truncate text-xs">Conversation {event.conversationId}</strong><span className="mt-1 block text-xs capitalize text-muted-foreground">{event.status.replaceAll("_", " ")} · retry {event.retryCount}</span>{event.lastErrorSummary ? <span className="mt-1 block text-xs text-destructive">{event.lastErrorSummary}</span> : null}</span>{permissions.canReplayMemoryOutbox && (event.status === "dead_letter" || event.status === "retry") ? <Button variant="outline" className="h-11" disabled={replay.isPending} onClick={() => replay.mutate(event.id)}><RefreshCw />Replay</Button> : null}</div>) : <EmptyPanel icon={Activity} title="Delivery queue is clear" description="No pending, retrying, or dead-letter retain events." />}</CardContent></Card> : null}
    </div>

    <div className="space-y-5">
      {permissions.canViewMemorySettings ? <Card><CardHeader className="border-b"><CardTitle>Provider health</CardTitle><CardDescription>Implementation details are visible only to authorized roles.</CardDescription></CardHeader><CardContent className="p-5">{settings.isPending ? <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : settings.error ? <MemoryNotice tone="error">{errorMessage(settings.error)}</MemoryNotice> : provider ? <dl className="space-y-4 text-sm"><Setting label="Provider" value={provider.provider} /><Setting label="Health" value={provider.providerHealth} capitalize /><Setting label="Checked" value={formatMemoryDate(provider.checkedAt)} /><Setting label="Bank reference" value={provider.providerReferenceHint ?? "Unavailable"} mono /></dl> : null}{permissions.canManageMemories && (memory.status === "provisioning" || memory.status === "degraded") ? <Button variant="outline" className="mt-5 h-11" disabled={retry.isPending} onClick={() => retry.mutate()}><RefreshCw />{retry.isPending ? "Retrying…" : "Retry provisioning"}</Button> : null}</CardContent></Card> : null}
      {permissions.canExportMemories ? <Card><CardHeader><CardTitle>Export</CardTitle><CardDescription>Download a sanitized JSON snapshot using a short-lived authorization.</CardDescription></CardHeader><CardContent><Button variant="outline" className="h-11" onClick={onExport}><Download />Export Memory</Button></CardContent></Card> : null}
      {permissions.canPurgeMemories ? <Card className="border-destructive/35"><CardHeader className="border-b"><CardTitle className="text-destructive">Danger zone</CardTitle><CardDescription>Memory deletion is independent from Agent deletion and cannot be undone.</CardDescription></CardHeader><CardContent className="p-5"><Button variant="destructive" className="h-11" onClick={onDelete}><Trash2 />{memory.status === "deletion_failed" ? "Retry deletion" : "Delete Memory"}</Button>{memory.activeBinding ? <p className="mt-3 text-xs leading-5 text-muted-foreground">Deletion remains blocked until the active Agent binding is detached.</p> : null}</CardContent></Card> : null}
      {actionError ? <MemoryNotice tone="error">{errorMessage(actionError)}</MemoryNotice> : null}
    </div>
  </div>;
}

function BackLink({ projectId }: { projectId: string }) { return <Link to="/$projectId/memory" params={{ projectId }} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35"><ArrowLeft className="size-4" />Memory</Link>; }
function DetailSkeleton() { return <div className="space-y-5"><Skeleton className="h-11 w-36" /><Skeleton className="h-24 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-[34rem] w-full" /></div>; }
function TabSkeleton() { return <div className="space-y-3" aria-label="Loading Memory content"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>; }
function RestrictedContent() { return <MemoryNotice tone="warning">Your active Project role can view the Memory resource but cannot read retained content.</MemoryNotice>; }
function Metric({ description, label, value }: { description: string; label: string; value: number }) { return <Card><CardContent className="p-5"><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-2 block text-3xl font-medium tabular-nums">{value}</strong><span className="mt-2 block text-xs text-muted-foreground">{description}</span></CardContent></Card>; }
function InsightRow({ insight }: { insight: MemoryInsight }) { return <article className="border-b p-5 last:border-b-0"><div className="flex items-start gap-3"><BrainCircuit className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="text-sm leading-6">{insight.text}</p><p className="mt-2 text-xs text-muted-foreground">{insight.evidence.length} source{insight.evidence.length === 1 ? "" : "s"} · updated {formatRelativeMemoryDate(insight.updatedAt)}</p></div></div></article>; }
function ActivityRow({ event }: { event: MemoryActivityView }) { return <article className="border-b px-5 py-4 last:border-b-0"><strong className="text-xs">{humanizeMemoryAction(event.action)}</strong><p className="mt-1 truncate text-xs text-muted-foreground">{formatRelativeMemoryDate(event.occurredAt)} · actor {event.actorId}</p></article>; }
function EmptyPanel({ description, icon: Icon, title }: { description: string; icon: typeof Activity; title: string }) { return <div className="px-6 py-12 text-center"><Icon className="mx-auto size-7 text-muted-foreground" /><strong className="mt-3 block text-sm">{title}</strong><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">{description}</p></div>; }
function FilterBar({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) { return <form className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>{children}</form>; }
function StatusSelect({ onChange, value }: { onChange: (value: "all" | MemoryItemStatus) => void; value: "all" | MemoryItemStatus }) { return <Select value={value} onValueChange={(next) => onChange(next as "all" | MemoryItemStatus)}><SelectTrigger aria-label="Filter Memory item status" className="h-11 w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="invalidated">Invalidated</SelectItem></SelectContent></Select>; }
function ItemStatus({ status }: { status: MemoryItemStatus }) { return <span className="text-xs"><span className="block text-muted-foreground">Status</span><strong className={status === "invalidated" ? "mt-1 block text-destructive" : "mt-1 block capitalize"}>{status}</strong></span>; }
function PageControls<T>({ cursor, history, page, setCursor, setHistory }: { cursor: string | undefined; history: string[]; page: { items: T[]; nextCursor: string | null; totalCount: number }; setCursor: (value: string | undefined) => void; setHistory: (value: string[]) => void }) { return <CursorPagination canPrevious={history.length > 0} canNext={Boolean(page.nextCursor)} itemCount={page.items.length} totalCount={page.totalCount} onPrevious={() => { const next = [...history]; const previous = next.pop(); setHistory(next); setCursor(previous || undefined); }} onNext={() => { if (!page.nextCursor) return; setHistory([...history, cursor ?? ""]); setCursor(page.nextCursor ?? undefined); }} />; }
function Setting({ capitalize = false, label, mono = false, value }: { capitalize?: boolean; label: string; mono?: boolean; value: string }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`${mono ? "font-mono text-xs" : "font-medium"} mt-1 break-words ${capitalize ? "capitalize" : ""}`}>{value}</dd></div>; }
