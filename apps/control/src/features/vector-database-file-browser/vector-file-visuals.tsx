import type { VectorDocument } from "@tali/contracts";
import {
  CheckCircle2,
  Clock3,
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Network,
  Presentation,
  ScanText,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type VectorFileKind =
  | "html"
  | "image"
  | "markdown"
  | "other"
  | "pdf"
  | "sheet"
  | "slides"
  | "text"
  | "word";

const fileVisuals: Record<VectorFileKind, {
  className: string;
  icon: LucideIcon;
  label: string;
}> = {
  pdf: { className: "bg-file-pdf", icon: FileText, label: "PDF" },
  word: { className: "bg-file-word", icon: FileText, label: "W" },
  slides: { className: "bg-file-slides", icon: Presentation, label: "P" },
  sheet: { className: "bg-file-sheet", icon: FileSpreadsheet, label: "X" },
  markdown: { className: "bg-file-markdown", icon: FileCode2, label: "MD" },
  html: { className: "bg-file-html", icon: FileCode2, label: "<>" },
  image: { className: "bg-file-image", icon: FileImage, label: "IMG" },
  text: { className: "bg-file-text", icon: FileText, label: "TXT" },
  other: { className: "bg-file-text", icon: File, label: "FILE" },
};

export function vectorFileKind(filename: string, mediaType = ""): VectorFileKind {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (mediaType === "application/pdf" || extension === "pdf") return "pdf";
  if (extension === "docx" || extension === "doc") return "word";
  if (extension === "pptx" || extension === "ppt") return "slides";
  if (extension === "xlsx" || extension === "xls" || extension === "csv") return "sheet";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (mediaType === "text/html" || extension === "html" || extension === "htm") return "html";
  if (mediaType.startsWith("image/") || ["png", "jpg", "jpeg", "tif", "tiff", "webp"].includes(extension)) return "image";
  if (mediaType.startsWith("text/") || extension === "txt") return "text";
  return "other";
}

export function vectorFileTypeLabel(filename: string, mediaType = ""): string {
  const kind = vectorFileKind(filename, mediaType);
  if (kind === "pdf") return "PDF document";
  if (kind === "word") return "Word document";
  if (kind === "slides") return "PowerPoint presentation";
  if (kind === "sheet") return "Spreadsheet";
  if (kind === "markdown") return "Markdown document";
  if (kind === "html") return "HTML document";
  if (kind === "image") return "Image";
  if (kind === "text") return "Text document";
  return mediaType || "File";
}

export function VectorFileIcon({
  className,
  filename,
  mediaType = "",
  size = "md",
}: {
  className?: string;
  filename: string;
  mediaType?: string;
  size?: "lg" | "md" | "sm";
}) {
  const visual = fileVisuals[vectorFileKind(filename, mediaType)];
  const Icon = visual.icon;
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-md text-white shadow-sm",
        size === "sm" ? "size-8" : size === "lg" ? "size-11" : "size-9",
        visual.className,
        className,
      )}
    >
      <Icon className={cn("opacity-90", size === "sm" ? "size-4" : size === "lg" ? "size-5" : "size-[1.125rem]")} strokeWidth={1.8} />
      <span className={cn(
        "absolute inset-x-0 bottom-0 bg-black/18 text-center font-semibold leading-none tracking-[-0.03em]",
        size === "sm" ? "py-[2px] text-[5px]" : size === "lg" ? "py-[2px] text-[7px]" : "py-[2px] text-[6px]",
      )}>
        {visual.label}
      </span>
    </span>
  );
}

const statusVisuals: Record<VectorDocument["status"], {
  className: string;
  icon: LucideIcon;
  label: string;
}> = {
  QUEUED: { className: "border-info-border bg-info-surface text-info-foreground", icon: Clock3, label: "Queued" },
  PARSING: { className: "border-info-border bg-info-surface text-info-foreground", icon: ScanText, label: "Parsing" },
  EMBEDDING: { className: "border-info-border bg-info-surface text-info-foreground", icon: Network, label: "Embedding" },
  READY: { className: "border-success-border bg-success-surface text-success-foreground", icon: CheckCircle2, label: "Indexed" },
  FAILED: { className: "border-destructive-border bg-destructive-surface text-destructive", icon: TriangleAlert, label: "Failed" },
};

export function vectorIndexStatusLabel(status: VectorDocument["status"]): string {
  return statusVisuals[status].label;
}

export function VectorIndexStatus({
  className,
  compact = false,
  status,
}: {
  className?: string;
  compact?: boolean;
  status: VectorDocument["status"];
}) {
  const visual = statusVisuals[status];
  const Icon = visual.icon;
  return (
    <span className={cn(
      "inline-flex w-fit items-center gap-1.5 rounded-full border font-medium",
      compact ? "px-2 py-1 text-[0.6875rem]" : "px-2.5 py-1.5 text-xs",
      visual.className,
      className,
    )}>
      <Icon className={cn("size-3.5", status === "EMBEDDING" && "animate-pulse motion-reduce:animate-none")} />
      {visual.label}
    </span>
  );
}
