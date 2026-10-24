import { WebSocket } from "ws";
import { requestOrigin } from "../http/request-origin";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";
import { hermesCredentials, maximumSessionLifetimeMs, runnerRequest, sessionLifetimeMs, upstreamSecret, validateAgentUiSession } from "./access";
import { prisma } from "../db/prisma";
import { agentDocumentPolicy, injectAgentDocument } from "./document";

export function parseAgentUiPath(requestUrl: string) {
  const url = new URL(requestUrl);
  const match = url.pathname.match(/^\/_agent-ui\/([\da-f-]{36})\/([\w-]{43})(\/.*)$/);
  if (!match || url.pathname.length > 8192 || /%2f|%5c|%25|%2e|\\|\/\//i.test(match[3]!)) throw new Response("Invalid Agent path.", { status: 400 });
  return { id: match[1]!, credential: match[2]!, path: match[3]! + url.search, prefix: `/_agent-ui/${match[1]}/${match[2]}/` };
}

const requestHeaders = new Set(["accept", "accept-language", "content-type", "range", "if-range", "if-none-match", "if-modified-since"]);
const responseHeaders = new Set(["content-type", "content-disposition", "content-range", "accept-ranges", "etag", "last-modified"]);
export function cleanAgentRequestHeaders(input: Headers): Headers {
  const headers = new Headers();
  input.forEach((value, key) => { if (requestHeaders.has(key)) headers.set(key, value); });
  return headers;
}

async function readBounded(response: Response, limit = 16 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Response("Agent document is too large.", { status: 502 }); }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const requests = new Map<string, number>();
let activeRequests = 0;
export async function proxyAgentRequest(request: Request, publicBase?: string): Promise<Response> {
  const route = parseAgentUiPath(request.url);
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return proxyAgentResponse(request, publicBase);
  const active = requests.get(route.id) ?? 0;
  if (active >= 16 || activeRequests >= 64) return new Response("Agent request limit reached.", { status: 429, headers: { "cache-control": "no-store" } });
  requests.set(route.id, active + 1); activeRequests++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true; activeRequests--;
    const remaining = (requests.get(route.id) ?? 1) - 1;
    if (remaining) requests.set(route.id, remaining); else requests.delete(route.id);
  };
  try {
    const response = await proxyAgentResponse(request, publicBase);
    if (!response.body) { release(); return response; }
    const reader = response.body.getReader();
    const timer = setInterval(() => { void validateAgentUiSession(route.id, route.credential).catch(() => { void reader.cancel(); release(); clearInterval(timer); }); }, 10_000);
    const finish = () => { clearInterval(timer); release(); };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try { const result = await reader.read(); if (result.done) { finish(); controller.close(); } else controller.enqueue(result.value); }
        catch (error) { finish(); controller.error(error); }
      },
      async cancel() { finish(); await reader.cancel(); },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  } catch (error) { release(); throw error; }
}

async function proxyAgentResponse(request: Request, publicBase?: string): Promise<Response> {
  const route = parseAgentUiPath(request.url);
  const record = await validateAgentUiSession(route.id, route.credential);
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method)) return new Response(null, { status: 405 });
  const origin = requestOrigin(request);
  const headers = new Headers({ "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, range, x-requested-with, x-hermes-session-token", "access-control-expose-headers": "content-disposition, content-range",
    "content-security-policy": agentDocumentPolicy(origin, route.prefix) });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (route.path.split("?", 1)[0] === "/_relay/session") {
    if (request.headers.get("origin") !== "null") return new Response(null, { status: 403, headers });
    if (request.method === "DELETE") {
      await prisma().agentUiSession.deleteMany({ where: { id: record.id } });
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return new Response(null, { status: 405, headers });
    const expiresAt = new Date(Math.min(Date.now() + sessionLifetimeMs, record.createdAt.getTime() + maximumSessionLifetimeMs, record.authSession.expiresAt.getTime()));
    await prisma().agentUiSession.update({ where: { id: record.id }, data: { expiresAt } });
    return new Response(null, { status: 204, headers });
  }
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return Object.assign(new Response("WebSocket upgrade required.", { status: 426 }), { crossws: agentWebSocketHooks });
  const outgoing = cleanAgentRequestHeaders(request.headers);
  outgoing.set("origin", record.upstreamOrigin);
  if (record.platform === "hermes") {
    // Hermes uses this routing hint. OpenClaw does not, and 2026.9 treats
    // any x-forwarded-* header as a client attribution claim.
    outgoing.set("x-forwarded-prefix", route.prefix.replace(/\/$/, ""));
    const credentials = hermesCredentials(record);
    outgoing.set("cookie", credentials.cookie);
    outgoing.set("x-hermes-session-token", credentials.token);
  }
  let body = request.body;
  if (body) {
    let received = 0;
    body = body.pipeThrough(new TransformStream({ transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > 32 * 1024 * 1024) { controller.error(new Error("Upload limit exceeded.")); return; }
      controller.enqueue(chunk);
    } }));
  }
  const response = await runnerRequest(record.sandboxName, record.namespace, route.path, {
    method: request.method, headers: outgoing, body,
    ...({ duplex: "half" } as RequestInit), signal: request.signal,
  });
  response.headers.forEach((value, key) => { if (responseHeaders.has(key)) headers.set(key, value); });
  const location = response.headers.get("location");
  if (location) {
    const target = new URL(location, record.upstreamOrigin + route.path);
    if (target.origin !== record.upstreamOrigin) { await response.body?.cancel(); return new Response("Agent redirect blocked.", { status: 502, headers }); }
    headers.set("location", (publicBase ?? route.prefix) + target.pathname.replace(/^\//, "") + target.search);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (request.method === "HEAD" || [204, 304].includes(response.status)) { await response.body?.cancel(); return new Response(null, { status: response.status, headers }); }
  if (contentType.includes("text/html")) {
    return new Response(injectAgentDocument(await readBounded(response), route.prefix, record.platform, publicBase ?? route.prefix, record.createdAt.getTime() + maximumSessionLifetimeMs), { status: response.status, headers });
  }
  // Bundlers may emit root-relative asset imports; these must stay in this
  // capability's path even when there is no runtime prefix option.
  if (/javascript|text\/css/.test(contentType)) {
    const text = (await readBounded(response)).replace(/(["'(])\/(assets|fonts)\//g, `$1${route.prefix}$2/`);
    return new Response(text, { status: response.status, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}

/** The upstream authenticates an actual backend connection, not a browser
 * device. Never reuse an untrusted browser identity, secret, role or scopes. */
export function openClawConnectFrame(text: string, token: string): string {
  const frame = JSON.parse(text);
  if (frame.type !== "req" || frame.method !== "connect") throw new Error("OpenClaw connect required.");
  return JSON.stringify({ type: "req", id: frame.id, method: "connect", params: {
    minProtocol: 4, maxProtocol: 4,
    client: { id: "gateway-client", version: "tali-relay", platform: "linux", mode: "backend" },
    role: "operator", scopes: ["operator.read", "operator.write", "operator.approvals"],
    caps: ["tool-events"], auth: { token },
  } });
}

export function openClawRequestFrame(text: string): string {
  const frame = JSON.parse(text);
  if (frame.method === "connect" || /^device\.|^node\.pair\./.test(frame.method ?? "")) {
    throw new Error("Credential operation denied.");
  }
  if (frame.method === "sessions.messages.subscribe" && frame.params?.includeApprovals) {
    // 2026.9 requires a paired device for approval-event subscriptions.
    // Relay authenticates as a backend; retain normal message streaming.
    frame.params.includeApprovals = false;
    return JSON.stringify(frame);
  }
  return text;
}

interface Connection { socket: WebSocket; timer: ReturnType<typeof setInterval>; connected: boolean; connectId?: string; platform: string; secret: string; sessionId: string; queue: Array<string | Uint8Array>; queuedBytes: number; }
const connections = new Map<string, Connection>();
import type { Hooks } from "crossws";
const agentWebSocketHooks: Partial<Hooks> = {
  async upgrade(request) {
    const route = parseAgentUiPath(request.url);
    const record = await validateAgentUiSession(route.id, route.credential);
    // CSP gives the native Agent document an opaque origin. A capability is still mandatory.
    if (request.headers.get("origin") !== "null") throw new Response("Invalid Agent document origin.", { status: 403 });
    const runtime = await loadPlatformRuntimeConfiguration();
    return { context: { route, record, runtime } };
  },
  open(peer) {
    try {
      const { route, record, runtime } = peer.context as unknown as { route: ReturnType<typeof parseAgentUiPath>; record: Awaited<ReturnType<typeof validateAgentUiSession>>; runtime: Awaited<ReturnType<typeof loadPlatformRuntimeConfiguration>> };
      if (connections.size >= 128 || [...connections.values()].filter((c) => c.sessionId === record.id).length >= 8) { peer.close(4429, "Connection limit"); return; }
      let path = route.path;
      const secret = upstreamSecret(record);
      const headers: Record<string, string> = { authorization: `Bearer ${runtime.runner.token}`, "x-tali-runtime-target": record.namespace };
      if (record.platform === "hermes") {
        const credentials = hermesCredentials(record);
        headers.cookie = credentials.cookie;
        headers.origin = record.upstreamOrigin;
        const upstreamPath = new URL(path, record.upstreamOrigin);
        upstreamPath.searchParams.delete("ticket");
        upstreamPath.searchParams.set("token", credentials.token);
        path = upstreamPath.pathname + upstreamPath.search;
      }
      const url = `${runtime.runner.url.replace(/^http/, "ws").replace(/\/$/, "")}/v1/sandboxes/${encodeURIComponent(record.sandboxName)}/web-ui${path}`;
      const socket = new WebSocket(url, { headers, maxPayload: 8 * 1024 * 1024, handshakeTimeout: 15_000 });
      const connection: Connection = { socket, connected: record.platform !== "openclaw", platform: record.platform, secret, sessionId: record.id, queue: [], queuedBytes: 0,
        timer: setInterval(() => { void validateAgentUiSession(route.id, route.credential).catch(() => { peer.close(4401, "Agent access expired"); socket.close(); }); }, 10_000) };
      connections.set(peer.id, connection);
      socket.on("open", () => { for (const text of connection.queue) socket.send(text); connection.queue = []; connection.queuedBytes = 0; });
      socket.on("message", (data, binary) => {
        if (peer.bufferedAmount > 8 * 1024 * 1024) { peer.close(1013, "Slow connection"); return; }
        if (record.platform === "openclaw" && !binary) {
          try {
            const frame = JSON.parse(data.toString());
            if (frame.type === "res" && frame.id === connection.connectId && frame.ok) {
              connection.connected = true;
              if (frame.payload?.auth) { delete frame.payload.auth.deviceToken; delete frame.payload.auth.deviceTokens; }
            }
            peer.send(JSON.stringify(frame));
          } catch { peer.close(1011, "Invalid Agent protocol"); }
        } else peer.send(binary ? data : data.toString());
      });
      socket.on("error", () => peer.close(1011, "Agent connection unavailable"));
      socket.on("close", () => peer.close(1000, "Agent connection closed"));
    } catch { peer.close(1011, "Agent connection unavailable"); }
  },
  message(peer, message) {
    const connection = connections.get(peer.id);
    if (!connection) { peer.close(1013, "Agent is connecting"); return; }
    if (message.uint8Array().byteLength > 8 * 1024 * 1024) { peer.close(1009, "Message limit exceeded"); return; }
    if (connection.socket.readyState === WebSocket.CONNECTING && connection.platform === "hermes") {
      const text = typeof message.rawData === "string" ? message.text() : message.uint8Array();
      connection.queuedBytes += Buffer.byteLength(text);
      if (connection.queuedBytes > 1024 * 1024) { peer.close(1009, "Message queue exceeded"); return; }
      connection.queue.push(text); return;
    }
    if (connection.socket.readyState !== WebSocket.OPEN) { peer.close(1013, "Agent is connecting"); return; }
    if (connection.socket.bufferedAmount > 8 * 1024 * 1024) { peer.close(1013, "Slow connection"); return; }
    try {
      if (connection.platform === "openclaw") {
        const text = message.text();
        const frame = JSON.parse(text);
        if (!connection.connected) {
          if (connection.connectId) throw new Error("Duplicate connect.");
          connection.connectId = frame.id;
          connection.socket.send(openClawConnectFrame(text, connection.secret));
        } else {
          connection.socket.send(openClawRequestFrame(text));
        }
      } else connection.socket.send(typeof message.rawData === "string" ? message.text() : message.uint8Array());
    } catch { peer.close(4403, "Agent operation denied"); }
  },
  close(peer) {
    const connection = connections.get(peer.id);
    if (connection) { clearInterval(connection.timer); connection.socket.terminate(); connections.delete(peer.id); }
  },
};
