import { createHash } from "node:crypto";
import type {
  Instance as Agent,
  InstanceCreator,
  AgentSpecializationDefinition,
  ResourceKind,
  KnowledgeSourceDefinition,
  InferenceGateway,
  DepartmentInferenceAvailability,
  InferenceResourceOrigin,
  ModelRouting,
  ModelRoutingAuditEvent,
  ModelRoutingBinding,
  McpServerDefinition,
  McpToolDefinition,
  ModelDeployment,
  ProviderAccount,
  SandboxPolicy,
  SkillDefinition,
} from "@tali/contracts";
import { prisma } from "../db/prisma";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { CostAnalyticsStore } from "../providers/cost-analytics-store";
import {
  EmbeddingModelDependencyService,
  type EmbeddingModelRemovalImpact,
} from "../providers/embedding-model-dependency-service";

type ResourceDelegateName =
  | "skillRecord"
  | "mcpServerRecord"
  | "knowledgeSourceRecord"
  | "agentSpecializationRecord";

function costKeyIdentifier(value: string): string {
  return value.startsWith("sha256:")
    ? value
    : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function decode<T>(payload: Prisma.JsonValue): T {
  return payload as T;
}

function decodeSkillDefinition(payload: unknown): SkillDefinition {
  const {
    bindings: _legacyBindings,
    ...skill
  } = payload as unknown as SkillDefinition & { bindings?: number };
  return skill;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function agentPayload(agent: Agent): Prisma.InputJsonValue {
  const {
    accessPolicyIds: _accessPolicyIds,
    createdBy: _createdBy,
    ...payload
  } = agent;
  return jsonInput(payload);
}

function agentCreator(
  user: Omit<InstanceCreator, "username"> & { username: string | null },
): InstanceCreator {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username ?? user.displayName,
  };
}

function mcpConnectionPayload(server: McpServerDefinition): Prisma.InputJsonValue {
  const {
    id: _id,
    litellmServerId: _litellmServerId,
    status: _status,
    tools: _tools,
    lastDiscoveryAttemptAt: _lastDiscoveryAttemptAt,
    lastDiscoveredAt: _lastDiscoveredAt,
    lastDiscoveryError: _lastDiscoveryError,
    ...connection
  } = server;
  return jsonInput(connection);
}

export function parseAgent(
  payload: string | Prisma.JsonValue,
  accessPolicyIds: string[] = [],
  createdBy?: InstanceCreator,
): Agent {
  const agent = (typeof payload === "string" ? JSON.parse(payload) : payload) as Partial<Agent>;
  if (
    agent.schemaVersion !== 2 ||
    typeof agent.id !== "string" ||
    typeof agent.name !== "string" ||
    typeof agent.sandboxName !== "string" ||
    typeof agent.model !== "string" ||
    typeof agent.systemPrompt !== "string" ||
    typeof agent.createdAt !== "string" ||
    typeof agent.updatedAt !== "string" ||
    !Array.isArray(agent.logs) ||
    agent.inferenceMode !== "PLATFORM_MANAGED" ||
    typeof agent.modelRoutingId !== "string" ||
    typeof agent.modelRoutingBindingId !== "string" ||
    typeof agent.modelRoutingKeyFingerprint !== "string" ||
    !agent.modelRoutingCapabilities ||
    !agent.modelRoutingComplianceDomain ||
    !agent.modelRoutingStatus
  ) throw new Error("Stored Instance data is incomplete.");
  const { createdBy: _storedCreator, ...configuration } = agent;
  return {
    ...configuration,
    accessPolicyIds,
    ...(createdBy ? { createdBy } : {}),
  } as Agent;
}

function parseCurrentAgent(
  payload: Prisma.JsonValue,
  accessPolicyIds: string[],
  createdBy?: InstanceCreator,
): Agent | undefined {
  const candidate = payload as Partial<Agent>;
  return candidate.schemaVersion === 2
    ? parseAgent(payload, accessPolicyIds, createdBy)
    : undefined;
}

function parseProviderAccount(payload: Prisma.JsonValue): ProviderAccount {
  return decode<ProviderAccount>(payload);
}

function parseModelDeployment(payload: Prisma.JsonValue): ModelDeployment {
  return decode<ModelDeployment>(payload);
}

function canonicalModelRouting(routing: ModelRouting): ModelRouting {
  return {
    ...routing,
    publicModelAlias: `tali-routing-${routing.id}`,
  };
}

function parseModelRouting(payload: Prisma.JsonValue): ModelRouting {
  return canonicalModelRouting(decode<ModelRouting>(payload));
}

function departmentOrigin<T extends object>(
  resource: T,
  department: { id: string; name: string },
  access: Partial<Pick<
    InferenceResourceOrigin,
    "accessSources" | "routingDependencyIds" | "projectDefault"
  >> = {},
): T {
  return {
    ...resource,
    origin: {
      scope: "DEPARTMENT",
      scopeId: department.id,
      scopeName: department.name,
      inherited: true,
      editable: false,
      ...access,
    },
  };
}

function bindingOrigin(
  binding: {
    projectInheritedAt: Date | null;
    departmentAssignedAt: Date | null;
    defaultFor?: string | null;
    defaultManagedBy?: string | null;
  } | undefined,
  routingDependencyIds: string[] = [],
): Partial<Pick<
  InferenceResourceOrigin,
  "accessSources" | "routingDependencyIds" | "projectDefault"
>> {
  const accessSources: NonNullable<InferenceResourceOrigin["accessSources"]> = [];
  if (binding?.projectInheritedAt) accessSources.push("PROJECT_INHERITANCE");
  if (binding?.departmentAssignedAt) accessSources.push("DEPARTMENT_ASSIGNMENT");
  if (routingDependencyIds.length) accessSources.push("ROUTING_DEPENDENCY");
  const defaultSlot = binding?.defaultFor;
  const defaultManager = binding?.defaultManagedBy;
  return {
    accessSources,
    ...(routingDependencyIds.length ? { routingDependencyIds } : {}),
    ...(defaultSlot && defaultManager
      ? {
          projectDefault: {
            slot: defaultSlot as "CHAT" | "EMBEDDING" | "SPEECH_TO_TEXT",
            managedBy: defaultManager as "PROJECT" | "DEPARTMENT",
          },
        }
      : {}),
  };
}

function withoutInferenceOrigin<T extends { origin?: unknown }>(resource: T): Omit<T, "origin"> {
  const { origin: _origin, ...stored } = resource;
  return stored;
}

export function routingDeploymentIds(routing: ModelRouting): Set<string> {
  const policy = routing.routingPolicy;
  if (policy.mode === "SINGLE") {
    return new Set([policy.modelDeploymentId, ...policy.fallbackModelDeploymentIds]);
  }
  if (policy.mode === "COMPLEXITY") {
    return new Set([
      policy.simpleModelDeploymentId,
      policy.complexModelDeploymentId,
      ...policy.fallbackModelDeploymentIds,
    ]);
  }
  return new Set([
    policy.defaultModelDeploymentId,
    policy.embeddingModelDeploymentId,
    ...policy.routes.map((route) => route.modelDeploymentId),
    ...policy.fallbackModelDeploymentIds,
  ]);
}

export class ProjectStore {
  private readonly costs: CostAnalyticsStore;
  readonly projectId: string;
  private readonly db: PrismaClient;

  constructor(
    projectId = "individual",
    db?: PrismaClient,
  ) {
    this.projectId = projectId;
    this.db = db ?? prisma();
    this.costs = new CostAnalyticsStore(this.db, this.projectId);
  }

  costAnalytics(): CostAnalyticsStore {
    return this.costs;
  }

  database(): PrismaClient {
    return this.db;
  }

  embeddingModelRemovalImpact(
    modelIds: readonly string[],
  ): Promise<EmbeddingModelRemovalImpact> {
    return new EmbeddingModelDependencyService(this).removalImpact(modelIds);
  }

  assertCanRemoveEmbeddingModels(
    modelIds: readonly string[],
    modelLabel?: string,
  ): Promise<void> {
    return new EmbeddingModelDependencyService(this).assertCanRemove(
      modelIds,
      modelLabel,
    );
  }

  private resourceDelegate(name: ResourceDelegateName): {
    upsert(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<{
      deletedAt: Date | null;
      payload: Prisma.JsonValue;
    } | null>;
    findMany(args: unknown): Promise<Array<{ payload: Prisma.JsonValue }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  } {
    return this.db[name] as never;
  }

  private async saveResourceRecord<T extends { id: string }>(
    delegateName: ResourceDelegateName,
    record: T,
  ): Promise<T> {
    await this.resourceDelegate(delegateName).upsert({
      where: { projectId_id: { projectId: this.projectId, id: record.id } },
      create: {
        projectId: this.projectId,
        id: record.id,
        payload: jsonInput(record),
      },
      update: { payload: jsonInput(record) },
    });
    return record;
  }

  private async getResourceRecord<T>(
    delegateName: ResourceDelegateName,
    id: string,
  ): Promise<T | undefined> {
    const row = await this.resourceDelegate(delegateName).findUnique({
      where: { projectId_id: { projectId: this.projectId, id } },
      select: { payload: true, deletedAt: true },
    });
    return row && !row.deletedAt
      ? decode<T>(row.payload)
      : undefined;
  }

  private async listResourceRecords<T>(delegateName: ResourceDelegateName): Promise<T[]> {
    const rows = await this.resourceDelegate(delegateName).findMany({
      where: { projectId: this.projectId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { payload: true },
    });
    return rows.map((row) => decode<T>(row.payload));
  }

  private async deleteResourceRecord(delegateName: ResourceDelegateName, id: string): Promise<boolean> {
    const result = await this.resourceDelegate(delegateName).updateMany({
      where: { projectId: this.projectId, id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

  saveSkillDefinition(skill: SkillDefinition): Promise<SkillDefinition> {
    return this.saveResourceRecord("skillRecord", skill);
  }
  getSkillDefinition(id: string): Promise<SkillDefinition | undefined> {
    return this.getResourceRecord<SkillDefinition & { bindings?: number }>("skillRecord", id)
      .then((skill) => skill ? decodeSkillDefinition(skill) : undefined);
  }
  async listSkillDefinitions(): Promise<SkillDefinition[]> {
    return (await this.listResourceRecords<SkillDefinition & { bindings?: number }>("skillRecord"))
      .map(decodeSkillDefinition);
  }
  deleteSkillDefinition(id: string): Promise<boolean> {
    return this.deleteResourceRecord("skillRecord", id);
  }
  getSkillArtifact(skillId: string, version: string) {
    return this.db.skillArtifactRecord.findUnique({
      where: { skillId_version: { skillId, version } },
    });
  }
  async saveMcpServerDefinition(server: McpServerDefinition): Promise<McpServerDefinition> {
    await this.db.mcpServerRecord.upsert({
      where: { projectId_id: { projectId: this.projectId, id: server.id } },
      create: {
        projectId: this.projectId,
        id: server.id,
        litellmServerId: server.litellmServerId,
        payload: mcpConnectionPayload(server),
        discoveryStatus: server.status,
        lastDiscoveryAttemptAt: server.lastDiscoveryAttemptAt,
        lastDiscoveredAt: server.lastDiscoveredAt,
        lastDiscoveryError: server.lastDiscoveryError,
      },
      update: {
        litellmServerId: server.litellmServerId,
        payload: mcpConnectionPayload(server),
        discoveryStatus: server.status,
        lastDiscoveryAttemptAt: server.lastDiscoveryAttemptAt,
        lastDiscoveredAt: server.lastDiscoveredAt,
        lastDiscoveryError: server.lastDiscoveryError,
      },
    });
    return server;
  }
  async getMcpServerDefinition(id: string): Promise<McpServerDefinition | undefined> {
    const row = await this.db.mcpServerRecord.findFirst({
      where: { projectId: this.projectId, id, deletedAt: null },
      include: { tools: { orderBy: { name: "asc" } } },
    });
    return row ? this.decodeMcpServer(row) : undefined;
  }
  async listMcpServerDefinitions(): Promise<McpServerDefinition[]> {
    const rows = await this.db.mcpServerRecord.findMany({
      where: { projectId: this.projectId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      include: { tools: { orderBy: { name: "asc" } } },
    });
    return rows.map((row) => this.decodeMcpServer(row));
  }
  async saveMcpDiscovery(
    id: string,
    result: {
      status: McpServerDefinition["status"];
      attemptedAt: string;
      discoveredAt?: string;
      error?: string;
      tools?: McpToolDefinition[];
    },
  ): Promise<McpServerDefinition> {
    const attemptedAt = new Date(result.attemptedAt);
    await this.db.$transaction(async (transaction) => {
      await transaction.mcpServerRecord.update({
        where: { projectId_id: { projectId: this.projectId, id } },
        data: {
          discoveryStatus: result.status,
          lastDiscoveryAttemptAt: attemptedAt,
          ...(result.discoveredAt ? { lastDiscoveredAt: new Date(result.discoveredAt) } : {}),
          lastDiscoveryError: result.error ?? null,
        },
      });
      if (result.tools) {
        await transaction.mcpToolRecord.deleteMany({
          where: { projectId: this.projectId, mcpServerId: id },
        });
        if (result.tools.length) {
          await transaction.mcpToolRecord.createMany({
            data: result.tools.map((tool) => ({
              projectId: this.projectId,
              mcpServerId: id,
              name: tool.name,
              title: tool.title ?? null,
              description: tool.description ?? null,
              inputSchema: jsonInput(tool.inputSchema),
              ...(tool.outputSchema ? { outputSchema: jsonInput(tool.outputSchema) } : {}),
              ...(tool.annotations ? { annotations: jsonInput(tool.annotations) } : {}),
              discoveredAt: new Date(tool.discoveredAt),
            })),
          });
        }
      }
    });
    const server = await this.getMcpServerDefinition(id);
    if (!server) throw new Error("MCP server was not found.");
    return server;
  }
  deleteMcpServerDefinition(id: string): Promise<boolean> {
    return this.deleteResourceRecord("mcpServerRecord", id);
  }
  saveKnowledgeSourceDefinition(source: KnowledgeSourceDefinition): Promise<KnowledgeSourceDefinition> {
    return this.saveResourceRecord("knowledgeSourceRecord", source);
  }
  getKnowledgeSourceDefinition(id: string): Promise<KnowledgeSourceDefinition | undefined> {
    return this.getResourceRecord("knowledgeSourceRecord", id);
  }
  listKnowledgeSourceDefinitions(): Promise<KnowledgeSourceDefinition[]> {
    return this.listResourceRecords("knowledgeSourceRecord");
  }
  deleteKnowledgeSourceDefinition(id: string): Promise<boolean> {
    return this.deleteResourceRecord("knowledgeSourceRecord", id);
  }
  listAgentSpecializations(): Promise<AgentSpecializationDefinition[]> {
    return this.listResourceRecords("agentSpecializationRecord");
  }

  private decodeMcpServer(row: {
    id: string;
    litellmServerId: string;
    payload: Prisma.JsonValue;
    discoveryStatus: McpServerDefinition["status"];
    lastDiscoveryAttemptAt: Date | null;
    lastDiscoveredAt: Date | null;
    lastDiscoveryError: string | null;
    tools: Array<{
      name: string;
      title: string | null;
      description: string | null;
      inputSchema: Prisma.JsonValue;
      outputSchema: Prisma.JsonValue | null;
      annotations: Prisma.JsonValue | null;
      discoveredAt: Date;
    }>;
  }): McpServerDefinition {
    const connection = decode<Omit<McpServerDefinition, "id" | "litellmServerId" | "status" | "tools" | "lastDiscoveryAttemptAt" | "lastDiscoveredAt" | "lastDiscoveryError">>(row.payload);
    return {
      id: row.id,
      litellmServerId: row.litellmServerId,
      ...connection,
      status: row.discoveryStatus,
      tools: row.tools.map((tool) => ({
        name: tool.name,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: decode<Record<string, unknown>>(tool.inputSchema),
        ...(tool.outputSchema ? { outputSchema: decode<Record<string, unknown>>(tool.outputSchema) } : {}),
        ...(tool.annotations ? { annotations: decode<McpToolDefinition["annotations"]>(tool.annotations) } : {}),
        discoveredAt: tool.discoveredAt.toISOString(),
      })),
      lastDiscoveryAttemptAt: row.lastDiscoveryAttemptAt?.toISOString() ?? null,
      lastDiscoveredAt: row.lastDiscoveredAt?.toISOString() ?? null,
      lastDiscoveryError: row.lastDiscoveryError,
    };
  }

  async isResourceInUse(kind: ResourceKind, id: string): Promise<boolean> {
    const agentField = kind === "skills" ? "skillIds" : kind === "mcp-servers" ? "mcpServerIds" : "knowledgeSourceIds";
    if ((await this.list()).some((agent) => (agent[agentField] ?? []).includes(id))) return true;
    const specializationField = kind === "skills" ? "defaultSkillIds" : kind === "mcp-servers" ? "defaultMcpServerIds" : "defaultKnowledgeSourceIds";
    return (await this.listAgentSpecializations())
      .some((specialization) => specialization[specializationField].includes(id));
  }

  async save(
    agent: Agent,
    ownerUserId?: string,
    creationIdempotencyKey?: string,
  ): Promise<Agent> {
    const create = {
      projectId: this.projectId,
      id: agent.id,
      payload: agentPayload(agent),
      createdAt: agent.createdAt,
      ...(creationIdempotencyKey ? { creationIdempotencyKey } : {}),
    };
    if (!ownerUserId) {
      const updated = await this.db.agentRecord.updateMany({
        where: {
          projectId: this.projectId,
          id: agent.id,
          kind: "SUPERVISOR",
        },
        data: { payload: agentPayload(agent) },
      });
      if (!updated.count) {
        throw new Error("An owner user is required when creating an Agent Instance.");
      }
    } else {
      const existing = await this.db.agentRecord.findUnique({
        where: { projectId_id: { projectId: this.projectId, id: agent.id } },
        select: { kind: true },
      });
      if (existing && existing.kind !== "SUPERVISOR") {
        throw new Error("Agent Instance identifier belongs to an A2A runtime.");
      }
      await this.db.agentRecord.upsert({
        where: { projectId_id: { projectId: this.projectId, id: agent.id } },
        create: {
          ...create,
          kind: "SUPERVISOR",
          ownerUserId,
        },
        update: {
          payload: agentPayload(agent),
        },
      });
    }
    const binding = await this.getModelRoutingBindingForAgent(agent.id);
    if (binding) await this.saveBindingAttribution(binding, agent);
    return agent;
  }

  async get(id: string): Promise<Agent | undefined> {
    return this.getAgentRecord(id, false);
  }

  async getIncludingDeleted(id: string): Promise<Agent | undefined> {
    return this.getAgentRecord(id, true);
  }

  private async getAgentRecord(
    id: string,
    includeDeleted: boolean,
  ): Promise<Agent | undefined> {
    const row = await this.db.agentRecord.findFirst({
      where: {
        projectId: this.projectId,
        id,
        kind: "SUPERVISOR",
        ...(!includeDeleted ? { deletedAt: null } : {}),
      },
      select: {
        payload: true,
        ownerMembership: {
          select: {
            user: {
              select: { id: true, displayName: true, username: true },
            },
          },
        },
        accessPolicyBindings: {
          orderBy: { accessPolicyId: "asc" },
          select: { accessPolicyId: true },
        },
      },
    });
    return row
      ? parseCurrentAgent(
          row.payload,
          row.accessPolicyBindings.map((binding) => binding.accessPolicyId),
          agentCreator(row.ownerMembership.user),
        )
      : undefined;
  }

  async ownerUserId(id: string): Promise<string | undefined> {
    const row = await this.db.agentRecord.findFirst({
      where: {
        projectId: this.projectId,
        id,
        kind: "SUPERVISOR",
        deletedAt: null,
      },
      select: { ownerUserId: true },
    });
    return row?.ownerUserId ?? undefined;
  }

  async getByCreationIdempotencyKey(
    ownerUserId: string,
    creationIdempotencyKey: string,
  ): Promise<Agent | undefined> {
    const row = await this.db.agentRecord.findFirst({
      where: {
        projectId: this.projectId,
        ownerUserId,
        creationIdempotencyKey,
        kind: "SUPERVISOR",
        deletedAt: null,
      },
      select: { id: true },
    });
    return row ? this.get(row.id) : undefined;
  }

  async list(ownerUserId?: string): Promise<Agent[]> {
    const rows = await this.db.agentRecord.findMany({
      where: {
        projectId: this.projectId,
        kind: "SUPERVISOR",
        deletedAt: null,
        ...(ownerUserId ? { ownerUserId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        payload: true,
        ownerMembership: {
          select: {
            user: {
              select: { id: true, displayName: true, username: true },
            },
          },
        },
        accessPolicyBindings: {
          orderBy: { accessPolicyId: "asc" },
          select: { accessPolicyId: true },
        },
      },
    });
    return rows.flatMap((row) => {
      const agent = parseCurrentAgent(
        row.payload,
        row.accessPolicyBindings.map((binding) => binding.accessPolicyId),
        agentCreator(row.ownerMembership.user),
      );
      return agent ? [agent] : [];
    });
  }

  async replaceAgentAccessPolicies(
    instanceId: string,
    accessPolicyIds: readonly string[],
    boundBy = "agent-service",
  ): Promise<Agent> {
    const uniquePolicyIds = [...new Set(accessPolicyIds)];
    if (
      uniquePolicyIds.length !== accessPolicyIds.length ||
      uniquePolicyIds.length < 1 ||
      uniquePolicyIds.length > 64
    ) throw new Error("Select between 1 and 64 unique Access Policies.");

    return this.db.$transaction(async (transaction) => {
      const instance = await transaction.agentRecord.findFirst({
        where: {
          projectId: this.projectId,
          id: instanceId,
          kind: "SUPERVISOR",
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!instance) throw new Error("Agent Instance not found.");

      const policies = await transaction.accessPolicyRecord.findMany({
        where: {
          projectId: this.projectId,
          id: { in: uniquePolicyIds },
          deletedAt: null,
        },
        select: { id: true },
      });
      const available = new Set(policies.map((policy) => policy.id));
      const missing = uniquePolicyIds.filter((id) => !available.has(id));
      if (missing.length) {
        throw new Error(`Access Policy not found: ${missing.join(", ")}.`);
      }

      await transaction.agentInstanceAccessPolicyBindingRecord.deleteMany({
        where: { projectId: this.projectId, instanceId },
      });
      await transaction.agentInstanceAccessPolicyBindingRecord.createMany({
        data: uniquePolicyIds.map((accessPolicyId) => ({
          projectId: this.projectId,
          instanceId,
          accessPolicyId,
          boundBy,
        })),
      });

      const updated = await transaction.agentRecord.findUniqueOrThrow({
        where: { projectId_id: { projectId: this.projectId, id: instanceId } },
        select: {
          payload: true,
          ownerMembership: {
            select: {
              user: {
                select: { id: true, displayName: true, username: true },
              },
            },
          },
          accessPolicyBindings: {
            orderBy: { accessPolicyId: "asc" },
            select: { accessPolicyId: true },
          },
        },
      });
      return parseAgent(
        updated.payload,
        updated.accessPolicyBindings.map((binding) => binding.accessPolicyId),
        agentCreator(updated.ownerMembership.user),
      );
    });
  }

  async listAgentsForReporting(): Promise<Array<Pick<Agent, "id" | "name" | "sandboxName" | "costKeyAlias" | "modelRoutingKeyFingerprint">>> {
    return (await this.list()).map((agent) => ({
      id: agent.id,
      name: agent.name,
      sandboxName: agent.sandboxName,
      costKeyAlias: agent.costKeyAlias ?? `tali-${agent.name}`,
      modelRoutingKeyFingerprint: agent.modelRoutingKeyFingerprint,
    }));
  }

  async softDelete(id: string, deletedAt = new Date()): Promise<boolean> {
    const result = await this.db.agentRecord.updateMany({
      where: {
        projectId: this.projectId,
        id,
        kind: "SUPERVISOR",
        deletedAt: null,
      },
      data: { deletedAt },
    });
    return result.count > 0;
  }

  async restore(id: string): Promise<boolean> {
    const result = await this.db.agentRecord.updateMany({
      where: {
        projectId: this.projectId,
        id,
        kind: "SUPERVISOR",
        deletedAt: { not: null },
      },
      data: { deletedAt: null },
    });
    return result.count > 0;
  }

  async hardDelete(id: string): Promise<void> {
    await this.db.agentRecord.deleteMany({
      where: { projectId: this.projectId, id, kind: "SUPERVISOR" },
    });
  }

  async saveProviderAccount(account: ProviderAccount, credentialPayload?: string): Promise<ProviderAccount> {
    const credential = credentialPayload ?? await this.getProviderAccountCredential(account.id);
    if (!credential) throw new Error("An API credential is required for a new Provider Account.");
    await this.db.providerAccountRecord.upsert({
      where: { projectId_id: { projectId: this.projectId, id: account.id } },
      create: {
        projectId: this.projectId,
        id: account.id,
        payload: jsonInput(account),
        credentialPayload: credential,
        createdAt: account.createdAt,
      },
      update: {
        payload: jsonInput(account),
        credentialPayload: credential,
      },
    });
    return account;
  }

  async getProviderAccount(id: string): Promise<ProviderAccount | undefined> {
    const row = await this.db.providerAccountRecord.findFirst({
      where: { projectId: this.projectId, id, deletedAt: null },
      select: { payload: true },
    });
    return row ? parseProviderAccount(row.payload) : undefined;
  }
  async listProviderAccounts(): Promise<ProviderAccount[]> {
    const rows = await this.db.providerAccountRecord.findMany({
      where: { projectId: this.projectId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    return rows.map((row) => parseProviderAccount(row.payload));
  }
  async getProviderAccountCredential(id: string): Promise<string | undefined> {
    const row = await this.db.providerAccountRecord.findFirst({
      where: { projectId: this.projectId, id, deletedAt: null },
      select: { credentialPayload: true },
    });
    return row?.credentialPayload;
  }

  async getModelProviderAccountCredential(
    deployment: ModelDeployment,
  ): Promise<string | undefined> {
    if (deployment.origin?.scope !== "DEPARTMENT") {
      return this.getProviderAccountCredential(deployment.providerAccountId);
    }
    const row = await this.db.departmentInferenceResourceRecord.findFirst({
      where: {
        departmentId: deployment.origin.scopeId,
        id: deployment.providerAccountId,
        kind: "PROVIDER",
        deletedAt: null,
      },
      select: { credentialPayload: true },
    });
    return row?.credentialPayload ?? undefined;
  }

  async saveModelDeployment(deployment: ModelDeployment): Promise<ModelDeployment> {
    if (deployment.origin?.scope === "DEPARTMENT") {
      throw new Error("Inherited Department Models are read-only in this Project.");
    }
    const storedDeployment = withoutInferenceOrigin(deployment);
    await this.db.modelDeploymentRecord.upsert({
      where: { projectId_id: { projectId: this.projectId, id: deployment.id } },
      create: {
        projectId: this.projectId,
        id: deployment.id,
        providerAccountId: deployment.providerAccountId,
        payload: jsonInput(storedDeployment),
        createdAt: deployment.createdAt,
      },
      update: { payload: jsonInput(storedDeployment) },
    });
    const account = await this.getProviderAccount(deployment.providerAccountId);
    await this.costs.saveModelEndpointMapping({
      id: `deployment:${deployment.id}:${deployment.createdAt}`,
      modelEndpointId: deployment.id,
      modelEndpointName: deployment.displayName,
      liteLLMModelName: deployment.litellmModelName,
      liteLLMModelGroup: deployment.litellmModelName,
      liteLLMModelId: deployment.modelId,
      provider: deployment.providerName,
      providerAccountId: deployment.providerAccountId,
      providerAccountName: account?.name ?? deployment.providerAccountId,
      validFrom: deployment.createdAt,
      createdAt: deployment.createdAt,
      updatedAt: deployment.updatedAt,
    });
    return deployment;
  }

  async getModelDeployment(id: string): Promise<ModelDeployment | undefined> {
    const row = await this.db.modelDeploymentRecord.findFirst({
      where: { projectId: this.projectId, id, deletedAt: null },
      select: { payload: true },
    });
    if (row) return parseModelDeployment(row.payload);
    const inherited = await this.db.projectDepartmentModelBinding.findUnique({
      where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
      select: {
        projectInheritedAt: true,
        departmentAssignedAt: true,
        defaultFor: true,
        defaultManagedBy: true,
        resource: { select: { kind: true, payload: true, deletedAt: true } },
        project: { select: { department: { select: { id: true, name: true } } } },
      },
    });
    const routingDependencies = (await this.departmentRoutingModelSources()).get(id) ?? [];
    if (inherited && inherited.resource.kind === "MODEL" && !inherited.resource.deletedAt) {
      return departmentOrigin(
        parseModelDeployment(inherited.resource.payload),
        inherited.project.department,
        bindingOrigin(inherited, routingDependencies),
      );
    }
    if (!routingDependencies.length) return undefined;
    const project = await this.db.project.findUnique({
      where: { id: this.projectId },
      select: { department: { select: { id: true, name: true } } },
    });
    if (!project) return undefined;
    const resource = await this.db.departmentInferenceResourceRecord.findFirst({
      where: {
        departmentId: project.department.id,
        id,
        kind: "MODEL",
        deletedAt: null,
      },
      select: { payload: true },
    });
    return resource
      ? departmentOrigin(
        parseModelDeployment(resource.payload),
        project.department,
        bindingOrigin(undefined, routingDependencies),
      )
      : undefined;
  }
  async listModelDeployments(providerAccountId?: string): Promise<ModelDeployment[]> {
    return this.listModelDeploymentsForReporting(providerAccountId);
  }
  async listModelDeploymentsForReporting(providerAccountId?: string): Promise<ModelDeployment[]> {
    const rows = await this.db.modelDeploymentRecord.findMany({
      where: {
        projectId: this.projectId,
        deletedAt: null,
        ...(providerAccountId ? { providerAccountId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const local = rows.map((row) => parseModelDeployment(row.payload));
    if (providerAccountId) return local;
    const inherited = await this.db.projectDepartmentModelBinding.findMany({
      where: { projectId: this.projectId, resource: { kind: "MODEL", deletedAt: null } },
      orderBy: { createdAt: "desc" },
      select: {
        projectInheritedAt: true,
        departmentAssignedAt: true,
        defaultFor: true,
        defaultManagedBy: true,
        resource: { select: { payload: true } },
        project: { select: { department: { select: { id: true, name: true } } } },
      },
    });
    const localIds = new Set(local.map((model) => model.id));
    const routingModelSources = await this.departmentRoutingModelSources();
    const directlyInherited = inherited.map((binding) => {
      const model = parseModelDeployment(binding.resource.payload);
      return departmentOrigin(
        model,
        binding.project.department,
        bindingOrigin(binding, routingModelSources.get(model.id) ?? []),
      );
    });
    const directIds = new Set(directlyInherited.map((model) => model.id));
    const routingModelIds = new Set(routingModelSources.keys());
    const missingIds = [...routingModelIds].filter(
      (id) => !localIds.has(id) && !directIds.has(id),
    );
    const project = missingIds.length
      ? await this.db.project.findUnique({
        where: { id: this.projectId },
        select: { department: { select: { id: true, name: true } } },
      })
      : null;
    const routedResources = project
      ? await this.db.departmentInferenceResourceRecord.findMany({
        where: {
          departmentId: project.department.id,
          id: { in: missingIds },
          kind: "MODEL",
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        select: { payload: true },
      })
      : [];
    return [
      ...local,
      ...directlyInherited.filter((model) => !localIds.has(model.id)),
      ...routedResources.map((resource) => departmentOrigin(
        parseModelDeployment(resource.payload),
        project!.department,
        bindingOrigin(
          undefined,
          routingModelSources.get(parseModelDeployment(resource.payload).id) ?? [],
        ),
      )),
    ];
  }
  private async departmentRoutingModelSources(): Promise<Map<string, string[]>> {
    const routings = await this.db.projectDepartmentRoutingBinding.findMany({
      where: {
        projectId: this.projectId,
        resource: { kind: "ROUTING", deletedAt: null },
      },
      select: { resourceId: true, resource: { select: { payload: true } } },
    });
    const sources = new Map<string, string[]>();
    for (const binding of routings) {
      for (const modelId of routingDeploymentIds(parseModelRouting(binding.resource.payload))) {
        sources.set(modelId, [...(sources.get(modelId) ?? []), binding.resourceId]);
      }
    }
    return sources;
  }
  private async inheritedRoutingModelIds(): Promise<Set<string>> {
    return new Set((await this.departmentRoutingModelSources()).keys());
  }

  async departmentRoutingModelIdsLostAfterRemoving(
    routingId: string,
  ): Promise<string[]> {
    const routingBinding = await this.db.projectDepartmentRoutingBinding.findUnique({
      where: {
        projectId_resourceId: { projectId: this.projectId, resourceId: routingId },
      },
      select: { departmentId: true },
    });
    if (!routingBinding) return [];
    const routing = await this.db.departmentInferenceResourceRecord.findFirst({
      where: {
        departmentId: routingBinding.departmentId,
        id: routingId,
        kind: "ROUTING",
        deletedAt: null,
      },
      select: { payload: true },
    });
    if (!routing) return [];
    const candidateIds = [...routingDeploymentIds(parseModelRouting(routing.payload))];
    if (!candidateIds.length) return [];
    const [directBindings, otherRoutings] = await Promise.all([
      this.db.projectDepartmentModelBinding.findMany({
        where: {
          projectId: this.projectId,
          resourceId: { in: candidateIds },
          OR: [
            { projectInheritedAt: { not: null } },
            { departmentAssignedAt: { not: null } },
          ],
        },
        select: { resourceId: true },
      }),
      this.db.projectDepartmentRoutingBinding.findMany({
        where: {
          projectId: this.projectId,
          resourceId: { not: routingId },
          OR: [
            { projectInheritedAt: { not: null } },
            { departmentAssignedAt: { not: null } },
          ],
          resource: { kind: "ROUTING", deletedAt: null },
        },
        select: { resource: { select: { payload: true } } },
      }),
    ]);
    const remainsAvailable = new Set(
      directBindings.map((binding) => binding.resourceId),
    );
    for (const binding of otherRoutings) {
      for (const modelId of routingDeploymentIds(
        parseModelRouting(binding.resource.payload),
      )) {
        remainsAvailable.add(modelId);
      }
    }
    return candidateIds.filter((id) => !remainsAvailable.has(id));
  }

  async deleteModelDeployment(id: string): Promise<boolean> {
    if (await this.db.projectDepartmentModelBinding.findUnique({
      where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
      select: { resourceId: true },
    })) {
      throw new Error("Department Models are read-only in a Project. Remove the Project link instead.");
    }
    const result = await this.db.modelDeploymentRecord.updateMany({
      where: { projectId: this.projectId, id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }
  async listAgentIdsUsingModelDeployments(ids: readonly string[]): Promise<string[]> {
    if (!ids.length) return [];
    const idSet = new Set(ids);
    return (await this.list()).flatMap((agent) =>
      agent.modelDeploymentId && idSet.has(agent.modelDeploymentId) ? [agent.id] : [],
    );
  }
  async deleteProviderAccount(id: string): Promise<boolean> {
    const deletedAt = new Date();
    return this.db.$transaction(async (transaction) => {
      await transaction.modelDeploymentRecord.updateMany({
        where: { projectId: this.projectId, providerAccountId: id, deletedAt: null },
        data: { deletedAt },
      });
      const result = await transaction.providerAccountRecord.updateMany({
        where: { projectId: this.projectId, id, deletedAt: null },
        data: { deletedAt },
      });
      return result.count > 0;
    });
  }

  async saveInferenceGateway(gateway: InferenceGateway): Promise<InferenceGateway> {
    await this.db.inferenceGatewayRecord.upsert({
      where: { projectId_id: { projectId: this.projectId, id: gateway.id } },
      create: {
        projectId: this.projectId,
        id: gateway.id,
        payload: jsonInput(gateway),
        createdAt: gateway.createdAt,
      },
      update: { payload: jsonInput(gateway) },
    });
    return gateway;
  }
  async getInferenceGateway(id: string): Promise<InferenceGateway | undefined> {
    const row = await this.db.inferenceGatewayRecord.findUnique({
      where: { projectId_id: { projectId: this.projectId, id } },
      select: { payload: true },
    });
    return row ? decode<InferenceGateway>(row.payload) : undefined;
  }
  async listInferenceGateways(): Promise<InferenceGateway[]> {
    const rows = await this.db.inferenceGatewayRecord.findMany({
      where: { projectId: this.projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { payload: true },
    });
    return rows.map((row) => decode<InferenceGateway>(row.payload));
  }

  async saveModelRouting(routing: ModelRouting): Promise<ModelRouting> {
    if (await this.isInheritedModelRouting(routing.id)) {
      throw new Error("Inherited Department Routing is read-only in this Project.");
    }
    const canonicalRouting = canonicalModelRouting(routing);
    const storedRouting = withoutInferenceOrigin(canonicalRouting);
    await this.db.modelRoutingRecord.upsert({
      where: { projectId_id: { projectId: this.projectId, id: canonicalRouting.id } },
      create: {
        projectId: this.projectId,
        id: canonicalRouting.id,
        payload: jsonInput(storedRouting),
        createdAt: canonicalRouting.createdAt,
      },
      update: { payload: jsonInput(storedRouting) },
    });
    await this.saveModelRoutingAttribution(canonicalRouting);
    return canonicalRouting;
  }
  async saveDefaultModelRouting(routing: ModelRouting): Promise<ModelRouting> {
    const canonicalRouting = canonicalModelRouting(routing);
    const inheritedTarget = await this.isInheritedModelRouting(routing.id);
    const departmentManagedDefault = await this.db.projectDepartmentRoutingBinding.findFirst({
      where: {
        projectId: this.projectId,
        isDefault: true,
        defaultManagedBy: "DEPARTMENT",
      },
      select: { resourceId: true },
    });
    if (departmentManagedDefault) {
      if (departmentManagedDefault.resourceId !== routing.id) {
        throw new Error(
          "This Project default Routing is managed by its Department. Change the Department assignment first.",
        );
      }
      const current = await this.getModelRouting(routing.id);
      if (!current) throw new Error("Routing not found.");
      return current;
    }
    const localRows = await this.db.modelRoutingRecord.findMany({
      where: { projectId: this.projectId, deletedAt: null },
      select: { payload: true },
    });
    const existing = localRows.map((row) => parseModelRouting(row.payload));
    const now = canonicalRouting.updatedAt;
    const routings = existing.map((candidate) =>
      candidate.id === canonicalRouting.id
        ? { ...canonicalRouting, isDefault: true }
        : candidate.isDefault
          ? { ...candidate, isDefault: false, updatedAt: now }
          : candidate,
    );
    if (!inheritedTarget && !routings.some((candidate) => candidate.id === canonicalRouting.id))
      throw new Error("Routing not found.");
    await this.db.$transaction(async (transaction) => {
      for (const candidate of routings) {
        await transaction.modelRoutingRecord.upsert({
          where: {
            projectId_id: {
              projectId: this.projectId,
              id: candidate.id,
            },
          },
          create: {
            projectId: this.projectId,
            id: candidate.id,
            payload: jsonInput(withoutInferenceOrigin(candidate)),
            createdAt: candidate.createdAt,
          },
          update: { payload: jsonInput(withoutInferenceOrigin(candidate)) },
        });
      }
      await transaction.projectDepartmentRoutingBinding.updateMany({
        where: { projectId: this.projectId },
        data: { isDefault: false, defaultManagedBy: null },
      });
      if (inheritedTarget) {
        await transaction.projectDepartmentRoutingBinding.update({
          where: {
            projectId_resourceId: {
              projectId: this.projectId,
              resourceId: routing.id,
            },
          },
          data: { isDefault: true, defaultManagedBy: "PROJECT" },
        });
      }
    });
    if (inheritedTarget) {
      const inherited = await this.getModelRouting(routing.id);
      if (!inherited) throw new Error("Routing not found.");
      return inherited;
    }
    await this.saveModelRoutingAttribution(canonicalRouting);
    return { ...canonicalRouting, isDefault: true };
  }
  private async saveModelRoutingAttribution(
    routing: ModelRouting,
  ): Promise<void> {
    const gateway = await this.getInferenceGateway(routing.gatewayId);
    await this.costs.saveModelEndpointMapping({
      id: `model-routing:${routing.id}:${routing.createdAt}`,
      modelEndpointId: `model-routing:${routing.id}`,
      modelEndpointName: routing.name,
      liteLLMModelName: routing.publicModelAlias,
      liteLLMModelGroup: routing.publicModelAlias,
      provider: "LiteLLM",
      providerAccountId: routing.gatewayId,
      providerAccountName: gateway?.name ?? routing.gatewayId,
      validFrom: routing.createdAt,
      createdAt: routing.createdAt,
      updatedAt: routing.updatedAt,
    });
  }
  async getModelRouting(id: string): Promise<ModelRouting | undefined> {
    const row = await this.db.modelRoutingRecord.findFirst({
      where: { projectId: this.projectId, id, deletedAt: null },
      select: { payload: true },
    });
    if (row) return parseModelRouting(row.payload);
    const inherited = await this.db.projectDepartmentRoutingBinding.findUnique({
      where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
      select: {
        projectInheritedAt: true,
        departmentAssignedAt: true,
        isDefault: true,
        defaultManagedBy: true,
        liteLLMTeamId: true,
        resource: { select: { kind: true, payload: true, deletedAt: true } },
        project: { select: { department: { select: { id: true, name: true } } } },
      },
    });
    if (!inherited || inherited.resource.kind !== "ROUTING" || inherited.resource.deletedAt) {
      return undefined;
    }
    const {
      liteLLMTeamId: _departmentTeamId,
      ...definition
    } = parseModelRouting(inherited.resource.payload);
    return departmentOrigin(
      {
        ...definition,
        isDefault: inherited.isDefault,
        ...(inherited.liteLLMTeamId
          ? { liteLLMTeamId: inherited.liteLLMTeamId }
          : {}),
      },
      inherited.project.department,
      {
        ...bindingOrigin(inherited),
        ...(inherited.isDefault && inherited.defaultManagedBy
          ? {
              projectDefault: {
                slot: "ROUTING" as const,
                managedBy: inherited.defaultManagedBy as "PROJECT" | "DEPARTMENT",
              },
            }
          : {}),
      },
    );
  }
  async listModelRoutings(): Promise<ModelRouting[]> {
    const rows = await this.db.modelRoutingRecord.findMany({
      where: { projectId: this.projectId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const inherited = await this.db.projectDepartmentRoutingBinding.findMany({
      where: { projectId: this.projectId, resource: { kind: "ROUTING", deletedAt: null } },
      orderBy: { createdAt: "desc" },
      select: {
        projectInheritedAt: true,
        departmentAssignedAt: true,
        isDefault: true,
        defaultManagedBy: true,
        liteLLMTeamId: true,
        resource: { select: { payload: true } },
        project: { select: { department: { select: { id: true, name: true } } } },
      },
    });
    return [
      ...rows.map((row) => parseModelRouting(row.payload)),
      ...inherited.map((binding) => {
        const {
          liteLLMTeamId: _departmentTeamId,
          ...definition
        } = parseModelRouting(binding.resource.payload);
        return departmentOrigin(
          {
            ...definition,
            isDefault: binding.isDefault,
            ...(binding.liteLLMTeamId
              ? { liteLLMTeamId: binding.liteLLMTeamId }
              : {}),
          },
          binding.project.department,
          {
            ...bindingOrigin(binding),
            ...(binding.isDefault && binding.defaultManagedBy
              ? {
                  projectDefault: {
                    slot: "ROUTING" as const,
                    managedBy: binding.defaultManagedBy as "PROJECT" | "DEPARTMENT",
                  },
                }
              : {}),
          },
        );
      }),
    ];
  }
  async deleteModelRouting(id: string): Promise<boolean> {
    if (await this.isInheritedModelRouting(id)) {
      throw new Error("Department Routing is read-only in a Project. Remove the Project link instead.");
    }
    const result = await this.db.modelRoutingRecord.updateMany({
      where: { projectId: this.projectId, id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

  async isInheritedModelRouting(id: string): Promise<boolean> {
    return Boolean(await this.db.projectDepartmentRoutingBinding.findUnique({
      where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
      select: { resourceId: true },
    }));
  }

  async saveModelRoutingRuntime(routing: ModelRouting): Promise<ModelRouting> {
    const inherited = await this.db.projectDepartmentRoutingBinding.findUnique({
      where: { projectId_resourceId: { projectId: this.projectId, resourceId: routing.id } },
      select: {
        resourceId: true,
      },
    });
    if (!inherited) return this.saveModelRouting(routing);
    await this.db.projectDepartmentRoutingBinding.update({
      where: {
        projectId_resourceId: {
          projectId: this.projectId,
          resourceId: inherited.resourceId,
        },
      },
      data: { liteLLMTeamId: routing.liteLLMTeamId ?? null },
    });
    return (await this.getModelRouting(routing.id))!;
  }

  async departmentInferenceAvailability(): Promise<DepartmentInferenceAvailability> {
    const project = await this.db.project.findUnique({
      where: { id: this.projectId },
      select: {
        department: { select: { id: true, name: true } },
        inheritedDepartmentModels: {
          select: {
            resourceId: true,
            projectInheritedAt: true,
            departmentAssignedAt: true,
            defaultFor: true,
            defaultManagedBy: true,
          },
        },
        inheritedDepartmentRoutings: {
          select: {
            resourceId: true,
            projectInheritedAt: true,
            departmentAssignedAt: true,
            isDefault: true,
            defaultManagedBy: true,
          },
        },
      },
    });
    if (!project) throw new Error("Project not found.");
    const resources = await this.db.departmentInferenceResourceRecord.findMany({
      where: {
        departmentId: project.department.id,
        kind: { in: ["MODEL", "ROUTING"] },
        deletedAt: null,
      },
      orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
      select: { id: true, kind: true, payload: true },
    });
    const modelBindings = new Map(
      project.inheritedDepartmentModels.map((binding) => [binding.resourceId, binding]),
    );
    const routingBindings = new Map(
      project.inheritedDepartmentRoutings.map((binding) => [binding.resourceId, binding]),
    );
    const routingSources = new Map<string, string[]>();
    for (const resource of resources) {
      if (resource.kind !== "ROUTING" || !routingBindings.has(resource.id)) continue;
      for (const modelId of routingDeploymentIds(parseModelRouting(resource.payload))) {
        routingSources.set(modelId, [...(routingSources.get(modelId) ?? []), resource.id]);
      }
    }
    const origin = (
      binding: Parameters<typeof bindingOrigin>[0],
      dependencyIds: string[] = [],
      projectDefault?: InferenceResourceOrigin["projectDefault"],
    ) => ({
      scope: "DEPARTMENT" as const,
      scopeId: project.department.id,
      scopeName: project.department.name,
      inherited: Boolean(binding || dependencyIds.length),
      editable: false,
      ...bindingOrigin(binding, dependencyIds),
      ...(projectDefault ? { projectDefault } : {}),
    });
    return {
      departmentId: project.department.id,
      departmentName: project.department.name,
      models: resources
        .filter((resource) => resource.kind === "MODEL")
        .map((resource) => ({
          ...parseModelDeployment(resource.payload),
          origin: origin(
            modelBindings.get(resource.id),
            routingSources.get(resource.id) ?? [],
          ),
        })),
      routings: resources
        .filter((resource) => resource.kind === "ROUTING")
        .map((resource) => {
          const binding = routingBindings.get(resource.id);
          return {
            ...parseModelRouting(resource.payload),
            isDefault: binding?.isDefault ?? false,
            origin: origin(
              binding,
              [],
              binding?.isDefault && binding.defaultManagedBy
                ? {
                    slot: "ROUTING",
                    managedBy: binding.defaultManagedBy as "PROJECT" | "DEPARTMENT",
                  }
                : undefined,
            ),
          };
        }),
    };
  }

  async inheritDepartmentModel(
    id: string,
    actor = "project-api",
  ): Promise<ModelDeployment> {
    if (await this.db.modelDeploymentRecord.findFirst({
      where: { projectId: this.projectId, id, deletedAt: null },
      select: { id: true },
    })) {
      throw new Error("A Project Model already uses this resource ID.");
    }
    const project = await this.db.project.findUnique({
      where: { id: this.projectId },
      select: { departmentId: true },
    });
    if (!project) throw new Error("Project not found.");
    const resource = await this.db.departmentInferenceResourceRecord.findFirst({
      where: {
        departmentId: project.departmentId,
        id,
        kind: "MODEL",
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!resource) throw new Error("This Department Model is unavailable.");
    await this.db.projectDepartmentModelBinding.upsert({
      where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
      create: {
        projectId: this.projectId,
        departmentId: project.departmentId,
        resourceId: id,
        projectInheritedAt: new Date(),
        projectInheritedBy: actor,
      },
      update: {
        projectInheritedAt: new Date(),
        projectInheritedBy: actor,
      },
    });
    return (await this.getModelDeployment(id))!;
  }

  async removeDepartmentModelInheritance(id: string): Promise<void> {
    const binding = await this.db.projectDepartmentModelBinding.findUnique({
      where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
      select: {
        projectInheritedAt: true,
        departmentAssignedAt: true,
        defaultManagedBy: true,
      },
    });
    if (!binding?.projectInheritedAt) throw new Error("Project Model inheritance not found.");
    const remainsAvailable = Boolean(binding.departmentAssignedAt)
      || (await this.inheritedRoutingModelIds()).has(id);
    if (!remainsAvailable) {
      await this.assertCanRemoveEmbeddingModels([id]);
    }
    if (!remainsAvailable && (await this.listAgentIdsUsingModelDeployments([id])).length) {
      throw new Error("Reassign Instances using this Model before removing its inheritance.");
    }
    if (binding.departmentAssignedAt) {
      await this.db.projectDepartmentModelBinding.update({
        where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
        data: {
          projectInheritedAt: null,
          projectInheritedBy: null,
          ...(binding.defaultManagedBy === "PROJECT"
            ? { defaultFor: null, defaultManagedBy: null }
            : {}),
        },
      });
    } else {
      await this.db.projectDepartmentModelBinding.delete({
        where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
      });
    }
  }

  async inheritDepartmentRouting(
    id: string,
    actor = "project-api",
  ): Promise<ModelRouting> {
    if (await this.db.modelRoutingRecord.findFirst({
      where: { projectId: this.projectId, id, deletedAt: null },
      select: { id: true },
    })) {
      throw new Error("A Project Routing already uses this resource ID.");
    }
    const project = await this.db.project.findUnique({
      where: { id: this.projectId },
      select: { departmentId: true },
    });
    if (!project) throw new Error("Project not found.");
    const resource = await this.db.departmentInferenceResourceRecord.findFirst({
      where: {
        departmentId: project.departmentId,
        id,
        kind: "ROUTING",
        deletedAt: null,
      },
      select: { payload: true },
    });
    if (!resource) throw new Error("This Department Routing is unavailable.");
    const routing = parseModelRouting(resource.payload);
    const modelIds = [...routingDeploymentIds(routing)];
    const models = await this.db.departmentInferenceResourceRecord.findMany({
      where: {
        departmentId: project.departmentId,
        id: { in: modelIds },
        kind: "MODEL",
        deletedAt: null,
      },
      select: { id: true },
    });
    if (models.length !== modelIds.length) {
      throw new Error("This Department Routing references a Model that is no longer available.");
    }
    const localModelCollision = await this.db.modelDeploymentRecord.findFirst({
      where: {
        projectId: this.projectId,
        id: { in: modelIds },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (localModelCollision) {
      throw new Error(
        "A Project Model conflicts with a Model ID used by this Department Routing.",
      );
    }
    await this.db.projectDepartmentRoutingBinding.upsert({
      where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
      create: {
        projectId: this.projectId,
        departmentId: project.departmentId,
        resourceId: id,
        projectInheritedAt: new Date(),
        projectInheritedBy: actor,
      },
      update: {
        projectInheritedAt: new Date(),
        projectInheritedBy: actor,
      },
    });
    return (await this.getModelRouting(id))!;
  }

  async removeDepartmentRoutingInheritance(id: string): Promise<void> {
    const binding = await this.db.projectDepartmentRoutingBinding.findUnique({
      where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
      select: {
        projectInheritedAt: true,
        departmentAssignedAt: true,
        isDefault: true,
      },
    });
    if (!binding?.projectInheritedAt) throw new Error("Project Routing inheritance not found.");
    if (!binding.departmentAssignedAt && binding.isDefault) {
      throw new Error("Choose another Project default before removing this inherited Routing.");
    }
    if (!binding.departmentAssignedAt) {
      await this.assertCanRemoveEmbeddingModels(
        await this.departmentRoutingModelIdsLostAfterRemoving(id),
      );
      const consumers = (await this.listModelRoutingBindings(id)).filter(
        (consumer) => !consumer.revokedAt,
      );
      if (consumers.length) {
        throw new Error("Reassign all Instances before removing this inherited Routing.");
      }
    }
    if (binding.departmentAssignedAt) {
      await this.db.projectDepartmentRoutingBinding.update({
        where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
        data: { projectInheritedAt: null, projectInheritedBy: null },
      });
    } else {
      await this.db.projectDepartmentRoutingBinding.delete({
        where: { projectId_resourceId: { projectId: this.projectId, resourceId: id } },
      });
    }
  }

  async saveModelRoutingBinding(binding: ModelRoutingBinding): Promise<ModelRoutingBinding> {
    const previous = await this.getModelRoutingBindingForAgent(binding.agentId);
    if (previous && previous.id !== binding.id && !previous.revokedAt) {
      const previousAgent = await this.get(previous.agentId);
      await this.saveBindingAttribution(
        { ...previous, revokedAt: binding.createdAt },
        previousAgent,
      );
    }
    await this.db.modelRoutingBindingRecord.upsert({
      where: { projectId_id: { projectId: this.projectId, id: binding.id } },
      create: {
        projectId: this.projectId,
        id: binding.id,
        modelRoutingId: binding.modelRoutingId,
        agentId: binding.agentId,
        payload: jsonInput(binding),
        createdAt: binding.createdAt,
      },
      update: { payload: jsonInput(binding) },
    });
    await this.saveBindingAttribution(
      binding,
      await this.getIncludingDeleted(binding.agentId),
    );
    return binding;
  }
  private async saveBindingAttribution(binding: ModelRoutingBinding, agent?: Agent): Promise<void> {
    const routing = await this.getModelRouting(binding.modelRoutingId);
    await this.costs.saveAttribution({
      id: `binding:${binding.id}`,
      projectId: this.projectId,
      instanceId: binding.agentId,
      instanceName: agent?.name ?? binding.agentId,
      liteLLMVirtualKeyId: costKeyIdentifier(binding.liteLLMTokenId),
      hashedToken: binding.keyFingerprint,
      virtualKeyAlias: binding.keyAlias,
      liteLLMUserId: binding.agentId,
      ...(binding.liteLLMTeamId ? { liteLLMTeamId: binding.liteLLMTeamId } : {}),
      ...(routing?.gatewayId ? { providerAccountId: routing.gatewayId } : {}),
      validFrom: binding.createdAt,
      ...(binding.revokedAt ? { validTo: binding.revokedAt } : {}),
      createdAt: binding.createdAt,
      updatedAt: binding.revokedAt ?? agent?.updatedAt ?? binding.createdAt,
    });
  }
  async getModelRoutingBindingForAgent(agentId: string): Promise<ModelRoutingBinding | undefined> {
    const row = await this.db.modelRoutingBindingRecord.findFirst({
      where: { projectId: this.projectId, agentId },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    return row ? decode<ModelRoutingBinding>(row.payload) : undefined;
  }
  async listModelRoutingBindings(modelRoutingId: string): Promise<ModelRoutingBinding[]> {
    const rows = await this.db.modelRoutingBindingRecord.findMany({
      where: { projectId: this.projectId, modelRoutingId },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    return rows.map((row) => decode<ModelRoutingBinding>(row.payload));
  }
  async appendModelRoutingAudit(event: ModelRoutingAuditEvent): Promise<ModelRoutingAuditEvent> {
    await this.db.modelRoutingAuditRecord.create({
      data: {
        projectId: this.projectId,
        eventId: event.eventId,
        modelRoutingId: event.modelRoutingId,
        payload: jsonInput(event),
        createdAt: event.timestamp,
      },
    });
    return event;
  }
  async listModelRoutingAudit(modelRoutingId: string): Promise<ModelRoutingAuditEvent[]> {
    const rows = await this.db.modelRoutingAuditRecord.findMany({
      where: { projectId: this.projectId, modelRoutingId },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    return rows.map((row) => decode<ModelRoutingAuditEvent>(row.payload));
  }

  async saveSandboxPolicy(policy: SandboxPolicy): Promise<SandboxPolicy> {
    const createdAt = policy.createdAt ?? new Date().toISOString();
    await this.db.sandboxPolicyRecord.upsert({
      where: { projectId_id: { projectId: this.projectId, id: policy.id } },
      create: {
        projectId: this.projectId,
        id: policy.id,
        payload: jsonInput(policy),
        createdAt,
      },
      update: { payload: jsonInput(policy) },
    });
    return policy;
  }
  async listSandboxPolicies(): Promise<SandboxPolicy[]> {
    const rows = await this.db.sandboxPolicyRecord.findMany({
      where: { projectId: this.projectId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    return rows.map((row) => decode<SandboxPolicy>(row.payload));
  }
  async deleteSandboxPolicy(id: string): Promise<void> {
    await this.db.sandboxPolicyRecord.updateMany({
      where: { projectId: this.projectId, id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
  async isSandboxPolicyInUse(id: string): Promise<boolean> {
    return (await this.list()).some((agent) => agent.policyId === id);
  }
}
