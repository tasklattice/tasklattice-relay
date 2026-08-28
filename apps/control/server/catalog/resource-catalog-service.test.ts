import { createHash } from "node:crypto";
import type { ModelDeployment } from "@tali/contracts";
import { describe, expect, it, vi } from "vitest";
import type { LiteLLMAdminClient } from "../providers/litellm-client";
import { ProjectQuotaService } from "../quotas/project-quota-service";
import { createTestStore } from "../test/store";
import type { SecretStore } from "../secrets/secret-store";
import { KnowledgeVectorDatabase } from "./knowledge-vector-database";
import { ResourceCatalogService } from "./resource-catalog-service";

function adapter(
  overrides: Partial<LiteLLMAdminClient> = {},
): LiteLLMAdminClient {
  return {
    baseUrl: "http://litellm.test",
    registerModel: vi.fn(),
    deleteModel: vi.fn(),
    probeModel: vi.fn(),
    createInstanceKey: vi.fn(),
    blockKey: vi.fn(),
    revokeKey: vi.fn(),
    listSpendLogs: vi.fn(async () => []),
    ensureProjectTeam: vi.fn(async () => "team-project"),
    updateProjectObjectPermissions: vi.fn(async () => undefined),
    registerMcpServer: vi.fn(async () => undefined),
    updateMcpServer: vi.fn(async () => undefined),
    deleteMcpServer: vi.fn(async () => undefined),
    discoverMcpTools: vi.fn(async () => [
      {
        name: "search_documents",
        description: "Search approved documents.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
        annotations: { readOnlyHint: true },
        discoveredAt: "2026-07-25T00:00:00.000Z",
      },
    ]),
    registerVectorStore: vi.fn(async () => undefined),
    updateVectorStore: vi.fn(async () => undefined),
    deleteVectorStore: vi.fn(async () => undefined),
    ...overrides,
  };
}

function serviceWithAdapter(overrides: Partial<LiteLLMAdminClient> = {}) {
  const store = createTestStore();
  const litellm = adapter(overrides);
  return {
    store,
    litellm,
    service: new ResourceCatalogService(
      store,
      new ProjectQuotaService(store, litellm),
      litellm,
    ),
  };
}

function markEmbeddingReady(store: ReturnType<typeof createTestStore>): void {
  const now = new Date().toISOString();
  const embedding: ModelDeployment = {
    id: "embedding-model-a",
    providerAccountId: "provider-a",
    modelId: "text-embedding-3-small",
    displayName: "Text Embedding 3 Small",
    modelType: "text-embedding",
    capabilities: [],
    inputModalities: ["text"],
    outputModalities: ["embedding"],
    providerPresetId: "openai",
    providerName: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    complianceDomain: "GLOBAL",
    endpointRegion: "global",
    crossBorderTransfer: false,
    litellmModelName: "tali/provider-a/text-embedding-3-small",
    status: "VALIDATED",
    checks: [],
    validationMessage: "Ready",
    validatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  vi.spyOn(store, "listModelDeployments").mockResolvedValue([embedding]);
}

const connection = {
  name: "Document Search MCP",
  alias: "document_search",
  description: "Search the Project's approved document collection.",
  category: "Knowledge",
  endpoint: "https://mcp.example.test/mcp",
  transport: "http" as const,
  authType: "none" as const,
  authReference: "",
  args: [],
  environment: [],
  accessGroups: ["knowledge-read"],
  allowedTools: [],
  extraHeaders: [],
  staticHeaders: [],
  internalNetworkOnly: true,
};

describe("ResourceCatalogService", () => {
  it("loads PostgreSQL catalog defaults and curated MCP templates", async () => {
    const service = new ResourceCatalogService(createTestStore());
    const catalog = await service.catalog();

    expect(catalog.skills).toHaveLength(15);
    expect(catalog.skills[0]).not.toHaveProperty("bindings");
    expect(
      catalog.skills.filter((skill) =>
        skill.compatibleAgents.includes("openai"),
      ).length,
    ).toBeGreaterThan(0);
    expect(catalog.skills.map((skill) => skill.name)).toEqual(
      expect.arrayContaining([
        "Helm Chart Developer",
        "Kubernetes Expert",
        "OCP Expert",
      ]),
    );
    expect(catalog.mcpServers).toEqual([]);
    expect(catalog.vectorDatabases).toEqual([]);
    expect(
      catalog.specializations.find((item) => item.id === "hr"),
    ).toMatchObject({
      defaultSkillIds: [
        "employee-policy-search",
        "document-summarization",
        "onboarding-guidance",
      ],
      defaultMcpServerIds: [],
      defaultKnowledgeSourceIds: [],
    });
    const availableSkillIds = new Set(catalog.skills.map((item) => item.id));
    const availableMcpServerIds = new Set(
      catalog.mcpServers.map((item) => item.id),
    );
    const availableKnowledgeSourceIds = new Set(
      catalog.vectorDatabases.map((item) => item.id),
    );
    for (const role of catalog.specializations) {
      expect(role.defaultSkillIds.every((id) => availableSkillIds.has(id))).toBe(true);
      expect(
        role.defaultMcpServerIds.every((id) => availableMcpServerIds.has(id)),
      ).toBe(true);
      expect(
        role.defaultKnowledgeSourceIds.every((id) =>
          availableKnowledgeSourceIds.has(id),
        ),
      ).toBe(true);
    }
    expect(catalog.mcpServerTemplates.map((template) => template.name)).toEqual(
      expect.arrayContaining([
        "Cloudflare Documentation",
        "Context7 Documentation",
        "DeepWiki Public Repositories",
        "GitHub",
        "Atlassian (Jira & Confluence)",
        "PostgreSQL",
        "MySQL",
        "Redis",
      ]),
    );
    expect(
      catalog.mcpServerTemplates.filter(
        (template) => template.category === "Example",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cloudflare-docs",
          endpointPlaceholder: "https://docs.mcp.cloudflare.com/mcp",
          defaultAuthType: "none",
        }),
        expect.objectContaining({
          id: "context7-docs",
          endpointPlaceholder: "https://mcp.context7.com/mcp",
          defaultAuthType: "none",
        }),
        expect.objectContaining({
          id: "deepwiki",
          endpointPlaceholder: "https://mcp.deepwiki.com/mcp",
          defaultAuthType: "none",
        }),
      ]),
    );
    expect(
      Object.fromEntries(
        catalog.mcpServerTemplates.map((template) => [
          template.id,
          template.logo,
        ]),
      ),
    ).toMatchObject({
      postgresql: "postgresql",
      mysql: "mysql",
      redis: "redis",
      slack: "slack",
    });
  });

  it("verifies and returns an immutable PostgreSQL Skill archive", async () => {
    const store = createTestStore();
    const service = new ResourceCatalogService(store);
    const skill = (await service.catalog()).skills.find(
      (candidate) => candidate.id === "document-summarization",
    )!;
    const archive = Buffer.from("test-vendor-skill-archive");
    const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
    vi.spyOn(store, "getSkillArtifact").mockResolvedValue({
      id: `${skill.id}@${skill.version}`,
      skillId: skill.id,
      version: skill.version,
      digest,
      archiveFormat: "tar+gzip",
      contentType: "application/gzip",
      archive: new Uint8Array(archive),
      compressedSizeBytes: archive.length,
      unpackedSizeBytes: archive.length,
      fileCount: 1,
      manifest: {},
      sourcePath: "artifacts/skills/vendor/test.tar.gz",
      createdAt: new Date(),
    });
    await service.updateSkill(skill.id, {
      ...skill,
      digest,
      endpoint: `tali+postgresql://skill-artifacts/${skill.id}/${skill.version}`,
    });

    await expect(service.verifySkillArtifact(skill.id)).resolves.toMatchObject({
      id: skill.id,
      digest,
    });
    await expect(service.skillArtifact(skill.id)).resolves.toMatchObject({
      contentType: "application/gzip",
      digest,
      fileName: `${skill.id}-${skill.version}.tar.gz`,
    });
  });

  it("persists project changes without overwriting them when defaults are seeded again", async () => {
    const store = createTestStore();
    const service = new ResourceCatalogService(store);
    const current = (await service.catalog()).skills.find(
      (skill) => skill.id === "helm-chart-developer",
    )!;

    await service.updateSkill(current.id, {
      ...current,
      name: "Helm Platform Developer",
    });
    const restarted = new ResourceCatalogService(store);

    expect(
      (await restarted.catalog()).skills.find(
        (skill) => skill.id === current.id,
      )?.name,
    ).toBe("Helm Platform Developer");
  });

  it("creates and removes project resources while protecting Role references", async () => {
    const service = new ResourceCatalogService(createTestStore());
    const created = await service.createSkill({
      name: "Release Notes Writer",
      description:
        "Draft structured release notes from approved change records.",
      problemStatement:
        "Release information is scattered across change records and is difficult to summarize consistently.",
      useCases: [
        "Prepare release notes for a deployment",
        "Summarize approved product changes",
      ],
      usageGuide:
        "Attach the Skill to a coding Agent and provide the approved change records as input.",
      author: "Developer Experience",
      category: "Developer Tools",
      trustLevel: "UNSAFE",
      compatibleAgents: ["openclaw", "claude-code"],
      version: "1.0.0",
      endpoint: "https://skills.internal.example/release-notes.tar.zst",
      digest: "Pending source check",
      owner: "Current project",
      permissions: 0,
      status: "DRAFT",
    });

    expect(created).toMatchObject({
      trustLevel: "UNSAFE",
      compatibleAgents: ["openclaw", "claude-code"],
      author: "Developer Experience",
    });
    expect(created.updatedAt).toEqual(expect.any(String));
    expect(await service.delete("skills", created.id)).toBe(true);
    await expect(service.delete("skills", "kubernetes-expert")).rejects.toThrow(
      "assigned to a Role or Instance",
    );
  });

  it("registers with LiteLLM, snapshots tools, and binds the Project Team", async () => {
    const { service, store, litellm } = serviceWithAdapter();
    const created = await service.createMcpServer(connection);

    expect(created.status).toBe("HEALTHY");
    expect(created.tools.map((tool) => tool.name)).toEqual([
      "search_documents",
    ]);
    expect(created.litellmServerId).toMatch(/^tali_[a-f0-9]{10}_/);
    expect(litellm.registerMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: created.litellmServerId,
        alias: "document_search",
        availableOnPublicInternet: false,
      }),
    );
    expect(litellm.updateProjectObjectPermissions).toHaveBeenCalledWith(
      "team-project",
      { mcpServers: [created.litellmServerId], vectorStores: [] },
    );
    expect(
      await store.database().mcpToolRecord.count({
        where: { projectId: store.projectId, mcpServerId: created.id },
      }),
    ).toBe(1);
  });

  it("keeps the last successful tool snapshot when LiteLLM refresh fails", async () => {
    let attempt = 0;
    const { service } = serviceWithAdapter({
      discoverMcpTools: vi.fn(async () => {
        attempt += 1;
        if (attempt > 1) throw new Error("LiteLLM MCP endpoint unavailable");
        return [
          {
            name: "read_document",
            inputSchema: { type: "object", properties: {} },
            discoveredAt: "2026-07-25T00:00:00.000Z",
          },
        ];
      }),
    });
    const created = await service.createMcpServer(connection);
    const refreshed = await service.discoverMcpServer(created.id);

    expect(refreshed.status).toBe("UNAVAILABLE");
    expect(refreshed.lastDiscoveryError).toContain(
      "LiteLLM MCP endpoint unavailable",
    );
    expect(refreshed.tools.map((tool) => tool.name)).toEqual(["read_document"]);
    expect(refreshed.lastDiscoveredAt).toBe(created.lastDiscoveredAt);
  });

  it("rejects arbitrary stdio commands before they reach the LiteLLM host", async () => {
    const { service, litellm } = serviceWithAdapter();

    await expect(
      service.createMcpServer({
        ...connection,
        name: "Unreviewed local process",
        alias: "unreviewed_process",
        transport: "stdio",
        endpoint: undefined,
        command: "node",
        args: ["malicious.js"],
      }),
    ).rejects.toThrow("reviewed built-in MCP Server template");
    expect(litellm.registerMcpServer).not.toHaveBeenCalled();
  });

  it("registers a Vector Database as a LiteLLM Vector Store and adds it to the Project Team", async () => {
    const { service, store, litellm } = serviceWithAdapter();
    markEmbeddingReady(store);
    const created = await service.createKnowledgeSource({
      name: "Engineering Handbook",
      description: "Approved engineering standards and operational runbooks.",
      vectorStoreId: "vs_engineering_handbook",
      provider: "openai",
      topK: 8,
      credentialReference: "",
    });

    expect(created.status).toBe("REGISTERED");
    expect(litellm.registerVectorStore).toHaveBeenCalledWith(
      expect.objectContaining({
        vectorStoreId: "vs_engineering_handbook",
        provider: "openai",
        metadata: expect.objectContaining({
          tali_project_id: "individual",
          top_k: 8,
        }),
      }),
    );
    expect(litellm.updateProjectObjectPermissions).toHaveBeenLastCalledWith(
      "team-project",
      { mcpServers: [], vectorStores: ["vs_engineering_handbook"] },
    );
  });

  it("registers the native LiteLLM PGVector connector", async () => {
    const store = createTestStore();
    markEmbeddingReady(store);
    const litellm = adapter();
    const secrets: SecretStore = {
      put: vi.fn(),
      get: vi.fn(async () => "pgvector-secret"),
      delete: vi.fn(),
    };
    const service = new ResourceCatalogService(
      store,
      new ProjectQuotaService(store, litellm),
      litellm,
      secrets,
    );

    const created = await service.createKnowledgeSource({
      name: "Product documentation",
      description: "Product documentation indexed in PostgreSQL with pgvector.",
      vectorStoreId: "vs_product_docs",
      provider: "pg_vector",
      apiBase: "https://pgvector.example.test",
      topK: 6,
      credentialReference: "k8s://tali/pgvector#API_KEY",
    });

    expect(created.status).toBe("REGISTERED");
    expect(litellm.registerVectorStore).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "pg_vector",
        litellmParams: {
          api_base: "https://pgvector.example.test",
          api_key: "pgvector-secret",
        },
      }),
    );
  });

  it("provisions a built-in PostgreSQL Knowledge Vector Database behind the Control bridge", async () => {
    const store = createTestStore();
    markEmbeddingReady(store);
    const litellm = adapter();
    const service = new ResourceCatalogService(
      store,
      new ProjectQuotaService(store, litellm),
      litellm,
    );

    const created = await service.createKnowledgeSource({
      name: "Engineering knowledge",
      description: "Engineering knowledge stored inside the shared PostgreSQL database.",
      vectorStoreId: "engineering-knowledge",
      provider: "postgresql",
      embeddingModel: "tali/openai/text-embedding-3-small",
      embeddingDimensions: 1536,
      topK: 8,
      credentialReference: "",
    });

    expect(created.status).toBe("REGISTERED");
    await expect(store.database().knowledgeVectorDatabase.findUnique({
      where: { projectId_id: { projectId: store.projectId, id: created.id } },
    })).resolves.toMatchObject({
      vectorStoreId: "engineering-knowledge",
      embeddingDimensions: 1536,
    });
    expect(litellm.registerVectorStore).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "pg_vector",
        metadata: expect.objectContaining({ tali_provider: "postgresql" }),
        litellmParams: expect.objectContaining({
          api_base: "http://127.0.0.1:8080/api/internal/vector-stores/individual",
          api_key: expect.any(String),
        }),
      }),
    );
  });

  it("resolves a validated Project embedding model and probes its vector dimensions", async () => {
    const store = createTestStore();
    const createEmbeddings = vi.fn(async () => [[0.1, 0.2, 0.3, 0.4]]);
    const litellm = adapter({ createEmbeddings });
    const now = new Date().toISOString();
    await store.saveProviderAccount({
      id: "nvidia-provider",
      name: "NVIDIA NIM",
      providerKind: "nvidia-nim",
      presetId: "nvidia-nim",
      endpoint: "https://integrate.api.nvidia.com/v1",
      config: { endpoint: "https://integrate.api.nvidia.com/v1" },
      complianceDomain: "GLOBAL",
      endpointRegion: "global",
      crossBorderTransfer: false,
      discoveredModels: ["nvidia/llama-nemotron-embed-1b-v2"],
      status: "VALIDATED",
      checks: [],
      credentialState: "STORED",
      validationMessage: "Ready",
      validatedAt: now,
      createdAt: now,
      updatedAt: now,
    }, JSON.stringify({
      version: 1,
      provider: "nvidia-nim",
      config: { endpoint: "https://integrate.api.nvidia.com/v1" },
      credentials: { apiKey: "nvapi-test" },
    }));
    const deploymentId = "11111111-1111-4111-8111-111111111111";
    await store.saveModelDeployment({
      id: deploymentId,
      providerAccountId: "nvidia-provider",
      modelId: "nvidia/llama-nemotron-embed-1b-v2",
      displayName: "Llama Nemotron Embed 1B v2",
      modelType: "text-embedding",
      capabilities: ["multilingual"],
      inputModalities: ["text"],
      outputModalities: ["embedding"],
      providerPresetId: "nvidia-nim",
      providerName: "NVIDIA NIM",
      endpoint: "https://integrate.api.nvidia.com/v1",
      complianceDomain: "GLOBAL",
      endpointRegion: "global",
      crossBorderTransfer: false,
      litellmModelName: "tali/nvidia/llama-nemotron-embed-1b-v2",
      status: "VALIDATED",
      checks: [],
      validationMessage: "Ready",
      validatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const service = new ResourceCatalogService(
      store,
      new ProjectQuotaService(store, litellm),
      litellm,
    );

    const created = await service.createKnowledgeSource({
      name: "NVIDIA engineering knowledge",
      description: "Engineering knowledge embedded through an assigned NVIDIA model.",
      vectorStoreId: "nvidia-engineering-knowledge",
      provider: "postgresql",
      embeddingModelDeploymentId: deploymentId,
      topK: 8,
      credentialReference: "",
    });

    expect(created).toMatchObject({
      embeddingModelDeploymentId: deploymentId,
      embeddingModel: "tali/nvidia/llama-nemotron-embed-1b-v2",
      embeddingDimensions: 4,
      status: "REGISTERED",
    });
    expect(createEmbeddings).toHaveBeenCalledWith(
      "tali/nvidia/llama-nemotron-embed-1b-v2",
      ["TaskLattice embedding dimension probe."],
      "passage",
    );
  });

  it("registers Elasticsearch through the authenticated TaskLattice Relay bridge", async () => {
    const store = createTestStore();
    markEmbeddingReady(store);
    const litellm = adapter();
    const secrets: SecretStore = {
      put: vi.fn(),
      get: vi.fn(async () => "elastic-api-key"),
      delete: vi.fn(),
    };
    const service = new ResourceCatalogService(
      store,
      new ProjectQuotaService(store, litellm),
      litellm,
      secrets,
    );

    const created = await service.createKnowledgeSource({
      name: "Search knowledge",
      description:
        "Operational knowledge indexed for Elasticsearch semantic search.",
      vectorStoreId: "knowledge-chunks",
      provider: "elasticsearch",
      apiBase: "https://elastic.example.test",
      semanticField: "content_semantic",
      contentField: "content",
      topK: 10,
      credentialReference: "k8s://tali/elasticsearch#API_KEY",
    });

    expect(created.status).toBe("REGISTERED");
    expect(litellm.registerVectorStore).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "pg_vector",
        metadata: expect.objectContaining({
          tali_provider: "elasticsearch",
        }),
        litellmParams: expect.objectContaining({
          api_base:
            "http://127.0.0.1:8080/api/internal/vector-stores/individual",
          api_key: expect.any(String),
        }),
      }),
    );
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it("rejects every Vector Database provider when the Project has no effective embedding model", async () => {
    const { service, litellm } = serviceWithAdapter();

    await expect(service.createKnowledgeSource({
      name: "Missing embedding",
      description: "This Project has no registered or inherited embedding model.",
      vectorStoreId: "missing-embedding",
      provider: "openai",
      topK: 8,
      credentialReference: "",
    })).rejects.toThrow("require a validated text embedding model");
    expect(litellm.registerVectorStore).not.toHaveBeenCalled();
  });

  it("blocks retrieval from an existing Vector Database without an effective embedding model", async () => {
    const { service } = serviceWithAdapter();

    await expect(service.searchVectorDatabase("existing-vectors", {
      query: "test",
      topK: 8,
    })).rejects.toThrow("require a validated text embedding model");
  });

  it("builds real scoped retrieval filters from the persisted metadata schema", async () => {
    const store = createTestStore();
    markEmbeddingReady(store);
    const litellm = adapter();
    const source = await store.saveKnowledgeSourceDefinition({
      id: "research-vectors",
      name: "Research vectors",
      description: "Research documents with typed metadata.",
      vectorStoreId: "research-vectors",
      provider: "postgresql",
      embeddingModel: "tali/openai/text-embedding-3-small",
      embeddingDimensions: 3,
      credentialReference: "",
      status: "REGISTERED",
      lastReconciliationError: null,
      topK: 8,
    });
    const vectors = new KnowledgeVectorDatabase(store, {
      createEmbeddings: vi.fn(async (_model, input) => input.map(() => [0.1, 0.2, 0.3])),
    });
    await vectors.provision(source);
    await store.database().vectorDocument.create({
      data: {
        projectId: store.projectId,
        databaseId: source.id,
        id: "paper-1",
        filename: "paper.pdf",
        directoryPath: "/Research",
        mediaType: "application/pdf",
        byteSize: 1_024,
        contentHash: "sha256:paper",
        status: "READY",
        customMetadata: {
          department: { type: "string", value: "research" },
        },
      },
    });
    const search = vi.spyOn(vectors, "search").mockResolvedValue({
      object: "vector_store.search_results.page",
      search_query: "coordination",
      data: [{
        score: 0.92,
        content: [{ type: "text", text: "Coordination costs can dominate." }],
        file_id: "chunk-3",
        filename: "paper.pdf",
        attributes: {
          document_id: "paper-1",
          file_path: "/Research/paper.pdf",
          page_number: 4,
          chunk_index: 2,
          tali_metadata_department: "research",
        },
      }],
    });
    const secrets: SecretStore = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
    const service = new ResourceCatalogService(
      store,
      new ProjectQuotaService(store, litellm),
      litellm,
      secrets,
      vectors,
    );

    await expect(service.searchVectorDatabase(source.id, {
      query: "coordination",
      topK: 6,
      folderId: null,
      metadataFilters: [{
        key: "department",
        operator: "eq",
        value: { type: "string", value: "research" },
      }],
    })).resolves.toMatchObject({
      results: [{ documentId: "paper-1", chunkId: "chunk-3", chunkIndex: 2 }],
    });
    expect(search).toHaveBeenCalledWith("research-vectors", {
      query: "coordination",
      max_num_results: 6,
      filters: {
        type: "and",
        filters: [
          { type: "eq", key: "folder_id", value: "root" },
          { type: "eq", key: "tali_metadata_department", value: "research" },
        ],
      },
    });
  });
});
