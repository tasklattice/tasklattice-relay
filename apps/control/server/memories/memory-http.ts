import {
  memoryStatuses,
  type MemoryItemStatus,
  type MemoryStatus,
} from "@tali/contracts";

function positiveInt(value: string | null, fallback: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Invalid limit; expected an integer from 1 to ${maximum}.`);
  }
  return parsed;
}

export function memoryIdFromParams(params: Record<string, string | undefined> | undefined): string {
  const memoryId = decodeURIComponent(params?.memoryId ?? "").trim();
  if (!memoryId) throw new Error("A Memory ID is required.");
  return memoryId;
}

export function requiredIdempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || value.length > 240) {
    throw new Error("A valid Idempotency-Key header is required.");
  }
  return value;
}

export function memoryResourceQuery(request: Request): {
  cursor?: string;
  limit: number;
  query?: string;
  statuses?: MemoryStatus[];
} {
  const url = new URL(request.url);
  const query = url.searchParams.get("query")?.trim();
  const cursor = url.searchParams.get("cursor")?.trim();
  const rawStatuses = url.searchParams.getAll("status").flatMap((value) =>
    value.split(",").map((item) => item.trim()).filter(Boolean)
  );
  const allowed = new Set<string>(memoryStatuses);
  if (rawStatuses.some((status) => !allowed.has(status))) {
    throw new Error("Invalid Memory status filter.");
  }
  return {
    limit: positiveInt(url.searchParams.get("limit"), 25, 100),
    ...(cursor ? { cursor } : {}),
    ...(query ? { query } : {}),
    ...(rawStatuses.length ? { statuses: rawStatuses as MemoryStatus[] } : {}),
  };
}

export function memoryItemQuery(request: Request): {
  cursor?: string;
  from?: string;
  limit: number;
  query?: string;
  sourceDocumentId?: string;
  status?: MemoryItemStatus;
  to?: string;
} {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor")?.trim();
  const query = url.searchParams.get("query")?.trim();
  const sourceDocumentId = url.searchParams.get("source_document_id")?.trim();
  const status = url.searchParams.get("status")?.trim();
  const from = url.searchParams.get("from")?.trim();
  const to = url.searchParams.get("to")?.trim();
  if (status && status !== "active" && status !== "invalidated") {
    throw new Error("Invalid Memory item status filter.");
  }
  if (from && Number.isNaN(Date.parse(from))) throw new Error("Invalid Memory from date.");
  if (to && Number.isNaN(Date.parse(to))) throw new Error("Invalid Memory to date.");
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new Error("Memory from date must be before to date.");
  }
  return {
    limit: positiveInt(url.searchParams.get("limit"), 25, 100),
    ...(cursor ? { cursor } : {}),
    ...(from ? { from } : {}),
    ...(query ? { query } : {}),
    ...(sourceDocumentId ? { sourceDocumentId } : {}),
    ...(status ? { status: status as MemoryItemStatus } : {}),
    ...(to ? { to } : {}),
  };
}

export function memoryOutboxQuery(request: Request): {
  cursor?: string;
  limit: number;
  statuses?: Array<"pending" | "processing" | "retry" | "delivered" | "dead_letter">;
} {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor")?.trim();
  const rawStatuses = url.searchParams.getAll("status").flatMap((value) =>
    value.split(",").map((item) => item.trim()).filter(Boolean)
  );
  const allowed = new Set(["pending", "processing", "retry", "delivered", "dead_letter"]);
  if (rawStatuses.some((status) => !allowed.has(status))) {
    throw new Error("Invalid Memory outbox status filter.");
  }
  return {
    limit: positiveInt(url.searchParams.get("limit"), 25, 100),
    ...(cursor ? { cursor } : {}),
    ...(rawStatuses.length
      ? { statuses: rawStatuses as Array<"pending" | "processing" | "retry" | "delivered" | "dead_letter"> }
      : {}),
  };
}
