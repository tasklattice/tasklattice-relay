import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { MemoryResourceView, MemoryStatus as MemoryStatusValue } from "@tali/contracts";
import {
  ArrowRight,
  BrainCircuit,
  Download,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { DeleteEntitySheet } from "@/components/shared/delete-entity-sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { EntitySheet } from "@/components/shared/entity-sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useCurrentProjectId } from "@/hooks/use-project";
import { useProjectPermissions } from "@/hooks/use-project-permissions";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";
import {
  CursorPagination,
  errorMessage,
  formatRelativeMemoryDate,
  MemoryErrorState,
  memoryEmptyCopy,
  MemoryLoadingRows,
  MemoryNotice,
  MemoryStatus,
  saveDownloadedFile,
} from "./memory-ui";

const PAGE_SIZE = 20;
type StatusFilter = "all" | Extract<MemoryStatusValue, "ready" | "unbound" | "degraded" | "provisioning" | "deletion_failed">;

export function MemoryListPage() {
  const projectId = useCurrentProjectId();
  const permissions = useProjectPermissions();
  const scope = useProjectQueryScope();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renameTarget, setRenameTarget] = useState<MemoryResourceView | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MemoryResourceView | null>(null);
  const [notice, setNotice] = useState("");

  const memories = useQuery({
    queryKey: scope.key("durable-memories", cursor ?? "first", query, status),
    queryFn: () => api.listMemories({
      ...(cursor ? { cursor } : {}),
      limit: PAGE_SIZE,
      ...(query ? { query } : {}),
      ...(status === "all" ? {} : { statuses: [status] }),
    }),
    enabled: permissions.canViewMemories,
    refetchInterval: (result) => result.state.data?.items.some((memory) =>
      ["provisioning", "degraded", "deleting"].includes(memory.status)
    ) ? 5_000 : false,
  });

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: scope.key("durable-memories") });
  const create = useMutation({
    mutationFn: () => api.createMemory({ displayName: createName }),
    onSuccess: async (memory) => {
      await invalidateList();
      setCreateOpen(false);
      setCreateName("");
      await navigate({
        to: "/$projectId/memory/$memoryId",
        params: { projectId, memoryId: memory.id },
      });
    },
  });
  const rename = useMutation({
    mutationFn: () => {
      if (!renameTarget) throw new Error("Select a Memory to rename.");
      return api.renameMemory(renameTarget.id, renameName);
    },
    onSuccess: async (memory) => {
      setRenameTarget(null);
      setNotice(`“${memory.displayName}” was renamed.`);
      await invalidateList();
    },
  });
  const remove = useMutation({
    mutationFn: () => {
      if (!deleteTarget) throw new Error("Select a Memory to delete.");
      return api.deleteMemory(deleteTarget.id, deleteTarget.displayName);
    },
    onSuccess: async () => {
      const name = deleteTarget?.displayName;
      setDeleteTarget(null);
      setNotice(`“${name}” was verified as deleted.`);
      await invalidateList();
    },
  });
  const exportMemory = useMutation({
    mutationFn: async (memory: MemoryResourceView) => {
      const grant = await api.authorizeMemoryExport(memory.id);
      const file = await api.downloadMemoryExport(grant.downloadUrl, `${memory.displayName}.json`);
      saveDownloadedFile(file.blob, file.fileName);
      return memory;
    },
    onSuccess: (memory) => setNotice(`Export for “${memory.displayName}” was downloaded.`),
  });

  const applyFilters = () => {
    setQuery(queryDraft.trim());
    setCursor(undefined);
    setCursorHistory([]);
  };
  const selectStatus = (next: StatusFilter) => {
    setStatus(next);
    setCursor(undefined);
    setCursorHistory([]);
  };

  if (!permissions.canViewMemories) {
    return (
      <div className="space-y-6">
        <PageHeader title="Memory" description="Durable context that survives Agent replacement." />
        <MemoryNotice tone="warning">Your active Project role does not grant access to Durable Memory resources.</MemoryNotice>
      </div>
    );
  }

  const items = memories.data?.items ?? [];
  const degradedCount = items.filter(({ status: itemStatus }) => itemStatus === "degraded" || itemStatus === "deletion_failed").length;
  const emptyCopy = memoryEmptyCopy(Boolean(query || status !== "all"));

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Memory"
        description="Durable context that survives Agent replacement. Create, curate, and reattach it independently of an Agent Instance."
        actions={permissions.canManageMemories ? (
          <Button className="h-11" onClick={() => {
            create.reset();
            setCreateName("");
            setCreateOpen(true);
          }}>
            <Plus /> Create Memory
          </Button>
        ) : undefined}
      />

      {notice ? <MemoryNotice tone="success">{notice}</MemoryNotice> : null}
      {degradedCount ? (
        <MemoryNotice tone="warning">
          {degradedCount} Memory {degradedCount === 1 ? "resource needs" : "resources need"} attention. Open the resource to inspect recovery actions.
        </MemoryNotice>
      ) : null}

      <form
        className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row"
        onSubmit={(event) => { event.preventDefault(); applyFilters(); }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Search Memory resources"
            className="h-11 pl-9"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="Search Memory by name"
          />
        </div>
        <Select value={status} onValueChange={(value) => selectStatus(value as StatusFilter)}>
          <SelectTrigger aria-label="Filter Memory status" className="h-11 w-full sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="unbound">Unbound</SelectItem>
            <SelectItem value="provisioning">Provisioning</SelectItem>
            <SelectItem value="degraded">Degraded</SelectItem>
            <SelectItem value="deletion_failed">Deletion failed</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline" className="h-11">Search</Button>
      </form>

      {memories.isPending ? (
        <MemoryLoadingRows />
      ) : memories.error ? (
        <MemoryErrorState error={memories.error} onRetry={() => void memories.refetch()} />
      ) : items.length ? (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="hidden grid-cols-[minmax(15rem,1.4fr)_10rem_minmax(13rem,1fr)_10rem_3rem] gap-4 border-b bg-muted/20 px-5 py-3 text-xs text-muted-foreground lg:grid">
              <span>Memory</span><span>Binding</span><span>Content</span><span>Last activity</span><span className="sr-only">Actions</span>
            </div>
            {items.map((memory) => (
              <article key={memory.id} className="grid min-h-28 gap-4 border-b px-5 py-4 last:border-b-0 hover:bg-muted/25 lg:grid-cols-[minmax(15rem,1.4fr)_10rem_minmax(13rem,1fr)_10rem_3rem] lg:items-center">
                <Link
                  to="/$projectId/memory/$memoryId"
                  params={{ projectId, memoryId: memory.id }}
                  className="group flex min-h-11 min-w-0 items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg border bg-muted/30 text-muted-foreground group-hover:text-foreground"><BrainCircuit className="size-5" /></span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm">{memory.displayName}</strong><MemoryStatus status={memory.status} /></span>
                    <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{memory.id}</span>
                  </span>
                </Link>
                <div className="text-xs">
                  <span className="block text-muted-foreground lg:hidden">Binding</span>
                  <strong className="mt-1 block truncate">{memory.activeBinding ? memory.activeBinding.instanceId : "Unbound"}</strong>
                  <span className="mt-1 block capitalize text-muted-foreground">{memory.activeBinding?.runtimeType ?? "Available to attach"}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs tabular-nums">
                  <Count label="Conversations" value={memory.counts?.conversations} />
                  <Count label="Facts" value={memory.counts?.facts} />
                  <Count label="Experiences" value={memory.counts?.experiences} />
                </div>
                <div className="text-xs"><span className="block text-muted-foreground lg:hidden">Last activity</span><span className="mt-1 block">{formatRelativeMemoryDate(memory.lastActivityAt)}</span></div>
                <div className="flex items-center justify-end gap-1">
                  <Button asChild variant="ghost" size="icon" className="size-11 lg:hidden">
                    <Link to="/$projectId/memory/$memoryId" params={{ projectId, memoryId: memory.id }} aria-label={`Open ${memory.displayName}`}><ArrowRight /></Link>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-11" aria-label={`Actions for ${memory.displayName}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem asChild><Link to="/$projectId/memory/$memoryId" params={{ projectId, memoryId: memory.id }}><ArrowRight />Open</Link></DropdownMenuItem>
                      {permissions.canManageMemories ? <DropdownMenuItem onSelect={() => { rename.reset(); setRenameTarget(memory); setRenameName(memory.displayName); }}><Pencil />Rename</DropdownMenuItem> : null}
                      {permissions.canExportMemories ? <DropdownMenuItem disabled={exportMemory.isPending} onSelect={() => exportMemory.mutate(memory)}><Download />Export</DropdownMenuItem> : null}
                      {permissions.canPurgeMemories ? <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { remove.reset(); setDeleteTarget(memory); }}><Trash2 />Delete Memory</DropdownMenuItem></> : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </article>
            ))}
            <CursorPagination
              canPrevious={cursorHistory.length > 0}
              canNext={Boolean(memories.data?.nextCursor)}
              itemCount={items.length}
              totalCount={memories.data?.totalCount ?? items.length}
              onPrevious={() => {
                const history = [...cursorHistory];
                const previous = history.pop();
                setCursorHistory(history);
                setCursor(previous || undefined);
              }}
              onNext={() => {
                if (!memories.data?.nextCursor) return;
                setCursorHistory((history) => [...history, cursor ?? ""]);
                setCursor(memories.data.nextCursor ?? undefined);
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={BrainCircuit}
          title={emptyCopy.title}
          description={emptyCopy.description}
          action={!query && status === "all" && permissions.canManageMemories ? <Button className="h-11" onClick={() => setCreateOpen(true)}><Plus />Create Memory</Button> : undefined}
        />
      )}

      <EntitySheet
        open={createOpen}
        onOpenChange={(open) => { if (!create.isPending) setCreateOpen(open); }}
        eyebrow="Durable Memory"
        title="Create Memory"
        description="Create a Project-level Memory that can be attached to one OpenClaw or Hermes Agent at a time."
        width="md"
        footer={<><Button variant="outline" disabled={create.isPending} onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={!createName.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create Memory"}</Button></>}
      >
        <div className="space-y-2"><Label htmlFor="memory-create-name">Name</Label><Input id="memory-create-name" autoFocus className="h-11" value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="Customer Support Memory" maxLength={120} /></div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">The Memory remains available when its Agent Instance is deleted or replaced.</p>
        {create.error ? <div className="mt-4"><MemoryNotice tone="error">{errorMessage(create.error)}</MemoryNotice></div> : null}
      </EntitySheet>

      <EntitySheet
        open={Boolean(renameTarget)}
        onOpenChange={(open) => { if (!open && !rename.isPending) setRenameTarget(null); }}
        eyebrow="Durable Memory"
        title="Rename Memory"
        description="The provider content and runtime binding are not changed."
        width="md"
        footer={<><Button variant="outline" disabled={rename.isPending} onClick={() => setRenameTarget(null)}>Cancel</Button><Button disabled={!renameName.trim() || rename.isPending} onClick={() => rename.mutate()}>{rename.isPending ? "Saving…" : "Save name"}</Button></>}
      >
        <div className="space-y-2"><Label htmlFor="memory-rename-name">Name</Label><Input id="memory-rename-name" autoFocus className="h-11" value={renameName} onChange={(event) => setRenameName(event.target.value)} maxLength={120} /></div>
        {rename.error ? <div className="mt-4"><MemoryNotice tone="error">{errorMessage(rename.error)}</MemoryNotice></div> : null}
      </EntitySheet>

      {deleteTarget ? (
        <DeleteEntitySheet
          open
          onOpenChange={(open) => { if (!open && !remove.isPending) setDeleteTarget(null); }}
          title="Delete Memory"
          description={<>Permanently delete <strong>{deleteTarget.displayName}</strong> and its retained content.</>}
          entityName={deleteTarget.displayName}
          confirmLabel={deleteTarget.status === "deletion_failed" ? "Retry deletion" : "Delete Memory"}
          deleting={remove.isPending}
          blocked={Boolean(deleteTarget.activeBinding)}
          blockedActionLabel="Open Memory settings"
          blockedAction={() => void navigate({ to: "/$projectId/memory/$memoryId", params: { projectId, memoryId: deleteTarget.id } })}
          impactDescription="The provider-side Memory is deleted and verified absent before Relay reports success. This action cannot be undone."
          onConfirm={() => remove.mutate()}
          {...(errorMessage(remove.error) ? { error: errorMessage(remove.error) } : {})}
        >
          {deleteTarget.activeBinding ? <MemoryNotice tone="warning">Detach this Memory from Agent {deleteTarget.activeBinding.instanceId} before deleting it.</MemoryNotice> : null}
        </DeleteEntitySheet>
      ) : null}
      {exportMemory.error ? <MemoryNotice tone="error">{errorMessage(exportMemory.error)}</MemoryNotice> : null}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number | undefined }) {
  return <span><span className="block truncate text-muted-foreground">{label}</span><strong className="mt-1 block">{value ?? "—"}</strong></span>;
}
