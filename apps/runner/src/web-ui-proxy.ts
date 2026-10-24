import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import { openShellWebUiOrigin } from "./openshell.js";
import { resolveOpenShellTarget } from "./runtime-target.js";

const hopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const allowedHeaders = new Set(["accept", "accept-language", "content-type", "content-length", "range", "if-range", "if-none-match", "if-modified-since", "cookie", "origin", "x-forwarded-prefix", "x-hermes-session-token", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol"]);

/** This endpoint is reachable only after the Runner's service authentication. */
export function webUiProxyOptions(incoming: IncomingMessage) {
  const match = (incoming.url ?? "").match(/^\/v1\/sandboxes\/([a-z][a-z0-9-]{0,61}[a-z0-9])\/web-ui(\/[^#]*)$/);
  if (!match) throw new Error("Invalid Web UI route.");
  const namespace = incoming.headers["x-tali-runtime-target"];
  if (typeof namespace !== "string") throw new Error("Project scope is required.");
  const target = resolveOpenShellTarget({ namespace });
  if (!target) throw new Error("Project scope is required.");
  const upstream = new URL(target.gatewayEndpoint);
  const headers: Record<string, string | string[]> = {};
  const connectionHeaders = new Set(String(incoming.headers.connection ?? "").toLowerCase().split(",").map((value) => value.trim()));
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value && allowedHeaders.has(key) && !hopHeaders.has(key) && !connectionHeaders.has(key)) headers[key] = value;
  }
  // Never accept a browser-selected upstream or forward the Runner credential.
  headers.host = new URL(openShellWebUiOrigin(match[1]!, target)).host;
  headers["accept-encoding"] = "identity";
  if (incoming.headers.upgrade === "websocket") {
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
  }
  return { upstream, options: { method: incoming.method, path: match[2]!, headers } };
}

export function proxyWebUiHttp(incoming: IncomingMessage, response: ServerResponse): void {
  try {
    const { upstream, options } = webUiProxyOptions(incoming);
    const request = (upstream.protocol === "https:" ? httpsRequest : httpRequest)(upstream, options, (result) => {
      response.writeHead(result.statusCode ?? 502, result.headers);
      result.pipe(response);
      result.on("error", () => response.destroy());
    });
    request.setTimeout(120_000, () => request.destroy());
    request.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end("Agent Web UI unavailable.");
    });
    incoming.on("aborted", () => request.destroy());
    response.on("close", () => request.destroy());
    incoming.pipe(request);
  } catch {
    response.writeHead(400);
    response.end("Invalid Agent Web UI route.");
  }
}

export function proxyWebUiUpgrade(incoming: IncomingMessage, socket: Duplex, head: Buffer): void {
  try {
    const { upstream, options } = webUiProxyOptions(incoming);
    const request = (upstream.protocol === "https:" ? httpsRequest : httpRequest)(upstream, options);
    const timer = setTimeout(() => request.destroy(), 15_000);
    request.on("upgrade", (response, upstreamSocket, upstreamHead) => {
      clearTimeout(timer);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
        .map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
      if (head.length) upstreamSocket.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      socket.pipe(upstreamSocket).pipe(socket);
      socket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.on("error", () => socket.destroy());
      socket.on("close", () => upstreamSocket.destroy());
      upstreamSocket.on("close", () => socket.destroy());
    });
    request.on("response", () => { clearTimeout(timer); socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"); request.destroy(); });
    request.on("error", () => { clearTimeout(timer); socket.destroy(); });
    socket.on("close", () => request.destroy());
    request.end();
  } catch {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  }
}
