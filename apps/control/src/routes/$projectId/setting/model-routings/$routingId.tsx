import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { complianceDomainCatalog, type ModelRouting } from "@tali/contracts";
import { Activity, ArrowLeft, ArrowRight, Boxes, Check, CheckCircle2, CircleAlert, Database, Ellipsis, ExternalLink, FileClock, KeyRound, RefreshCw, Route as RouteIcon, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { DeleteModelRoutingSheet } from "@/components/providers/delete-model-routing-sheet";
import { GatewaySyncStatus } from "@/components/providers/gateway-sync-status";
import { ProviderIcon } from "@/components/providers/provider-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatPlatformDateTime } from "@/lib/platform-preferences";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";

export const Route = createFileRoute("/$projectId/setting/model-routings/$routingId")({ component: ModelRoutingDetailPage });
type Tab = "overview" | "routing" | "access" | "consumers" | "audit";

function ModelRoutingDetailPage() {
  const { routingId, projectId } = Route.useParams();
  const [tab, setTab] = useState<Tab>("overview");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const queryClient = useQueryClient();
  const scope = useProjectQueryScope();
  const navigate = useNavigate();
  const routing = useQuery({ queryKey: scope.key("model-routing", routingId), queryFn: () => api.getModelRouting(routingId) });
  const gateways = useQuery({ queryKey: scope.key("inference-gateways"), queryFn: api.listInferenceGateways });
  const refresh = useMutation({ mutationFn: () => api.refreshModelRouting(routingId), onSuccess: async () => Promise.all([queryClient.invalidateQueries({ queryKey: scope.key("model-routing", routingId) }), queryClient.invalidateQueries({ queryKey: scope.key("model-routings") })]) });
  const remove = useMutation({ mutationFn: () => api.deleteModelRouting(routingId), onSuccess: () => navigate({ to: "/$projectId/setting", params: { projectId }, search: { section: "routing" } }) });
  if (routing.isPending) return <div className="grid min-h-72 place-items-center text-sm text-muted-foreground">Loading routing…</div>;
  if (routing.error || !routing.data) return <div role="alert" className="border-l-2 border-destructive bg-destructive/5 p-4 text-sm text-destructive">{routing.error?.message ?? "Routing not found."}</div>;
  const current = routing.data;
  const gateway = gateways.data?.find((item) => item.id === current.gatewayId);
  const ready = current.status === "READY";
  const passingChecks = current.conditions.filter((condition) => condition.status === "PASS").length;
  return <div className="space-y-4">
    <div><Button asChild variant="ghost" size="sm" className="-ml-3 mb-2 text-muted-foreground hover:text-foreground"><Link to="/$projectId/setting" params={{ projectId }} search={{ section: "routing" }}><ArrowLeft />Routing</Link></Button><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2.5"><h1 className="font-display text-2xl font-light tracking-[0.005em]">{current.name}</h1><GatewaySyncStatus message={current.validationMessage} status={current.status} />{current.isDefault ? <span className="rounded-sm border border-border/65 bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">Project default</span> : null}</div><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{current.description || "A reusable routing configuration for registered models."}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}><RefreshCw className={cn(refresh.isPending && "animate-spin")} />Refresh routing</Button>{gateway ? <Button asChild variant="outline"><a href={gateway.adminUiUrl} target="_blank" rel="noreferrer">Inspect routing <ExternalLink /></a></Button> : null}<DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label={`Actions for ${current.name}`}><Ellipsis /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem className="text-destructive focus:text-destructive" disabled={current.isDefault} onSelect={() => { remove.reset(); setDeleteOpen(true); }}><Trash2 />{current.isDefault ? "Choose another default before deleting" : "Delete routing"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div></div>
    <section role="status" className={cn("flex flex-col gap-5 rounded-lg border border-border/45 border-l-[3px] px-5 py-[18px] sm:flex-row sm:items-center sm:justify-between", ready ? "border-l-emerald-600 bg-emerald-500/[0.035]" : "border-l-amber-600 bg-amber-500/[0.035]")}>
      <div className="flex min-w-0 gap-3">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", ready ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700")}>{ready ? <CheckCircle2 className="size-[18px]" /> : <CircleAlert className="size-[18px]" />}</span>
        <div><h2 className="font-sans text-sm font-semibold">{ready ? "This routing is ready for Instances" : "This routing needs attention"}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{ready ? `${current.publicModelAlias} passed ${passingChecks} routing, compliance, and access checks. Each Instance receives its own isolated Virtual Key.` : current.validationMessage}</p></div>
      </div>
      {ready ? <Button asChild className="shrink-0"><Link to="/$projectId/instances" params={{ projectId }} search={{ create: "instance" }}><Boxes />Create Instance</Link></Button> : <Button className="shrink-0" disabled title="Resolve the failed checks before using this model for a new Instance"><CircleAlert />Unavailable for new Instances</Button>}
    </section>
    <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="gap-4">
      <div className="overflow-x-auto">
        <TabsList variant="line" aria-label="Routing detail" className="min-w-max">
          {([
            ["overview", "Overview"],
            ["routing", "Models & routing"],
            ["access", "Access & policy"],
            ["consumers", "Consumers"],
            ["audit", "Audit"],
          ] as const).map(([item, label]) => <TabsTrigger key={item} value={item}>{label}</TabsTrigger>)}
        </TabsList>
      </div>
      {refresh.error ? <p role="alert" className="border-l-2 border-destructive bg-destructive/5 p-3 text-sm text-destructive">{refresh.error.message}</p> : null}
      <TabsContent value="overview"><Overview routing={current} {...(gateway?.name ? { gatewayName: gateway.name } : {})} /></TabsContent>
      <TabsContent value="routing"><RoutingTab routing={current} projectId={projectId} adminUiUrl={gateway?.adminUiUrl} /></TabsContent>
      <TabsContent value="access"><AccessTab routing={current} onDelete={() => { remove.reset(); setDeleteOpen(true); }} /></TabsContent>
      <TabsContent value="consumers"><ConsumersTab routingId={current.id} /></TabsContent>
      <TabsContent value="audit"><AuditTab routingId={current.id} /></TabsContent>
    </Tabs>
    <DeleteModelRoutingSheet
      consumers={current.consumers}
      deleting={remove.isPending}
      {...(remove.error?.message ? { error: remove.error.message } : {})}
      onConfirm={() => remove.mutate()}
      onOpenChange={setDeleteOpen}
      onViewConsumers={() => setTab("consumers")}
      open={deleteOpen}
      routingName={current.name}
    />
  </div>;
}

function Overview({ routing, gatewayName }: { routing: ModelRouting; gatewayName?: string }) {
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
    <div className="space-y-4">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-4" />Routing contract</CardTitle><CardDescription>The stable model identity and routing policy every consumer receives.</CardDescription></CardHeader><CardContent className="grid gap-px overflow-hidden rounded-md border border-border/55 bg-border/40 sm:grid-cols-2"><Fact label="Public model alias" value={routing.publicModelAlias} mono /><Fact label="Routing mode" value={routingModeLabel(routing)} /><Fact label="Data boundary" value={complianceLabel(routing.complianceDomain)} /><Fact label="Access isolation" value="Virtual Key per Instance" /></CardContent></Card>
      <Card><CardHeader><CardTitle>Inference path</CardTitle><CardDescription>One routing configuration connects registered models to Instances.</CardDescription></CardHeader><CardContent>
        <div className="grid overflow-hidden rounded-md border border-border/55 sm:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)] sm:items-stretch">
          <PathStep icon={Database} label="Registered models" value="Provider endpoints" />
          <PathArrow />
          <PathStep icon={RouteIcon} label="Routing identity" value={routing.publicModelAlias} mono />
          <PathArrow />
          <PathStep icon={KeyRound} label="Consumer access" value={`${routing.consumers} Instance${routing.consumers === 1 ? "" : "s"}`} />
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">Providers supply registered models. TaskLattice Relay stores model IDs as desired state, then reconciles one stable LiteLLM alias without copying Provider credentials.</p>
      </CardContent></Card>
    </div>
    <div className="space-y-4"><Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" />Routing readiness</CardTitle><CardDescription>Fail-closed checks across routing, compliance, and access.</CardDescription></CardHeader><CardContent className="divide-y divide-border/45">{routing.conditions.length ? routing.conditions.map((condition) => <div key={condition.type} className="flex gap-2.5 py-3 first:pt-0 last:pb-0"><span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", condition.status === "PASS" ? "bg-emerald-600" : condition.status === "UNKNOWN" ? "bg-amber-600" : "bg-destructive")} /><span><strong className="block text-[13px] font-medium">{conditionLabel(condition.type)}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{condition.reason}</span></span></div>) : <p className="text-sm text-muted-foreground">Refresh the routing to populate readiness checks.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Operational status</CardTitle></CardHeader><CardContent className="divide-y divide-border/45"><FactRow label="Gateway" value={gatewayName ?? "Managed gateway"} /><FactRow label="Consumers" value={String(routing.consumers)} /><FactRow label="Control-plane audit" value="Enabled" /><FactRow label="Last synchronized" value={routing.lastSynchronizedAt ? formatPlatformDateTime(routing.lastSynchronizedAt) : "Never"} /><FactRow label="LiteLLM version" value={routing.liteLLMVersion ?? "Not reported"} /></CardContent></Card></div>
  </div>;
}

function RoutingTab({ routing, projectId, adminUiUrl }: { routing: ModelRouting; projectId: string; adminUiUrl?: string | undefined }) {
  const scope = useProjectQueryScope();
  const models = useQuery({ queryKey: scope.key("model-deployments"), queryFn: api.listModelDeployments });
  const modelName = (id: string) => {
    const model = models.data?.find((candidate) => candidate.id === id);
    return model ? `${model.displayName} · ${model.providerName}` : id;
  };
  const capabilities = [
    ["Automatic model selection", routing.capabilities.automaticRouting],
    ["Provider failover", routing.capabilities.failover],
    ["Context fallback", routing.capabilities.contextWindowFallback],
    ["Content policy fallback", routing.capabilities.contentPolicyFallback],
    ["Retries", routing.capabilities.retries],
    ["Request audit", routing.capabilities.requestAudit],
  ] as const;
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><RouteIcon className="size-4" />Routing contract</CardTitle><CardDescription>The stored Routing policy is reconciled to one stable LiteLLM model identity.</CardDescription></CardHeader><CardContent><div className="grid gap-px overflow-hidden border bg-border sm:grid-cols-3"><Fact label="Public model alias" value={routing.publicModelAlias} mono /><Fact label="Policy mode" value={routingModeLabel(routing)} /><Fact label="Configuration source" value="TaskLattice Relay reconciler" /></div>{adminUiUrl ? <Button asChild variant="outline" className="mt-4"><a href={adminUiUrl} target="_blank" rel="noreferrer">Inspect effective LiteLLM config <ExternalLink /></a></Button> : null}</CardContent></Card>
    <Card><CardHeader><CardTitle>Stored routing policy</CardTitle><CardDescription>Version {routing.routingPolicy.version} is the desired state used for every refresh and repair.</CardDescription></CardHeader><CardContent><RoutingPolicyFacts routing={routing} modelName={modelName} /></CardContent></Card>
    <Card><CardHeader><CardTitle>Routing capabilities</CardTitle><CardDescription>Read-only behavior detected from the effective LiteLLM configuration.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{capabilities.map(([label, state]) => <div key={label} className="flex min-h-12 items-center gap-3 border px-3 text-sm"><span className={cn("grid size-6 place-items-center", state === "ENABLED" ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground")}>{state === "ENABLED" ? <Check className="size-4" /> : <Activity className="size-4" />}</span><span><strong className="block text-xs">{label}</strong><span className="text-xs text-muted-foreground">{state === "ENABLED" ? "Enabled in LiteLLM" : state === "DISABLED" ? "Not enabled" : "Not reported"}</span></span></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-4" />Registered model inventory</CardTitle><CardDescription>Registered models available when this policy is edited.</CardDescription></CardHeader><CardContent>{models.isPending ? <p className="text-sm text-muted-foreground">Loading models…</p> : models.error ? <p role="alert" className="text-sm text-destructive">{models.error.message}</p> : models.data?.length ? <div className="divide-y border">{models.data.map((model) => <div key={model.id} className="grid gap-3 p-3 text-xs sm:grid-cols-[1fr_1fr_auto] sm:items-center"><div className="flex min-w-0 items-center gap-3"><ProviderIcon presetId={model.providerPresetId} className="size-9 shrink-0 [&_img]:size-5" /><span className="min-w-0"><strong className="block truncate">{model.providerName}</strong><span className="text-muted-foreground">{complianceLabel(model.complianceDomain)}</span></span></div><span><strong className="block truncate font-medium">{model.displayName}</strong><span className="block truncate text-muted-foreground">{model.modelId}</span></span><span className={model.status === "VALIDATED" ? "text-emerald-700" : "text-amber-700"}>{model.status === "VALIDATED" ? "Ready" : model.status.replaceAll("_", " ")}</span></div>)}</div> : <div className="border border-dashed p-8 text-center"><Database className="mx-auto size-[18px] text-muted-foreground" /><p className="mt-3 text-sm">No models registered.</p><Button asChild variant="outline" className="mt-4"><Link to="/$projectId/setting" params={{ projectId }} search={{ section: "models" }}>Register models <ArrowRight /></Link></Button></div>}</CardContent></Card>
  </div>;
}

function RoutingPolicyFacts({
  modelName,
  routing,
}: {
  modelName: (id: string) => string;
  routing: ModelRouting;
}) {
  const policy = routing.routingPolicy;
  const fallbackIds = policy.fallbackModelDeploymentIds;
  if (policy.mode === "SINGLE") {
    return (
      <div className="grid gap-px overflow-hidden border bg-border sm:grid-cols-2">
        <Fact label="All requests" value={modelName(policy.modelDeploymentId)} />
        <Fact label="Fallback chain" value={fallbackIds.length ? fallbackIds.map(modelName).join(" → ") : "Disabled"} />
        <Fact label="Retries before fallback" value={String(policy.retries)} />
      </div>
    );
  }
  if (policy.mode === "COMPLEXITY") {
    return (
      <div className="grid gap-px overflow-hidden border bg-border sm:grid-cols-2">
        <Fact label="SIMPLE / MEDIUM" value={modelName(policy.simpleModelDeploymentId)} />
        <Fact label="COMPLEX / REASONING" value={modelName(policy.complexModelDeploymentId)} />
        <Fact label="Fallback chain" value={fallbackIds.length ? fallbackIds.map(modelName).join(" → ") : "Disabled"} />
        <Fact label="Retries before fallback" value={String(policy.retries)} />
      </div>
    );
  }
  return (
    <div className="grid gap-px overflow-hidden border bg-border sm:grid-cols-2">
      <Fact label="Default model" value={modelName(policy.defaultModelDeploymentId)} />
      <Fact label="Routing embedding model" value={modelName(policy.embeddingModelDeploymentId)} />
      {policy.routes.map((route) => (
        <Fact
          key={route.intent}
          label={`Intent · ${route.intent}`}
          value={`${modelName(route.modelDeploymentId)} · ${route.utterances.length} examples`}
        />
      ))}
      <Fact label="Fallback chain" value={fallbackIds.length ? fallbackIds.map(modelName).join(" → ") : "Disabled"} />
      <Fact label="Retries before fallback" value={String(policy.retries)} />
    </div>
  );
}

function AccessTab({ routing, onDelete }: { routing: ModelRouting; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const scope = useProjectQueryScope();
  const [name, setName] = useState(routing.name);
  const [description, setDescription] = useState(routing.description);
  useEffect(() => { setName(routing.name); setDescription(routing.description); }, [routing]);
  const update = useMutation({ mutationFn: (input: Parameters<typeof api.updateModelRouting>[1]) => api.updateModelRouting(routing.id, input), onSuccess: async () => Promise.all([queryClient.invalidateQueries({ queryKey: scope.key("model-routing", routing.id) }), queryClient.invalidateQueries({ queryKey: scope.key("model-routings") })]) });
  return <div className="space-y-4"><SettingsCard title="Routing identity" description="The human-readable identity shown in every model selection surface."><div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Description"><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field></div><Button className="mt-4" disabled={update.isPending} onClick={() => update.mutate({ name, description })}>Save routing identity</Button></SettingsCard>
    <SettingsCard title="Access credentials" description="Key material is never displayed or persisted by the TaskLattice Relay API."><div className="flex items-center gap-3 border bg-muted/20 p-3"><KeyRound className="size-4 text-primary" /><span><strong className="block text-sm">Per-Instance Virtual Keys enabled</strong><span className="text-xs text-muted-foreground">Team-scoped · model-restricted · independently revocable</span></span></div></SettingsCard>
    <SettingsCard title="Data boundary" description="Routing keeps all selected and fallback models inside one declared boundary."><div className="max-w-sm"><ReadOnly label="Data boundary" value={complianceLabel(routing.complianceDomain)} /></div><p className="mt-3 flex gap-2 text-xs text-muted-foreground"><CircleAlert className="size-4 shrink-0" />This is a routing residency boundary, not a legal certification. A mismatch blocks new Instance bindings.</p></SettingsCard>
    <SettingsCard title="Audit policy" description="Control-plane events are always captured; request telemetry depends on LiteLLM callbacks."><div className="grid gap-3 sm:grid-cols-2"><ReadOnly label="Control-plane events" value="Enabled" /><ReadOnly label="Prompt and response capture" value="Disabled" /></div></SettingsCard>
    <SettingsCard title="Lifecycle" description={routing.isDefault ? "Choose another Project default before suspending this routing." : "Suspension removes this routing from new Instance selection without deleting history."}><Button variant="outline" disabled={routing.isDefault} onClick={() => { if (window.confirm(routing.status === "SUSPENDED" ? "Resume this routing?" : "Suspend this routing?")) update.mutate({ suspended: routing.status !== "SUSPENDED" }); }}>{routing.status === "SUSPENDED" ? "Resume routing" : "Suspend routing"}</Button></SettingsCard>
    <Card className="border-destructive/30"><CardHeader><CardTitle className="text-destructive">Danger zone</CardTitle><CardDescription>{routing.isDefault ? "Choose another Project default before deleting this routing." : routing.consumers > 0 ? `${routing.consumers} active ${routing.consumers === 1 ? "Instance must" : "Instances must"} be reassigned before this routing can be deleted.` : "Deleting removes this routing while keeping registered models."}</CardDescription></CardHeader><CardContent><Button variant="destructive" disabled={routing.isDefault} onClick={onDelete}><Trash2 />Delete routing</Button></CardContent></Card>
    {update.error ? <p role="alert" className="text-sm text-destructive">{update.error.message}</p> : null}
  </div>;
}

function ConsumersTab({ routingId }: { routingId: string }) {
  const scope = useProjectQueryScope();
  const query = useQuery({ queryKey: scope.key("model-routing-consumers", routingId), queryFn: () => api.listModelRoutingConsumers(routingId) });
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Boxes className="size-4" />Routing consumers</CardTitle><CardDescription>Instances using this routing, each with an independently revocable Virtual Key.</CardDescription></CardHeader><CardContent>{query.isPending ? <p className="text-sm text-muted-foreground">Loading consumers…</p> : query.data?.length ? <div className="divide-y border">{query.data.map((binding) => <div key={binding.id} className="grid gap-2 p-3 text-xs sm:grid-cols-3"><span><span className="block text-muted-foreground">Instance</span><strong>{binding.agentId}</strong></span><span><span className="block text-muted-foreground">Key fingerprint</span><strong className="font-mono">{binding.keyFingerprint}</strong></span><span><span className="block text-muted-foreground">Attached</span><strong>{formatPlatformDateTime(binding.createdAt)}</strong></span></div>)}</div> : <p className="py-10 text-center text-sm text-muted-foreground">No Instance currently uses this routing.</p>}</CardContent></Card>;
}

function AuditTab({ routingId }: { routingId: string }) {
  const scope = useProjectQueryScope();
  const query = useQuery({ queryKey: scope.key("model-routing-audit", routingId), queryFn: () => api.listModelRoutingAudit(routingId) });
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileClock className="size-4" />Control-plane audit</CardTitle><CardDescription>Secrets and prompt content are excluded.</CardDescription></CardHeader><CardContent>{query.isPending ? <p className="text-sm text-muted-foreground">Loading audit events…</p> : query.data?.length ? <ol className="divide-y border">{query.data.map((event) => <li key={event.eventId} className="grid gap-2 p-3 text-xs sm:grid-cols-[11rem_1fr_auto]"><span className="text-muted-foreground">{formatPlatformDateTime(event.timestamp)}</span><span><strong className="block">{event.type}</strong><span className="mt-1 block text-muted-foreground">{event.reason}</span></span><span className={event.result === "SUCCESS" ? "text-emerald-700" : "text-destructive"}>{event.result}</span></li>)}</ol> : <p className="py-10 text-center text-sm text-muted-foreground">No audit events.</p>}</CardContent></Card>;
}

function SettingsCard({ children, description, title }: { children: ReactNode; description: string; title: string }) { return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>; }
function Field({ children, label }: { children: ReactNode; label: string }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function ReadOnly({ label, value }: { label: string; value: string }) { return <div><Label>{label}</Label><div className="mt-2 flex min-h-10 items-center border bg-muted/30 px-3 text-sm">{value}</div></div>; }
function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="bg-card px-4 py-3.5"><span className="block text-xs text-muted-foreground">{label}</span><strong className={cn("mt-1 block text-sm font-medium [overflow-wrap:anywhere]", mono && "font-mono")}>{value}</strong></div>; }
function FactRow({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4 py-3 text-xs first:pt-0 last:pb-0"><span className="text-muted-foreground">{label}</span><strong className="text-right font-medium">{value}</strong></div>; }
function PathStep({ icon: Icon, label, mono = false, value }: { icon: typeof Database; label: string; mono?: boolean; value: string }) { return <div className="flex min-h-20 items-center gap-3 p-4"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/70"><Icon className="size-4 text-primary" /></span><span className="min-w-0"><span className="block text-xs text-muted-foreground">{label}</span><strong className={cn("mt-1 block text-xs font-medium leading-5 [overflow-wrap:anywhere]", mono && "font-mono")}>{value}</strong></span></div>; }
function PathArrow() { return <span className="hidden items-center justify-center border-x border-border/45 text-muted-foreground/60 sm:flex"><ArrowRight className="size-3.5" /></span>; }
function conditionLabel(type: ModelRouting["conditions"][number]["type"]) { return type === "BINDING" ? "Routing binding" : type === "GATEWAY" ? "Gateway health" : type === "COMPLIANCE" ? "Compliance boundary" : "Capabilities"; }
function routingModeLabel(routing: ModelRouting) {
  return routing.routingPolicy.mode === "SINGLE"
    ? "Fixed model"
    : routing.routingPolicy.mode === "COMPLEXITY"
      ? "By complexity"
      : "By intent";
}
function complianceLabel(domain: ModelRouting["complianceDomain"]) {
  return complianceDomainCatalog.find((item) => item.id === domain)?.label ?? domain;
}
