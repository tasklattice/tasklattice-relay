import { createStructuredLogger, serializeError } from "../../../../../../../observability/structured-logger";
import { WebSocket } from "ws";
import { defineWebSocketHandler } from "nitro";
import type { InstanceService } from "../../../../../../../instances/instance-service";
import { getInstanceServiceForProject } from "../../../../../../../services";
import { BufferedTerminalInput } from "../../../../../../../terminal/buffered-terminal-input";
import {
  consumeTerminalSession,
  type TerminalSessionRecord,
} from "../../../../../../../terminal/terminal-sessions";

interface TerminalPeerContext {
  service: InstanceService;
  session: TerminalSessionRecord;
}

interface TerminalConnection {
  input: BufferedTerminalInput;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

const logger = createStructuredLogger("control-terminal");

const connections = new Map<string, TerminalConnection>();
const connectTimeoutMs = 15_000;

function clearConnectionTimeout(connection: TerminalConnection): void {
  if (!connection.timeout) return;
  clearTimeout(connection.timeout);
  connection.timeout = undefined;
}

export default defineWebSocketHandler({
  async upgrade(request) {
    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const sessionId = segments.at(-2) ?? "";
    const token = url.searchParams.get("token") ?? "";
    const session = consumeTerminalSession(sessionId, token);
    if (!session)
      throw new Response("Invalid terminal session.", { status: 401 });
    const projectId = decodeURIComponent(url.pathname.split("/")[4] ?? "");
    if (projectId !== session.projectId)
      throw new Response("Invalid project context.", { status: 401 });
    // Browser WebSocket clients cannot attach the Bearer header used by the
    // JSON API. The short-lived, single-use terminal token was issued only
    // after the caller passed Project authorization, so it is the capability
    // for this upgrade. Scope the service exclusively from that token rather
    // than trying to authenticate the WebSocket as a second HTTP request.
    const service = getInstanceServiceForProject(session.projectId);
    const agent = await service.get(session.agentId);
    if (!agent || agent.status !== "READY")
      throw new Response(
        "Terminal is available only when the Agent is healthy and running.",
        { status: 409 },
      );
    return { context: { service, session } };
  },
  async open(peer) {
    const { service, session } = peer.context as unknown as TerminalPeerContext;
    const connectionId = peer.id.slice(0, 8);
    logger.log("info", "terminal.connecting", {
      connectionId, sandboxName: session.sandboxName,
    });
    const connection: TerminalConnection = {
      input: new BufferedTerminalInput(),
      timeout: undefined,
    };
    connections.set(peer.id, connection);
    connection.timeout = setTimeout(() => {
      if (connections.get(peer.id) !== connection) return;
      connections.delete(peer.id);
      logger.log("error", "terminal.connect_timeout", { connectionId, timeoutMs: connectTimeoutMs });
      peer.send(
        "\r\nUnable to open the runtime terminal before the connection timeout.\r\n",
      );
      peer.close(1011, "Runtime terminal connection timed out");
      connection.input.close();
    }, connectTimeoutMs);

    try {
      const [upstreamUrl, headers] = await Promise.all([
        service.runner.terminalWebSocketUrl(
          session.sandboxName,
          session.agentPlatform,
          await service.runnerRuntimeTarget(),
        ),
        service.runner.authorizationHeaders(),
      ]);
      if (connections.get(peer.id) !== connection) return;

      const upstream = new WebSocket(upstreamUrl, { headers });
      connection.input.attach(upstream);
      upstream.on("open", () => {
        logger.log("info", "terminal.connected", { connectionId });
        connection.input.flush();
      });
      upstream.once("message", () => clearConnectionTimeout(connection));
      upstream.on("message", (data) => peer.send(data));
      upstream.on("close", (code, reason) => {
        clearConnectionTimeout(connection);
        logger.log(code === 1000 || code === 1001 || code === 1005 ? "info" : "warning",
          "terminal.upstream_closed", { connectionId, code });
        peer.close(
          code === 1005 || code === 1006 ? 1011 : code,
          reason.toString(),
        );
      });
      upstream.on("error", (error) => {
        clearConnectionTimeout(connection);
        logger.log("error", "terminal.upstream_failed", { connectionId, ...serializeError(error) });
        peer.close(1011, "Runtime terminal unavailable");
      });
    } catch (error) {
      if (connections.get(peer.id) !== connection) return;
      clearConnectionTimeout(connection);
      connections.delete(peer.id);
      connection.input.close();
      logger.log("error", "terminal.connect_failed", { connectionId, ...serializeError(error) });
      peer.close(1011, "Runtime terminal unavailable");
    }
  },
  message(peer, message) {
    const connection = connections.get(peer.id);
    if (!connection) return;
    connection.input.write(message.text());
  },
  close(peer) {
    const connection = connections.get(peer.id);
    if (!connection) return;
    clearConnectionTimeout(connection);
    connections.delete(peer.id);
    connection.input.close();
  },
});
