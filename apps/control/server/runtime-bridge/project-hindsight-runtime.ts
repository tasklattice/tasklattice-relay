import { getControlConfig } from "../config/control-config";
import { problemResponse } from "../http/responses";
import { ProjectMemoryRuntimeService, MemoryRuntimeAccessDeniedError } from "./project-memory-runtime-service";
import type { ProjectRuntimeCoordinatorIdentity } from "./project-runtime-bridge-token";
import { sanitizeRuntimeMemoryText } from "./memory-runtime-sanitizer";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Expose the native SDK's runtime operations, never Bank administration. */
export function hindsightRuntimePath(method: string, path: string, instanceId: string, bank: string): string {
  if (method === "GET" && path === "version") return "/version";
  const match = /^v1\/default\/banks\/([^/]+)\/(memories(?:\/recall)?|reflect|operations\/[a-zA-Z0-9_-]+)$/.exec(path);
  if (!match || match[1] !== instanceId || !/^[a-zA-Z0-9_-]+$/.test(bank)) {
    throw new MemoryRuntimeAccessDeniedError();
  }
  const operation = match[2]!;
  if (method !== (operation.startsWith("operations/") ? "GET" : "POST")) {
    throw new MemoryRuntimeAccessDeniedError();
  }
  return `/v1/default/banks/${bank}/${operation}`;
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
      typeof item === "string" && ["content", "query", "context"].includes(key)
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
  if (new URL(request.url).search) throw new MemoryRuntimeAccessDeniedError();
  let body: string | undefined;
  if (request.method === "POST") {
    try {
      const input = JSON.parse(await readBounded(request, MAX_REQUEST_BYTES));
      if (!input || Array.isArray(input) || typeof input !== "object") throw new Error();
      body = JSON.stringify(sanitizePayload(input));
    } catch { return problemResponse(400, "Invalid Hindsight request."); }
  }
  const config = dependencies.configuration ?? getControlConfig().memory;
  if (!config.apiKey) return problemResponse(503, "Memory Runtime is unavailable.");
  try {
    const upstream = await (dependencies.fetch ?? fetch)(`${config.baseUrl.replace(/\/$/, "")}${targetPath}`, {
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
    const responseBody = await readBounded(upstream, MAX_RESPONSE_BYTES);
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
