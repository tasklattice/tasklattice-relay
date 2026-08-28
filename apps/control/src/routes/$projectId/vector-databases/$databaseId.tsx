import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { VectorDocument } from "@tali/contracts";
import { Activity, Database, FileUp, MoreHorizontal, Search, Settings, Trash2 } from "lucide-react";
import { DeleteEntitySheet } from "@/components/shared/delete-entity-sheet";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { DeleteObjectDialog, NewFolderDialog, RenameMoveDialog, UploadFilesSheet, VectorDocumentActionSheet } from "@/features/vector-database-file-browser/vector-database-file-actions";
import { SearchVectorsSheet, VectorDatabaseActivitySheet } from "@/features/vector-database-file-browser/vector-database-auxiliary";
import { descendantFolderIds, type FileBrowserSelection } from "@/features/vector-database-file-browser/file-browser-utils";
import { VectorDatabaseFileBrowser } from "@/features/vector-database-file-browser/vector-database-file-browser";
import { VectorDatabaseProperties } from "@/features/vector-database-file-browser/vector-database-properties";
import { VectorDocumentDetailsPanel } from "@/features/vector-database-file-browser/vector-document-details-panel";
import { useCurrentProjectId } from "@/hooks/use-project";
import { useProjectPermissions } from "@/hooks/use-project-permissions";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";

export const Route = createFileRoute("/$projectId/vector-databases/$databaseId")({
  component: VectorDatabaseDetail,
});

type EditState = { mode: "rename" | "move"; selection: FileBrowserSelection };
type FileActionState = {
  documentId: string;
  view: "preview" | "chunks" | "metadata";
  targetChunkId?: string;
};

function VectorDatabaseDetail() {
  const { databaseId } = Route.useParams();
  const projectId = useCurrentProjectId();
  const permissions = useProjectPermissions();
  const scope = useProjectQueryScope();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selection, setSelection] = useState<FileBrowserSelection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [edit, setEdit] = useState<EditState | null>(null);
  const [editName, setEditName] = useState("");
  const [editParentId, setEditParentId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileBrowserSelection | null>(null);
  const [deleteDatabaseOpen, setDeleteDatabaseOpen] = useState(false);
  const [fileAction, setFileAction] = useState<FileActionState | null>(null);
  const [notice, setNotice] = useState("");

  const overview = useQuery({
    queryKey: scope.key("vector-database", databaseId),
    queryFn: () => api.getVectorDatabase(databaseId),
    refetchInterval: (query) => query.state.data?.stats.processingDocumentCount ? 2_000 : false,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: scope.key("vector-database", databaseId) });
  };
  const database = overview.data?.database;
  const folders = overview.data?.folders ?? [];
  const documents = overview.data?.documents ?? [];
  const currentFolder = currentFolderId ? folders.find((folder) => folder.id === currentFolderId) : undefined;

  useEffect(() => {
    if (currentFolderId && overview.data && !folders.some((folder) => folder.id === currentFolderId)) {
      setCurrentFolderId(null);
      setSelection(null);
    }
  }, [currentFolderId, folders, overview.data]);

  const upload = useMutation({
    mutationFn: async () => {
      const queued = [];
      for (const file of uploadFiles) queued.push(await api.queueVectorDocument(databaseId, file, currentFolderId));
      return queued;
    },
    onSuccess: async (queued) => {
      setUploadOpen(false);
      setUploadFiles([]);
      setNotice(`${queued.length} ${queued.length === 1 ? "file was" : "files were"} queued for parsing and vector indexing.`);
      await refresh();
    },
  });
  const createFolder = useMutation({
    mutationFn: () => api.createVectorFolder(databaseId, { name: newFolderName, parentId: currentFolderId }),
    onSuccess: async (folder) => {
      setNewFolderOpen(false);
      setNewFolderName("");
      setNotice(`Folder “${folder.name}” was created.`);
      await refresh();
    },
  });
  const updateObject = useMutation({
    mutationFn: async () => {
      if (!edit) throw new Error("Select a file or folder to update.");
      if (edit.selection.kind === "folder") {
        return api.updateVectorFolder(databaseId, edit.selection.id, edit.mode === "rename" ? { name: editName } : { parentId: editParentId });
      }
      return api.updateVectorDocument(databaseId, edit.selection.id, edit.mode === "rename" ? { filename: editName } : { folderId: editParentId });
    },
    onSuccess: async () => {
      const mode = edit?.mode;
      setEdit(null);
      setNotice(mode === "rename" ? "The name was updated without re-embedding." : "The item was moved without re-embedding.");
      await refresh();
    },
  });
  const removeObject = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error("Select a file or folder to delete.");
      return deleteTarget.kind === "folder" ? api.deleteVectorFolder(databaseId, deleteTarget.id) : api.deleteVectorDocument(databaseId, deleteTarget.id);
    },
    onSuccess: async () => {
      const target = deleteTarget;
      if (target?.kind === "folder" && currentFolderId === target.id) {
        setCurrentFolderId(folders.find((folder) => folder.id === target.id)?.parentId ?? null);
      }
      setDeleteTarget(null);
      setSelection(null);
      setFileAction(null);
      setNotice(target?.kind === "folder" ? "The folder, nested files, and Vector Records were permanently deleted." : "The file and its Vector Records were permanently deleted.");
      await refresh();
    },
  });
  const removeDatabase = useMutation({
    mutationFn: () => api.deleteResource("vector-databases", databaseId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scope.key("resource-catalog") });
      await navigate({ to: "/$projectId/vector-databases", params: { projectId } });
    },
  });

  const openFileAction = (
    document: VectorDocument,
    view: FileActionState["view"],
    options: Pick<FileActionState, "targetChunkId"> = {},
  ) => {
    setSearchOpen(false);
    setSelection({ kind: "file", id: document.id });
    setFileAction({ documentId: document.id, view, ...options });
  };
  const select = (next: FileBrowserSelection | null) => {
    setSelection(next);
    setFileAction(null);
  };
  const changeFolder = (folderId: string | null) => {
    setCurrentFolderId(folderId);
    setSelection(null);
    setFileAction(null);
  };
  const beginEdit = (mode: EditState["mode"], target: FileBrowserSelection) => {
    const folder = target.kind === "folder" ? folders.find((item) => item.id === target.id) : undefined;
    const document = target.kind === "file" ? documents.find((item) => item.id === target.id) : undefined;
    setEdit({ mode, selection: target });
    setEditName(folder?.name ?? document?.filename ?? "");
    setEditParentId(folder?.parentId ?? document?.folderId ?? null);
    updateObject.reset();
  };
  const objectAction = (action: "rename" | "move" | "edit-metadata" | "delete", target: FileBrowserSelection) => {
    if (action === "edit-metadata" && target.kind === "file") {
      const document = documents.find((item) => item.id === target.id);
      if (document) openFileAction(document, "metadata");
      return;
    }
    if (action === "edit-metadata") return;
    if (action === "delete") {
      removeObject.reset();
      setDeleteTarget(target);
    } else beginEdit(action, target);
  };
  const editFolders = useMemo(() => {
    if (edit?.selection.kind !== "folder") return folders;
    const excluded = descendantFolderIds(folders, edit.selection.id);
    excluded.add(edit.selection.id);
    return folders.filter((folder) => !excluded.has(folder.id));
  }, [edit, folders]);

  if (overview.isPending) return <DetailSkeleton />;
  if (overview.error || !overview.data || !database) {
    return <div className="grid min-h-80 place-items-center rounded-sm border px-6 py-14 text-center"><div><Database className="mx-auto size-7 text-muted-foreground" /><strong className="mt-3 block">Vector Database unavailable</strong><p className="mt-2 text-sm text-destructive">{overview.error?.message ?? "The Vector Database was not found."}</p><Button asChild variant="outline" className="mt-5"><Link to="/$projectId/vector-databases" params={{ projectId }}>Back to Vector Databases</Link></Button></div></div>;
  }

  const deleteFolder = deleteTarget?.kind === "folder" ? folders.find((folder) => folder.id === deleteTarget.id) : undefined;
  const deleteDocument = deleteTarget?.kind === "file" ? documents.find((document) => document.id === deleteTarget.id) : undefined;
  const deleteProcessing = deleteDocument && isProcessing(deleteDocument) ? 1 : deleteFolder?.processingFileCount ?? 0;
  const deleteFailed = deleteDocument?.status === "FAILED" ? 1 : deleteFolder?.failedFileCount ?? 0;
  const selectedDocument = selection?.kind === "file"
    ? documents.find((document) => document.id === selection.id)
    : undefined;
  const actionDocument = fileAction
    ? documents.find((document) => document.id === fileAction.documentId)
    : undefined;
  const selectedTarget: FileBrowserSelection | undefined = selectedDocument
    ? { kind: "file", id: selectedDocument.id }
    : undefined;

  const renderSelectedDocumentDetails = (onClose?: () => void) => selectedDocument && selectedTarget ? (
    <VectorDocumentDetailsPanel
      canManage={permissions.canUpdateVectorDatabases}
      canViewContent={permissions.canViewVectorDatabaseContent}
      databaseId={databaseId}
      document={selectedDocument}
      onDelete={() => { removeObject.reset(); setDeleteTarget(selectedTarget); }}
      onEditMetadata={() => openFileAction(selectedDocument, "metadata")}
      onMove={() => beginEdit("move", selectedTarget)}
      onClose={onClose}
      onOpenPreview={() => openFileAction(selectedDocument, "preview")}
      onRename={() => beginEdit("rename", selectedTarget)}
      onViewChunks={() => openFileAction(selectedDocument, "chunks")}
    />
  ) : null;

  return (
    <div className="min-w-0 space-y-5 pb-10">
      <header className="flex flex-col gap-5 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate font-display text-[1.625rem] font-light leading-tight tracking-[0.005em]">{database.name}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {database.provider === "postgresql" ? "Managed" : "Connected"} vector database · {database.status === "REGISTERED" ? "Ready" : "Unavailable"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11" disabled={!permissions.canViewVectorDatabaseContent} onClick={() => { setFileAction(null); setSelection(null); setSearchOpen(true); }}><Search />Test retrieval</Button>
          {database.provider === "postgresql" ? <Button className="h-11" disabled={!permissions.canUpdateVectorDatabases} onClick={() => { upload.reset(); setUploadFiles([]); setUploadOpen(true); }}><FileUp />Upload files</Button> : null}
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-11" aria-label={`Actions for ${database.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56"><DropdownMenuItem onSelect={() => setSettingsOpen(true)}><Settings />Database settings</DropdownMenuItem><DropdownMenuItem onSelect={() => setActivityOpen(true)}><Activity />View activity</DropdownMenuItem>{permissions.canDeleteVectorDatabases ? <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteDatabaseOpen(true)}><Trash2 />Delete vector database</DropdownMenuItem></> : null}</DropdownMenuContent></DropdownMenu>
        </div>
      </header>
      {notice ? <p role="status" className="border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm">{notice}</p> : null}

      <div className="min-h-[42rem] min-w-0 overflow-hidden rounded-md border bg-card">
        <VectorDatabaseFileBrowser builtIn={database.provider === "postgresql"} canManage={permissions.canUpdateVectorDatabases} currentFolderId={currentFolderId} documents={documents} folders={folders} refreshing={overview.isFetching} selection={selection} onAction={objectAction} onCurrentFolderChange={changeFolder} onNewFolder={() => { createFolder.reset(); setNewFolderName(""); setNewFolderOpen(true); }} onRefresh={() => void refresh()} onSelectionChange={select} onUpload={() => { upload.reset(); setUploadFiles([]); setUploadOpen(true); }} />
      </div>

      <UploadFilesSheet destination={currentFolder?.path ?? "/"} error={errorMessage(upload.error)} files={uploadFiles} open={uploadOpen} pending={upload.isPending} onFiles={setUploadFiles} onOpenChange={setUploadOpen} onUpload={() => upload.mutate()} />
      <NewFolderDialog error={errorMessage(createFolder.error)} name={newFolderName} open={newFolderOpen} pending={createFolder.isPending} onNameChange={setNewFolderName} onOpenChange={setNewFolderOpen} onSubmit={() => createFolder.mutate()} />
      <RenameMoveDialog currentParentId={editParentId} error={errorMessage(updateObject.error)} folders={editFolders} mode={edit?.mode ?? "rename"} name={editName} open={Boolean(edit)} pending={updateObject.isPending} title={editName} onNameChange={setEditName} onOpenChange={(open) => { if (!open) setEdit(null); }} onParentChange={setEditParentId} onSubmit={() => updateObject.mutate()} />
      <DeleteObjectDialog error={errorMessage(removeObject.error)} failedFileCount={deleteFailed} fileCount={deleteFolder?.totalFileCount ?? (deleteDocument ? 1 : 0)} name={deleteFolder?.name ?? deleteDocument?.filename ?? "selected item"} open={Boolean(deleteTarget)} pending={removeObject.isPending} processingFileCount={deleteProcessing} type={deleteTarget?.kind ?? "file"} vectorCount={deleteFolder?.totalVectorCount ?? deleteDocument?.chunkCount ?? 0} onConfirm={() => removeObject.mutate()} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }} />
      <Sheet open={Boolean(selectedDocument) && !fileAction && !searchOpen} onOpenChange={(open) => { if (!open) setSelection(null); }}>
        <SheetContent side="right" showCloseButton={false} className="!w-full gap-0 overflow-hidden p-0 sm:!w-[min(94vw,34rem)] sm:!max-w-[34rem]">
          <SheetHeader className="sr-only"><SheetTitle>File details</SheetTitle><SheetDescription>Selected Vector Database file summary</SheetDescription></SheetHeader>
          {renderSelectedDocumentDetails(() => setSelection(null))}
        </SheetContent>
      </Sheet>
      <VectorDocumentActionSheet canManage={permissions.canUpdateVectorDatabases} databaseId={databaseId} document={actionDocument ?? null} initialView={fileAction?.view ?? "preview"} open={Boolean(fileAction) && !searchOpen} targetChunkId={fileAction?.targetChunkId} onOpenChange={(open) => { if (!open) setFileAction(null); }} onUpdated={() => void refresh()} />
      <SearchVectorsSheet canViewContent={permissions.canViewVectorDatabaseContent} currentFolderId={currentFolderId} currentFolderPath={currentFolder?.path ?? "/"} databaseId={databaseId} metadataSchema={overview.data.metadataSchema} open={searchOpen && !fileAction} onOpenChange={(open) => setSearchOpen(open)} onViewSource={({ chunkId, documentId }) => { const document = documents.find((item) => item.id === documentId); if (document) openFileAction(document, "chunks", { targetChunkId: chunkId }); }} />
      <VectorDatabaseActivitySheet jobs={overview.data.jobs} open={activityOpen} onOpenChange={setActivityOpen} />
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}><SheetContent side="right" className="w-[min(94vw,25rem)] sm:max-w-[25rem]"><SheetHeader className="sr-only"><SheetTitle>Database settings</SheetTitle><SheetDescription>Vector Database provider and index settings</SheetDescription></SheetHeader><VectorDatabaseProperties canManage={permissions.canUpdateVectorDatabases} overview={overview.data} onDelete={() => setDeleteDatabaseOpen(true)} onMove={() => undefined} onOpenFile={() => undefined} onRename={() => undefined} /></SheetContent></Sheet>
      <DeleteEntitySheet open={deleteDatabaseOpen} onOpenChange={setDeleteDatabaseOpen} title="Delete Vector Database" description={<>Permanently delete <strong>{database.name}</strong>.</>} entityName={database.name} confirmLabel="Delete Vector Database" deleting={removeDatabase.isPending} onConfirm={() => removeDatabase.mutate()} {...(errorMessage(removeDatabase.error) ? { error: errorMessage(removeDatabase.error) } : {})} impactDescription={`${overview.data.stats.documentCount} files and ${overview.data.stats.chunkCount} Vector Records will be deleted permanently. ${overview.data.stats.processingDocumentCount} files are processing and ${overview.data.stats.failedDocumentCount} have failed.`} />
    </div>
  );
}

function isProcessing(document: VectorDocument): boolean {
  return document.status === "QUEUED" || document.status === "PARSING" || document.status === "EMBEDDING";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function DetailSkeleton() {
  return <div className="space-y-5"><Skeleton className="h-11 w-48" /><Skeleton className="h-24 w-full" /><Skeleton className="h-[42rem] w-full" /></div>;
}
