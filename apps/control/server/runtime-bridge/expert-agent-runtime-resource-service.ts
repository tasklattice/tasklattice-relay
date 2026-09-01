import { createHash } from "node:crypto";
import {
  expertAgentVersionSnapshotSchema,
  vectorDatabaseSearchInputSchema,
  type ExpertAgentVersionSnapshot,
  type ExpertAgentResourceBinding,
  type McpServerDefinition,
} from "@tali/contracts";
import { z } from "zod";
import { ResourceCatalogService } from "../catalog/resource-catalog-service";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import {
  canonicalJson,
  expertAgentContentDigest,
} from "../expert-agents/expert-agent-domain";
import { ModelRoutingResolver } from "../model-routings/model-routing-service";
import {
  LiteLLMClient,
  type LiteLLMAdminClient,
} from "../providers/litellm-client";
import { ProjectStore } from "../projects/project-store";
import type { ProjectRuntimeExpertAgentIdentity } from "./project-runtime-bridge-token";

export const expertAgentMcpCallSchema = z.object({
  serverId: z.string().trim().min(1).max(240),
  toolName: z.string().trim().min(1).max(200),
  arguments: z.record(z.string(), z.unknown()),
}).strict();

export const expertAgentKnowledgeSearchSchema = z.object({
  vectorDatabaseId: z.string().trim().min(1).max(240),
  query: z.string().trim().min(1).max(8_000),
  limit: z.number().int().min(1).max(20),
}).strict();

export const expertAgentModelCompletionSchema = z.object({
  modelRoutingId: z.string().trim().min(1).max(240),
  system: z.string().trim().min(1).max(32_000),
  user: z.string().trim().min(1).max(128_000),
  responseJsonSchema: z.record(z.string(), z.unknown()),
  temperature: z.number().min(0).max(0.2),
}).strict();

type RuntimeStore = Pick<
  ProjectStore,
  "getKnowledgeSourceDefinition" | "getMcpServerDefinition" | "getModelRouting"
>;
type RuntimeCatalog = Pick<ResourceCatalogService, "searchVectorDatabase">
  & Partial<Pick<ResourceCatalogService, "reconcileMcpServer">>;
type RuntimeLiteLLM = Pick<LiteLLMAdminClient, "callMcpTool" | "completeStructuredModel">;
interface RuntimeRevisionResolver {
  mcp(server: McpServerDefinition): string;
  modelRouting(configurationHash: string): string;
  knowledge(vectorDatabaseId: string): Promise<string>;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function bindingFor(
  snapshot: ExpertAgentVersionSnapshot,
  kind: ExpertAgentResourceBinding["kind"],
  resourceId: string,
): ExpertAgentResourceBinding {
  const binding = snapshot.resources.find((item) =>
    item.kind === kind && item.resourceId === resourceId
  );
  if (!binding) {
    throw new Error(`Version has no immutable binding for ${kind}:${resourceId}.`);
  }
  return binding;
}

export class ExpertAgentResourceRevisionService {
  constructor(
    private readonly projectId: string,
    private readonly db: PrismaClient = prisma(),
  ) {}

  mcp(server: McpServerDefinition): string {
    const {
      lastDiscoveryAttemptAt: _lastDiscoveryAttemptAt,
      lastDiscoveredAt: _lastDiscoveredAt,
      lastDiscoveryError: _lastDiscoveryError,
      tools,
      ...versionedDefinition
    } = server;
    // Secret values never enter the digest, but their references and every
    // effective connection/tool-policy field do. A routine rediscovery with
    // identical results does not invalidate a Version.
    return digest({
      ...versionedDefinition,
      tools: tools.map(({ discoveredAt: _discoveredAt, ...tool }) => tool),
    });
  }

  modelRouting(configurationHash: string): string {
    return configurationHash.startsWith("sha256:")
      ? configurationHash
      : `sha256:${configurationHash}`;
  }

  async knowledge(vectorDatabaseId: string): Promise<string> {
    const [source, database, documents, chunks] = await Promise.all([
      this.db.knowledgeSourceRecord.findUnique({
        where: {
          projectId_id: { projectId: this.projectId, id: vectorDatabaseId },
        },
        select: { payload: true, updatedAt: true, deletedAt: true },
      }),
      this.db.knowledgeVectorDatabase.findUnique({
        where: {
          projectId_id: { projectId: this.projectId, id: vectorDatabaseId },
        },
        select: {
          vectorStoreId: true,
          embeddingModel: true,
          embeddingDimensions: true,
          updatedAt: true,
        },
      }),
      this.db.vectorDocument.findMany({
        where: { projectId: this.projectId, databaseId: vectorDatabaseId },
        orderBy: { id: "asc" },
        select: {
          id: true,
          activeRevision: true,
          contentHash: true,
          customMetadata: true,
          status: true,
          updatedAt: true,
        },
      }),
      this.db.knowledgeVectorChunk.findMany({
        where: {
          projectId: this.projectId,
          databaseId: vectorDatabaseId,
          documentId: null,
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          content: true,
          attributes: true,
          updatedAt: true,
        },
      }),
    ]);
    if (!source || source.deletedAt || !database) {
      throw new Error("Bound Vector Database was not found.");
    }
    return digest({
      source: source.payload,
      sourceUpdatedAt: source.updatedAt.toISOString(),
      database: {
        ...database,
        updatedAt: database.updatedAt.toISOString(),
      },
      documents: documents.map((document) => ({
        ...document,
        updatedAt: document.updatedAt.toISOString(),
      })),
      directChunks: chunks.map((chunk) => ({
        ...chunk,
        updatedAt: chunk.updatedAt.toISOString(),
      })),
    });
  }
}

export class ExpertAgentRuntimeResourceService {
  private readonly db: PrismaClient;
  private readonly store: RuntimeStore;
  private readonly catalog: RuntimeCatalog;
  private readonly litellm: RuntimeLiteLLM;
  private readonly revisions: RuntimeRevisionResolver;
  private readonly snapshotOverride: ExpertAgentVersionSnapshot | undefined;

  constructor(
    readonly identity: ProjectRuntimeExpertAgentIdentity,
    dependencies: {
      db?: PrismaClient;
      store?: RuntimeStore;
      catalog?: RuntimeCatalog;
      litellm?: RuntimeLiteLLM;
      revisions?: RuntimeRevisionResolver;
      snapshot?: ExpertAgentVersionSnapshot;
    } = {},
  ) {
    const db = dependencies.db ?? prisma();
    this.db = db;
    const store = dependencies.store ?? new ProjectStore(identity.projectId, db);
    this.store = store;
    this.catalog = dependencies.catalog
      ?? new ResourceCatalogService(store as ProjectStore);
    this.litellm = dependencies.litellm ?? new LiteLLMClient();
    this.revisions = dependencies.revisions
      ?? new ExpertAgentResourceRevisionService(identity.projectId, db);
    if (dependencies.snapshot) {
      const snapshot = expertAgentVersionSnapshotSchema.parse(dependencies.snapshot);
      if (
        snapshot.agentId !== identity.agentId
        || expertAgentContentDigest(snapshot) !== identity.contentDigest
      ) {
        throw new Error("Version validation identity does not match the immutable snapshot.");
      }
      this.snapshotOverride = snapshot;
    }
  }

  async callMcpTool(raw: unknown): Promise<unknown> {
    const input = expertAgentMcpCallSchema.parse(raw);
    const snapshot = await this.snapshot();
    const binding = bindingFor(snapshot, "MCP_SERVER", input.serverId);
    const server = await this.store.getMcpServerDefinition(input.serverId);
    if (!server || server.status !== "HEALTHY") {
      throw new Error("Bound MCP Server is not healthy.");
    }
    this.requireRevision(binding, this.revisions.mcp(server));
    const tool = server.tools.find((item) => item.name === input.toolName);
    if (!tool || (server.allowedTools.length && !server.allowedTools.includes(tool.name))) {
      throw new Error("MCP tool is not present in the bound Server allowlist.");
    }
    const explicitlyReadOnly = tool.annotations?.readOnlyHint === true
      || server.readOnlyTools?.includes(tool.name) === true;
    if (binding.access === "READ" && !explicitlyReadOnly) {
      throw new Error("READ bindings may invoke only tools explicitly marked read-only.");
    }
    if (binding.access === "INVOKE" && tool.annotations?.destructiveHint === true) {
      throw new Error("Destructive MCP tools require a READ_WRITE binding.");
    }
    if (!this.litellm.callMcpTool) {
      throw new Error("The configured LiteLLM adapter does not support MCP calls.");
    }
    try {
      return await this.litellm.callMcpTool(
        server.litellmServerId,
        input.toolName,
        input.arguments,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const canReconcile = /(?:tool|mcp server).{0,240}not found/i.test(detail)
        && this.catalog.reconcileMcpServer;
      if (!canReconcile) throw error;
      const reconciled = await this.catalog.reconcileMcpServer!(server.id);
      if (reconciled.status !== "HEALTHY") {
        throw new Error("Bound MCP Server reconciliation failed.", { cause: error });
      }
      this.requireRevision(binding, this.revisions.mcp(reconciled));
      return this.litellm.callMcpTool(
        reconciled.litellmServerId,
        input.toolName,
        input.arguments,
      );
    }
  }

  async searchKnowledge(raw: unknown): Promise<Array<{
    id: string;
    title: string;
    text: string;
    uri: string | null;
    score: number;
    metadata: Record<string, unknown>;
  }>> {
    const input = expertAgentKnowledgeSearchSchema.parse(raw);
    const snapshot = await this.snapshot();
    const binding = bindingFor(
      snapshot,
      "KNOWLEDGE_VECTOR_DATABASE",
      input.vectorDatabaseId,
    );
    if (binding.access !== "READ" && binding.access !== "READ_WRITE") {
      throw new Error("Knowledge search requires a READ binding.");
    }
    const database = await this.store.getKnowledgeSourceDefinition(
      input.vectorDatabaseId,
    );
    if (!database || database.status !== "REGISTERED") {
      throw new Error("Bound Vector Database is unavailable.");
    }
    if (
      snapshot.execution.mode === "WORKFLOW"
      && (snapshot.execution.configuration.engineType
        === "DETERMINISTIC_CUSTOMER_SUPPORT"
        || snapshot.execution.configuration.engineType
          === "CONTROLLED_OFFBOARDING_KNOWLEDGE")
      && database.provider !== "postgresql"
    ) {
      throw new Error(
        "Controlled Knowledge Workflows require a platform-versioned PostgreSQL Vector Database.",
      );
    }
    this.requireRevision(
      binding,
      await this.revisions.knowledge(input.vectorDatabaseId),
    );
    const result = await this.catalog.searchVectorDatabase(
      input.vectorDatabaseId,
      vectorDatabaseSearchInputSchema.parse({
        query: input.query,
        topK: input.limit,
      }),
    );
    return result.results.map((item) => ({
      id: item.id,
      title: item.filename,
      text: item.content,
      uri: typeof item.attributes.source_uri === "string"
        ? item.attributes.source_uri
        : null,
      score: item.score,
      metadata: item.attributes,
    }));
  }

  async completeModel(raw: unknown): Promise<unknown> {
    const input = expertAgentModelCompletionSchema.parse(raw);
    const snapshot = await this.snapshot();
    if (snapshot.execution.mode !== "AGENTIC") {
      throw new Error("Workflow Agents cannot generate factual responses at runtime.");
    }
    if (snapshot.execution.modelRoutingId !== input.modelRoutingId) {
      throw new Error("Requested Model Routing does not match the immutable execution spec.");
    }
    const binding = bindingFor(snapshot, "MODEL_ROUTING", input.modelRoutingId);
    if (binding.access !== "INVOKE" && binding.access !== "READ_WRITE") {
      throw new Error("Model completion requires an INVOKE binding.");
    }
    const routing = await new ModelRoutingResolver(this.store as ProjectStore)
      .resolve(input.modelRoutingId);
    this.requireRevision(
      binding,
      this.revisions.modelRouting(routing.configurationHash),
    );
    if (!this.litellm.completeStructuredModel) {
      throw new Error("The configured LiteLLM adapter does not support structured completion.");
    }
    return this.litellm.completeStructuredModel({
      model: routing.publicModelAlias,
      system: input.system,
      user: input.user,
      responseJsonSchema: input.responseJsonSchema,
      temperature: input.temperature,
    });
  }

  private async snapshot(): Promise<ExpertAgentVersionSnapshot> {
    if (this.snapshotOverride) return this.snapshotOverride;
    const version = await this.db.expertAgentVersionRecord.findFirst({
      where: {
        projectId: this.identity.projectId,
        id: this.identity.versionId,
        agentId: this.identity.agentId,
        contentDigest: this.identity.contentDigest,
      },
    });
    if (!version || version.contentDigest !== this.identity.contentDigest) {
      throw new Error("Agent Version was not found.");
    }
    return expertAgentVersionSnapshotSchema.parse(version.snapshot);
  }

  private requireRevision(
    binding: ExpertAgentResourceBinding,
    currentRevision: string,
  ): void {
    if (binding.revision !== currentRevision) {
      throw new Error(
        `Bound ${binding.kind}:${binding.resourceId} revision drifted; rebuild and revalidate the Version.`,
      );
    }
  }
}
