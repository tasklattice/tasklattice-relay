import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  VectorCustomMetadata,
  VectorDocument,
  VectorFolder,
  VectorMetadataType,
} from "@tali/contracts";
import {
  AlertTriangle,
  ChevronDown,
  FileText,
  FileUp,
  Folder,
  LoaderCircle,
  Move,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";
import { filePath, formatBytes } from "./file-browser-utils";

export function NewFolderDialog({ error, name, open, pending, onNameChange, onOpenChange, onSubmit }: {
  error: string;
  name: string;
  open: boolean;
  pending: boolean;
  onNameChange: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>Create a logical TaskLattice folder in the current Vector Database directory.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-6 py-5">
          <Label htmlFor="new-vector-folder-name">Folder name</Label>
          <Input id="new-vector-folder-name" className="h-11" autoFocus value={name} onChange={(event) => onNameChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) onSubmit(); }} />
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim() || pending} onClick={onSubmit}>{pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Folder />}Create folder</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenameMoveDialog({
  currentParentId,
  error,
  folders,
  mode,
  name,
  open,
  pending,
  title,
  onNameChange,
  onOpenChange,
  onParentChange,
  onSubmit,
}: {
  currentParentId: string | null;
  error: string;
  folders: VectorFolder[];
  mode: "rename" | "move";
  name: string;
  open: boolean;
  pending: boolean;
  title: string;
  onNameChange: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onParentChange: (folderId: string | null) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "rename" ? "Rename" : "Move"} “{title}”</DialogTitle>
          <DialogDescription>
            {mode === "rename"
              ? "Renaming changes TaskLattice metadata only. Existing vector embeddings stay intact."
              : "Moving changes folder metadata and file paths without generating new embeddings."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          {mode === "rename" ? (
            <div className="space-y-2">
              <Label htmlFor="vector-object-name">Name</Label>
              <Input id="vector-object-name" className="h-11" autoFocus value={name} onChange={(event) => onNameChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) onSubmit(); }} />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Destination folder</Label>
              <Select value={currentParentId ?? "root"} onValueChange={(value) => onParentChange(value === "root" ? null : value)}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Files (root)</SelectItem>
                  {folders.map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.path}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={pending || (mode === "rename" && !name.trim())} onClick={onSubmit}>
            {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : mode === "rename" ? <Pencil /> : <Move />}
            {mode === "rename" ? "Rename" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteObjectDialog({
  error,
  failedFileCount,
  fileCount,
  name,
  open,
  pending,
  processingFileCount,
  type,
  vectorCount,
  onConfirm,
  onOpenChange,
}: {
  error: string;
  failedFileCount: number;
  fileCount: number;
  name: string;
  open: boolean;
  pending: boolean;
  processingFileCount: number;
  type: "file" | "folder";
  vectorCount: number;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-sm bg-destructive/10 text-destructive"><AlertTriangle className="size-4" /></span>Delete “{name}”?</DialogTitle>
          <DialogDescription>This permanently deletes data. TaskLattice does not provide a recycle bin for Vector Database files.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <p className="text-sm leading-6">
            {type === "folder"
              ? `This folder contains ${fileCount} ${fileCount === 1 ? "file" : "files"} and ${vectorCount} Vector Records.`
              : `This will delete the file and its ${vectorCount} Vector Records.`}
          </p>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border bg-border text-sm">
            <Impact label="Files" value={fileCount} />
            <Impact label="Vector Records" value={vectorCount} />
            <Impact label="Processing" value={processingFileCount} warning={processingFileCount > 0} />
            <Impact label="Failed" value={failedFileCount} warning={failedFileCount > 0} />
          </dl>
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>{pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Trash2 />}Delete {type}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UploadFilesSheet({
  destination,
  error,
  files,
  open,
  pending,
  onFiles,
  onOpenChange,
  onUpload,
}: {
  destination: string;
  error: string;
  files: File[];
  open: boolean;
  pending: boolean;
  onFiles: (files: File[]) => void;
  onOpenChange: (open: boolean) => void;
  onUpload: () => void;
}) {
  const [inputKey, setInputKey] = useState(0);
  useEffect(() => { if (!open) setInputKey((value) => value + 1); }, [open]);
  return (
    <Sheet open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <SheetContent side="right" className="w-[min(94vw,38rem)] sm:max-w-[38rem]">
        <SheetHeader className="border-b px-5 py-5">
          <SheetTitle>Upload files</SheetTitle>
          <SheetDescription>Destination: <span className="font-mono text-foreground">{destination}</span>. Files are queued for parsing and indexing.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed text-center hover:bg-muted/20 focus-within:ring-2 focus-within:ring-ring">
            <FileUp className="size-7 text-primary" />
            <strong className="mt-3 text-sm">Choose files</strong>
            <span className="mt-1 text-xs text-muted-foreground">PDF, Office, HTML, Markdown, text, or images · 25 MiB each</span>
            <input key={inputKey} className="sr-only" type="file" multiple accept=".pdf,.docx,.pptx,.xlsx,.html,.htm,.md,.txt,.png,.jpg,.jpeg,.tif,.tiff" onChange={(event) => onFiles([...event.target.files ?? []])} />
          </label>
          {files.length ? (
            <div className="divide-y rounded-sm border">
              {files.map((file, index) => (
                <div key={`${file.name}:${index}`} className="flex min-h-14 items-center gap-3 px-4 py-3">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{file.name}</strong><span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span></span>
                </div>
              ))}
            </div>
          ) : null}
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        </div>
        <SheetFooter className="border-t px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!files.length || pending} onClick={onUpload}>{pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <FileUp />}{pending ? `Uploading ${files.length}…` : `Upload ${files.length || ""}`}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

type FileDetailView = "preview" | "chunks" | "metadata";
type MetadataDraftRow = {
  id: string;
  key: string;
  type: VectorMetadataType;
  value: string | boolean;
};

export function VectorDocumentActionSheet({
  canManage,
  databaseId,
  document,
  initialView,
  open,
  targetChunkId,
  onOpenChange,
  onUpdated,
}: {
  canManage: boolean;
  databaseId: string;
  document: VectorDocument | null;
  initialView: FileDetailView;
  open: boolean;
  targetChunkId: string | undefined;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const scope = useProjectQueryScope();
  const queryClient = useQueryClient();
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set());
  const [metadataRows, setMetadataRows] = useState<MetadataDraftRow[]>([]);
  const detail = useQuery({
    queryKey: scope.key("vector-document", databaseId, document?.id ?? ""),
    queryFn: () => api.getVectorDocument(databaseId, document!.id),
    enabled: open && Boolean(document),
  });
  const chunks = useQuery({
    queryKey: scope.key("vector-document-chunks", databaseId, document?.id ?? ""),
    queryFn: () => api.getVectorDocumentChunks(databaseId, document!.id),
    enabled: open && Boolean(document) && initialView !== "metadata",
  });
  const fullText = useMemo(
    () => chunks.data?.chunks.map((chunk) => chunk.content).join("\n\n") ?? "",
    [chunks.data],
  );
  const parsedMetadata = metadataFromRows(metadataRows);
  const saveMetadata = useMutation({
    mutationFn: () => {
      if (!document || !parsedMetadata.data) throw new Error(parsedMetadata.error || "Review the metadata fields.");
      return api.updateVectorDocument(databaseId, document.id, { customMetadata: parsedMetadata.data });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scope.key("vector-document", databaseId, document?.id ?? "") });
      onUpdated();
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    setExpandedChunks(targetChunkId ? new Set([targetChunkId]) : new Set());
    saveMetadata.reset();
  }, [open, targetChunkId]);

  useEffect(() => {
    if (!detail.data) return;
    setMetadataRows(metadataRowsFrom(detail.data.customMetadata));
  }, [detail.data]);

  useEffect(() => {
    if (!open || initialView !== "chunks" || !targetChunkId || !chunks.data) return;
    const frame = window.requestAnimationFrame(() => {
      window.document.getElementById(chunkElementId(targetChunkId))?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chunks.data, initialView, open, targetChunkId]);

  const updateMetadataRow = (id: string, patch: Partial<MetadataDraftRow>) => {
    setMetadataRows((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
    saveMetadata.reset();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !saveMetadata.isPending && onOpenChange(next)}>
      <SheetContent side="right" className="!w-full gap-0 overflow-hidden bg-background sm:!w-[min(96vw,52rem)] sm:!max-w-[52rem] [&>button]:size-11">
        <SheetHeader className="shrink-0 border-b px-5 py-5 pr-14 sm:px-6 sm:pr-14">
          <SheetTitle>{detailViewTitle(initialView, document)}</SheetTitle>
          <SheetDescription>{document ? `${filePath(document)} · ${document.chunkCount} chunks · ${formatBytes(document.byteSize)}` : "Indexed file content"}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-6 sm:px-6">
          {detail.isPending || (initialView !== "metadata" && chunks.isPending) ? <div className="space-y-3"><Skeleton className="h-5 w-36" /><Skeleton className="h-40 w-full" /><Skeleton className="h-24 w-full" /></div> : null}
          {detail.error ? <ErrorMessage>{detail.error.message}</ErrorMessage> : null}
          {chunks.error ? <ErrorMessage>{chunks.error.message}</ErrorMessage> : null}
          {detail.data && chunks.data && initialView === "preview" ? (
            <section>
              <h3 className="text-sm font-semibold">Indexed text</h3>
              <p className="mt-1 text-xs text-muted-foreground">Combined text from the active Vector Records.</p>
              {chunks.data.truncated ? <p className="mt-4 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">This preview contains the first {chunks.data.chunks.length} of {chunks.data.total} chunks.</p> : null}
              <p className="mt-5 whitespace-pre-wrap text-sm leading-7">{fullText || "No indexed text is available."}</p>
            </section>
          ) : null}
          {detail.data && chunks.data && initialView === "chunks" ? (
            <section>
              <div className="flex items-end justify-between gap-3 border-b pb-3"><div><h3 className="text-sm font-semibold">Vector Records</h3><p className="mt-1 text-xs text-muted-foreground">Expand a chunk to inspect its full indexed text.</p></div><span className="text-xs text-muted-foreground">{chunks.data.total} records</span></div>
              {chunks.data.truncated ? <p className="border-b bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">Showing the first {chunks.data.chunks.length} records.</p> : null}
              <div className="divide-y">
                {chunks.data.chunks.map((chunk) => {
                  const expanded = expandedChunks.has(chunk.id);
                  return (
                    <Collapsible key={chunk.id} open={expanded} onOpenChange={(next) => setExpandedChunks((current) => { const copy = new Set(current); if (next) copy.add(chunk.id); else copy.delete(chunk.id); return copy; })}>
                      <article id={chunkElementId(chunk.id)} className={targetChunkId === chunk.id ? "bg-primary/5" : undefined}>
                        <CollapsibleTrigger asChild>
                          <button type="button" className="flex min-h-20 w-full items-start gap-3 px-3 py-4 text-left outline-none hover:bg-muted/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                            <ChevronDown className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs">Chunk {chunk.chunkIndex + 1}</strong><span className="text-xs text-muted-foreground">{chunk.pageNumber ? `Page ${chunk.pageNumber}` : "No page"} · {chunk.tokenCount} tokens</span></span><span className="mt-2 line-clamp-2 block text-xs leading-5 text-muted-foreground">{chunk.content || "No text"}</span></span>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent><div className="border-t bg-muted/15 px-10 py-4"><p className="whitespace-pre-wrap text-sm leading-6">{chunk.content}</p><p className="mt-3 break-all font-mono text-[11px] text-muted-foreground">{chunk.id}</p></div></CollapsibleContent>
                      </article>
                    </Collapsible>
                  );
                })}
                {!chunks.data.chunks.length ? <p className="py-12 text-center text-sm text-muted-foreground">No chunks have been indexed.</p> : null}
              </div>
            </section>
          ) : null}
          {detail.data && initialView === "metadata" ? (
            <section>
              <h3 className="text-sm font-semibold">Custom metadata</h3>
              <p className="mt-1 text-xs text-muted-foreground">Typed file-level fields are propagated to every Vector Record without re-embedding.</p>
              {canManage ? (
                <div className="mt-5 space-y-4">
                  <div className="space-y-3">{metadataRows.map((row, index) => <MetadataEditorRow key={row.id} index={index} row={row} onChange={(patch) => updateMetadataRow(row.id, patch)} onRemove={() => setMetadataRows((rows) => rows.filter((item) => item.id !== row.id))} />)}</div>
                  <Button variant="outline" size="sm" onClick={() => setMetadataRows((rows) => [...rows, { id: `new-${Date.now()}-${rows.length}`, key: "", type: "string", value: "" }])} disabled={metadataRows.length >= 32}><Plus />Add field</Button>
                  {parsedMetadata.error ? <ErrorMessage>{parsedMetadata.error}</ErrorMessage> : null}
                  {saveMetadata.error ? <ErrorMessage>{saveMetadata.error.message}</ErrorMessage> : null}
                  <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end"><Button variant="outline" className="h-11" disabled={saveMetadata.isPending} onClick={() => onOpenChange(false)}>Cancel</Button><Button className="h-11" disabled={Boolean(parsedMetadata.error) || saveMetadata.isPending} onClick={() => saveMetadata.mutate()}>{saveMetadata.isPending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Save />}{saveMetadata.isPending ? "Saving…" : "Save metadata"}</Button></div>
                </div>
              ) : Object.keys(detail.data.customMetadata).length ? <MetadataList className="mt-5" items={Object.entries(detail.data.customMetadata).map(([key, metadata]) => [key, metadataDisplayValue(metadata)])} /> : <p className="mt-5 text-sm text-muted-foreground">No custom metadata has been added.</p>}
            </section>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function detailViewTitle(view: FileDetailView, document: VectorDocument | null): string {
  if (view === "preview") return "Indexed text preview";
  if (view === "chunks") return `Chunks${document ? ` · ${document.filename}` : ""}`;
  return "Edit custom metadata";
}

function MetadataList({ className, items }: { className?: string; items: Array<[string, string]> }) {
  return <dl className={`divide-y border-y text-sm ${className ?? ""}`}>{items.map(([label, value]) => <div key={label} className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words font-medium">{value}</dd></div>)}</dl>;
}

function MetadataEditorRow({ index, row, onChange, onRemove }: { index: number; row: MetadataDraftRow; onChange: (patch: Partial<MetadataDraftRow>) => void; onRemove: () => void }) {
  const valueId = `vector-metadata-value-${row.id}`;
  return <div className="grid gap-3 rounded-sm border p-3 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_2.75rem] sm:items-end"><div className="space-y-2"><Label htmlFor={`vector-metadata-key-${row.id}`}>Key</Label><Input id={`vector-metadata-key-${row.id}`} className="h-11 font-mono text-xs" value={row.key} onChange={(event) => onChange({ key: event.target.value.toLowerCase().replace(/\s+/g, "_") })} placeholder="department" /></div><div className="space-y-2"><Label>Type</Label><Select value={row.type} onValueChange={(type) => onChange({ type: type as VectorMetadataType, value: type === "boolean" ? false : "" })}><SelectTrigger className="h-11 w-full" aria-label={`Metadata field ${index + 1} type`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="string">String</SelectItem><SelectItem value="number">Number</SelectItem><SelectItem value="boolean">Boolean</SelectItem><SelectItem value="date">Date</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor={valueId}>Value</Label>{row.type === "boolean" ? <div className="flex h-11 items-center justify-between rounded-md border px-3"><span className="text-sm">{row.value ? "True" : "False"}</span><Switch id={valueId} checked={row.value === true} onCheckedChange={(checked) => onChange({ value: checked })} aria-label={`Metadata field ${index + 1} boolean value`} /></div> : <Input id={valueId} className="h-11" type={row.type === "number" ? "number" : row.type === "date" ? "date" : "text"} value={String(row.value)} onChange={(event) => onChange({ value: event.target.value })} />}</div><Button variant="ghost" size="icon" className="size-11 text-muted-foreground hover:text-destructive" aria-label={`Remove metadata field ${index + 1}`} onClick={onRemove}><X /></Button></div>;
}

function metadataRowsFrom(metadata: VectorCustomMetadata): MetadataDraftRow[] {
  return Object.entries(metadata).map(([key, item], index) => ({ id: `${key}-${index}`, key, type: item.type, value: item.type === "boolean" ? item.value : String(item.value) }));
}

function metadataFromRows(rows: MetadataDraftRow[]): { data?: VectorCustomMetadata; error?: string } {
  const metadata: VectorCustomMetadata = {};
  for (const [index, row] of rows.entries()) {
    const key = row.key.trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) return { error: `Field ${index + 1}: use lowercase letters, numbers, and underscores; start with a letter.` };
    if (metadata[key]) return { error: `Metadata key “${key}” is duplicated.` };
    if (row.type === "number") {
      const value = Number(row.value);
      if (row.value === "" || !Number.isFinite(value)) return { error: `Metadata field “${key}” needs a valid number.` };
      metadata[key] = { type: "number", value };
    } else if (row.type === "boolean") metadata[key] = { type: "boolean", value: row.value === true };
    else if (row.type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.value))) return { error: `Metadata field “${key}” needs a valid date.` };
      metadata[key] = { type: "date", value: String(row.value) };
    } else metadata[key] = { type: "string", value: String(row.value) };
  }
  return { data: metadata };
}

function metadataDisplayValue(metadata: VectorCustomMetadata[string]): string {
  if (metadata.type === "boolean") return metadata.value ? "True" : "False";
  return String(metadata.value);
}

function chunkElementId(chunkId: string): string {
  return `vector-chunk-${chunkId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function Impact({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div className="bg-background p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className={warning ? "mt-1 font-semibold text-destructive" : "mt-1 font-semibold"}>{value}</dd></div>;
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">{children}</p>;
}
