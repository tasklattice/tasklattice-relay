import { getControlConfig } from "../config/control-config";
import { problemResponse } from "../http/responses";
import { ProjectMemoryRuntimeService, MemoryRuntimeAccessDeniedError } from "./project-memory-runtime-service";
import type { ProjectRuntimeCoordinatorIdentity } from "./project-runtime-bridge-token";
import { sanitizeRuntimeMemoryText } from "./memory-runtime-sanitizer";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** The native plugin may operate on its bound Bank's content, never Bank administration. */
export function hindsightRuntimePath(method: string, path: string, instanceId: string, bank: string): string {
  if (method === "GET" && ["version", "v1/version"].includes(path)) return "/version";
  const match = /^v1\/default\/banks\/([a-zA-Z0-9_-]+)\/(.+)$/.exec(path);
  if (!match || match[1] !== instanceId || !/^[a-zA-Z0-9_-]+$/.test(bank)) throw new MemoryRuntimeAccessDeniedError();
  const operation = match[2]!;
  const allowed = method === "GET"
    ? /^(config|documents|operations(?:\/[a-zA-Z0-9_-]+)?|knowledge-base\/(tree|search|pages\/[a-zA-Z0-9_-]+))$/.test(operation)
    : method === "POST"
      ? /^(memories(?:\/recall)?|reflect|knowledge-base\/(pages|folders))$/.test(operation)
      : method === "PATCH" && /^knowledge-base\/nodes\/[a-zA-Z0-9_-]+$/.test(operation);
  if (!allowed) throw new MemoryRuntimeAccessDeniedError();
  return `/v1/default/banks/${bank}/${operation}`;
}

export function hindsightRuntimeQuery(path: string, search: URLSearchParams): string {
  const allowed = path.endsWith("/documents") ? ["q", "tags", "tags_match", "limit", "offset"]
    : path.endsWith("/knowledge-base/search") ? ["q", "limit"] : [];
  const clean = new URLSearchParams();
  for (const [key, value] of search) {
    if (!allowed.includes(key) || search.getAll(key).length !== 1 || value.length > 8000) throw new MemoryRuntimeAccessDeniedError();
    if (["limit", "offset"].includes(key) && (!/^\d+$/.test(value) || Number(value) > (key === "limit" ? 500 : 100000))) throw new MemoryRuntimeAccessDeniedError();
    if (key === "tags_match" && !["all", "any", "all_strict", "any_strict", "exact"].includes(value)) throw new MemoryRuntimeAccessDeniedError();
    clean.set(key, key === "q" ? sanitizeRuntimeMemoryText(value, 8000) : value);
  }
  return clean.size ? `?${clean}` : "";
}

// Keep the upstream protocol intact; redact memory text before it leaves Relay.
// Structural identifiers and timestamps must stay unchanged for native append
// and operation polling semantics. No credential headers are forwarded.
function sanitizePayload(value: unknown, depth = 0, textOnly = false): unknown {
  if (textOnly && typeof value === "string") return sanitizeRuntimeMemoryText(value, 128_000);
  if (depth > 16) throw new Error("Invalid Hindsight payload depth.");
  if (Array.isArray(value)) return value.map(item => sanitizePayload(item, depth + 1, textOnly));
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key,
      typeof item === "string" && ["content", "query", "context", "source_query", "name", "description"].includes(key)
        ? sanitizeRuntimeMemoryText(item, 128_000)
        : sanitizePayload(item, depth + 1, textOnly || ["metadata", "tags"].includes(key)),
    ]),
  );
  return value;
}

async function readBounded(response: Request | Response, maximum: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > maximum) throw new Error("Invalid Hindsight payload size.");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error("Invalid Hindsight payload size."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function proxyHindsightRuntime(
  request: Request,
  identity: ProjectRuntimeCoordinatorIdentity,
  path: string,
  dependencies: {
    runtime?: Pick<ProjectMemoryRuntimeService, "requireBoundMemory" | "recordNativeActivity">;
    configuration?: { baseUrl: string; apiKey: string };
    fetch?: typeof fetch;
  } = {},
): Promise<Response> {
  const runtime = dependencies.runtime ?? new ProjectMemoryRuntimeService(identity.projectId);
  // Re-resolve the live binding on every call, including version and async polls.
  const { memory } = await runtime.requireBoundMemory(identity);
  const targetPath = hindsightRuntimePath(request.method, path, identity.coordinatorInstanceId, memory.providerRef!);
  const query = hindsightRuntimeQuery(path, new URL(request.url).searchParams);
  let body: string | undefined;
  if (["POST", "PATCH"].includes(request.method)) {
    try {
      const input = JSON.parse(await readBounded(request, MAX_REQUEST_BYTES));
      if (!input || Array.isArray(input) || typeof input !== "object") throw new Error();
      // No request may redirect the operation to another Bank or tenant.
      if (["bank_id", "bankId", "tenant_id", "tenantId"].some(key => key in input)) throw new Error();
      body = JSON.stringify(sanitizePayload(input));
    } catch { return problemResponse(400, "Invalid Hindsight request."); }
  }
  const config = dependencies.configuration ?? getControlConfig().memory;
  if (!config.apiKey) return problemResponse(503, "Memory Runtime is unavailable.");
  try {
    const upstream = await (dependencies.fetch ?? fetch)(`${config.baseUrl.replace(/\/$/, "")}${targetPath}${query}`, {
      method: request.method,
      headers: { "authorization": `Bearer ${config.apiKey}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body }),
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return problemResponse(upstream.status === 404 ? 404 : 503, "Memory Runtime operation unavailable.");
    }
    let responseBody = await readBounded(upstream, MAX_RESPONSE_BYTES);
    if (path.endsWith("/config")) {
      // The plugin only needs append support; global model/provider configuration
      // must never cross the runtime boundary.
      const document = JSON.parse(responseBody);
      responseBody = JSON.stringify({ config: { store_document_text: document.config?.store_document_text !== false }, overrides: {} });
    }
    if (request.method === "POST" && targetPath.endsWith("/memories")) {
      // The provider accepted the write. Activity bookkeeping must not turn an
      // accepted native retain into a retry (and duplicate facts).
      try { await runtime.recordNativeActivity(memory.id); }
      catch { console.warn("Memory Runtime activity update failed."); }
    }
    return new Response(responseBody, {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch { return problemResponse(503, "Memory Runtime is unavailable."); }
}
