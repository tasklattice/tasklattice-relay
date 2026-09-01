import { useQuery } from "@tanstack/react-query";
import type { VectorCustomMetadata, VectorDocument } from "@tali/contracts";
import {
  MoreHorizontal,
  Move,
  Pencil,
  Plus,
  Rows3,
  Trash2,
  X,
} from "lucide-react";
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
import {
  VectorFileIcon,
  VectorIndexStatus,
  vectorFileTypeLabel,
  vectorIndexStatusLabel,
} from "./vector-file-visuals";

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
    <div className="flex h-full min-h-0 flex-col bg-card">
      <header className="shrink-0 border-b px-5 py-5 sm:px-6">
        <div className="flex items-start gap-3.5">
          <VectorFileIcon filename={document.filename} mediaType={document.mediaType} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-lg font-semibold leading-6 tracking-[-0.01em]">{document.filename}</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={filePath(document)}>
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
        <section className="border-b bg-muted/20 px-5 py-4 sm:px-6" aria-label="File indexing summary">
          <div className="flex flex-wrap items-center gap-2.5 text-sm">
            <VectorIndexStatus status={document.status} />
            <span aria-hidden="true" className="text-muted-foreground/60">·</span>
            <span>{document.chunkCount} chunks</span>
            <span aria-hidden="true" className="text-muted-foreground/60">·</span>
            <span>{formatBytes(document.byteSize)}</span>
          </div>
        </section>

        <section className="border-b px-5 py-5 sm:px-6" aria-labelledby="indexed-text-preview-title">
          <div className="flex items-start justify-between gap-4">
            <h3 id="indexed-text-preview-title" className="text-base font-semibold leading-6">Indexed text preview</h3>
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
          <div className="mt-3.5">
            {ready && canViewContent && detail.isPending ? <PreviewSkeleton /> : null}
            {detail.error ? <PanelMessage tone="danger">{detail.error.message}</PanelMessage> : null}
            {!canViewContent ? <PanelMessage>Content preview is unavailable for your Project role.</PanelMessage> : null}
            {canViewContent && !ready ? <PanelMessage>{previewUnavailableMessage(document)}</PanelMessage> : null}
            {canViewContent && ready && detail.data && !preview ? <PanelMessage>No indexed text is available.</PanelMessage> : null}
            {preview ? <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/70">{preview}</p> : null}
          </div>
        </section>

        <section className="border-b px-5 py-5 sm:px-6" aria-labelledby="file-properties-title">
          <h3 id="file-properties-title" className="text-base font-semibold">File properties</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <Property label="Type" value={vectorFileTypeLabel(document.filename, document.mediaType)} />
            <Property label="Status" value={vectorIndexStatusLabel(document.status)} />
            {document.pageCount ? <Property label="Pages" value={String(document.pageCount)} /> : null}
            {document.ocrPageCount ? <Property label="OCR pages" value={String(document.ocrPageCount)} /> : null}
            <Property label="Chunks" value={String(document.chunkCount)} />
            <Property label="Size" value={formatBytes(document.byteSize)} />
          </dl>
          <Button
            variant="outline"
            className="mt-5 h-10"
            disabled={!ready || !canViewContent || document.chunkCount === 0}
            onClick={onViewChunks}
          >
            <Rows3 />View chunks
          </Button>
        </section>

        <section className="px-5 py-5 sm:px-6" aria-labelledby="custom-metadata-title">
          <div className="flex items-start justify-between gap-4">
            <h3 id="custom-metadata-title" className="text-base font-semibold">Custom metadata</h3>
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
            <p className="mt-3.5 text-sm leading-6 text-muted-foreground">No custom metadata has been added.</p>
          )}
          {canManage && !metadata.length ? (
            <Button variant="outline" className="mt-4 h-10" onClick={onEditMetadata}>
              <Plus />Add metadata
            </Button>
          ) : null}
        </section>
      </div>
    </div>
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
