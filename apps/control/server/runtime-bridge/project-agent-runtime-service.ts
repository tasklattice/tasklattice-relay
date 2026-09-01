import {
  agentGardenEntrySchema,
  a2aAgentInstanceSchema,
  expertAgentVersionSnapshotSchema,
  getAgentPlatformDefinition,
  isAgentPlatformId,
  projectAgentRuntimeInstanceSchema,
  type A2aAgentInstance,
  type AgentGardenEntry,
  type AgentGardenSkill,
  type ExpertAgentVersionSnapshot,
} from "@tali/contracts";
import { getControlConfig } from "../config/control-config";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { createSecretStore, type SecretStore } from "../secrets/secret-store";
import { AgentGardenStore } from "../agent-garden/agent-garden-store";
import { databaseAgentCatalog } from "../agent-garden/database-agent-catalog";
import { deriveProjectRuntimeExpertAgentA2aToken } from "./project-runtime-bridge-token";

export interface ProjectA2aPeer {
  description: string;
  id: string;
  name: string;
  protocolVersion: "1.0";
  skills: AgentGardenSkill[];
  timeoutSeconds: number;
  delegation?: {
    canRunIndependently: true;
    receivesWhen: string[];
    delegatesTo: string[];
  };
}

interface ResolvedInstance {
  agent: AgentGardenEntry;
  instance: A2aAgentInstance;
}

interface ResolvedExpertAgent {
  agentId: string;
  contentDigest: string;
  endpoint: string;
  instanceId: string;
  versionNumber: number;
  versionId: string;
  snapshot: ExpertAgentVersionSnapshot;
}

function expertDelegationMetadata(snapshot: ExpertAgentVersionSnapshot) {
  return {
    canRunIndependently: true as const,
    receivesWhen: snapshot.product.delegationGuidance ?? [],
    delegatesTo: snapshot.delegations
      .filter((delegation) => delegation.enabled)
      .map((delegation) => delegation.expertAgentId),
  };
}

const MAX_A2A_RESPONSE_BYTES = 1024 * 1024;

async function limitedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MAX_A2A_RESPONSE_BYTES
  ) {
    throw new Error("The callable A2A Instance response exceeded the 1 MiB limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_A2A_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The callable A2A Instance response exceeded the 1 MiB limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function jsonRpcError(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function requestId(payload: unknown): unknown {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { id?: unknown }).id
    : null;
}

function jsonRpcSendMessageParams(payload: unknown): unknown | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const request = payload as { method?: unknown; params?: unknown };
  return request.method === "SendMessage"
    && request.params
    && typeof request.params === "object"
    && !Array.isArray(request.params)
      ? request.params
      : undefined;
}

function httpJsonSendMessageEndpoint(endpoint: string): string {
  return `${endpoint.replace(/\/$/, "")}/message:send`;
}

export class ProjectAgentRuntimeService {
  constructor(
    readonly projectId: string,
    private readonly db: PrismaClient = prisma(),
    private readonly secrets: SecretStore = createSecretStore(),
  ) {}

  async listPeers(coordinatorInstanceId: string): Promise<ProjectA2aPeer[]> {
    const [instances, experts] = await Promise.all([
      this.instances(coordinatorInstanceId),
      this.expertAgents(coordinatorInstanceId),
    ]);
    return [...instances.map(({ agent, instance }) => {
      return {
        id: instance.id,
        name: instance.name,
        description: instance.description,
        protocolVersion: "1.0" as const,
        timeoutSeconds: 120,
        skills: instance.skills.length ? instance.skills : agent.skills,
      };
    }), ...experts.map((expert) => ({
      id: expert.instanceId,
      name: expert.snapshot.product.name,
      description: expert.snapshot.product.purpose,
      protocolVersion: "1.0" as const,
      timeoutSeconds: Math.ceil(expert.snapshot.execution.timeoutMs / 1_000),
      delegation: expertDelegationMetadata(expert.snapshot),
      skills: expert.snapshot.product.capabilities.map((capability, index) => ({
        id: `capability-${index + 1}`,
        name: capability.slice(0, 200),
        description: capability,
        tags: [expert.snapshot.execution.mode.toLowerCase()],
      })),
    }))];
  }

  async listExpertPeers(
    coordinatorInstanceId: string,
  ): Promise<ProjectA2aPeer[]> {
    return (await this.expertAgents(coordinatorInstanceId)).map((expert) => ({
      id: expert.instanceId,
      name: expert.snapshot.product.name,
      description: expert.snapshot.product.purpose,
      protocolVersion: "1.0" as const,
      timeoutSeconds: Math.ceil(expert.snapshot.execution.timeoutMs / 1_000),
      delegation: expertDelegationMetadata(expert.snapshot),
      skills: expert.snapshot.product.capabilities.map((capability, index) => ({
        id: `capability-${index + 1}`,
        name: capability.slice(0, 200),
        description: capability,
        tags: [expert.snapshot.execution.mode.toLowerCase()],
      })),
    }));
  }

  async agentCard(
    coordinatorInstanceId: string,
    agentId: string,
    publicEndpoint: string,
  ): Promise<unknown> {
    const expert = await this.expertAgent(coordinatorInstanceId, agentId);
    if (expert) {
      return {
        name: expert.snapshot.product.name,
        description: expert.snapshot.product.purpose,
        version: `v${expert.versionNumber}`,
        supportedInterfaces: [{
          url: publicEndpoint,
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        }],
        capabilities: {
          streaming: false,
          pushNotifications: false,
          extendedAgentCard: false,
        },
        defaultInputModes: ["text/plain"],
        defaultOutputModes: ["text/plain", "application/json"],
        metadata: {
          tali: {
            agentId: expert.agentId,
            instanceId: expert.instanceId,
            versionId: expert.versionId,
            ...expertDelegationMetadata(expert.snapshot),
          },
        },
        skills: expert.snapshot.product.capabilities.map((capability, index) => ({
          id: `capability-${index + 1}`,
          name: capability.slice(0, 200),
          description: capability,
          tags: [expert.snapshot.execution.mode.toLowerCase()],
        })),
      };
    }
    const { agent, instance } = await this.instance(
      coordinatorInstanceId,
      agentId,
    );
    const skills = instance.skills.length ? instance.skills : agent.skills;
    return {
      name: instance.name,
      description: instance.description,
      version: agent.configuration.catalogVersion ?? "1.0.0",
      supportedInterfaces: [{
        url: publicEndpoint,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
        ...(instance.a2a?.tenant ? { tenant: instance.a2a.tenant } : {}),
      }],
      capabilities: {
        streaming: false,
        pushNotifications: false,
        extendedAgentCard: false,
      },
      defaultInputModes: instance.a2a?.defaultInputModes ?? ["text/plain"],
      defaultOutputModes: instance.a2a?.defaultOutputModes ?? ["text/plain"],
      skills,
    };
  }

  async sendMessage(
    coordinatorInstanceId: string,
    agentId: string,
    payload: unknown,
  ): Promise<{ body: unknown; status: number }> {
    const expert = await this.expertAgent(coordinatorInstanceId, agentId);
    if (expert) return this.sendExpertMessage(expert, payload);
    const { agent, instance } = await this.instance(
      coordinatorInstanceId,
      agentId,
    );
    if (!instance.endpoint) {
      throw new Error("Callable A2A Instance endpoint is unavailable.");
    }
    const headers = new Headers({
      accept: "application/a2a+json, application/json",
      "content-type": "application/json",
      "a2a-version": "1.0",
    });
    if (agent.authReference) {
      const credential = await this.secrets.get(agent.authReference);
      if (agent.authType === "bearer_token") {
        headers.set("authorization", `Bearer ${credential}`);
      } else if (agent.authType === "api_key") {
        headers.set("x-api-key", credential);
      }
    }
    const httpJsonParams = instance.a2a?.protocolBinding === "HTTP+JSON"
      ? jsonRpcSendMessageParams(payload)
      : undefined;
    if (instance.a2a?.protocolBinding === "HTTP+JSON" && !httpJsonParams) {
      return {
        status: 200,
        body: jsonRpcError(
          requestId(payload),
          -32601,
          "The callable HTTP+JSON Instance supports SendMessage only.",
        ),
      };
    }
    const endpoint = httpJsonParams
      ? httpJsonSendMessageEndpoint(instance.endpoint)
      : instance.endpoint;
    if (httpJsonParams) headers.set("content-type", "application/a2a+json");
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(httpJsonParams ?? payload),
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    const text = await limitedResponseText(response);
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      if (response.ok) {
        return {
          status: 502,
          body: jsonRpcError(
            requestId(payload),
            -32002,
            "The callable A2A Instance returned a non-JSON response.",
          ),
        };
      }
    }
    if (httpJsonParams) {
      return response.ok
        ? {
            status: response.status,
            body: {
              jsonrpc: "2.0",
              id: requestId(payload),
              result: body,
            },
          }
        : {
            status: response.status,
            body: jsonRpcError(
              requestId(payload),
              -32002,
              `The callable HTTP+JSON Instance returned HTTP ${response.status}.`,
            ),
          };
    }
    return { status: response.status, body };
  }

  async sendExpertAgentMessage(
    instanceId: string,
    payload: unknown,
  ): Promise<{ body: unknown; status: number }> {
    const expert = await this.activeExpertAgent(instanceId);
    if (!expert) throw new Error("Agent Instance A2A Runtime was not found.");
    return this.sendExpertMessage(expert, payload);
  }

  private async sendExpertMessage(
    expert: ResolvedExpertAgent,
    payload: unknown,
  ): Promise<{ body: unknown; status: number }> {
    const token = deriveProjectRuntimeExpertAgentA2aToken({
      projectId: this.projectId,
      namespace: await this.runtimeNamespace(),
      agentId: expert.agentId,
      versionId: expert.versionId,
      contentDigest: expert.contentDigest,
    }, getControlConfig().auth.secret);
    const response = await fetch(expert.endpoint, {
      method: "POST",
      headers: {
        accept: "application/a2a+json, application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "a2a-version": "1.0",
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(
        900_000,
        Math.max(1_000, expert.snapshot.execution.timeoutMs),
      )),
    });
    const text = await limitedResponseText(response);
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      if (response.ok) {
        return {
          status: 502,
          body: jsonRpcError(
            requestId(payload),
            -32002,
            "The Expert Agent returned a non-JSON response.",
          ),
        };
      }
    }
    return { status: response.status, body };
  }

  private async runtimeNamespace(): Promise<string> {
    const target = await this.db.projectRuntimeTarget.findUnique({
      where: { projectId: this.projectId },
      select: { namespace: true, status: true },
    });
    if (!target || target.status !== "ready") {
      throw new Error("Project Runtime Namespace is not ready.");
    }
    return target.namespace;
  }

  private async requireCoordinator(coordinatorInstanceId: string): Promise<void> {
    const coordinator = await this.db.agentRecord.findFirst({
      where: {
        projectId: this.projectId,
        id: coordinatorInstanceId,
        kind: "SUPERVISOR",
        deletedAt: null,
      },
      select: { payload: true },
    });
    if (!coordinator) throw new Error("Coordinator Instance was not found.");
    const coordinatorPayload = coordinator.payload
      && typeof coordinator.payload === "object"
      && !Array.isArray(coordinator.payload)
      ? coordinator.payload as Record<string, unknown>
      : {};
    const platformId = coordinatorPayload.agentPlatform;
    if (
      typeof platformId !== "string"
      || !isAgentPlatformId(platformId)
      || !getAgentPlatformDefinition(platformId).capabilities.canDelegate
    ) {
      throw new Error("This Instance runtime cannot delegate A2A tasks.");
    }
  }

  private async expertAgents(
    coordinatorInstanceId: string,
  ): Promise<ResolvedExpertAgent[]> {
    await this.requireCoordinator(coordinatorInstanceId);
    return this.activeExpertAgents();
  }

  private async activeExpertAgents(): Promise<ResolvedExpertAgent[]> {
    const rows = await this.db.agentRecord.findMany({
      where: {
        projectId: this.projectId,
        kind: "PROJECT_AGENT",
        developedAgentId: { not: null },
        agentVersionId: { not: null },
        deletedAt: null,
        developedAgent: { deletedAt: null },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        agentVersion: true,
      },
    });
    return rows.flatMap((row) => {
      if (!row.agentVersion || !row.developedAgentId) return [];
      const parsedInstance = projectAgentRuntimeInstanceSchema.safeParse(row.payload);
      if (
        !parsedInstance.success
        || parsedInstance.data.status !== "READY"
        || !parsedInstance.data.endpoint
      ) return [];
      const snapshot = expertAgentVersionSnapshotSchema.parse(row.agentVersion.snapshot);
      return [{
        instanceId: row.id,
        agentId: row.developedAgentId,
        contentDigest: row.agentVersion.contentDigest,
        endpoint: parsedInstance.data.endpoint,
        versionNumber: row.agentVersion.versionNumber,
        versionId: row.agentVersion.id,
        snapshot,
      }];
    });
  }

  private async activeExpertAgent(
    instanceId: string,
  ): Promise<ResolvedExpertAgent | undefined> {
    return (await this.activeExpertAgents()).find(
      (expert) => expert.instanceId === instanceId,
    );
  }

  private async expertAgent(
    coordinatorInstanceId: string,
    instanceId: string,
  ): Promise<ResolvedExpertAgent | undefined> {
    return (await this.expertAgents(coordinatorInstanceId)).find(
      (expert) => expert.instanceId === instanceId,
    );
  }

  private async instances(
    coordinatorInstanceId: string,
  ): Promise<ResolvedInstance[]> {
    await new AgentGardenStore(this.projectId, this.db).ensureAgents(
      databaseAgentCatalog,
    );
    await this.requireCoordinator(coordinatorInstanceId);
    const rows = await this.db.agentRecord.findMany({
      where: {
        projectId: this.projectId,
        kind: "A2A",
        deletedAt: null,
        catalogAgent: { deletedAt: null },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        payload: true,
        catalogAgent: { select: { payload: true } },
      },
    });
    return rows
      .map((row) => ({
        instance: a2aAgentInstanceSchema.parse(row.payload),
        agent: agentGardenEntrySchema.parse(row.catalogAgent!.payload),
      }))
      .filter(({ agent, instance }) =>
        instance.status === "READY"
        && Boolean(instance.endpoint)
        && Boolean(instance.agentCardUrl)
        && Boolean(instance.a2a)
        && agent.status === "READY"
        && agent.integrationType === "a2a"
        && (agent.usageMode === "CALLABLE" || agent.usageMode === "HYBRID")
        && agent.usageCapabilities.acceptsDelegation
      );
  }

  private async instance(
    coordinatorInstanceId: string,
    agentId: string,
  ): Promise<ResolvedInstance> {
    const found = (await this.instances(coordinatorInstanceId)).find(
      ({ instance }) => instance.id === agentId,
    );
    if (!found) throw new Error("Callable A2A Instance was not found.");
    return found;
  }
}
