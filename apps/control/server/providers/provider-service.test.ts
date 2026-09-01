import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestStore } from "../test/store";
import type { SecretStore } from "../secrets/secret-store";
import type { LiteLLMAdminClient } from "./litellm-client";
import { ProviderService } from "./provider-service";

const deepSeekConnection = {
  connection: {
    provider: "deepseek" as const,
    name: "DeepSeek production",
    config: { endpoint: "https://api.deepseek.com/v1" },
    credentials: { apiKey: "provider-secret-value" },
  },
  models: [
    { modelId: "deepseek-chat", displayName: "DeepSeek Chat", modelType: "llm" as const },
    { modelId: "deepseek-reasoner", displayName: "DeepSeek Reasoner", modelType: "llm" as const },
  ],
  complianceDomain: "GLOBAL" as const,
};

function mockDeepSeekCatalog(): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    data: deepSeekConnection.models.map(({ modelId: id }) => ({ id })),
  }), { status: 200 })));
}

function mockOpenAIEmbeddingCatalog(...modelIds: string[]): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    data: modelIds.map((id) => ({ id })),
  }), { status: 200 })));
}

function liteLLM(): LiteLLMAdminClient {
  return {
    baseUrl: "http://litellm:4000",
    registerModel: vi.fn(async () => "tali/account/deepseek-chat"),
    deleteModel: vi.fn(async () => undefined),
    probeModel: vi.fn(async () => undefined),
    createInstanceKey: vi.fn(async () => ({ secret: "sk-instance", tokenId: "hashed-token" })),
    blockKey: vi.fn(async () => undefined),
    revokeKey: vi.fn(async () => undefined),
    listSpendLogs: vi.fn(async () => []),
  };
}

function managedSecrets(): { secrets: SecretStore; values: Map<string, string> } {
  const values = new Map<string, string>();
  const secrets: SecretStore = {
    put: vi.fn(async (projectId, resourceId, value) => {
      const reference = `memory://${projectId}/${resourceId}`;
      values.set(reference, value);
      return reference;
    }),
    get: vi.fn(async (reference) => {
      const value = values.get(reference);
      if (!value) throw new Error("Managed credential is unavailable.");
      return value;
    }),
    delete: vi.fn(async (reference) => {
      values.delete(reference);
    }),
  };
  return { secrets, values };
}

describe("ProviderService", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("rejects a Provider that is unavailable inside the requested compliance boundary", async () => {
    const service = new ProviderService(createTestStore(), liteLLM());
    await expect(service.createConnection({
      connection: {
        provider: "openai",
        name: "OpenAI production",
        config: { endpoint: "https://api.openai.com/v1" },
        credentials: { apiKey: "provider-secret-value" },
      },
      models: [
        { modelId: "gpt-5.2", displayName: "GPT-5.2", modelType: "llm" },
      ],
      complianceDomain: "CN_MAINLAND",
    })).rejects.toThrow("does not have a supported endpoint configuration");
  });

  it("rejects a regional endpoint that conflicts with its boundary", async () => {
    const service = new ProviderService(createTestStore(), liteLLM());
    await expect(service.createConnection({
      connection: {
        provider: "qwen",
        name: "Qwen China",
        config: {
          region: "international",
          endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        },
        credentials: { apiKey: "provider-secret-value" },
      },
      models: [
        { modelId: "qwen-plus", displayName: "Qwen Plus", modelType: "llm" },
      ],
      complianceDomain: "CN_MAINLAND",
    })).rejects.toThrow("endpoint region does not match");
  });

  it("rejects a cloud region that falls outside its selected boundary", async () => {
    const service = new ProviderService(createTestStore(), liteLLM());
    await expect(service.createConnection({
      connection: {
        provider: "aws-bedrock",
        name: "Bedrock Europe",
        config: { region: "us-east-1" },
        credentials: {
          accessKeyId: "provider-access-key",
          secretAccessKey: "provider-secret-value",
        },
      },
      models: [
        {
          modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
          displayName: "Claude 3.5 Sonnet",
          modelType: "llm",
        },
      ],
      complianceDomain: "EU_EEA",
    })).rejects.toThrow("region does not match");
  });

  it("stores one credential and automatically configures exposed catalog models", async () => {
    mockDeepSeekCatalog();
    const store = createTestStore();
    const litellm = liteLLM();
    const { secrets } = managedSecrets();
    const service = new ProviderService(store, litellm, secrets);
    const { account } = await service.createConnection(deepSeekConnection);
    expect(account.status).toBe("VALIDATED");
    expect(account.discoveredModels).toContain("deepseek-chat");
    expect(await service.listModels(account.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: "deepseek-chat", status: "VALIDATED" }),
      expect.objectContaining({ modelId: "deepseek-reasoner", status: "VALIDATED" }),
    ]));
    expect(await service.listModels(account.id)).toHaveLength(2);
    expect(litellm.registerModel).toHaveBeenCalledTimes(2);
    expect(vi.mocked(litellm.registerModel).mock.calls[0]?.[0].litellmParams)
      .not.toHaveProperty("ssl_verify");
    const credentialReference = (await store.getProviderAccountCredential(account.id))!;
    expect(credentialReference).toMatch(/^memory:\/\//);
    expect(JSON.parse(await secrets.get(credentialReference))).toMatchObject({
      version: 1,
      provider: "deepseek",
      credentials: { apiKey: "provider-secret-value" },
    });
    expect(JSON.stringify(await service.listAccounts())).not.toContain("provider-secret-value");
  });

  it("persists skipped TLS verification and forwards it to LiteLLM", async () => {
    mockDeepSeekCatalog();
    const store = createTestStore();
    const litellm = liteLLM();
    const { secrets } = managedSecrets();
    const service = new ProviderService(store, litellm, secrets);
    const result = await service.createConnection({
      ...deepSeekConnection,
      connection: {
        ...deepSeekConnection.connection,
        skipTlsVerify: true,
      },
      models: [deepSeekConnection.models[0]!],
    });

    expect(result.account.skipTlsVerify).toBe(true);
    expect(litellm.registerModel).toHaveBeenCalledWith(expect.objectContaining({
      litellmParams: expect.objectContaining({ ssl_verify: false }),
    }));
    const credentialReference = (await store.getProviderAccountCredential(result.account.id))!;
    expect(JSON.parse(await secrets.get(credentialReference)))
      .toMatchObject({ skipTlsVerify: true });

    vi.mocked(litellm.registerModel).mockClear();
    await service.registerModel({
      providerAccountId: result.account.id,
      ...deepSeekConnection.models[1]!,
    });
    expect(litellm.registerModel).toHaveBeenCalledWith(expect.objectContaining({
      litellmParams: expect.objectContaining({ ssl_verify: false }),
    }));
  });

  it("moves a legacy inline credential into the managed Project Secret store on first use", async () => {
    mockDeepSeekCatalog();
    const store = createTestStore();
    const { secrets } = managedSecrets();
    const service = new ProviderService(store, liteLLM(), secrets);
    const { account } = await service.createConnection({
      ...deepSeekConnection,
      models: [deepSeekConnection.models[0]!],
    });
    await store.saveProviderAccount(account, JSON.stringify({
      version: 1,
      provider: "deepseek",
      config: deepSeekConnection.connection.config,
      credentials: deepSeekConnection.connection.credentials,
    }));

    await expect(service.discoverAccount(account.id)).resolves.toBeDefined();
    const migratedReference = (await store.getProviderAccountCredential(account.id))!;
    expect(migratedReference).toMatch(/^memory:\/\//);
    expect(JSON.parse(await secrets.get(migratedReference))).toMatchObject({
      credentials: { apiKey: "provider-secret-value" },
    });
  });

  it("deletes an unused account and unregisters its LiteLLM models", async () => {
    mockDeepSeekCatalog();
    const store = createTestStore();
    const litellm = liteLLM();
    const { secrets } = managedSecrets();
    const service = new ProviderService(store, litellm, secrets);
    const { account } = await service.createConnection(deepSeekConnection);
    const credentialReference = (await store.getProviderAccountCredential(account.id))!;

    await expect(service.deleteAccount(account.id)).resolves.toBe(true);
    expect(litellm.deleteModel).toHaveBeenCalledTimes(2);
    expect(await service.listAccounts()).toEqual([]);
    expect(await service.listModels()).toEqual([]);
    await expect(secrets.get(credentialReference)).rejects.toThrow("unavailable");
  });

  it("removes one unused model while keeping its saved Provider credentials", async () => {
    mockDeepSeekCatalog();
    const store = createTestStore();
    const litellm = liteLLM();
    const service = new ProviderService(store, litellm);
    const { account, models } = await service.createConnection(deepSeekConnection);

    await expect(
      service.deleteModelDeployment(models[0]!.id),
    ).resolves.toBe(true);
    expect(litellm.deleteModel).toHaveBeenCalledWith(
      models[0]!.litellmModelName,
    );
    expect(await service.listAccounts()).toHaveLength(1);
    expect(await service.listModels(account.id)).toEqual([
      expect.objectContaining({ id: models[1]!.id }),
    ]);
  });

  it("blocks removal of the last validated embedding model while Durable Memory depends on it", async () => {
    mockOpenAIEmbeddingCatalog("text-embedding-3-small", "text-embedding-3-large");
    const store = createTestStore();
    const litellm = liteLLM();
    const service = new ProviderService(store, litellm);
    const { account, models } = await service.createConnection({
      connection: {
        provider: "openai",
        name: "OpenAI embeddings",
        config: { endpoint: "https://api.openai.com/v1" },
        credentials: { apiKey: "provider-secret-value" },
      },
      models: [{
        modelId: "text-embedding-3-small",
        displayName: "Embedding Small",
        modelType: "text-embedding",
      }],
      complianceDomain: "GLOBAL",
    });
    await store.database().memoryRecord.create({
      data: {
        projectId: store.projectId,
        id: "11111111-1111-4111-8111-111111111111",
        displayName: "Hermes project memory",
        status: "ready",
      },
    });

    await expect(service.modelRemovalImpact(models[0]!.id)).resolves.toMatchObject({
      blocking: true,
      dependencies: [{
        kind: "DURABLE_MEMORY",
        name: "Hermes project memory",
      }],
      remainingValidatedEmbeddingModels: 0,
    });
    await expect(service.deleteModelDeployment(models[0]!.id)).rejects.toMatchObject({
      code: "embedding_model_dependency_conflict",
      status: 409,
    });
    await expect(service.deleteAccount(account.id)).rejects.toMatchObject({
      code: "embedding_model_dependency_conflict",
      status: 409,
    });
    expect(litellm.deleteModel).not.toHaveBeenCalled();

    await service.registerModel({
      providerAccountId: account.id,
      modelId: "text-embedding-3-large",
      displayName: "Embedding Large",
      modelType: "text-embedding",
    });
    await expect(service.deleteModelDeployment(models[0]!.id)).resolves.toBe(true);
  });

  it("blocks removal of an embedding model directly bound to a Vector Database even when a replacement exists", async () => {
    mockOpenAIEmbeddingCatalog("text-embedding-3-small", "text-embedding-3-large");
    const store = createTestStore();
    const service = new ProviderService(store, liteLLM());
    const result = await service.createConnection({
      connection: {
        provider: "openai",
        name: "OpenAI embeddings",
        config: { endpoint: "https://api.openai.com/v1" },
        credentials: { apiKey: "provider-secret-value" },
      },
      models: [
        {
          modelId: "text-embedding-3-small",
          displayName: "Embedding Small",
          modelType: "text-embedding",
        },
        {
          modelId: "text-embedding-3-large",
          displayName: "Embedding Large",
          modelType: "text-embedding",
        },
      ],
      complianceDomain: "GLOBAL",
    });
    const boundModel = result.models[0]!;
    await store.saveKnowledgeSourceDefinition({
      id: "project-vectors",
      name: "Project vectors",
      description: "Project documents embedded with the explicitly selected model.",
      vectorStoreId: "project-vectors",
      provider: "postgresql",
      embeddingModelDeploymentId: boundModel.id,
      embeddingModel: boundModel.litellmModelName,
      embeddingDimensions: 1536,
      credentialReference: "",
      status: "REGISTERED",
      lastReconciliationError: null,
      topK: 8,
    });

    await expect(service.deleteModelDeployment(boundModel.id)).rejects.toThrow(
      "1 Vector Database",
    );
  });

  it("blocks Provider deletion while a Model Routing references one of its deployments", async () => {
    mockDeepSeekCatalog();
    const store = createTestStore();
    const litellm = liteLLM();
    const service = new ProviderService(store, litellm);
    const { account, models } = await service.createConnection(deepSeekConnection);
    const now = new Date().toISOString();
    await store.saveInferenceGateway({
      id: "litellm-default",
      name: "LiteLLM",
      baseUrl: "http://litellm:4000",
      adminUiUrl: "http://litellm:4000/ui",
      credentialSource: "ENVIRONMENT",
      status: "READY",
      validationMessage: "Ready",
      createdAt: now,
      updatedAt: now,
    });
    await store.saveModelRouting({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Production",
      description: "",
      gatewayId: "litellm-default",
      managementMode: "LITELLM_MANAGED",
      publicModelAlias: models[0]!.litellmModelName,
      routingPolicy: {
        version: 1,
        mode: "SINGLE",
        modelDeploymentId: models[0]!.id,
        fallbackModelDeploymentIds: [],
        retries: 2,
      },
      complianceDomain: "GLOBAL",
      status: "READY",
      isDefault: false,
      keyPolicy: { perInstance: true, rotationDays: 90 },
      auditPolicy: { controlPlane: true, requestLogs: true, capturePrompts: false },
      capabilities: {
        automaticRouting: "DISABLED",
        routerType: "UNKNOWN",
        sessionAffinity: "UNKNOWN",
        adaptiveRouting: "UNKNOWN",
        failover: "UNKNOWN",
        generalFallback: "UNKNOWN",
        contextWindowFallback: "UNKNOWN",
        contentPolicyFallback: "UNKNOWN",
        retries: "UNKNOWN",
        requestAudit: "UNKNOWN",
      },
      conditions: [],
      configurationHash: "sha256:test",
      observedGeneration: 1,
      validationMessage: "Ready",
      consumers: 0,
      createdAt: now,
      updatedAt: now,
    });

    await expect(service.deleteAccount(account.id)).rejects.toThrow("Model Routing");
    await expect(
      service.deleteModelDeployment(models[0]!.id),
    ).rejects.toThrow("in use by 1 Model Routing");
    expect(litellm.deleteModel).not.toHaveBeenCalled();
  });

  it("does not persist a rejected Endpoint + key", async () => {
    mockDeepSeekCatalog();
    const litellm = liteLLM();
    vi.mocked(litellm.probeModel).mockRejectedValue(new Error("Provider rejected the credential."));
    const service = new ProviderService(createTestStore(), litellm);
    await expect(service.createConnection(deepSeekConnection)).rejects.toThrow("rejected");
    expect(await service.listAccounts()).toEqual([]);
  });

  it("keeps a validated connection when one selected model fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "gpt-5.2" }, { id: "text-embedding-3-large" }],
    }), { status: 200 })));
    const litellm = liteLLM();
    vi.mocked(litellm.registerModel).mockImplementation(async ({ model }) => `tali/account/${model.modelId}`);
    vi.mocked(litellm.probeModel)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Embedding deployment is unavailable."));
    const service = new ProviderService(createTestStore(), litellm);
    const result = await service.createConnection({
      connection: {
        provider: "openai",
        name: "OpenAI production",
        config: { endpoint: "https://api.openai.com/v1" },
        credentials: { apiKey: "provider-secret-value" },
      },
      models: [
        { modelId: "gpt-5.2", displayName: "GPT-5.2", modelType: "llm" },
        { modelId: "text-embedding-3-large", displayName: "Embedding", modelType: "text-embedding" },
      ],
      complianceDomain: "GLOBAL",
    });

    expect(result.account.status).toBe("DEGRADED");
    expect(result.models).toHaveLength(1);
    expect(result.failures).toEqual([expect.objectContaining({ message: "Embedding deployment is unavailable." })]);
    expect(await service.listAccounts()).toHaveLength(1);
    expect(litellm.deleteModel).toHaveBeenCalledWith("tali/account/text-embedding-3-large");
  });
});
