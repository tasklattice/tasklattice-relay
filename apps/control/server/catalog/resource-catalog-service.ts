import { createHash, randomUUID } from "node:crypto";
import {
  hasValidatedEmbeddingModel,
  type CreateVectorFolderInput,
  type CreateKnowledgeSourceDefinitionInput,
  type CreateMcpServerDefinitionInput,
  type CreateSkillDefinitionInput,
  type ResourceCatalog,
  type ResourceKind,
  type KnowledgeSourceDefinition,
  type UpsertVectorChunksInput,
  type McpServerDefinition,
  type SkillDefinition,
  type UpdateKnowledgeSourceDefinitionInput,
  type UpdateMcpServerDefinitionInput,
  type UpdateSkillDefinitionInput,
  type VectorDatabaseOverview,
  type VectorDeletionImpact,
  type VectorDocument,
  type VectorDocumentChunks,
  type VectorDocumentDetail,
  type VectorFolder,
  type VectorIngestionJob,
  type VectorDatabaseSearchInput,
  type VectorDatabaseSearchResult,
  type UpdateVectorDocumentInput,
  type UpdateVectorFolderInput,
} from "@tali/contracts";
import { controlJobQueue } from "../jobs/control-job-queue";
import {
  LiteLLMClient,
  type LiteLLMAdminClient,
  type LiteLLMMcpServerInput,
  type LiteLLMVectorStoreInput,
} from "../providers/litellm-client";
import { ProjectStore } from "../projects/project-store";
import { ProjectQuotaService } from "../quotas/project-quota-service";
import { createSecretStore, type SecretStore } from "../secrets/secret-store";
import { mcpServerTemplates } from "./mcp-server-templates";
import { KnowledgeVectorDatabase } from "./knowledge-vector-database";
import {
  vectorStoreBridgeApiBase,
  vectorStoreBridgeApiKey,
} from "./vector-store-bridge-auth";
import {
  VectorDocumentService,
  type UploadedVectorDocument,
} from "./vector-document-service";
import type { VectorStoreSearchResponse } from "./vector-store-protocol";

function resourceId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-$/, "") || "resource";
  return `${slug}-${randomUUID().slice(0, 8)}`;
}

function liteLLMServerId(projectId: string, resourceId: string): string {
  const projectHash = createHash("sha256").update(projectId).digest("hex").slice(0, 10);
  return `tali_${projectHash}_${resourceId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 80)}`;
}

function liteLLMVectorStoreProvider(
  provider: KnowledgeSourceDefinition["provider"],
): LiteLLMVectorStoreInput["provider"] {
  if (provider === "elasticsearch" || provider === "postgresql") {
    return "pg_vector";
  }
  return provider;
}

export class VectorDatabaseEmbeddingRequiredError extends Error {
  readonly code = "embedding_model_required";
  readonly status = 409;

  constructor() {
    super(
      "Vector Databases require a validated text embedding model. Register or inherit an embedding model in Project Settings before creating one.",
    );
    this.name = "VectorDatabaseEmbeddingRequiredError";
  }
}

export class ResourceCatalogService {
  readonly vectorDatabase: KnowledgeVectorDatabase;
  readonly vectorDocuments: VectorDocumentService;
  constructor(
    readonly store = new ProjectStore(),
    readonly quotas = new ProjectQuotaService(store),
    readonly litellm: LiteLLMAdminClient = new LiteLLMClient(),
    readonly secrets: SecretStore = createSecretStore(),
    vectorDatabase?: KnowledgeVectorDatabase,
    vectorDocuments?: VectorDocumentService,
  ) {
    this.vectorDatabase = vectorDatabase ?? new KnowledgeVectorDatabase(store, {
      createEmbeddings: (model, input, inputType) =>
        this.requireAdapter("createEmbeddings")(model, input, inputType),
    });
    this.vectorDocuments = vectorDocuments
      ?? new VectorDocumentService(store, this.vectorDatabase);
  }

  async catalog(): Promise<ResourceCatalog> {
    return {
      skills: await this.store.listSkillDefinitions(),
      mcpServers: await this.store.listMcpServerDefinitions(),
      mcpServerTemplates,
      vectorDatabases: await this.store.listKnowledgeSourceDefinitions(),
      specializations: await this.store.listAgentSpecializations(),
    };
  }

  async createSkill(input: CreateSkillDefinitionInput): Promise<SkillDefinition> {
    return this.store.saveSkillDefinition({
      id: resourceId(input.name),
      ...input,
      updatedAt: new Date().toISOString(),
    });
  }

  async updateSkill(id: string, input: UpdateSkillDefinitionInput): Promise<SkillDefinition> {
    const current = await this.store.getSkillDefinition(id);
    if (!current) throw new Error("Skill was not found.");
    return this.store.saveSkillDefinition({
      ...current,
      ...input,
      id,
      updatedAt: new Date().toISOString(),
    });
  }

  async verifySkillArtifact(id: string): Promise<SkillDefinition> {
    const skill = await this.store.getSkillDefinition(id);
    if (!skill) throw new Error("Skill was not found.");
    const artifact = await this.store.getSkillArtifact(skill.id, skill.version);
    if (!artifact) throw new Error("Skill artifact was not found.");
    const digest =
      `sha256:${createHash("sha256").update(artifact.archive).digest("hex")}`;
    if (digest !== artifact.digest || digest !== skill.digest) {
      throw new Error("Skill artifact digest does not match the catalog.");
    }
    return skill;
  }

  async skillArtifact(id: string) {
    const skill = await this.verifySkillArtifact(id);
    const artifact = await this.store.getSkillArtifact(skill.id, skill.version);
    if (!artifact) throw new Error("Skill artifact was not found.");
    return {
      archive: artifact.archive,
      contentType: artifact.contentType,
      digest: artifact.digest,
      fileName: `${skill.id}-${skill.version}.tar.gz`,
    };
  }

  async createMcpServer(input: CreateMcpServerDefinitionInput): Promise<McpServerDefinition> {
    this.assertSafeRegistration(input);
    await this.quotas.assertCanCreate("mcp");
    const id = resourceId(input.name);
    const server = await this.store.saveMcpServerDefinition({
      id,
      litellmServerId: liteLLMServerId(this.store.projectId, id),
      ...input,
      status: "UNCHECKED",
      tools: [],
      lastDiscoveryAttemptAt: null,
      lastDiscoveredAt: null,
      lastDiscoveryError: null,
    });
    try {
      await this.requireAdapter("registerMcpServer")(await this.liteLLMInput(server));
      await this.syncProjectObjectPermissions();
      return await this.discoverMcpServer(server.id);
    } catch (error) {
      return this.store.saveMcpDiscovery(server.id, {
        status: this.failureStatus(error),
        attemptedAt: new Date().toISOString(),
        error: safeError(error),
      });
    }
  }

  async updateMcpServer(id: string, input: UpdateMcpServerDefinitionInput): Promise<McpServerDefinition> {
    this.assertSafeRegistration(input);
    const current = await this.store.getMcpServerDefinition(id);
    if (!current) throw new Error("MCP server was not found.");
    const next = await this.store.saveMcpServerDefinition({
      ...current,
      ...input,
      id,
      status: "UNCHECKED",
      lastDiscoveryError: null,
    });
    try {
      await this.requireAdapter("updateMcpServer")(await this.liteLLMInput(next));
      await this.syncProjectObjectPermissions();
      return await this.discoverMcpServer(id);
    } catch (error) {
      return this.store.saveMcpDiscovery(id, {
        status: this.failureStatus(error),
        attemptedAt: new Date().toISOString(),
        error: safeError(error),
      });
    }
  }

  async discoverMcpServer(id: string): Promise<McpServerDefinition> {
    const current = await this.store.getMcpServerDefinition(id);
    if (!current) throw new Error("MCP server was not found.");
    const attemptedAt = new Date().toISOString();
    try {
      const tools = await this.requireAdapter("discoverMcpTools")(current.litellmServerId);
      return this.store.saveMcpDiscovery(id, {
        status: "HEALTHY",
        attemptedAt,
        discoveredAt: new Date().toISOString(),
        tools,
      });
    } catch (error) {
      return this.store.saveMcpDiscovery(id, {
        status: this.failureStatus(error),
        attemptedAt,
        error: safeError(error),
      });
    }
  }

  async reconcileMcpServer(id: string): Promise<McpServerDefinition> {
    const current = await this.store.getMcpServerDefinition(id);
    if (!current) throw new Error("MCP server was not found.");
    const attemptedAt = new Date().toISOString();
    try {
      const input = await this.liteLLMInput(current);
      await this.requireAdapter("updateMcpServer")(input).catch(async (error) => {
        if (!isRemoteNotFound(error)) throw error;
        await this.requireAdapter("registerMcpServer")(input);
      });
      await this.syncProjectObjectPermissions();
      return this.discoverMcpServer(id);
    } catch (error) {
      return this.store.saveMcpDiscovery(id, {
        status: this.failureStatus(error),
        attemptedAt,
        error: safeError(error),
      });
    }
  }

  async createKnowledgeSource(input: CreateKnowledgeSourceDefinitionInput): Promise<KnowledgeSourceDefinition> {
    await this.assertEmbeddingModelAvailable();
    await this.quotas.assertCanCreate("knowledge-base");
    const resolvedInput = await this.resolveKnowledgeSourceEmbedding(input);
    const source = await this.store.saveKnowledgeSourceDefinition({
      id: resourceId(resolvedInput.name),
      ...resolvedInput,
      status: "UNAVAILABLE",
      lastReconciliationError: null,
    });
    try {
      if (source.provider === "postgresql") {
        await this.vectorDatabase.provision(source);
      }
      await this.requireAdapter("registerVectorStore")(await this.liteLLMVectorStoreInput(source));
      await this.syncProjectObjectPermissions();
      return this.store.saveKnowledgeSourceDefinition({
        ...source,
        status: "REGISTERED",
        lastReconciliationError: null,
      });
    } catch (error) {
      return this.store.saveKnowledgeSourceDefinition({
        ...source,
        status: "UNAVAILABLE",
        lastReconciliationError: safeError(error),
      });
    }
  }

  async updateKnowledgeSource(id: string, input: UpdateKnowledgeSourceDefinitionInput): Promise<KnowledgeSourceDefinition> {
    await this.assertEmbeddingModelAvailable();
    const current = await this.store.getKnowledgeSourceDefinition(id);
    if (!current) throw new Error("Vector Database was not found.");
    if (current.vectorStoreId !== input.vectorStoreId) {
      throw new Error("The provider Vector Store ID is immutable. Create a new Vector Database instead.");
    }
    const resolvedInput = await this.resolveKnowledgeSourceEmbedding(input, current);
    const candidate: KnowledgeSourceDefinition = {
      ...current,
      ...resolvedInput,
      id,
      status: "UNAVAILABLE",
      lastReconciliationError: null,
    };
    if (candidate.provider === "postgresql") {
      await this.vectorDatabase.provision(candidate);
    }
    const next = await this.store.saveKnowledgeSourceDefinition(candidate);
    try {
      await this.requireAdapter("updateVectorStore")(await this.liteLLMVectorStoreInput(next));
      await this.syncProjectObjectPermissions();
      if (next.provider !== "postgresql") {
        await this.vectorDatabase.drop(next.id);
      }
      return this.store.saveKnowledgeSourceDefinition({
        ...next,
        status: "REGISTERED",
        lastReconciliationError: null,
      });
    } catch (error) {
      return this.store.saveKnowledgeSourceDefinition({
        ...next,
        status: "UNAVAILABLE",
        lastReconciliationError: safeError(error),
      });
    }
  }

  async delete(kind: ResourceKind, id: string): Promise<boolean> {
    if (await this.store.isResourceInUse(kind, id))
      throw new Error("This resource is assigned to a Role or Instance and cannot be deleted.");
    if (kind === "skills") return this.store.deleteSkillDefinition(id);
    if (kind === "mcp-servers") {
      const server = await this.store.getMcpServerDefinition(id);
      if (!server) return false;
      await this.requireAdapter("deleteMcpServer")(server.litellmServerId)
        .catch((error) => {
          if (!isRemoteNotFound(error)) throw error;
        });
      const deleted = await this.store.deleteMcpServerDefinition(id);
      await this.syncProjectObjectPermissions();
      return deleted;
    }
    const source = await this.store.getKnowledgeSourceDefinition(id);
    if (!source) return false;
    await this.requireAdapter("deleteVectorStore")(source.vectorStoreId)
      .catch((error) => {
        if (!isRemoteNotFound(error)) throw error;
      });
    if (source.provider === "postgresql") {
      await this.vectorDatabase.drop(source.id);
    }
    const deleted = await this.store.deleteKnowledgeSourceDefinition(id);
    await this.syncProjectObjectPermissions();
    return deleted;
  }

  async upsertVectorChunks(
    sourceId: string,
    input: UpsertVectorChunksInput,
  ): Promise<{ upserted: number }> {
    await this.assertEmbeddingModelAvailable();
    return this.vectorDatabase.upsertChunks(sourceId, input);
  }

  async deleteVectorChunk(
    sourceId: string,
    chunkId: string,
  ): Promise<boolean> {
    return this.vectorDatabase.deleteChunk(sourceId, chunkId);
  }

  async vectorDatabaseOverview(id: string): Promise<VectorDatabaseOverview> {
    return this.vectorDocuments.overview(id);
  }

  async vectorDocument(id: string, documentId: string): Promise<VectorDocumentDetail> {
    return this.vectorDocuments.document(id, documentId);
  }

  async vectorDocumentChunks(id: string, documentId: string): Promise<VectorDocumentChunks> {
    return this.vectorDocuments.documentChunks(id, documentId);
  }

  async queueVectorDocument(
    id: string,
    file: UploadedVectorDocument,
    uploadedBy: string,
    directoryPath = "/",
    folderId?: string | null,
  ): Promise<{ document: VectorDocument; job: VectorIngestionJob }> {
    await this.assertEmbeddingModelAvailable();
    return this.vectorDocuments.queue(
      id,
      file,
      uploadedBy,
      controlJobQueue(),
      folderId === undefined ? { directoryPath } : { folderId },
    );
  }

  async deleteVectorDocument(id: string, documentId: string): Promise<boolean> {
    return this.vectorDocuments.delete(id, documentId);
  }

  async createVectorFolder(
    id: string,
    input: CreateVectorFolderInput,
  ): Promise<VectorFolder> {
    return this.vectorDocuments.createFolder(id, input);
  }

  async updateVectorFolder(
    id: string,
    folderId: string,
    input: UpdateVectorFolderInput,
  ): Promise<VectorFolder> {
    return this.vectorDocuments.updateFolder(id, folderId, input);
  }

  async deleteVectorFolder(
    id: string,
    folderId: string,
  ): Promise<VectorDeletionImpact | undefined> {
    return this.vectorDocuments.deleteFolder(id, folderId);
  }

  async updateVectorDocument(
    id: string,
    documentId: string,
    input: UpdateVectorDocumentInput,
  ): Promise<VectorDocument> {
    return this.vectorDocuments.updateDocument(id, documentId, input);
  }

  async searchVectorDatabase(
    id: string,
    input: VectorDatabaseSearchInput,
  ): Promise<VectorDatabaseSearchResult> {
    await this.assertEmbeddingModelAvailable();
    const database = await this.store.getKnowledgeSourceDefinition(id);
    if (!database) throw new Error("Vector Database was not found.");
    const startedAt = Date.now();
    const filters: Array<Record<string, unknown>> = [];
    if (input.folderId !== undefined) {
      filters.push({ type: "eq", key: "folder_id", value: input.folderId ?? "root" });
    }
    if (input.metadataFilters?.length) {
      const metadataSchema = database.provider === "postgresql"
        ? await this.vectorDocuments.metadataFields(id)
        : [];
      const fields = new Map(metadataSchema.map((field) => [field.key, field]));
      for (const filter of input.metadataFilters) {
        const field = fields.get(filter.key);
        if (!field) {
          throw new Error(`Metadata field “${filter.key}” is not present in this Vector Database schema.`);
        }
        if (field.type !== filter.value.type) {
          throw new Error(`Metadata field “${filter.key}” requires a ${field.type} value.`);
        }
        filters.push({
          type: filter.operator,
          key: `tali_metadata_${filter.key}`,
          value: filter.value.value,
        });
      }
    }
    const request = {
      query: input.query,
      max_num_results: input.topK,
      ...(filters.length === 1
        ? { filters: filters[0] }
        : filters.length > 1
          ? { filters: { type: "and", filters } }
          : {}),
    };
    const response = database.provider === "postgresql"
      ? await this.vectorDatabase.search(database.vectorStoreId, request)
      : (await this.requireAdapter("searchVectorStore")(database.vectorStoreId, request)) as VectorStoreSearchResponse;
    if (!response || !Array.isArray(response.data)) {
      throw new Error("The Vector Database provider returned an invalid search response.");
    }
    return {
      query: input.query,
      durationMs: Date.now() - startedAt,
      results: response.data.map((item) => {
        const attributes = jsonRecord(item.attributes);
        const pageNumber = typeof attributes.page_number === "number"
          ? attributes.page_number
          : null;
        const chunkIndex = typeof attributes.chunk_index === "number"
          ? attributes.chunk_index
          : null;
        const sectionPath = Array.isArray(attributes.section_path)
          ? attributes.section_path.filter((value): value is string => typeof value === "string")
          : [];
        return {
          id: item.file_id,
          chunkId: item.file_id,
          documentId: typeof attributes.document_id === "string"
            ? attributes.document_id
            : null,
          content: item.content.map((part) => part.text).join("\n"),
          filename: item.filename,
          directoryPath: typeof attributes.file_path === "string"
            ? parentDirectory(attributes.file_path)
            : "/",
          score: item.score,
          pageNumber,
          chunkIndex,
          sectionPath,
          attributes,
        };
      }),
    };
  }

  private async syncProjectObjectPermissions(): Promise<void> {
    const teamId = await this.quotas.ensureProjectTeam();
    const [mcpServers, vectorStores] = await Promise.all([
      this.store.listMcpServerDefinitions()
        .then((servers) => servers.map((server) => server.litellmServerId)),
      this.store.listKnowledgeSourceDefinitions()
        .then((sources) => sources.map((source) => source.vectorStoreId)),
    ]);
    await this.requireAdapter("updateProjectObjectPermissions")(teamId, {
      mcpServers,
      vectorStores,
    });
  }

  private async assertEmbeddingModelAvailable(): Promise<void> {
    if (!hasValidatedEmbeddingModel(await this.store.listModelDeployments())) {
      throw new VectorDatabaseEmbeddingRequiredError();
    }
  }

  private async resolveKnowledgeSourceEmbedding<
    T extends CreateKnowledgeSourceDefinitionInput,
  >(
    input: T,
    current?: KnowledgeSourceDefinition,
  ): Promise<T> {
    if (input.provider !== "postgresql" || !input.embeddingModelDeploymentId) {
      return input;
    }
    const deployment = await this.store.getModelDeployment(
      input.embeddingModelDeploymentId,
    );
    if (!deployment) {
      throw new Error("The selected Project embedding model was not found.");
    }
    if (deployment.modelType !== "text-embedding") {
      throw new Error("The selected model is not a text embedding model.");
    }
    if (deployment.status !== "VALIDATED") {
      throw new Error("The selected embedding model must pass validation before it can back a Vector Database.");
    }
    const unchanged = current?.embeddingModelDeploymentId === deployment.id
      && current.embeddingModel === deployment.litellmModelName
      && Boolean(current.embeddingDimensions);
    let embeddingDimensions = unchanged
      ? current.embeddingDimensions
      : undefined;
    if (!embeddingDimensions) {
      const [probe] = await this.requireAdapter("createEmbeddings")(
        deployment.litellmModelName,
        ["TaskLattice embedding dimension probe."],
        "passage",
      );
      if (!probe || !probe.length || probe.length > 16_000 || !probe.every(Number.isFinite)) {
        throw new Error("The selected embedding model returned an invalid probe vector.");
      }
      embeddingDimensions = probe.length;
    }
    return {
      ...input,
      embeddingModel: deployment.litellmModelName,
      embeddingDimensions,
    };
  }

  private async liteLLMInput(server: McpServerDefinition): Promise<LiteLLMMcpServerInput> {
    const [credential, staticHeaders, environment] = await Promise.all([
      server.authReference ? this.secrets.get(server.authReference) : Promise.resolve(undefined),
      this.resolveReferences(server.staticHeaders.map((entry) => [entry.name, entry.valueReference])),
      this.resolveReferences(server.environment.map((entry) => [entry.name, entry.valueReference])),
    ]);
    return {
      serverId: server.litellmServerId,
      serverName: server.alias,
      alias: server.alias,
      description: server.description,
      transport: server.transport === "openapi" ? "http" : server.transport,
      authType: server.authType,
      ...(credential ? { credential } : {}),
      ...(server.endpoint ? { url: server.endpoint } : {}),
      ...(server.specPath ? { specPath: server.specPath } : {}),
      ...(server.sourceUrl ? { sourceUrl: server.sourceUrl } : {}),
      accessGroups: server.accessGroups,
      allowedTools: server.allowedTools,
      extraHeaders: server.extraHeaders,
      staticHeaders,
      ...(server.command ? { command: server.command } : {}),
      args: server.args,
      environment,
      ...(server.oauth?.authorizationUrl ? { authorizationUrl: server.oauth.authorizationUrl } : {}),
      ...(server.oauth?.tokenUrl ? { tokenUrl: server.oauth.tokenUrl } : {}),
      ...(server.oauth?.registrationUrl ? { registrationUrl: server.oauth.registrationUrl } : {}),
      ...(server.oauth?.flow ? { oauth2Flow: server.oauth.flow } : {}),
      availableOnPublicInternet: !server.internalNetworkOnly,
    };
  }

  private async resolveReferences(entries: Array<[string, string]>): Promise<Record<string, string>> {
    return Object.fromEntries(await Promise.all(entries.map(async ([name, reference]) => [
      name,
      await this.secrets.get(reference),
    ])));
  }

  private async liteLLMVectorStoreInput(source: KnowledgeSourceDefinition): Promise<LiteLLMVectorStoreInput> {
    const usesInternalBridge = source.provider === "elasticsearch"
      || source.provider === "postgresql";
    const credential = !usesInternalBridge && source.credentialReference
      ? await this.secrets.get(source.credentialReference)
      : undefined;
    return {
      vectorStoreId: source.vectorStoreId,
      provider: liteLLMVectorStoreProvider(source.provider),
      name: source.name,
      description: source.description,
      metadata: {
        managed_by: "tali",
        tali_project_id: this.store.projectId,
        tali_provider: source.provider,
        top_k: source.topK,
      },
      litellmParams: {
        ...(usesInternalBridge
          ? {
              api_base: await vectorStoreBridgeApiBase(
                this.store.projectId,
                this.store.database(),
              ),
              api_key: vectorStoreBridgeApiKey(),
            }
          : {
              ...(source.apiBase ? { api_base: source.apiBase } : {}),
              ...(source.embeddingModel ? { litellm_embedding_model: source.embeddingModel } : {}),
              ...this.vectorStoreCredentialParams(source.provider, credential),
            }),
      },
    };
  }

  private vectorStoreCredentialParams(
    provider: KnowledgeSourceDefinition["provider"],
    credential: string | undefined,
  ): Record<string, unknown> {
    if (!credential) return {};
    if (credential.trim().startsWith("{")) {
      const parsed = JSON.parse(credential) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Vector Store credential JSON must be an object.");
      }
      return parsed as Record<string, unknown>;
    }
    if (provider === "vertex_ai") return { vertex_credentials: credential };
    return { api_key: credential };
  }

  private assertSafeRegistration(input: CreateMcpServerDefinitionInput): void {
    if (input.transport !== "stdio") return;
    const template = mcpServerTemplates.find((candidate) => candidate.id === input.templateId);
    const usesReviewedCommand = template?.transport === "stdio"
      && template.command === input.command
      && JSON.stringify(template.args) === JSON.stringify(input.args);
    if (!usesReviewedCommand) {
      throw new Error("Custom stdio commands are not allowed. Select a reviewed built-in MCP Server template.");
    }
  }

  private requireAdapter<K extends keyof LiteLLMAdminClient>(
    name: K,
  ): NonNullable<LiteLLMAdminClient[K]> {
    const adapter = this.litellm[name];
    if (typeof adapter !== "function") {
      throw new Error(`LiteLLM adapter does not implement ${String(name)}.`);
    }
    return adapter.bind(this.litellm) as NonNullable<LiteLLMAdminClient[K]>;
  }

  private failureStatus(error: unknown): McpServerDefinition["status"] {
    return /(?:401|403|credential|permission|oauth|secret)/i.test(safeError(error))
      ? "PERMISSION_REQUIRED"
      : "UNAVAILABLE";
  }
}

function parentDirectory(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) return "/";
  return `/${segments.slice(0, -1).join("/")}`;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000);
}

function isRemoteNotFound(error: unknown): boolean {
  return /(?:\b404\b|not found)/i.test(safeError(error));
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
