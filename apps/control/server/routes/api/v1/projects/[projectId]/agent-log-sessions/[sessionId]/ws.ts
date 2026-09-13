import { defineWebSocketHandler } from "nitro";
import type { ManagedAgentLogHandle } from "../../../../../../../kubernetes/managed-agent-log-stream";
import { KubernetesManagedAgentLogStream } from "../../../../../../../kubernetes/managed-agent-log-stream";
import { getAgentInstanceDetailServiceForProject } from "../../../../../../../services";
import {
  consumeAgentLogSession,
  type AgentLogSessionRecord,
} from "../../../../../../../terminal/agent-log-sessions";

interface AgentLogPeerContext {
  session: AgentLogSessionRecord;
}

interface AgentLogConnection {
  handle?: ManagedAgentLogHandle;
  timeout: ReturnType<typeof setTimeout>;
}

const connections = new Map<string, AgentLogConnection>();
const maxSessionMs = 30 * 60_000;

function closeConnection(peerId: string): void {
  const connection = connections.get(peerId);
  if (!connection) return;
  connections.delete(peerId);
  clearTimeout(connection.timeout);
  connection.handle?.close();
}

export default defineWebSocketHandler({
  async upgrade(request) {
    const url = new URL(request.url);
    const sessionId = url.pathname.split("/").at(-2) ?? "";
    const token = url.searchParams.get("token") ?? "";
    const session = consumeAgentLogSession(sessionId, token);
    if (!session) throw new Response("Invalid Agent log session.", { status: 401 });
    const projectId = decodeURIComponent(url.pathname.split("/")[4] ?? "");
    if (projectId !== session.projectId) {
      throw new Response("Invalid project context.", { status: 401 });
    }
    const detail = await getAgentInstanceDetailServiceForProject(projectId).get(
      session.instanceId,
    );
    if (
      !detail
      || (detail.kind !== "A2A" && detail.kind !== "PROJECT_AGENT")
      || detail.status !== "READY"
      || (!detail.instance.podName && !detail.runtimeView.workloadName)
    ) {
      throw new Response("The managed Agent runtime is not available.", { status: 409 });
    }
    return { context: { session } };
  },
  async open(peer) {
    const { session } = peer.context as unknown as AgentLogPeerContext;
    const connection: AgentLogConnection = {
      timeout: setTimeout(() => {
        if (!connections.has(peer.id)) return;
        peer.send("\r\n[control] Live log session reached its 30 minute limit.\r\n");
        peer.close(1000, "Log session limit reached");
        closeConnection(peer.id);
      }, maxSessionMs),
    };
    connections.set(peer.id, connection);
    try {
      const detail = await getAgentInstanceDetailServiceForProject(
        session.projectId,
      ).get(session.instanceId);
      if (
        !detail
        || (detail.kind !== "A2A" && detail.kind !== "PROJECT_AGENT")
      ) {
        throw new Error("Agent Instance is no longer available.");
      }
      peer.send(
        `[control] Following ${detail.runtimeView.namespace}/${detail.runtimeView.podName ?? detail.runtimeView.workloadName} (read-only)\r\n`,
      );
      const logs = new KubernetesManagedAgentLogStream();
      const callbacks = {
        onData: (data: string) => peer.send(data),
        onError: (error: Error) => {
          peer.send(`\r\n[control] Log stream error: ${error.message}\r\n`);
          peer.close(1011, "Kubernetes log stream failed");
          closeConnection(peer.id);
        },
        onEnd: () => {
          peer.send("\r\n[control] Log stream ended.\r\n");
          peer.close(1000, "Log stream ended");
          closeConnection(peer.id);
        },
      };
      connection.handle = detail.kind === "PROJECT_AGENT"
        ? await logs.openProjectAgent(
            session.projectId,
            {
              agentId: detail.id,
              namespace: detail.runtimeView.namespace!,
              workloadName: detail.runtimeView.workloadName!,
            },
            session.options,
            callbacks,
          )
        : await logs.open(
            session.projectId,
            detail.instance,
            session.options,
            callbacks,
          );
    } catch (error) {
      peer.send(
        `\r\n[control] ${error instanceof Error ? error.message : "Unable to open the Kubernetes log stream."}\r\n`,
      );
      peer.close(1011, "Kubernetes log stream unavailable");
      closeConnection(peer.id);
    }
  },
  message(peer) {
    peer.send("\r\n[control] This log session is read-only.\r\n");
  },
  close(peer) {
    closeConnection(peer.id);
  },
});
