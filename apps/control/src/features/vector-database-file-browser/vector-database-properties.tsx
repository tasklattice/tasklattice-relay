import type {
  VectorDatabaseOverview,
  VectorDocument,
  VectorFolder,
} from "@tali/contracts";
import {
  ChevronDown,
  Database,
  Folder,
  Move,
  Pencil,
  Rows3,
  Trash2,
} from "lucide-react";
import { getVectorStoreProvider } from "@/components/knowledge/vector-store-provider";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatPlatformDateTime } from "@/lib/platform-preferences";
import { cn } from "@/lib/utils";
import { filePath, formatBytes } from "./file-browser-utils";
import { VectorFileIcon, vectorIndexStatusLabel } from "./vector-file-visuals";

export function VectorDatabaseProperties({
  canManage,
  folder,
  document,
  overview,
  onDelete,
  onMove,
  onOpenFile,
  onRename,
}: {
  canManage: boolean;
  folder?: VectorFolder | undefined;
  document?: VectorDocument | undefined;
  overview: VectorDatabaseOverview;
  onDelete: () => void;
  onMove: () => void;
  onOpenFile: () => void;
  onRename: () => void;
}) {
  if (folder) {
    return (
      <PropertiesShell icon={<Folder />} title={folder.name} description="Logical folder">
        <PropertiesList items={[
          ["Parent path", parentPath(folder.path)],
          ["Direct children", String(folder.directChildCount)],
          ["Nested files", String(folder.totalFileCount)],
          ["Vector records", String(folder.totalVectorCount)],
          ["Created", formatPlatformDateTime(folder.createdAt)],
          ["Updated", formatPlatformDateTime(folder.updatedAt)],
        ]} />
        {canManage ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11" onClick={onRename}><Pencil />Rename</Button>
            <Button variant="outline" className="h-11" onClick={onMove}><Move />Move</Button>
          </div>
        ) : null}
        <ProcessingSummary processing={folder.processingFileCount} failed={folder.failedFileCount} />
        {canManage ? <DeleteAction label="Delete folder" onClick={onDelete} /> : null}
      </PropertiesShell>
    );
  }

  if (document) {
    return (
      <PropertiesShell icon={<VectorFileIcon filename={document.filename} mediaType={document.mediaType} size="sm" />} title={document.filename} description={document.mediaType}>
        <PropertiesList items={[
          ["Path", filePath(document)],
          ["Size", formatBytes(document.byteSize)],
          ["Chunks", String(document.chunkCount)],
          ["Index status", statusLabel(document.status)],
          ["Uploaded", formatPlatformDateTime(document.createdAt)],
          ["Updated", formatPlatformDateTime(document.updatedAt)],
          ["Embedding model", overview.database.embeddingModel ?? "Provider managed"],
        ]} />
        <Button variant="outline" className="h-11 w-full" onClick={onOpenFile}>
          <Rows3 />View chunks
        </Button>
        {document.error ? <p role="alert" className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">{document.error}</p> : null}
        {canManage ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11" onClick={onRename}><Pencil />Rename</Button>
            <Button variant="outline" className="h-11" onClick={onMove}><Move />Move</Button>
          </div>
        ) : null}
        {canManage ? <DeleteAction label="Delete file" onClick={onDelete} /> : null}
      </PropertiesShell>
    );
  }

  const database = overview.database;
  return (
    <PropertiesShell icon={<Database />} title={database.name} description="Vector Database properties">
      <PropertiesList items={[
        ["Provider", getVectorStoreProvider(database.provider).label],
        ["Collection / Index", database.vectorStoreId],
        ["Dimension", database.embeddingDimensions ? String(database.embeddingDimensions) : "Provider managed"],
        ["Distance metric", "Cosine"],
        ["Embedding model", database.embeddingModel ?? "Provider managed"],
        ["Files", String(overview.stats.documentCount)],
        ["Vector records", String(overview.stats.chunkCount)],
        ["Created", formatPlatformDateTime(overview.createdAt)],
        ["Updated", formatPlatformDateTime(overview.updatedAt)],
      ]} />
      <ProcessingSummary
        processing={overview.stats.processingDocumentCount}
        failed={overview.stats.failedDocumentCount}
      />
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="h-11 w-full justify-between px-2">
            Advanced <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t pt-4">
          <PropertiesList items={[
            ["Registration", database.status],
            ["Default Top K", String(database.topK)],
            ["Parser", database.provider === "postgresql" ? "Docling HybridChunker" : "Provider managed"],
            ["API base", database.apiBase ?? (database.provider === "postgresql" ? "Internal Control bridge" : "Provider default")],
          ]} compact />
        </CollapsibleContent>
      </Collapsible>
    </PropertiesShell>
  );
}

function PropertiesShell({ children, description, icon, title }: {
  children: React.ReactNode;
  description: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b px-5 py-5 pr-14 sm:px-6 sm:pr-14">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground [&_svg]:size-4">{icon}</span>
          <span className="min-w-0">
            <h2 className="break-words text-sm font-semibold">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
    </div>
  );
}

function PropertiesList({ compact = false, items }: {
  compact?: boolean;
  items: Array<[string, string]>;
}) {
  return (
    <dl className={cn("space-y-3", compact && "space-y-2.5")}>
      {items.map(([label, value]) => (
        <div key={label} className="grid gap-1 text-sm sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProcessingSummary({ failed, processing }: { failed: number; processing: number }) {
  if (!failed && !processing) return null;
  return (
    <div className="space-y-2 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs">
      {processing ? <p>{processing} {processing === 1 ? "file is" : "files are"} still processing.</p> : null}
      {failed ? <p className="text-destructive">{failed} {failed === 1 ? "file has" : "files have"} failed indexing.</p> : null}
    </div>
  );
}

function DeleteAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="mt-auto border-t pt-4">
      <Button variant="ghost" className="h-11 w-full justify-start px-2 text-destructive hover:text-destructive" onClick={onClick}>
        <Trash2 />{label}
      </Button>
    </div>
  );
}

function parentPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.length <= 1 ? "/" : `/${segments.slice(0, -1).join("/")}`;
}

const statusLabel = vectorIndexStatusLabel;
