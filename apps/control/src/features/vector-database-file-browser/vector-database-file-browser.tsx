import { useMemo, type KeyboardEvent, type MouseEvent } from "react";
import type { VectorDocument, VectorFolder } from "@tali/contracts";
import {
  ChevronRight,
  FileText,
  FileUp,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Move,
  Pencil,
  RefreshCw,
  Tags,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  childDocuments,
  childFolders,
  folderBreadcrumbs,
  formatBytes,
  type FileBrowserSelection,
} from "./file-browser-utils";

type ObjectAction = "rename" | "move" | "edit-metadata" | "delete";

export function VectorDatabaseFileBrowser({
  builtIn,
  canManage,
  currentFolderId,
  documents,
  folders,
  refreshing,
  selection,
  onAction,
  onCurrentFolderChange,
  onNewFolder,
  onRefresh,
  onSelectionChange,
  onUpload,
}: {
  builtIn: boolean;
  canManage: boolean;
  currentFolderId: string | null;
  documents: VectorDocument[];
  folders: VectorFolder[];
  refreshing: boolean;
  selection: FileBrowserSelection | null;
  onAction: (action: ObjectAction, selection: FileBrowserSelection) => void;
  onCurrentFolderChange: (folderId: string | null) => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onSelectionChange: (selection: FileBrowserSelection | null) => void;
  onUpload: () => void;
}) {
  const breadcrumbs = folderBreadcrumbs(folders, currentFolderId);
  const rows = useMemo(() => {
    const folderRows = childFolders(folders, currentFolderId).map((folder) => ({
      kind: "folder" as const,
      folder,
      name: folder.name,
    }));
    const fileRows = childDocuments(documents, currentFolderId).map((document) => ({
      kind: "file" as const,
      document,
      name: document.filename,
    }));
    const sorter = (
      left: (typeof folderRows)[number] | (typeof fileRows)[number],
      right: (typeof folderRows)[number] | (typeof fileRows)[number],
    ) => left.name.localeCompare(right.name);
    return [...folderRows.toSorted(sorter), ...fileRows.toSorted(sorter)];
  }, [currentFolderId, documents, folders]);

  const open = (next: FileBrowserSelection) => {
    if (next.kind === "folder") onCurrentFolderChange(next.id);
    else onSelectionChange(next);
  };
  const activate = (event: KeyboardEvent<HTMLDivElement>, next: FileBrowserSelection) => {
    if (event.key === "Enter") {
      event.preventDefault();
      open(next);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onSelectionChange(null);
      event.currentTarget.blur();
    }
  };

  return (
    <section className="flex min-h-[36rem] min-w-0 flex-col bg-background" aria-label="Vector Database files">
      <header className="flex flex-col gap-3 border-b px-4 py-3 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
        <nav aria-label="Current folder" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            className="min-h-11 rounded-sm px-2 font-medium hover:bg-muted focus-visible:outline-2"
            onClick={() => onCurrentFolderChange(null)}
          >
            Files
          </button>
          {breadcrumbs.map((folder) => (
            <span className="contents" key={folder.id}>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="min-h-11 max-w-48 truncate rounded-sm px-2 font-medium hover:bg-muted focus-visible:outline-2"
                onClick={() => onCurrentFolderChange(folder.id)}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {builtIn ? <Button variant="outline" className="h-11" disabled={!canManage} onClick={onNewFolder}><FolderPlus /> New folder</Button> : null}
          <Button variant="ghost" size="icon" className="size-11" aria-label="Refresh files" onClick={onRefresh}>
            <RefreshCw className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
          </Button>
        </div>
      </header>

      <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_6.5rem_3rem] items-center gap-3 border-b px-4 text-sm font-semibold sm:px-5 md:grid-cols-[minmax(0,1fr)_7rem_5rem_6rem_3rem]">
        <span>Name</span>
        <span>Status</span>
        <span className="hidden md:block">Chunks</span>
        <span className="hidden md:block">Size</span>
        <span />
      </div>

      <div
        className="min-h-0 flex-1"
        onClick={(event) => {
          if (event.currentTarget === event.target) onSelectionChange(null);
        }}
      >
        {rows.map((row) => {
          const next: FileBrowserSelection = row.kind === "folder"
            ? { kind: "folder", id: row.folder.id }
            : { kind: "file", id: row.document.id };
          const selected = selection?.kind === next.kind && selection.id === next.id;
          return (
            <div
              key={`${row.kind}:${next.id}`}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              className={cn(
                "group grid min-h-[4.5rem] cursor-pointer grid-cols-[minmax(0,1fr)_6.5rem_3rem] items-center gap-3 border-b px-4 text-left outline-none hover:bg-muted/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 md:grid-cols-[minmax(0,1fr)_7rem_5rem_6rem_3rem]",
                selected && "bg-sky-500/10 hover:bg-sky-500/10",
              )}
              onClick={() => open(next)}
              onKeyDown={(event) => activate(event, next)}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-sm text-muted-foreground",
                  "bg-muted",
                )}>
                  {row.kind === "folder" ? <Folder className="size-4" /> : <FileText className="size-4" />}
                </span>
                <strong className="min-w-0 break-words text-base font-medium leading-6">{row.name}</strong>
              </span>
              <span className="text-xs">
                {row.kind === "folder"
                  ? <span className="text-muted-foreground">—</span>
                  : <Badge variant="outline" className={statusClassName(row.document.status)}>{statusLabel(row.document.status)}</Badge>}
              </span>
              <span className="hidden font-mono text-xs md:block">
                {row.kind === "folder" ? row.folder.totalVectorCount : row.document.chunkCount}
              </span>
              <span className="hidden text-sm md:block">
                {row.kind === "folder" ? "—" : formatBytes(row.document.byteSize)}
              </span>
              <ObjectMenu
                canManage={canManage}
                kind={row.kind}
                label={`Actions for ${row.name}`}
                onAction={(action) => onAction(action, next)}
              />
            </div>
          );
        })}
        {!rows.length ? (
          <div className="grid min-h-72 place-items-center px-6 py-12 text-center">
            <div>
              <Folder className="mx-auto size-7 text-muted-foreground" />
              <strong className="mt-4 block text-sm">This folder is empty</strong>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                {builtIn
                  ? "Upload source files here or create a folder to organize them."
                  : "Files for this provider are managed outside TaskLattice."}
              </p>
              {builtIn && canManage ? <Button className="mt-5 h-11" onClick={(event) => { event.stopPropagation(); onUpload(); }}><FileUp />Upload files</Button> : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
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
        <Button variant="ghost" size="icon" className="size-11" aria-label={label} onClick={stop}>
          <MoreHorizontal />
        </Button>
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

function statusLabel(status: VectorDocument["status"]): string {
  if (status === "READY") return "Indexed";
  if (status === "FAILED") return "Failed";
  if (status === "QUEUED") return "Uploading";
  return "Processing";
}

function statusClassName(status: VectorDocument["status"]): string {
  if (status === "READY") return "border-transparent bg-sky-500/10 text-sky-700 dark:text-sky-300";
  if (status === "FAILED") return "border-transparent bg-destructive/10 text-destructive";
  return "border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-300";
}
