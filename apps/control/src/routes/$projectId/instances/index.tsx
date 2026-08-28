import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import {
  agentPlatformIds,
  type Instance as Agent,
  type InstanceStatus,
  type A2aAgentInstance,
} from "@tali/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AlertTriangle, Boxes, Columns3Cog, Eye, Globe2, Info, MoreHorizontal, Plus, RefreshCw, RotateCcw, Search, SquareTerminal, Trash2, X } from "lucide-react";
import { AccountAvatar } from "@/components/account/account-avatar";
import { AgentGardenIcon } from "@/components/agent-garden/agent-garden-icon";
import { AgentPlatformIcon } from "@/components/agents/agent-platform-icon";
import { CreateInstanceSheet } from "@/components/agents/create-instance-sheet";
import { resolveProvisioningState } from "@/components/agents/provisioning-state";
import { DeleteInstanceSheet } from "@/components/instances/delete-instance-sheet";
import {
  INSTANCE_COLUMNS_STORAGE_KEY,
  instanceListColumns,
  instanceListGridTemplate,
  parseHiddenInstanceColumns,
  toggleHiddenInstanceColumn,
  type InstanceListColumnId,
} from "@/components/instances/instance-list-columns";
import { formatRelativeTime } from "@/components/instances/instance-detail-model";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { getAgentPlatformPresentation } from "@/lib/agent-platforms";
import { cn } from "@/lib/utils";
import { formatPlatformDateTime } from "@/lib/platform-preferences";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { useCurrentProjectId } from "@/hooks/use-project";
import { useProjectPermissions } from "@/hooks/use-project-permissions";

export const Route = createFileRoute("/$projectId/instances/")({
  validateSearch: z.object({
    create: z.literal("instance").optional(),
    created: z.string().optional(),
    retainedMemory: z.string().uuid().optional(),
    retainedMemoryName: z.string().optional(),
    platform: z.enum(agentPlatformIds).optional(),
    specialization: z.string().trim().min(1).max(64).optional(),
  }),
  component: Instances,
});

const statusFilters = ["ALL", "PROVISIONING", "READY", "FAILED", "DESTROYING"] as const satisfies readonly (InstanceStatus | "ALL")[];

type InstanceGridStyle = CSSProperties & { "--instance-grid-columns": string };

function InstanceTime({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatPlatformDateTime(value)} className="block min-w-0">
      <span className="block truncate text-xs font-medium text-foreground">{formatRelativeTime(value)}</span>
      <span className="mt-1 block truncate text-[11px] text-muted-foreground">{formatPlatformDateTime(value)}</span>
    </time>
  );
}

function ColumnVisibilityMenu({
  hiddenColumns,
  onReset,
  onToggle,
}: {
  hiddenColumns: readonly InstanceListColumnId[];
  onReset: () => void;
  onToggle: (column: InstanceListColumnId) => void;
}) {
  const hidden = new Set(hiddenColumns);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="h-11 px-3" aria-label="Customize Instance columns">
          <Columns3Cog className="size-4" />
          <span className="hidden sm:inline">Columns</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        {instanceListColumns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={!hidden.has(column.id)}
            onCheckedChange={() => onToggle(column.id)}
            onSelect={(event) => event.preventDefault()}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!hiddenColumns.length} onSelect={onReset}>
          <RotateCcw className="size-4" />
          Restore defaults
        </DropdownMenuItem>
        <p className="px-2 py-2 text-[11px] leading-4 text-muted-foreground">Saved on this device.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CreationNotice({ onClose }: { onClose: () => void }) {
  return (
    <div role="status" className="flex min-h-16 items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Info className="size-4" /></span>
      <p className="min-w-0 flex-1"><strong>Creation request submitted.</strong> The Instance is being created in the background.</p>
      <button type="button" aria-label="Dismiss creation notice" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-md text-primary hover:bg-primary/10 focus-visible:outline-2"><X className="size-5" /></button>
    </div>
  );
}

function InstanceLifecycleStatus({ instance }: { instance: Agent }) {
  const projectId = useCurrentProjectId();
  if (instance.status === "READY") {
    return <Badge className="gap-2 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"><span className="size-2 rounded-full bg-emerald-500" />Ready</Badge>;
  }
  if (instance.status === "FAILED") {
    return (
      <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: instance.id }} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 text-xs font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-2">
        <AlertTriangle className="size-4" />Failed<span className="sr-only"> — view failure details</span>
      </Link>
    );
  }
  if (instance.status === "DESTROYING") {
    return <span className="inline-flex min-h-11 items-center gap-2 rounded-md bg-muted px-3 text-xs font-medium"><Spinner className="size-4" />Removing</span>;
  }

  const state = resolveProvisioningState({ status: instance.status, ...(instance.provisioningStage ? { stage: instance.provisioningStage } : {}) });
  const step = Math.min(5, Math.max(1, state.activeIndex));
  return (
    <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: instance.id }} className="inline-flex min-h-11 flex-col justify-center rounded-md border border-primary/20 bg-primary/5 px-3 text-xs hover:bg-primary/10 focus-visible:outline-2">
      <span className="flex items-center gap-2 font-medium text-foreground"><Spinner className="size-4 text-primary" />Creating · {step}/5</span>
      <span className="mt-0.5 pl-6 tabular-nums text-muted-foreground">{state.progress}% complete</span>
    </Link>
  );
}

function ManagedA2aLifecycleStatus({ instance }: { instance: A2aAgentInstance }) {
  if (instance.status === "READY") {
    return <Badge className="gap-2 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"><span className="size-2 rounded-full bg-emerald-500" />Ready</Badge>;
  }
  if (instance.status === "FAILED") {
    return <span className="inline-flex min-h-11 items-center gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 text-xs font-medium text-destructive"><AlertTriangle className="size-4" />Failed</span>;
  }
  if (instance.status === "DESTROYING") {
    return <span className="inline-flex min-h-11 items-center gap-2 rounded-md bg-muted px-3 text-xs font-medium"><Spinner className="size-4" />Removing</span>;
  }
  return <span className="inline-flex min-h-11 items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 text-xs font-medium"><Spinner className="size-4 text-primary" />Provisioning</span>;
}

function ActionTooltip({ children, label }: { children: ReactElement; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="inline-flex">{children}</span></TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

function PrimaryInstanceAction({ canInteract, instance }: { canInteract: boolean; instance: Agent }) {
  const projectId = useCurrentProjectId();
  const platform = getAgentPlatformPresentation(instance.agentPlatform);
  const scope = useProjectQueryScope();
  const interaction = useQuery({
    queryKey: scope.key("agent-interaction", instance.id),
    queryFn: () => api.getInstanceInteraction(instance.id),
    enabled: canInteract && instance.status === "READY",
    retry: 1,
    staleTime: 15_000,
    refetchInterval: 4 * 60_000,
  });
  const endpoint = interaction.data?.httpEndpoint;
  const endpointReady = endpoint?.status === "READY" && Boolean(endpoint.url);

  if (instance.status === "READY" && endpointReady && endpoint?.url) {
    return (
      <ActionTooltip label={`Open ${platform.endpointLabel}`}>
        <Button asChild variant="outline" size="icon">
          <a href={endpoint.url} target="_blank" rel="noreferrer" aria-label={`Open ${platform.endpointLabel} for ${instance.name}`}>
            <Globe2 className="size-[18px]" />
          </a>
        </Button>
      </ActionTooltip>
    );
  }
  if (instance.status === "FAILED") {
    return (
      <ActionTooltip label="View failure details">
        <Button asChild variant="outline" size="icon">
          <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: instance.id }} aria-label={`View failure details for ${instance.name}`}>
            <AlertTriangle className="size-[18px]" />
          </Link>
        </Button>
      </ActionTooltip>
    );
  }
  return (
    <ActionTooltip label="View Instance details">
      <Button asChild variant="outline" size="icon">
        <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: instance.id }} aria-label={`View details for ${instance.name}`}>
          <Eye className="size-[18px]" />
        </Link>
      </Button>
    </ActionTooltip>
  );
}

function InstanceActions({ canDelete, canUseTerminal, instance, onDelete }: { canDelete: boolean; canUseTerminal: boolean; instance: Agent; onDelete: () => void }) {
  const projectId = useCurrentProjectId();
  const platform = getAgentPlatformPresentation(instance.agentPlatform);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${instance.name}`}><MoreHorizontal className="size-5" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild><Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: instance.id }}><Eye />View details</Link></DropdownMenuItem>
        {canUseTerminal && instance.status === "READY" ? <DropdownMenuItem asChild><Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: instance.id }} search={{ tab: "terminal" }}><SquareTerminal />Open {platform.consoleLabel}</Link></DropdownMenuItem> : null}
        <DropdownMenuItem disabled><RefreshCw />Restart unavailable</DropdownMenuItem>
        {canDelete ? <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          disabled={instance.status === "DESTROYING"}
          onSelect={onDelete}
        >
          <Trash2 />
          {instance.status === "DESTROYING"
            ? "Deletion in progress"
            : "Delete Instance"}
        </DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ManagedA2aInstanceRow({
  gridStyle,
  hiddenColumns,
  instance,
}: {
  gridStyle: InstanceGridStyle;
  hiddenColumns: readonly InstanceListColumnId[];
  instance: A2aAgentInstance;
}) {
  const projectId = useCurrentProjectId();
  const hidden = new Set(hiddenColumns);
  const details = (
    <Link
      to="/$projectId/instances/$instanceId"
      params={{ projectId, instanceId: instance.id }}
      aria-label={`View Agent and runtime details for ${instance.name}`}
    ><Eye className="size-[18px]" /></Link>
  );
  return (
    <div style={gridStyle} className="group relative grid min-h-[5.25rem] grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] items-center gap-3 border-b px-4 py-3 text-sm transition-colors hover:bg-muted/30 xl:grid-cols-[var(--instance-grid-columns)]">
      <Link
        to="/$projectId/instances/$instanceId"
        params={{ projectId, instanceId: instance.id }}
        aria-label={`View Instance details for ${instance.name}`}
        className="absolute inset-0 z-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
      />
      <span className="pointer-events-none relative z-10 col-span-3 flex min-w-0 items-center gap-3 xl:col-span-1">
        <AgentGardenIcon type="a2a" className="transition-colors group-hover:border-primary/30 group-hover:bg-primary/5" />
        <span className="min-w-0">
          <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: instance.id }} className="pointer-events-auto block truncate font-medium text-foreground hover:text-primary hover:underline">{instance.name}</Link>
          <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{instance.id.slice(0, 8)} · A2A Standard</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground xl:hidden">
            {instance.runtime === "kubernetes"
              ? `Pod ${instance.podName ?? "pending"}`
              : "External A2A runtime"}
          </span>
        </span>
      </span>
      {!hidden.has("runtime") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block">
        <strong className="block truncate text-xs font-medium">
          {instance.runtime === "kubernetes"
            ? "Kubernetes · Project Main Space"
            : "External · Runtime Bridge"}
        </strong>
        <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
          {instance.runtime === "kubernetes"
            ? instance.podName ?? instance.deploymentName ?? "Pod pending"
            : instance.endpoint ?? "Endpoint unavailable"}
        </span>
      </span> : null}
      {!hidden.has("createdBy") ? <span className="pointer-events-none relative z-10 hidden min-w-0 items-center gap-2 xl:flex">
        <AccountAvatar identity={instance.createdBy} className="size-7" />
        <span className="min-w-0">
          <strong className="block truncate text-xs font-medium">{instance.createdBy?.displayName ?? "Unknown user"}</strong>
          <span className="mt-1 block truncate text-xs text-muted-foreground">{instance.createdBy ? `@${instance.createdBy.username}` : "Creator unavailable"}</span>
        </span>
      </span> : null}
      {!hidden.has("createdAt") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block"><InstanceTime value={instance.createdAt} /></span> : null}
      {!hidden.has("updatedAt") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block"><InstanceTime value={instance.updatedAt} /></span> : null}
      <span className={cn("relative z-20", hidden.has("status") && "xl:hidden")} onClick={(event) => event.stopPropagation()}><ManagedA2aLifecycleStatus instance={instance} /></span>
      <span className={cn("relative z-20 justify-self-end lg:justify-self-start", hidden.has("access") && "xl:hidden")} onClick={(event) => event.stopPropagation()}>
        <ActionTooltip label="View Agent and runtime details"><Button asChild variant="outline" size="icon">{details}</Button></ActionTooltip>
      </span>
      <span className="relative z-20 justify-self-end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${instance.name}`}><MoreHorizontal className="size-5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem asChild><Link to="/$projectId/agent-garden/$agentId" params={{ projectId, agentId: instance.agentId }}><Eye />View Garden Agent</Link></DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}

function Instances() {
  const projectId = useCurrentProjectId();
  const queryClient = useQueryClient();
  const scope = useProjectQueryScope();
  const permissions = useProjectPermissions();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof statusFilters)[number]>("ALL");
  const [hiddenColumns, setHiddenColumns] = useState<InstanceListColumnId[]>([]);
  const [deletingInstance, setDeletingInstance] = useState<Agent>();
  const [retainedMemory, setRetainedMemory] = useState<{ id: string; displayName: string } | null>(null);
  const agents = useQuery({ queryKey: scope.key("agents"), queryFn: api.listInstances, refetchInterval: 2_000 });
  const garden = useQuery({ queryKey: scope.key("agent-garden"), queryFn: api.getAgentGarden });
  const filtered = useMemo(() => (agents.data ?? []).filter((agent) => {
    const matchesQuery = `${agent.name} ${agent.id} ${agent.sandboxName} ${getAgentPlatformPresentation(agent.agentPlatform).name} ${agent.createdBy?.displayName ?? ""} ${agent.createdBy?.username ?? ""}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (status === "ALL" || agent.status === status);
  }), [agents.data, query, status]);
  const managed = useMemo(() => (garden.data?.instances ?? []).filter((instance) => {
    const searchable = `${instance.name} ${instance.id} ${instance.agentId} ${instance.runtimeNamespace ?? ""} ${instance.deploymentName ?? ""} ${instance.podName ?? ""} ${instance.imageReference ?? ""} ${instance.endpoint ?? ""} A2A ${instance.runtime}`;
    return searchable.toLowerCase().includes(query.trim().toLowerCase())
      && (status === "ALL" || instance.status === status);
  }), [garden.data?.instances, query, status]);
  const totalInstances = (agents.data?.length ?? 0) + (garden.data?.instances.length ?? 0);
  const visibleInstances = filtered.length + managed.length;
  const gridStyle = useMemo<InstanceGridStyle>(() => ({
    "--instance-grid-columns": instanceListGridTemplate(hiddenColumns),
  }), [hiddenColumns]);

  useEffect(() => {
    const syncColumns = (value: string | null) => {
      setHiddenColumns(parseHiddenInstanceColumns(value));
    };
    try {
      syncColumns(window.localStorage.getItem(INSTANCE_COLUMNS_STORAGE_KEY));
    } catch {
      syncColumns(null);
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === INSTANCE_COLUMNS_STORAGE_KEY) syncColumns(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persistHiddenColumns = (next: InstanceListColumnId[]) => {
    setHiddenColumns(next);
    try {
      window.localStorage.setItem(INSTANCE_COLUMNS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The list remains usable when browser storage is unavailable.
    }
  };
  const remove = useMutation({
    mutationFn: api.deleteInstance,
    onSuccess: async (result) => {
      setRetainedMemory(result.retainedMemory);
      setDeletingInstance(undefined);
      await queryClient.invalidateQueries({ queryKey: scope.key("agents") });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Instances" description="Monitor workbench Agents and callable A2A Instances available in this Project." actions={permissions.canCreateAgents ? <Button asChild className="h-11"><Link to="/$projectId/instances" params={{ projectId }} search={{ create: "instance" }}><Plus />Create Instance</Link></Button> : undefined} />

      {search.created ? <CreationNotice onClose={() => void navigate({ to: "/$projectId/instances", params: { projectId }, search: {}, replace: true })} /> : null}
      {search.retainedMemory || retainedMemory ? (
        <p role="status" className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm">
          <span>The Agent is being deleted. Its Memory <strong>{search.retainedMemoryName ?? retainedMemory?.displayName ?? ""}</strong> is retained.</span>
          <Button asChild variant="outline" className="h-11"><Link to="/$projectId/memory/$memoryId" params={{ projectId, memoryId: search.retainedMemory ?? retainedMemory!.id }}>Open retained Memory</Link></Button>
        </p>
      ) : null}

      {agents.error || garden.error ? (
        <p role="alert" className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {(agents.error ?? garden.error)?.message}
        </p>
      ) : null}

      <TooltipProvider>
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center gap-3">
            <label className="w-full sm:w-72">
              <span className="sr-only">Search instances</span>
              <InputGroup className="h-11 rounded-md">
                <InputGroupAddon><Search className="size-4" /></InputGroupAddon>
                <InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search instances" />
              </InputGroup>
            </label>
            <Select value={status} onValueChange={(value) => setStatus(value as (typeof statusFilters)[number])}>
              <SelectTrigger size="lg" aria-label="Filter Instances by status" className="w-[calc(100%-3.5rem)] sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{statusFilters.map((value) => <SelectItem key={value} value={value}>{value === "ALL" ? "All statuses" : value.charAt(0) + value.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
            </Select>
            <span className="ml-auto hidden text-xs tabular-nums text-muted-foreground sm:block">{visibleInstances} of {totalInstances} Instances</span>
            <ColumnVisibilityMenu
              hiddenColumns={hiddenColumns}
              onReset={() => persistHiddenColumns([])}
              onToggle={(column) => persistHiddenColumns(toggleHiddenInstanceColumn(hiddenColumns, column))}
            />
            <ActionTooltip label={agents.isFetching || garden.isFetching ? "Refreshing Instances" : "Refresh Instances"}>
              <Button type="button" variant="outline" size="icon" className="size-11" disabled={agents.isFetching || garden.isFetching} aria-label="Refresh Instances" onClick={() => void Promise.all([agents.refetch(), garden.refetch()])}>
                {agents.isFetching || garden.isFetching ? <Spinner /> : <RefreshCw className="size-4" />}
              </Button>
            </ActionTooltip>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {visibleInstances ? (
            <div className="overflow-x-auto">
              <div style={gridStyle} className="hidden items-center gap-3 border-b bg-muted/20 px-4 py-3 text-xs text-muted-foreground xl:grid xl:grid-cols-[var(--instance-grid-columns)]">
                <span>Instance</span>
                {instanceListColumns.filter((column) => !hiddenColumns.includes(column.id)).map((column) => <span key={column.id}>{column.label}</span>)}
                <span className="sr-only">Actions</span>
              </div>
              {managed.map((instance) => <ManagedA2aInstanceRow key={instance.id} instance={instance} hiddenColumns={hiddenColumns} gridStyle={gridStyle} />)}
              {filtered.map((agent) => {
                const platform = getAgentPlatformPresentation(agent.agentPlatform);
                return (
                  <div key={agent.id} style={gridStyle} className={cn(
                    "group relative grid min-h-[5.25rem] grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] items-center gap-3 border-b px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-muted/30 xl:grid-cols-[var(--instance-grid-columns)]",
                    search.created === agent.id && "bg-primary/5 shadow-[inset_3px_0_0_var(--primary)]",
                  )}>
                    <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: agent.id }} aria-label={`View details for ${agent.name}`} className="absolute inset-0 z-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px]" />
                    <span className="pointer-events-none relative z-10 col-span-3 flex min-w-0 items-center gap-3 xl:col-span-1">
                      <AgentPlatformIcon platform={platform} className="transition-colors group-hover:border-primary/30 group-hover:bg-primary/5" />
                      <span className="min-w-0">
                        <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: agent.id }} className="pointer-events-auto block truncate font-medium text-foreground hover:text-primary hover:underline">{agent.name}</Link>
                        <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{agent.id.slice(0, 8)} · {platform.name}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground xl:hidden">Created by {agent.createdBy?.displayName ?? "Unknown user"}</span>
                      </span>
                    </span>
                    {!hiddenColumns.includes("runtime") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block"><strong className="block truncate text-xs font-medium">{platform.runtimeName}</strong><span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{agent.sandboxName}</span></span> : null}
                    {!hiddenColumns.includes("createdBy") ? <span className="pointer-events-none relative z-10 hidden min-w-0 items-center gap-2 xl:flex">
                      <AccountAvatar
                        identity={agent.createdBy}
                        className="size-7"
                      />
                      <span className="min-w-0">
                        <strong className="block truncate text-xs font-medium">{agent.createdBy?.displayName ?? "Unknown user"}</strong>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">{agent.createdBy ? `@${agent.createdBy.username}` : "Creator unavailable"}</span>
                      </span>
                    </span> : null}
                    {!hiddenColumns.includes("createdAt") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block"><InstanceTime value={agent.createdAt} /></span> : null}
                    {!hiddenColumns.includes("updatedAt") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block"><InstanceTime value={agent.updatedAt} /></span> : null}
                    <span className={cn("relative z-20", hiddenColumns.includes("status") && "xl:hidden")} onClick={(event) => event.stopPropagation()}><InstanceLifecycleStatus instance={agent} /></span>
                    <span className={cn("relative z-20 justify-self-end lg:justify-self-start", hiddenColumns.includes("access") && "xl:hidden")} onClick={(event) => event.stopPropagation()}><PrimaryInstanceAction canInteract={permissions.canInteractWithAgents} instance={agent} /></span>
                    <span className="relative z-20 justify-self-end" onClick={(event) => event.stopPropagation()}><InstanceActions canDelete={permissions.canDeleteAgents} canUseTerminal={permissions.canUseAgentTerminal} instance={agent} onDelete={() => setDeletingInstance(agent)} /></span>
                  </div>
                );
              })}
            </div>
          ) : totalInstances ? (
            <EmptyState
              icon={Boxes}
              title="No matching instances"
              description="Adjust the search or status filter."
            />
          ) : (
            <EmptyState
              icon={Boxes}
              title="No Instances yet"
              description="Create an Instance to start running an Agent in this Project."
              action={permissions.canCreateAgents ? (
                <Button asChild>
                  <Link
                    to="/$projectId/instances"
                    params={{ projectId }}
                    search={{ create: "instance" }}
                  >
                    <Plus />
                    Create Instance
                  </Link>
                </Button>
              ) : undefined}
            />
          )}
        </CardContent>
      </Card>
      </TooltipProvider>

      {permissions.canDeleteAgents && deletingInstance ? <DeleteInstanceSheet open instanceName={deletingInstance.name} retainsMemory={Boolean(deletingInstance.durableMemoryId)} deleting={remove.isPending} onOpenChange={(open) => { if (!open) setDeletingInstance(undefined); }} onConfirm={() => remove.mutate(deletingInstance.id)} {...(remove.error instanceof Error ? { error: remove.error.message } : {})} /> : null}
      {permissions.canCreateAgents && search.create === "instance" ? (
        <CreateInstanceSheet
          open
          {...(search.platform ? { initialAgentPlatform: search.platform } : {})}
          {...(search.specialization ? { initialSpecializationId: search.specialization } : {})}
          onOpenChange={(open) => {
            if (open) return;
            void navigate({
              to: "/$projectId/instances",
              params: { projectId },
              search: search.created ? { created: search.created } : {},
              replace: true,
            });
          }}
        />
      ) : null}
    </div>
  );
}
