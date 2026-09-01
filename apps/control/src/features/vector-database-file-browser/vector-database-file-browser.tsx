import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { VectorDatabaseDefinition, VectorDocument, VectorFolder } from "@tali/contracts";
import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Clock3,
  Database,
  FileText,
  FileUp,
  FlaskConical,
  Folder,
  FolderOpen,
  FolderPlus,
  List,
  LoaderCircle,
  MoreHorizontal,
  Move,
  Pencil,
  RefreshCw,
  Search,
  Tags,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getVectorStoreProvider, VectorStoreProviderIcon } from "@/components/knowledge/vector-store-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPlatformDate } from "@/lib/platform-preferences";
import { cn } from "@/lib/utils";
import {
  childDocuments,
  childFolders,
  folderBreadcrumbs,
  formatBytes,
  type FileBrowserSelection,
} from "./file-browser-utils";
import { VectorFileIcon, VectorIndexStatus } from "./vector-file-visuals";

type ObjectAction = "rename" | "move" | "edit-metadata" | "delete";
type SortOrder = "name-asc" | "name-desc" | "updated";
export type VectorDatabaseWorkspaceView = "files" | "retrieval";

export function VectorDatabaseFileBrowser({
  builtIn,
  canManage,
  currentFolderId,
  databaseId,
  databaseName,
  databaseOptions,
  databaseOptionsError,
  databaseOptionsLoading,
  documents,
  folders,
  refreshing,
  retrievalContent,
  selection,
  view,
  onAction,
  onCurrentFolderChange,
  onDatabaseChange,
  onNewFolder,
  onRefresh,
  onSelectionChange,
  onUpload,
  onViewChange,
}: {
  builtIn: boolean;
  canManage: boolean;
  currentFolderId: string | null;
  databaseId: string;
  databaseName: string;
  databaseOptions: VectorDatabaseDefinition[];
  databaseOptionsError: string | undefined;
  databaseOptionsLoading: boolean;
  documents: VectorDocument[];
  folders: VectorFolder[];
  refreshing: boolean;
  retrievalContent: ReactNode;
  selection: FileBrowserSelection | null;
  view: VectorDatabaseWorkspaceView;
  onAction: (action: ObjectAction, selection: FileBrowserSelection) => void;
  onCurrentFolderChange: (folderId: string | null) => void;
  onDatabaseChange: (databaseId: string) => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onSelectionChange: (selection: FileBrowserSelection | null) => void;
  onUpload: () => void;
  onViewChange: (view: VectorDatabaseWorkspaceView) => void;
}) {
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("updated");
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const breadcrumbs = useMemo(
    () => folderBreadcrumbs(folders, currentFolderId),
    [currentFolderId, folders],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();

  useEffect(() => {
    if (!breadcrumbs.length) return;
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      for (const folder of breadcrumbs) next.add(folder.id);
      return next;
    });
  }, [breadcrumbs]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const visibleFolders = useMemo(() => {
    const results = normalizedQuery
      ? folders.filter((folder) => `${folder.name} ${folder.path}`.toLocaleLowerCase().includes(normalizedQuery))
      : childFolders(folders, currentFolderId);
    return results.toSorted((left, right) => left.name.localeCompare(right.name));
  }, [currentFolderId, folders, normalizedQuery]);

  const visibleDocuments = useMemo(() => {
    const results = normalizedQuery
      ? documents.filter((document) => `${document.filename} ${document.directoryPath}`.toLocaleLowerCase().includes(normalizedQuery))
      : childDocuments(documents, currentFolderId);
    return results.toSorted((left, right) => {
      if (sortOrder === "name-asc") return left.filename.localeCompare(right.filename);
      if (sortOrder === "name-desc") return right.filename.localeCompare(left.filename);
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [currentFolderId, documents, normalizedQuery, sortOrder]);

  const goToFolder = (folderId: string | null) => {
    setQuery("");
    onCurrentFolderChange(folderId);
  };
  const toggleFolder = (folderId: string) => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };
  const contextLabel = normalizedQuery
    ? `Search results for “${query.trim()}”`
    : breadcrumbs.at(-1)?.name ?? databaseName;

  const tree = (
    <FolderTree
      currentFolderId={currentFolderId}
      databaseName={databaseName}
      documentCount={documents.length}
      expandedFolderIds={expandedFolderIds}
      folders={folders}
      onCurrentFolderChange={goToFolder}
      onToggle={toggleFolder}
    />
  );

  const emptyFolderTree = !folders.length && !normalizedQuery ? (
    <div className="mx-2 mt-4 border-t border-knowledge-border px-1 pt-4">
      <p className="text-xs font-medium text-foreground">No folders yet</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Create folders when this knowledge base needs more structure.</p>
      {builtIn && canManage ? (
        <Button variant="ghost" size="sm" className="mt-2 -ml-2 h-11 text-knowledge-accent-foreground" onClick={onNewFolder}>
          <FolderPlus />Create first folder
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <section className="grid min-h-[44rem] min-w-0 grid-cols-[minmax(0,1fr)] bg-card lg:grid-cols-[15.5rem_minmax(0,1fr)]" aria-label="Vector Database workspace">
      <aside className="border-b bg-knowledge-sidebar lg:border-b-0 lg:border-r lg:border-knowledge-border" aria-label="Knowledge folders">
        <header className="border-b border-knowledge-border px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <KnowledgeBaseSwitcher
              currentDatabaseId={databaseId}
              currentDatabaseName={databaseName}
              databases={databaseOptions}
              error={databaseOptionsError}
              loading={databaseOptionsLoading}
              onChange={onDatabaseChange}
            />
            {builtIn ? (
              <Button variant="ghost" size="icon" className="size-11 shrink-0 text-knowledge-accent-foreground hover:bg-knowledge-accent-surface" disabled={!canManage} aria-label="Create folder" onClick={onNewFolder}>
                <FolderPlus />
              </Button>
            ) : null}
          </div>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              aria-label="Search knowledge"
              className="h-11 bg-card pl-9 pr-14"
              placeholder="Search knowledge..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <Button variant="ghost" size="icon" className="absolute right-0 top-0 size-11" aria-label="Clear search" onClick={() => setQuery("")}>
                <X className="size-4" />
              </Button>
            ) : (
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.625rem] text-muted-foreground">⌘K</kbd>
            )}
          </div>
        </header>

        <div className="hidden px-3 py-3 lg:block">
          <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">Folders</div>
          {tree}
          {emptyFolderTree}
        </div>
        <details className="group lg:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
            Browse folders
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="max-h-72 overflow-y-auto border-t border-knowledge-border px-3 py-3">{tree}{emptyFolderTree}</div>
        </details>
      </aside>

      <Tabs value={view} onValueChange={(value) => onViewChange(value as VectorDatabaseWorkspaceView)} className="min-h-0 min-w-0 gap-0 bg-card">
        <header className="border-b bg-card">
          <div className="flex min-h-14 flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <TabsList variant="line" aria-label="Vector Database view" className="h-14 border-b-0">
              <TabsTrigger value="files" className="h-14 px-3"><FileText />Files</TabsTrigger>
              <TabsTrigger value="retrieval" className="h-14 px-3"><FlaskConical />Test retrieval</TabsTrigger>
            </TabsList>
            {view === "files" ? (
              <div className="flex flex-wrap items-center gap-2 pb-3 sm:pb-0">
                {builtIn ? <Button className="h-11" disabled={!canManage} title={!canManage ? "A validated embedding model and update permission are required" : undefined} onClick={onUpload}><FileUp />Upload files</Button> : null}
                {builtIn ? <Button variant="outline" className="h-11" disabled={!canManage} title={!canManage ? "A validated embedding model and update permission are required" : undefined} onClick={onNewFolder}><FolderPlus />New folder</Button> : null}
                <Button variant="ghost" size="icon" className="size-11" aria-label="Refresh files" onClick={onRefresh}>
                  <RefreshCw className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
                </Button>
              </div>
            ) : null}
          </div>
          {view === "files" && (breadcrumbs.length || normalizedQuery) ? (
            <nav aria-label="Current folder" className="flex min-h-11 min-w-0 flex-wrap items-center gap-1 border-t px-4 text-sm sm:px-5">
              <button type="button" className="min-h-11 rounded-md px-2 font-medium hover:bg-muted focus-visible:outline-2" onClick={() => goToFolder(null)}>
                Root
              </button>
              {breadcrumbs.map((folder) => (
                <span className="contents" key={folder.id}>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  <button type="button" className="min-h-11 max-w-48 truncate rounded-md px-2 font-medium hover:bg-muted focus-visible:outline-2" onClick={() => goToFolder(folder.id)}>
                    {folder.name}
                  </button>
                </span>
              ))}
              {normalizedQuery ? <span className="ml-2 truncate text-muted-foreground">{contextLabel}</span> : null}
            </nav>
          ) : null}
        </header>

        <div hidden={view !== "files"} className="min-h-0 flex-1 space-y-8 overflow-y-auto px-4 py-5 sm:px-5 sm:py-6">
          <FolderSection canManage={canManage} folders={visibleFolders} searching={Boolean(normalizedQuery)} onAction={onAction} onOpen={goToFolder} />
          <FileSection builtIn={builtIn} canManage={canManage} documents={visibleDocuments} searching={Boolean(normalizedQuery)} selection={selection} sortOrder={sortOrder} onAction={onAction} onSelectionChange={onSelectionChange} onSortOrderChange={setSortOrder} onUpload={onUpload} />
        </div>
        <div hidden={view !== "retrieval"} className="min-h-0 flex-1 overflow-y-auto">
          {retrievalContent}
        </div>
      </Tabs>
    </section>
  );
}

function KnowledgeBaseSwitcher({ currentDatabaseId, currentDatabaseName, databases, error, loading, onChange }: {
  currentDatabaseId: string;
  currentDatabaseName: string;
  databases: VectorDatabaseDefinition[];
  error: string | undefined;
  loading: boolean;
  onChange: (databaseId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="-ml-2 h-auto min-h-11 min-w-0 flex-1 justify-between gap-2 px-2 py-1.5 text-left hover:bg-knowledge-accent-surface"
          aria-label={`Switch knowledge base. Current: ${currentDatabaseName}`}
        >
          <span className="min-w-0">
            <span className="block text-xs font-medium text-muted-foreground">Knowledge base</span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2">
              <Database className="size-4 shrink-0 text-knowledge-accent-foreground" />
              <span className="truncate text-sm font-semibold" title={currentDatabaseName}>{currentDatabaseName}</span>
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Switch knowledge base</DropdownMenuLabel>
        {loading && databases.length === 0 ? (
          <DropdownMenuItem disabled><LoaderCircle className="animate-spin motion-reduce:animate-none" />Loading databases…</DropdownMenuItem>
        ) : null}
        {error && databases.length === 0 ? (
          <DropdownMenuItem disabled><TriangleAlert />Database list unavailable</DropdownMenuItem>
        ) : null}
        {databases.map((database) => {
          const selected = database.id === currentDatabaseId;
          return (
            <DropdownMenuItem key={database.id} onSelect={() => onChange(database.id)}>
              <VectorStoreProviderIcon provider={database.provider} className="size-8 rounded-md shadow-none [&_img]:size-5 [&_svg]:size-5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{database.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{getVectorStoreProvider(database.provider).label} · {database.status === "REGISTERED" ? "Ready" : "Unavailable"}</span>
              </span>
              {selected ? <Check className="size-4 text-knowledge-accent-foreground" aria-label="Current knowledge base" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FolderTree({ currentFolderId, databaseName, documentCount, expandedFolderIds, folders, onCurrentFolderChange, onToggle }: {
  currentFolderId: string | null;
  databaseName: string;
  documentCount: number;
  expandedFolderIds: Set<string>;
  folders: VectorFolder[];
  onCurrentFolderChange: (folderId: string | null) => void;
  onToggle: (folderId: string) => void;
}) {
  return (
    <nav aria-label="Folder tree" className="space-y-0.5">
      <button
        type="button"
        aria-current={currentFolderId === null ? "page" : undefined}
        className={cn(
          "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2",
          currentFolderId === null && "bg-knowledge-accent-surface text-knowledge-accent-foreground hover:bg-knowledge-accent-surface",
        )}
        onClick={() => onCurrentFolderChange(null)}
      >
        {currentFolderId === null ? <FolderOpen className="size-4 fill-current" /> : <Folder className="size-4" />}
        <span className="min-w-0 flex-1 truncate">{databaseName}</span>
        <Count value={documentCount} />
      </button>
      {childFolders(folders, null).map((folder) => (
        <FolderTreeNode key={folder.id} currentFolderId={currentFolderId} depth={0} expandedFolderIds={expandedFolderIds} folder={folder} folders={folders} onCurrentFolderChange={onCurrentFolderChange} onToggle={onToggle} />
      ))}
    </nav>
  );
}

function FolderTreeNode({ currentFolderId, depth, expandedFolderIds, folder, folders, onCurrentFolderChange, onToggle }: {
  currentFolderId: string | null;
  depth: number;
  expandedFolderIds: Set<string>;
  folder: VectorFolder;
  folders: VectorFolder[];
  onCurrentFolderChange: (folderId: string | null) => void;
  onToggle: (folderId: string) => void;
}) {
  const children = childFolders(folders, folder.id);
  const expanded = expandedFolderIds.has(folder.id);
  const selected = currentFolderId === folder.id;
  return (
    <div>
      <div className={cn(
        "flex min-h-11 items-center rounded-md transition-colors hover:bg-muted",
        selected && "bg-knowledge-accent-surface text-knowledge-accent-foreground hover:bg-knowledge-accent-surface",
      )} style={{ paddingLeft: `${depth * 0.875 + 0.25}rem` }}>
        {children.length ? (
          <button type="button" className="grid size-9 shrink-0 place-items-center rounded-md focus-visible:outline-2" aria-label={`${expanded ? "Collapse" : "Expand"} ${folder.name}`} aria-expanded={expanded} onClick={() => onToggle(folder.id)}>
            <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : <span className="w-9 shrink-0" />}
        <button type="button" aria-current={selected ? "page" : undefined} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 pr-2 text-left text-sm focus-visible:outline-2" onClick={() => onCurrentFolderChange(folder.id)}>
          {expanded ? <FolderOpen className="size-4 shrink-0 fill-current" /> : <Folder className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          <Count value={folder.totalFileCount} />
        </button>
      </div>
      {expanded ? children.map((child) => (
        <FolderTreeNode key={child.id} currentFolderId={currentFolderId} depth={depth + 1} expandedFolderIds={expandedFolderIds} folder={child} folders={folders} onCurrentFolderChange={onCurrentFolderChange} onToggle={onToggle} />
      )) : null}
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <span className="grid min-w-6 shrink-0 place-items-center rounded-full border border-knowledge-border bg-card px-1.5 py-0.5 text-[0.625rem] tabular-nums text-muted-foreground">{value}</span>;
}

function FolderSection({ canManage, folders, searching, onAction, onOpen }: {
  canManage: boolean;
  folders: VectorFolder[];
  searching: boolean;
  onAction: (action: ObjectAction, selection: FileBrowserSelection) => void;
  onOpen: (folderId: string) => void;
}) {
  return (
    <section aria-labelledby="knowledge-folders-title">
      <div>
        <h2 id="knowledge-folders-title" className="text-xl font-semibold tracking-[-0.02em]">Folders</h2>
        <p className="mt-1 text-sm text-muted-foreground">{searching ? `${folders.length} matching folders` : "Organize and access your knowledge"}</p>
      </div>
      {folders.length ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {folders.map((folder) => {
            const selection: FileBrowserSelection = { kind: "folder", id: folder.id };
            return (
              <article key={folder.id} className="group relative overflow-hidden rounded-lg border border-knowledge-border bg-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-knowledge-accent/45 hover:shadow-md motion-reduce:transform-none">
                <button type="button" className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px]" onClick={() => onOpen(folder.id)}>
                  <div className={cn("relative grid h-32 place-items-center overflow-hidden", folderIllustrationClass(folder.id))}>
                    <span className="absolute left-1/2 top-6 h-14 w-20 -translate-x-[58%] rotate-[-5deg] rounded-md border border-white/70 bg-white/85 shadow-sm" />
                    <span className="absolute left-1/2 top-7 h-14 w-20 -translate-x-[37%] rotate-[5deg] rounded-md border border-white/70 bg-white/70 shadow-sm" />
                    <Folder className="relative mt-7 size-24 fill-current stroke-current drop-shadow-md" strokeWidth={1.15} />
                    <span className="absolute right-3 top-3 flex items-center gap-1.5">
                      {folder.processingFileCount ? <LoaderCircle className="size-4 animate-spin text-info motion-reduce:animate-none" aria-label={`${folder.processingFileCount} processing`} /> : null}
                      {folder.failedFileCount ? <TriangleAlert className="size-4 text-destructive" aria-label={`${folder.failedFileCount} failed`} /> : null}
                    </span>
                  </div>
                  <div className="px-4 pb-4 pt-3 pr-14">
                    <h3 className="truncate text-sm font-semibold" title={folder.name}>{folder.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{folder.totalFileCount} {folder.totalFileCount === 1 ? "file" : "files"}</p>
                  </div>
                </button>
                <div className="absolute bottom-2 right-2">
                  <ObjectMenu canManage={canManage} kind="folder" label={`Actions for ${folder.name}`} onAction={(action) => onAction(action, selection)} />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 flex min-h-24 items-center justify-center rounded-lg border border-dashed border-knowledge-border bg-knowledge-sidebar px-5 text-center text-sm text-muted-foreground">
          {searching ? "No folders match this search." : "No folders in this location yet."}
        </div>
      )}
    </section>
  );
}

function FileSection({ builtIn, canManage, documents, searching, selection, sortOrder, onAction, onSelectionChange, onSortOrderChange, onUpload }: {
  builtIn: boolean;
  canManage: boolean;
  documents: VectorDocument[];
  searching: boolean;
  selection: FileBrowserSelection | null;
  sortOrder: SortOrder;
  onAction: (action: ObjectAction, selection: FileBrowserSelection) => void;
  onSelectionChange: (selection: FileBrowserSelection | null) => void;
  onSortOrderChange: (sortOrder: SortOrder) => void;
  onUpload: () => void;
}) {
  return (
    <section aria-labelledby="knowledge-files-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="knowledge-files-title" className="text-xl font-semibold tracking-[-0.02em]">Files</h2>
          <p className="mt-1 text-sm text-muted-foreground">{searching ? `${documents.length} matching files` : `${documents.length} files in this location`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sortOrder} onValueChange={(value) => onSortOrderChange(value as SortOrder)}>
            <SelectTrigger className="h-11 w-[10.5rem] bg-card" aria-label="Sort files">
              {sortOrder === "updated" ? <Clock3 className="size-4" /> : <ArrowDownAZ className="size-4" />}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">Last modified</SelectItem>
              <SelectItem value="name-asc">Name A–Z</SelectItem>
              <SelectItem value="name-desc">Name Z–A</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="size-11" aria-label="List view" aria-pressed="true"><List /></Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-knowledge-border bg-card">
        <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_7rem_3rem] items-center gap-3 border-b border-knowledge-border bg-knowledge-sidebar px-4 text-xs font-medium text-muted-foreground md:grid-cols-[minmax(0,1fr)_8.5rem_5rem_7.5rem_3rem] xl:grid-cols-[minmax(14rem,1fr)_8.5rem_5rem_minmax(9rem,12rem)_7.5rem_3rem]">
          <span>Name</span>
          <span>Index status</span>
          <span className="hidden md:block">Chunks</span>
          <span className="hidden xl:block">Added by</span>
          <span className="hidden md:block">Updated</span>
          <span />
        </div>
        {documents.map((document) => {
          const next: FileBrowserSelection = { kind: "file", id: document.id };
          const selected = selection?.kind === "file" && selection.id === document.id;
          return (
            <div key={document.id} className={cn(
              "grid min-h-16 grid-cols-[minmax(0,1fr)_7rem_3rem] items-center gap-3 border-b border-knowledge-border px-4 transition-colors last:border-b-0 hover:bg-muted/30 md:grid-cols-[minmax(0,1fr)_8.5rem_5rem_7.5rem_3rem] xl:grid-cols-[minmax(14rem,1fr)_8.5rem_5rem_minmax(9rem,12rem)_7.5rem_3rem]",
              selected && "bg-knowledge-accent-surface/70 hover:bg-knowledge-accent-surface/70",
            )}>
              <button type="button" aria-pressed={selected} className="flex min-h-16 min-w-0 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelectionChange(next)}>
                <VectorFileIcon filename={document.filename} mediaType={document.mediaType} />
                <span className="min-w-0">
                  <strong className="block truncate text-sm font-medium" title={document.filename}>{document.filename}</strong>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {searching ? document.directoryPath : formatBytes(document.byteSize)}
                    {!searching && document.uploadedBy ? <span className="xl:hidden"> · Added by {document.uploadedBy}</span> : null}
                  </span>
                </span>
              </button>
              <VectorIndexStatus compact status={document.status} />
              <span className="hidden font-mono text-xs tabular-nums text-muted-foreground md:block">{document.chunkCount}</span>
              <span className="hidden min-w-0 items-center gap-2 xl:flex">
                <Avatar className="size-7 border border-knowledge-border">
                  <AvatarFallback className="bg-knowledge-sidebar text-[0.625rem] font-semibold text-knowledge-accent-foreground">
                    {identityInitials(document.uploadedBy)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-xs text-foreground" title={document.uploadedBy ?? "Unknown uploader"}>{document.uploadedBy ?? "Unknown"}</span>
              </span>
              <span className="hidden text-xs text-muted-foreground md:block">{formatPlatformDate(document.updatedAt)}</span>
              <ObjectMenu canManage={canManage} kind="file" label={`Actions for ${document.filename}`} onAction={(action) => onAction(action, next)} />
            </div>
          );
        })}
        {!documents.length ? (
          <div className="grid min-h-48 place-items-center px-6 py-10 text-center">
            <div>
              {searching ? <Search className="mx-auto size-7 text-muted-foreground" /> : <FileText className="mx-auto size-7 text-muted-foreground" />}
              <strong className="mt-4 block text-sm">{searching ? "No matching files" : "No files in this location"}</strong>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                {searching ? "Try a different file name or folder path." : builtIn ? "Upload source files here to parse and index them." : "Files for this provider are managed outside TaskLattice."}
              </p>
              {!searching && builtIn && canManage ? <Button className="mt-5 h-11" onClick={onUpload}><FileUp />Upload files</Button> : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function identityInitials(identity: string | null): string {
  if (!identity) return "?";
  const parts = identity.trim().split(/[\s@._-]+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : parts[0]!.slice(0, 2)).toLocaleUpperCase();
}

function ObjectMenu({ canManage, kind, label, onAction }: {
  canManage: boolean;
  kind: "file" | "folder";
  label: string;
  onAction: (action: ObjectAction) => void;
}) {
  if (!canManage) return <span />;
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11" aria-label={label} onClick={stop}><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={stop}>
        <DropdownMenuItem onSelect={() => onAction("rename")}><Pencil />Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("move")}><Move />Move</DropdownMenuItem>
        {kind === "file" ? <DropdownMenuItem onSelect={() => onAction("edit-metadata")}><Tags />Edit metadata</DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onAction("delete")}><Trash2 />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function folderIllustrationClass(id: string): string {
  const variants = [
    "bg-knowledge-accent-surface text-knowledge-folder-cyan",
    "bg-info-surface text-knowledge-folder-blue",
    "bg-success-surface text-knowledge-folder-mint",
    "bg-muted text-knowledge-folder-ink",
  ];
  const score = [...id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return variants[score % variants.length]!;
}
