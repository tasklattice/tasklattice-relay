import { useQuery } from "@tanstack/react-query";
import type { VectorCustomMetadata, VectorDocument } from "@tali/contracts";
import {
  FileText,
  MoreHorizontal,
  Move,
  Pencil,
  Plus,
  Rows3,
  Trash2,
  X,
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
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectQueryScope } from "@/hooks/use-project-query-scope";
import { api } from "@/lib/api";
import { filePath, formatBytes } from "./file-browser-utils";

const PREVIEW_LENGTH = 360;

export function VectorDocumentDetailsPanel({
  canManage,
  canViewContent,
  databaseId,
  document,
  onDelete,
  onEditMetadata,
  onMove,
  onClose,
  onOpenPreview,
  onRename,
  onViewChunks,
}: {
  canManage: boolean;
  canViewContent: boolean;
  databaseId: string;
  document: VectorDocument;
  onDelete: () => void;
  onEditMetadata: () => void;
  onMove: () => void;
  onClose?: (() => void) | undefined;
  onOpenPreview: () => void;
  onRename: () => void;
  onViewChunks: () => void;
}) {
  const scope = useProjectQueryScope();
  const ready = document.status === "READY";
  const detail = useQuery({
    queryKey: scope.key("vector-document", databaseId, document.id),
    queryFn: () => api.getVectorDocument(databaseId, document.id),
    enabled: ready && canViewContent,
  });
  const indexedText = detail.data?.previewText.trim() ?? "";
  const preview = indexedText.length > PREVIEW_LENGTH || detail.data?.previewTruncated
    ? `${indexedText.slice(0, PREVIEW_LENGTH).trimEnd()}…`
    : indexedText;
  const metadata = Object.entries(document.customMetadata);

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      <header className="shrink-0 border-b px-6 py-7">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-xl font-semibold leading-7 tracking-tight">{document.filename}</h2>
            <p className="mt-1.5 truncate text-sm text-muted-foreground" title={filePath(document)}>
              {document.directoryPath}
            </p>
          </div>
          <div className="-mr-2 flex shrink-0 items-center">
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-11" aria-label={`Actions for ${document.filename}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onRename}><Pencil />Rename</DropdownMenuItem>
                  <DropdownMenuItem onSelect={onMove}><Move />Move</DropdownMenuItem>
                  <DropdownMenuItem onSelect={onEditMetadata}><Pencil />Edit metadata</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}><Trash2 />Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {onClose ? <Button variant="ghost" size="icon" className="size-11" aria-label="Close file details" onClick={onClose}><X /></Button> : null}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        <section className="border-b px-6 py-5" aria-label="File indexing summary">
          <div className="flex flex-wrap items-center gap-2.5 text-sm">
            <StatusBadge status={document.status} />
            <span aria-hidden="true" className="text-muted-foreground/60">·</span>
            <span>{document.chunkCount} chunks</span>
            <span aria-hidden="true" className="text-muted-foreground/60">·</span>
            <span>{formatBytes(document.byteSize)}</span>
          </div>
        </section>

        <section className="border-b px-6 py-7" aria-labelledby="indexed-text-preview-title">
          <div className="flex items-start justify-between gap-4">
            <h3 id="indexed-text-preview-title" className="text-lg font-semibold leading-6">Indexed text preview</h3>
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 shrink-0 text-muted-foreground hover:text-foreground"
              disabled={!ready || !canViewContent || !indexedText}
              onClick={onOpenPreview}
            >
              Open preview
            </Button>
          </div>
          <div className="mt-4">
            {ready && canViewContent && detail.isPending ? <PreviewSkeleton /> : null}
            {detail.error ? <PanelMessage tone="danger">{detail.error.message}</PanelMessage> : null}
            {!canViewContent ? <PanelMessage>Content preview is unavailable for your Project role.</PanelMessage> : null}
            {canViewContent && !ready ? <PanelMessage>{previewUnavailableMessage(document)}</PanelMessage> : null}
            {canViewContent && ready && detail.data && !preview ? <PanelMessage>No indexed text is available.</PanelMessage> : null}
            {preview ? <p className="whitespace-pre-wrap text-[15px] leading-7 text-muted-foreground">{preview}</p> : null}
          </div>
        </section>

        <section className="border-b px-6 py-7" aria-labelledby="file-properties-title">
          <h3 id="file-properties-title" className="text-lg font-semibold">File properties</h3>
          <dl className="mt-5 space-y-4 text-sm">
            <Property label="Type" value={mediaTypeLabel(document)} />
            <Property label="Status" value={statusLabel(document.status)} />
            <Property label="Chunks" value={String(document.chunkCount)} />
            <Property label="Size" value={formatBytes(document.byteSize)} />
          </dl>
          <Button
            variant="outline"
            className="mt-6 h-11"
            disabled={!ready || !canViewContent || document.chunkCount === 0}
            onClick={onViewChunks}
          >
            <Rows3 />View chunks
          </Button>
        </section>

        <section className="px-6 py-7" aria-labelledby="custom-metadata-title">
          <div className="flex items-start justify-between gap-4">
            <h3 id="custom-metadata-title" className="text-lg font-semibold">Custom metadata</h3>
            {canManage ? (
              <Button variant="ghost" size="sm" className="-mr-2 text-muted-foreground hover:text-foreground" onClick={onEditMetadata}>
                <Pencil />Edit
              </Button>
            ) : null}
          </div>
          {metadata.length ? (
            <dl className="mt-5 divide-y border-y text-sm">
              {metadata.map(([key, value]) => (
                <div key={key} className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="break-all font-mono text-xs text-muted-foreground">{key}</dt>
                  <dd className="min-w-0 break-words font-medium">{metadataValue(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-4 text-[15px] leading-6 text-muted-foreground">No custom metadata has been added.</p>
          )}
          {canManage && !metadata.length ? (
            <Button variant="outline" className="mt-5 h-11" onClick={onEditMetadata}>
              <Plus />Add metadata
            </Button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: VectorDocument["status"] }) {
  return (
    <Badge
      variant="outline"
      className={status === "READY"
        ? "border-transparent bg-sky-500/10 text-sky-700 dark:text-sky-300"
        : status === "FAILED"
          ? "border-transparent bg-destructive/10 text-destructive"
          : "border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-300"}
    >
      {statusLabel(status)}
    </Badge>
  );
}

function Property({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="space-y-2.5" aria-label="Loading indexed text preview">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-[92%]" />
      <Skeleton className="h-4 w-[84%]" />
      <Skeleton className="h-4 w-[70%]" />
    </div>
  );
}

function PanelMessage({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "danger" | "neutral" }) {
  return <p className={tone === "danger" ? "text-sm leading-6 text-destructive" : "text-sm leading-6 text-muted-foreground"}>{children}</p>;
}

function mediaTypeLabel(document: VectorDocument): string {
  const extension = document.filename.split(".").pop()?.toLowerCase();
  if (document.mediaType === "application/pdf" || extension === "pdf") return "PDF document";
  if (extension === "docx") return "Word document";
  if (extension === "pptx") return "PowerPoint presentation";
  if (extension === "xlsx") return "Excel workbook";
  if (extension === "md") return "Markdown document";
  if (extension === "txt") return "Text document";
  if (document.mediaType.startsWith("image/")) return "Image";
  if (document.mediaType === "text/html") return "HTML document";
  return document.mediaType;
}

function statusLabel(status: VectorDocument["status"]): string {
  if (status === "READY") return "Indexed";
  if (status === "FAILED") return "Failed";
  if (status === "QUEUED") return "Uploading";
  if (status === "PARSING") return "Parsing";
  return "Embedding";
}

function previewUnavailableMessage(document: VectorDocument): string {
  if (document.status === "FAILED") return document.error || "Indexing failed, so no text preview is available.";
  if (document.status === "QUEUED") return "This file is waiting to be processed.";
  if (document.status === "PARSING") return "TaskLattice is extracting text from this file.";
  return "TaskLattice is creating vector embeddings for this file.";
}

function metadataValue(metadata: VectorCustomMetadata[string]): string {
  if (metadata.type === "boolean") return metadata.value ? "True" : "False";
  return String(metadata.value);
}
