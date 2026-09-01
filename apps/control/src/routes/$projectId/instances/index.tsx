import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import {
  agentPlatformIds,
  type Instance as Agent,
  type A2aAgentInstance,
  type RuntimeInventoryIdentity,
  type RuntimeInventoryItem,
  type RuntimeInventoryStatus,
} from "@tali/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AlertTriangle, Bot, Boxes, Columns3Cog, Eye, Globe2, Info, MoreHorizontal, Plus, RefreshCw, RotateCcw, Search, SquareTerminal, Trash2, X } from "lucide-react";
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
import { EntityDetailList, EntitySheet } from "@/components/shared/entity-sheet";
import { RuntimeStatusBadge, StatusBadge } from "@/components/shared/status";
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
import { useAccessContext } from "@/components/auth/access-context-provider";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { useCurrentProjectId, useProject } from "@/hooks/use-project";
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

const statusFilters = ["ALL", "INACTIVE", "ACTIVATING", "PROVISIONING", "READY", "DEGRADED", "FAILED", "DESTROYING"] as const satisfies readonly (RuntimeInventoryStatus | "ALL")[];
const sourceFilters = ["ALL", "WORKSPACE_INSTANCE", "MANAGED_A2A", "PROJECT_AGENT"] as const;

function isProjectAgentSource(sourceType: string): boolean {
  return sourceType === "PROJECT_AGENT";
}

function productFormLabel(form: RuntimeInventoryItem["classification"]["form"]): string {
  if (form === "INTERACTIVE") return "Interactive Agent";
  if (form === "SERVICE") return "Service Agent";
  return "Hybrid Agent";
}

function collaborationRoleLabel(
  role: RuntimeInventoryItem["classification"]["role"],
): string {
  if (role === "SUPERVISOR") return "Supervisor role";
  if (role === "SPECIALIST") return "Specialist role";
  return "Hybrid role";
}

function a2aRoleLabel(item: RuntimeInventoryItem): string {
  const directions = item.classification.a2a.directions;
  if (directions.includes("CLIENT") && directions.includes("SERVER")) {
    return "A2A Client + Server";
  }
  if (directions.includes("SERVER")) return "A2A Server";
  if (directions.includes("CLIENT")) return "A2A Client";
  return "A2A not exposed";
}

type InstanceGridStyle = CSSProperties & { "--instance-grid-columns": string };

function InstanceTime({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatPlatformDateTime(value)} className="block min-w-0">
      <span className="block truncate text-xs font-medium text-foreground">{formatRelativeTime(value)}</span>
      <span className="mt-1 block truncate text-[11px] text-muted-foreground">{formatPlatformDateTime(value)}</span>
    </time>
  );
}

function RuntimePerson({
  identity,
  unavailable = "Unassigned",
}: {
  identity: RuntimeInventoryIdentity | null | undefined;
  unavailable?: string;
}) {
  return (
    <span className="pointer-events-none relative z-10 hidden min-w-0 items-center gap-2 xl:flex">
      <AccountAvatar identity={identity ?? undefined} className="size-7" />
      <span className="min-w-0">
        <strong className="block truncate text-xs font-medium">{identity?.displayName ?? unavailable}</strong>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{identity ? `@${identity.username}` : "No user record"}</span>
      </span>
    </span>
  );
}

function RuntimeInventoryDetail({
  item,
  onOpenChange,
  projectId,
}: {
  item: RuntimeInventoryItem | null;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  if (!item) return null;
  const ownerNames = item.ownership.owners.map((owner) => owner.displayName).join(", ") || "Unassigned";
  const maintainerNames = item.ownership.maintainers.map((member) => member.displayName).join(", ") || "None";
  return (
    <EntitySheet
      open
      onOpenChange={onOpenChange}
      eyebrow="Runtime Inventory"
      title={item.name}
      description="Unified runtime identity and responsibility. Lifecycle controls remain specific to the source that created this workload."
      footer={isProjectAgentSource(item.sourceType) && item.relation ? (
        <div>
          <Button asChild>
            <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: item.sourceId }}>Open runtime details</Link>
          </Button>
        </div>
      ) : <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>}
    >
      <EntityDetailList items={[
        { label: "Source", value: item.sourceType.replaceAll("_", " ") },
        { label: "Product form", value: productFormLabel(item.classification.form) },
        { label: "Collaboration role", value: collaborationRoleLabel(item.classification.role) },
        { label: "Execution strategy", value: item.classification.executionStrategy ?? "Runtime-defined" },
        { label: "A2A role", value: a2aRoleLabel(item) },
        { label: "Agent Card", value: item.classification.a2a.agentCardStatus },
        { label: "Status", value: item.status },
        { label: "Version", value: item.activeVersion ? `v${item.activeVersion.versionNumber}` : "Not version-pinned", mono: Boolean(item.activeVersion) },
        { label: "Runtime", value: item.runtime.label },
        { label: "Namespace", value: item.runtime.namespace ?? "Not recorded", mono: true },
        { label: "Workload", value: item.runtime.workloadName ?? "Not recorded", mono: true },
        { label: "Endpoint", value: item.runtime.endpoint ?? "Not exposed", mono: true },
        { label: "Owned by", value: ownerNames },
        { label: "Maintained by", value: maintainerNames },
        { label: "Created by", value: item.ownership.createdBy?.displayName ?? "Unknown" },
        { label: "Creator evidence", value: item.ownership.creatorProvenance.replaceAll("_", " ") },
        { label: "Last deployed by", value: item.ownership.lastDeployedBy?.displayName ?? "Not recorded" },
        { label: "Modified", value: formatPlatformDateTime(item.updatedAt) },
      ]} />
    </EntitySheet>
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
      <p className="min-w-0 flex-1"><strong>Interactive Agent creation submitted.</strong> Its managed runtime is being created in the background.</p>
      <button type="button" aria-label="Dismiss creation notice" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-md text-primary hover:bg-primary/10 focus-visible:outline-2"><X className="size-5" /></button>
    </div>
  );
}

function InstanceLifecycleStatus({ instance }: { instance: Agent }) {
  const projectId = useCurrentProjectId();
  if (instance.status === "READY") {
    return <StatusBadge label="Ready" tone="success" />;
  }
  if (instance.status === "FAILED") {
    return (
      <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: instance.id }} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-destructive-border bg-destructive-surface px-3 text-xs font-medium text-destructive hover:brightness-[0.98] focus-visible:outline-2">
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
    <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: instance.id }} className="inline-flex min-h-11 flex-col justify-center rounded-md border border-info-border bg-info-surface px-3 text-xs hover:brightness-[0.98] focus-visible:outline-2">
      <span className="flex items-center gap-2 font-medium text-info-foreground"><Spinner className="size-4 text-info" />Creating · {step}/5</span>
      <span className="mt-0.5 pl-6 tabular-nums text-muted-foreground">{state.progress}% complete</span>
    </Link>
  );
}

function ManagedA2aLifecycleStatus({ instance }: { instance: A2aAgentInstance }) {
  if (instance.status === "READY") {
    return <StatusBadge label="Ready" tone="success" />;
  }
  if (instance.status === "FAILED") {
    return <StatusBadge label="Failed" tone="danger" />;
  }
  if (instance.status === "DESTROYING") {
    return <span className="inline-flex min-h-11 items-center gap-2 rounded-md bg-muted px-3 text-xs font-medium"><Spinner className="size-4" />Removing</span>;
  }
  return <span className="inline-flex min-h-11 items-center"><StatusBadge label="Provisioning" tone="info" pulse /></span>;
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
  inventory,
}: {
  gridStyle: InstanceGridStyle;
  hiddenColumns: readonly InstanceListColumnId[];
  instance: A2aAgentInstance;
  inventory: RuntimeInventoryItem;
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
          <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{instance.id.slice(0, 8)} · {productFormLabel(inventory.classification.form)}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground xl:hidden">
            {instance.runtime === "kubernetes"
              ? `Pod ${instance.podName ?? "pending"}`
              : "External A2A runtime"}
          </span>
        </span>
      </span>
      {!hidden.has("source") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block">
        <strong className="block truncate text-xs font-medium">Agent Garden</strong>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{a2aRoleLabel(inventory)}</span>
      </span> : null}
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
      {!hidden.has("version") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block text-xs text-muted-foreground">Not version-pinned</span> : null}
      {!hidden.has("ownedBy") ? <RuntimePerson identity={inventory.ownership.owners[0]} /> : null}
      {!hidden.has("createdBy") ? <RuntimePerson identity={inventory.ownership.createdBy} unavailable="Unknown creator" /> : null}
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

function ExpertAgentRuntimeRow({
  gridStyle,
  hiddenColumns,
  inventory,
  onInspect,
}: {
  gridStyle: InstanceGridStyle;
  hiddenColumns: readonly InstanceListColumnId[];
  inventory: RuntimeInventoryItem;
  onInspect: () => void;
}) {
  const projectId = useCurrentProjectId();
  const hidden = new Set(hiddenColumns);
  return (
    <div style={gridStyle} className="group relative grid min-h-[5.25rem] grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] items-center gap-3 border-b px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-muted/30 xl:grid-cols-[var(--instance-grid-columns)]">
      <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: inventory.sourceId }} aria-label={`View ${inventory.name} runtime details`} className="absolute inset-0 z-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px]" />
      <span className="pointer-events-none relative z-10 col-span-3 flex min-w-0 items-center gap-3 xl:col-span-1">
        <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-muted/35 text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:bg-primary/5 group-hover:text-primary"><Bot className="size-5" /></span>
        <span className="min-w-0">
          <Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: inventory.sourceId }} className="pointer-events-auto block truncate font-medium text-foreground hover:text-primary hover:underline">{inventory.name}</Link>
          <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{inventory.sourceId.slice(0, 8)} · {productFormLabel(inventory.classification.form)}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground xl:hidden">Owned by {inventory.ownership.owners[0]?.displayName ?? "Unassigned"}</span>
        </span>
      </span>
      {!hidden.has("source") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block"><strong className="block truncate text-xs font-medium">Agent Developer</strong><span className="mt-1 block truncate text-xs text-muted-foreground">{inventory.classification.executionStrategy ? `${inventory.classification.executionStrategy} · ` : ""}{a2aRoleLabel(inventory)}</span></span> : null}
      {!hidden.has("runtime") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block"><strong className="block truncate text-xs font-medium">{inventory.runtime.label}</strong><span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{inventory.runtime.workloadName ?? inventory.runtime.namespace ?? "Workload pending"}</span></span> : null}
      {!hidden.has("version") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block"><strong className="block truncate font-mono text-xs font-medium">{inventory.activeVersion ? `v${inventory.activeVersion.versionNumber}` : "—"}</strong><span className="mt-1 block truncate text-xs text-muted-foreground">Immutable Version</span></span> : null}
      {!hidden.has("ownedBy") ? <RuntimePerson identity={inventory.ownership.owners[0]} /> : null}
      {!hidden.has("createdBy") ? <RuntimePerson identity={inventory.ownership.createdBy} unavailable="Unknown creator" /> : null}
      {!hidden.has("updatedAt") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block"><InstanceTime value={inventory.updatedAt} /></span> : null}
      <span className={cn("relative z-20", hidden.has("status") && "xl:hidden")}><RuntimeStatusBadge status={inventory.status} /></span>
      <span className={cn("relative z-20 justify-self-end lg:justify-self-start", hidden.has("access") && "xl:hidden")}>
        <ActionTooltip label="View Agent and runtime details"><Button asChild variant="outline" size="icon"><Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: inventory.sourceId }} aria-label={`View ${inventory.name} runtime details`}><Eye className="size-[18px]" /></Link></Button></ActionTooltip>
      </span>
      <span className="relative z-20 justify-self-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${inventory.name}`}><MoreHorizontal className="size-5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild><Link to="/$projectId/instances/$instanceId" params={{ projectId, instanceId: inventory.sourceId }}><Eye />View runtime details</Link></DropdownMenuItem>
            <DropdownMenuItem onSelect={onInspect}><Info />Inspect inventory record</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}

function Instances() {
  const projectId = useCurrentProjectId();
  const { currentProject } = useProject();
  const { active: activeAccess } = useAccessContext();
  const queryClient = useQueryClient();
  const scope = useProjectQueryScope();
  const permissions = useProjectPermissions();
  const activeProjectAdmin = activeAccess?.level === "project"
    && activeAccess.resourceId === currentProject?.id
    ? activeAccess.roleId === "ROLE_PROJECT_ADMIN"
    : currentProject?.activeRole === "admin";
  const canCreateSupervisor = permissions.canCreateAgents && activeProjectAdmin;
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof statusFilters)[number]>("ALL");
  const [source, setSource] = useState<(typeof sourceFilters)[number]>("ALL");
  const [hiddenColumns, setHiddenColumns] = useState<InstanceListColumnId[]>([]);
  const [deletingInstance, setDeletingInstance] = useState<Agent>();
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeInventoryItem | null>(null);
  const [retainedMemory, setRetainedMemory] = useState<{ id: string; displayName: string } | null>(null);
  const inventory = useQuery({ queryKey: scope.key("runtime-inventory"), queryFn: api.listRuntimeInventory, refetchInterval: 2_000 });
  const agents = useQuery({ queryKey: scope.key("agents"), queryFn: api.listInstances, refetchInterval: 2_000 });
  const garden = useQuery({ queryKey: scope.key("agent-garden"), queryFn: api.getAgentGarden });
  const visibleInventory = useMemo(() => (inventory.data?.data ?? []).filter((item) => {
    const searchable = [
      item.name,
      item.sourceId,
      item.sourceType,
      item.subtype,
      item.classification.form,
      item.classification.role,
      item.classification.executionStrategy,
      ...item.classification.a2a.directions,
      item.runtime.label,
      item.runtime.namespace,
      item.runtime.workloadName,
      item.runtime.endpoint,
      item.activeVersion ? `v${item.activeVersion.versionNumber}` : undefined,
      item.ownership.createdBy?.displayName,
      item.ownership.createdBy?.username,
      ...item.ownership.owners.flatMap((owner) => [owner.displayName, owner.username]),
      ...item.ownership.maintainers.flatMap((member) => [member.displayName, member.username]),
    ].filter(Boolean).join(" ").toLowerCase();
    return searchable.includes(query.trim().toLowerCase())
      && (status === "ALL" || item.status === status)
      && (source === "ALL" || (source === "PROJECT_AGENT" ? isProjectAgentSource(item.sourceType) : item.sourceType === source));
  }), [inventory.data?.data, query, source, status]);
  const agentById = useMemo(() => new Map((agents.data ?? []).map((agent) => [agent.id, agent])), [agents.data]);
  const managedById = useMemo(() => new Map((garden.data?.instances ?? []).map((instance) => [instance.id, instance])), [garden.data?.instances]);
  const filtered = useMemo(() => visibleInventory.flatMap((item) => {
    if (item.sourceType !== "WORKSPACE_INSTANCE") return [];
    const agent = agentById.get(item.sourceId);
    return agent ? [{ agent, inventory: item }] : [];
  }), [agentById, visibleInventory]);
  const managed = useMemo(() => visibleInventory.flatMap((item) => {
    if (item.sourceType !== "MANAGED_A2A") return [];
    const instance = managedById.get(item.sourceId);
    return instance ? [{ instance, inventory: item }] : [];
  }), [managedById, visibleInventory]);
  const projectAgents = useMemo(
    () => visibleInventory.filter((item) => isProjectAgentSource(item.sourceType)),
    [visibleInventory],
  );
  const totalInstances = inventory.data?.data.length ?? 0;
  const visibleInstances = visibleInventory.length;
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
      <PageHeader title="Runtime Inventory" description="Monitor every Agent runtime through one model. Product form, collaboration role, execution strategy, and A2A behavior remain separate." actions={canCreateSupervisor ? <Button asChild className="h-11"><Link to="/$projectId/instances" params={{ projectId }} search={{ create: "instance" }}><Plus />Create interactive Agent</Link></Button> : undefined} />

      {search.created ? <CreationNotice onClose={() => void navigate({ to: "/$projectId/instances", params: { projectId }, search: {}, replace: true })} /> : null}
      {search.retainedMemory || retainedMemory ? (
        <p role="status" className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm">
          <span>The Agent is being deleted. Its Memory <strong>{search.retainedMemoryName ?? retainedMemory?.displayName ?? ""}</strong> is retained.</span>
          <Button asChild variant="outline" className="h-11"><Link to="/$projectId/memory/$memoryId" params={{ projectId, memoryId: search.retainedMemory ?? retainedMemory!.id }}>Open retained Memory</Link></Button>
        </p>
      ) : null}

      {inventory.error || agents.error || garden.error ? (
        <p role="alert" className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {(inventory.error ?? agents.error ?? garden.error)?.message}
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
            <Select value={source} onValueChange={(value) => setSource(value as (typeof sourceFilters)[number])}>
              <SelectTrigger size="lg" aria-label="Filter Instances by source" className="w-full sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All sources</SelectItem>
                <SelectItem value="WORKSPACE_INSTANCE">Workspace</SelectItem>
                <SelectItem value="MANAGED_A2A">Agent Garden</SelectItem>
                <SelectItem value="PROJECT_AGENT">Agent Developer</SelectItem>
              </SelectContent>
            </Select>
            <span className="ml-auto hidden text-xs tabular-nums text-muted-foreground sm:block">{visibleInstances} of {totalInstances} Instances</span>
            <ColumnVisibilityMenu
              hiddenColumns={hiddenColumns}
              onReset={() => persistHiddenColumns([])}
              onToggle={(column) => persistHiddenColumns(toggleHiddenInstanceColumn(hiddenColumns, column))}
            />
            <ActionTooltip label={inventory.isFetching || agents.isFetching || garden.isFetching ? "Refreshing Runtime Inventory" : "Refresh Runtime Inventory"}>
              <Button type="button" variant="outline" size="icon" className="size-11" disabled={inventory.isFetching || agents.isFetching || garden.isFetching} aria-label="Refresh Runtime Inventory" onClick={() => void Promise.all([inventory.refetch(), agents.refetch(), garden.refetch()])}>
                {inventory.isFetching || agents.isFetching || garden.isFetching ? <Spinner /> : <RefreshCw className="size-4" />}
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
              {projectAgents.map((item) => <ExpertAgentRuntimeRow key={item.id} inventory={item} hiddenColumns={hiddenColumns} gridStyle={gridStyle} onInspect={() => setSelectedRuntime(item)} />)}
              {managed.map(({ instance, inventory: inventoryItem }) => <ManagedA2aInstanceRow key={instance.id} instance={instance} inventory={inventoryItem} hiddenColumns={hiddenColumns} gridStyle={gridStyle} />)}
              {filtered.map(({ agent, inventory: inventoryItem }) => {
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
                        <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{agent.id.slice(0, 8)} · {productFormLabel(inventoryItem.classification.form)}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground xl:hidden">Created by {agent.createdBy?.displayName ?? "Unknown user"}</span>
                      </span>
                    </span>
                    {!hiddenColumns.includes("source") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block"><strong className="block truncate text-xs font-medium">Workspace · {platform.name}</strong><span className="mt-1 block truncate text-xs text-muted-foreground">{collaborationRoleLabel(inventoryItem.classification.role)} · {a2aRoleLabel(inventoryItem)}</span></span> : null}
                    {!hiddenColumns.includes("runtime") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block"><strong className="block truncate text-xs font-medium">{platform.runtimeName}</strong><span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{agent.sandboxName}</span></span> : null}
                    {!hiddenColumns.includes("version") ? <span className="pointer-events-none relative z-10 hidden min-w-0 xl:block text-xs text-muted-foreground">Not version-pinned</span> : null}
                    {!hiddenColumns.includes("ownedBy") ? <RuntimePerson identity={inventoryItem.ownership.owners[0]} /> : null}
                    {!hiddenColumns.includes("createdBy") ? <RuntimePerson identity={inventoryItem.ownership.createdBy} unavailable="Unknown creator" /> : null}
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
              title="No runtime workloads yet"
              description="Create an interactive Agent or make a Service Agent Version current to add its runtime projection."
              action={canCreateSupervisor ? (
                <Button asChild>
                  <Link
                    to="/$projectId/instances"
                    params={{ projectId }}
                    search={{ create: "instance" }}
                  >
                    <Plus />
                    Create interactive Agent
                  </Link>
                </Button>
              ) : undefined}
            />
          )}
        </CardContent>
      </Card>
      </TooltipProvider>

      <RuntimeInventoryDetail item={selectedRuntime} projectId={projectId} onOpenChange={(open) => { if (!open) setSelectedRuntime(null); }} />

      {permissions.canDeleteAgents && deletingInstance ? <DeleteInstanceSheet open instanceName={deletingInstance.name} retainsMemory={Boolean(deletingInstance.durableMemoryId)} deleting={remove.isPending} onOpenChange={(open) => { if (!open) setDeletingInstance(undefined); }} onConfirm={() => remove.mutate(deletingInstance.id)} {...(remove.error instanceof Error ? { error: remove.error.message } : {})} /> : null}
      {canCreateSupervisor && search.create === "instance" ? (
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
