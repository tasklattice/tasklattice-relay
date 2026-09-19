import { getRunnerConfig } from "./runner-config.js";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import { resolveOpenShellTarget } from "./runtime-target.js";

import { projectRuntimeNamespaceSchema } from "@tali/contracts";

export interface ProjectServiceRoute {
  upstreamHost: string;
  upstreamPort: number;
  upstreamProtocol: "http:" | "https:";
  workspace: string;
}

function hostname(value: string): string {
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return "";
  }
}

export function projectServiceRoute(
  hostHeader: string | undefined,
  baseUrl = getRunnerConfig().openshell.serviceBaseUrl
    ?? "http://openshell.localhost:8080",
): ProjectServiceRoute | undefined {
  if (!hostHeader) return undefined;
  const requestedHost = hostname(hostHeader);
  const baseHost = new URL(baseUrl).hostname;
  const suffix = `.${baseHost}`;
  if (!requestedHost.endsWith(suffix)) return undefined;
  const routeName = requestedHost.slice(0, -suffix.length);
  const [workspace = "", sandbox = "", service = "", ...extra] =
    routeName.split("--");
  const resourcePattern = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
  if (
    extra.length
    || !projectRuntimeNamespaceSchema.safeParse(workspace).success
    || !resourcePattern.test(sandbox)
    || !resourcePattern.test(service)
  ) return undefined;
  const target = resolveOpenShellTarget({ namespace: workspace });
  if (!target) return undefined;
  const upstream = new URL(target.gatewayEndpoint);
  return {
    upstreamHost: upstream.hostname,
    upstreamPort: Number(upstream.port || (upstream.protocol === "https:" ? 443 : 80)),
    upstreamProtocol: upstream.protocol as "http:" | "https:",
    workspace,
  };
}

function reject(socket: Duplex, status: number, message: string): void {
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} Bad Request\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

function upstreamOptions(request: IncomingMessage, route: ProjectServiceRoute) {
  return {
    host: route.upstreamHost,
    port: route.upstreamPort,
    method: request.method,
    path: request.url,
    headers: request.headers,
  };
}

function projectGatewayRequest(route: ProjectServiceRoute) {
  return route.upstreamProtocol === "https:" ? httpsRequest : httpRequest;
}

export function startProjectServiceProxy(): ReturnType<typeof createServer> | undefined {
  if (!projectServiceProxyEnabled()) return undefined;
  const port = Number(getRunnerConfig().openshell.serviceProxy.port ?? "8080");
  const host = getRunnerConfig().openshell.serviceProxy.host ?? "0.0.0.0";
  const server = createServer((incoming, response) => {
    if (incoming.url === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok\n");
      return;
    }
    const route = projectServiceRoute(incoming.headers.host);
    if (!route) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("Invalid Project OpenShell service route.\n");
      return;
    }
    const upstream = projectGatewayRequest(route)(
      upstreamOptions(incoming, route),
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain" });
      }
      response.end(`Project OpenShell Gateway unavailable: ${error.message}\n`);
    });
    incoming.pipe(upstream);
  });
  server.on("upgrade", (incoming, socket, head) => {
    const route = projectServiceRoute(incoming.headers.host);
    if (!route) return void reject(socket, 400, "Invalid Project OpenShell service route.");
    const upstream = projectGatewayRequest(route)(upstreamOptions(incoming, route));
    upstream.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      const status = upstreamResponse.statusCode ?? 101;
      const statusMessage = upstreamResponse.statusMessage ?? "Switching Protocols";
      const headers = Object.entries(upstreamResponse.headers)
        .flatMap(([name, value]) =>
          Array.isArray(value)
            ? value.map((item) => `${name}: ${item}\r\n`)
            : value === undefined
              ? []
              : [`${name}: ${value}\r\n`],
        )
        .join("");
      socket.write(`HTTP/1.1 ${status} ${statusMessage}\r\n${headers}\r\n`);
      if (head.length) upstreamSocket.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on("error", () => reject(socket, 502, "Project OpenShell Gateway unavailable."));
    upstream.end();
  });
  server.listen(port, host, () => {
    console.log(`Project OpenShell service proxy listening on ${host}:${port}`);
  });
  return server;
}

export function projectServiceProxyEnabled(): boolean {
  return getRunnerConfig().openshell.serviceProxy.enabled;
}
