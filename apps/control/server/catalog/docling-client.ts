import { getWorkerConfig } from "../config/worker-config";
import { z } from "zod";

const doclingChunkSchema = z.object({
  filename: z.string(),
  chunk_index: z.number().int().min(0),
  text: z.string(),
  raw_text: z.string().nullable().optional(),
  num_tokens: z.number().int().min(0).nullable().optional(),
  headings: z.array(z.string()).nullable().optional(),
  captions: z.array(z.string()).nullable().optional(),
  doc_items: z.array(z.string()).default([]),
  page_numbers: z.array(z.number().int().min(1)).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
}).passthrough();

const doclingDocumentResultSchema = z.object({
  document: z.object({ json_content: z.unknown().nullable().optional() }).passthrough().optional(),
  content: z.object({ json_content: z.unknown().nullable().optional() }).passthrough().optional(),
}).passthrough();

const doclingChunkResponseSchema = z.object({
  chunks: z.array(doclingChunkSchema),
  documents: z.array(doclingDocumentResultSchema).default([]),
  processing_time: z.number().min(0),
}).passthrough();

export interface DoclingParsedChunk {
  content: string;
  index: number;
  label: string | null;
  pageNumber: number | null;
  sectionPath: string[];
  tokenCount: number;
  attributes: Record<string, unknown>;
}

export interface DoclingParseResult {
  chunks: DoclingParsedChunk[];
  document: unknown | null;
  ocrPageCount: number;
  pageCount: number;
  processingTimeSeconds: number;
}

export interface VectorDocumentParser {
  parse(input: {
    bytes: Uint8Array;
    filename: string;
    mediaType: string;
  }): Promise<DoclingParseResult>;
}

export class DoclingClient implements VectorDocumentParser {
  constructor(
    private readonly baseUrl?: string,
    private readonly apiKey?: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly enabled?: boolean,
  ) {}

  async parse(input: {
    bytes: Uint8Array;
    filename: string;
    mediaType: string;
  }): Promise<DoclingParseResult> {
    if (!(this.enabled ?? getWorkerConfig().docling.enabled)) throw new Error("Document parsing is disabled in worker.docling configuration.");
    const body = new FormData();
    const buffer = Buffer.from(input.bytes);
    body.set(
      "files",
      new Blob([buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer], { type: input.mediaType }),
      input.filename,
    );
    body.set("convert_from_formats", doclingFormat(input.filename, input.mediaType));
    body.set("convert_do_ocr", "true");
    body.set("convert_force_ocr", "false");
    body.set("convert_image_export_mode", "placeholder");
    body.set("convert_abort_on_error", "true");
    body.set("convert_do_table_structure", "true");
    body.set("convert_table_mode", "accurate");
    body.set("convert_do_pdf_heading_hierarchy", "true");
    body.set("chunking_max_tokens", "512");
    body.set("chunking_merge_peers", "true");
    body.set("chunking_include_raw_text", "true");
    body.set("include_converted_doc", "true");

    const response = await this.fetcher(
      `${(this.baseUrl ?? getWorkerConfig().docling.baseUrl).replace(/\/$/, "")}/v1/chunk/hybrid/file`,
      {
        method: "POST",
        ...((this.apiKey ?? getWorkerConfig().docling.apiKey) ? { headers: { "x-api-key": this.apiKey ?? getWorkerConfig().docling.apiKey! } } : {}),
        body,
        signal: AbortSignal.timeout(10 * 60 * 1_000),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 4_000);
      throw new Error(
        `Docling parsing failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
      );
    }
    const parsed = doclingChunkResponseSchema.parse(await response.json());
    const chunks = parsed.chunks
      .filter((chunk) => chunk.text.trim())
      .map((chunk): DoclingParsedChunk => ({
        content: chunk.text.trim(),
        index: chunk.chunk_index,
        label: labelFromDocItems(chunk.doc_items),
        pageNumber: chunk.page_numbers?.[0] ?? null,
        sectionPath: chunk.headings?.filter(Boolean) ?? [],
        tokenCount: chunk.num_tokens ?? approximateTokens(chunk.text),
        attributes: {
          captions: chunk.captions ?? [],
          doc_items: chunk.doc_items,
          page_numbers: chunk.page_numbers ?? [],
          ...(chunk.metadata ?? {}),
        },
      }));
    if (!chunks.length) {
      throw new Error("Docling completed without producing searchable chunks.");
    }
    const documentResult = parsed.documents[0];
    const document = documentResult?.document?.json_content
      ?? documentResult?.content?.json_content
      ?? null;
    const pageNumbers = chunks.flatMap((chunk) => chunk.attributes.page_numbers as number[]);
    const pageCount = Math.max(
      documentPageCount(document),
      pageNumbers.length ? Math.max(...pageNumbers) : 0,
    );
    return {
      chunks,
      document,
      // Docling does not expose a stable per-page OCR flag in the chunk API.
      // OCR remains visible as the configured parser capability and in the
      // persisted Docling document rather than an invented counter.
      ocrPageCount: 0,
      pageCount,
      processingTimeSeconds: parsed.processing_time,
    };
  }
}

function doclingFormat(filename: string, mediaType: string): string {
  const extension = filename.toLowerCase().split(".").pop();
  const formats: Record<string, string> = {
    pdf: "pdf",
    docx: "docx",
    pptx: "pptx",
    xlsx: "xlsx",
    html: "html",
    htm: "html",
    md: "md",
    txt: "md",
    png: "image",
    jpg: "image",
    jpeg: "image",
    tif: "image",
    tiff: "image",
  };
  const format = extension ? formats[extension] : undefined;
  if (format) return format;
  if (mediaType.startsWith("image/")) return "image";
  throw new Error(`Docling does not support the uploaded file type: ${mediaType || filename}.`);
}

function documentPageCount(document: unknown): number {
  if (!document || typeof document !== "object" || Array.isArray(document)) return 0;
  const pages = (document as Record<string, unknown>).pages;
  if (Array.isArray(pages)) return pages.length;
  if (pages && typeof pages === "object") return Object.keys(pages).length;
  return 0;
}

function labelFromDocItems(items: string[]): string | null {
  const item = items[0];
  if (!item) return null;
  const match = item.match(/^#\/([^/]+)/);
  return match?.[1]?.replace(/s$/, "") ?? null;
}

function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}
