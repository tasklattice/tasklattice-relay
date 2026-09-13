import { describe, expect, it, vi } from "vitest";
import {
  createInstanceSchema,
  createModelRoutingSchema,
  updateModelRoutingSchema,
} from "@tali/contracts";
import { createTestStore } from "../test/store";
import type {
  LiteLLMAdminClient,
  LiteLLMModelRoutingInspection,
} from "../providers/litellm-client";
import {
  ModelRoutingResolver,
  ModelRoutingService,
} from "./model-routing-service";

const capabilities = {
  automaticRouting: "ENABLED",
  routerType: "COMPLEXITY_ROUTER",
  complexityTierCount: 4,
  sessionAffinity: "ENABLED",
  adaptiveRouting: "DISABLED",
  failover: "ENABLED",
  generalFallback: "ENABLED",
  contextWindowFallback: "DISABLED",
  contentPolicyFallback: "DISABLED",
  retries: "ENABLED",
  requestAudit: "ENABLED",
} as const;
const defaultModelId = "99999999-9999-4999-8999-999999999999";

function adapter(
  inspection: Omit<LiteLLMModelRoutingInspection, "configurationHash"> & {
    configurationHash?: string;
  },
): LiteLLMAdminClient {
  return {
    baseUrl: "http://litellm:4000",
    registerModel: vi.fn(),
    deleteModelById: vi.fn(async () => undefined),
    deleteModel: vi.fn(),
    probeModel: vi.fn(),
    createInstanceKey: vi.fn(),
    blockKey: vi.fn(),
    revokeKey: vi.fn(),
    listSpendLogs: vi.fn(),
    inspectModelRouting: vi.fn(async () => ({
      configurationHash: "sha256:litellm",
      ...inspection,
    })),
    reconcileModelRoutingRoute: vi.fn(),
    deleteModelRoutingRoute: vi.fn(),
    createModelRoutingTeam: vi.fn(async () => "team-a"),
    createModelRoutingKey: vi.fn(async () => ({
      secret: "sk-instance-secret",
      tokenId: "token-hash",
    })),
    deleteModelRoutingTeam: vi.fn(),
  };
}

async function saveRoutingModel(
  store: ReturnType<typeof createTestStore>,
  id: string,
  displayName: string,
  litellmModelName: string,
  domain: "CN_MAINLAND" | "GLOBAL" = "CN_MAINLAND",
  modelType: "llm" | "text-embedding" = "llm",
) {
  const now = new Date().toISOString();
  const providerAccountId = `provider-${id.slice(0, 4)}`;
  await store.saveProviderAccount(
    {
      id: providerAccountId,
      name: `Provider ${id.slice(0, 4)}`,
      providerKind: "custom-openai-compatible",
      presetId: "custom-openai-compatible",
      endpoint: "http://models.test/v1",
      config: {},
      complianceDomain: domain,
      endpointRegion: domain === "CN_MAINLAND" ? "cn-test-1" : "global-test-1",
      crossBorderTransfer: false,
      discoveredModels: [],
      status: "VALIDATED",
      checks: [],
      credentialState: "STORED",
      validationMessage: "Ready",
      validatedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    "test-credential",
  );
  return store.saveModelDeployment({
    id,
    providerAccountId,
    modelId: displayName.toLowerCase().replaceAll(" ", "-"),
    displayName,
    modelType,
    capabilities:
      modelType === "llm" ? ["reasoning", "tool-calling"] : ["multilingual"],
    inputModalities: ["text"],
    outputModalities: modelType === "llm" ? ["text"] : ["embedding"],
    providerPresetId: "custom-openai-compatible",
    providerName: "Test provider",
    endpoint: "http://models.test/v1",
    complianceDomain: domain,
    endpointRegion: domain === "CN_MAINLAND" ? "cn-test-1" : "global-test-1",
    crossBorderTransfer: false,
    litellmModelName,
    status: "VALIDATED",
    checks: [],
    validationMessage: "Ready",
    validatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

function input(domain: "CN_MAINLAND" | "GLOBAL" = "CN_MAINLAND") {
  return createModelRoutingSchema.parse({
    name: "Production inference",
    description: "Managed production inference access.",
    gatewayId: "litellm-default",
    routingPolicy: {
      version: 1,
      mode: "SINGLE",
      modelDeploymentId: defaultModelId,
      fallbackModelDeploymentIds: [],
      retries: 2,
    },
    complianceDomain: domain,
    isDefault: true,
  });
}

async function saveDefaultRoutingModel(
  store: ReturnType<typeof createTestStore>,
  domain: "CN_MAINLAND" | "GLOBAL" = "CN_MAINLAND",
) {
  return saveRoutingModel(
    store,
    defaultModelId,
    "Production Chat",
    "production-chat",
    domain,
  );
}

describe("Model Routing contracts", () => {
  it("does not inject create defaults into a default-only update", () => {
    expect(updateModelRoutingSchema.parse({ isDefault: true })).toEqual({
      isDefault: true,
    });
  });

  it("keeps model selection out of Instance creation", () => {
    expect(() =>
      createInstanceSchema.parse({
        name: "Research Agent",
        description: "",
        runtime: "openshell",
        accessPolicyIds: ["11111111-1111-4111-8111-111111111111"],
        modelRoutingId: "routing-a",
        systemPrompt: "Research the request and report the evidence.",
        modelDeploymentId: "must-be-ignored",
      }),
    ).toThrow();
  });

  it("requires one or more directly selected Access Policies", () => {
    const accessPolicyIds = ["2f3d37d9-fd85-49ee-80b3-06861b8c44b1"];
    expect(
      createInstanceSchema.parse({
        name: "Research Agent",
        description: "",
        runtime: "openshell",
        systemPrompt: "Research the request and report the evidence.",
        accessPolicyIds,
        modelRoutingId: "routing-a",
      }).accessPolicyIds,
    ).toEqual(accessPolicyIds);
    expect(() =>
      createInstanceSchema.parse({
        name: "Research Agent",
        description: "",
        runtime: "openshell",
        systemPrompt: "Research the request and report the evidence.",
        modelRoutingId: "routing-a",
      }),
    ).toThrow();
  });

  it("defaults secret-safe key and audit policies", () => {
    expect(input()).toMatchObject({
      keyPolicy: { perInstance: true, rotationDays: 90 },
      auditPolicy: {
        controlPlane: true,
        requestLogs: true,
        capturePrompts: false,
      },
    });
  });

  it("accepts concise region-oriented names such as CN", () => {
    expect(
      createModelRoutingSchema.parse({
        ...input(),
        name: "CN",
      }).name,
    ).toBe("CN");
  });

  it("versions complexity routing and rejects overlapping tiers or fallback", () => {
    const simpleId = "11111111-1111-4111-8111-111111111111";
    const complexId = "22222222-2222-4222-8222-222222222222";
    expect(
      createModelRoutingSchema.parse({
        name: "Smart route",
        gatewayId: "litellm-default",
        complianceDomain: "GLOBAL",
        routingPolicy: {
          mode: "COMPLEXITY",
          simpleModelDeploymentId: simpleId,
          complexModelDeploymentId: complexId,
        },
      }).routingPolicy,
    ).toEqual({
      version: 1,
      mode: "COMPLEXITY",
      simpleModelDeploymentId: simpleId,
      complexModelDeploymentId: complexId,
      fallbackModelDeploymentIds: [],
      retries: 2,
    });
    expect(() =>
      createModelRoutingSchema.parse({
        name: "Invalid route",
        gatewayId: "litellm-default",
        complianceDomain: "GLOBAL",
        routingPolicy: {
          mode: "COMPLEXITY",
          simpleModelDeploymentId: simpleId,
          complexModelDeploymentId: complexId,
          fallbackModelDeploymentIds: [simpleId],
        },
      }),
    ).toThrow("fallback");
  });
});

describe("Model Routing validation", () => {
  it("reconciles a single model without creating a complexity router", async () => {
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const client = adapter({
      exists: true,
      version: "1.86.2",
      modelCount: 1,
      complianceDomains: ["CN_MAINLAND"],
      complianceUnknown: false,
      capabilities: {
        ...capabilities,
        automaticRouting: "DISABLED",
        routerType: "UNKNOWN",
      },
    });
    const service = new ModelRoutingService(store, client);

    const routing = await service.create(input());

    expect(routing.status).toBe("READY");
    expect(client.reconcileModelRoutingRoute).toHaveBeenCalledWith({
      strategy: "SINGLE",
      alias: routing.publicModelAlias,
      modelRoutingId: routing.id,
      complianceDomain: "CN_MAINLAND",
      defaultModel: "production-chat",
      fallbackModels: [],
      retries: 2,
      requestAudit: true,
    });
    expect(client.inspectModelRouting).toHaveBeenCalledWith("production-chat");
  });

  it("reconciles a versioned complexity policy into a stable LiteLLM alias", async () => {
    const store = createTestStore();
    const simpleId = "11111111-1111-4111-8111-111111111111";
    const complexId = "22222222-2222-4222-8222-222222222222";
    const fallbackId = "33333333-3333-4333-8333-333333333333";
    await saveRoutingModel(
      store,
      simpleId,
      "Gemini Flash",
      "tali/google/gemini-flash",
    );
    await saveRoutingModel(
      store,
      complexId,
      "Claude Sonnet",
      "tali/anthropic/sonnet",
    );
    await saveRoutingModel(store, fallbackId, "Qwen Max", "tali/qwen/max");
    const client = adapter({
      exists: true,
      version: "1.86.2",
      modelCount: 3,
      complianceDomains: ["CN_MAINLAND"],
      complianceUnknown: false,
      capabilities,
    });
    const service = new ModelRoutingService(store, client);

    const routing = await service.create(
      createModelRoutingSchema.parse({
        name: "Cost-aware production",
        gatewayId: "litellm-default",
        complianceDomain: "CN_MAINLAND",
        routingPolicy: {
          version: 1,
          mode: "COMPLEXITY",
          simpleModelDeploymentId: simpleId,
          complexModelDeploymentId: complexId,
          fallbackModelDeploymentIds: [fallbackId],
          retries: 2,
        },
      }),
    );

    expect(routing).toMatchObject({
      status: "READY",
      publicModelAlias: `tali-routing-${routing.id}`,
      routingPolicy: { version: 1, mode: "COMPLEXITY", retries: 2 },
    });
    expect(client.reconcileModelRoutingRoute).toHaveBeenCalledWith({
      strategy: "COMPLEXITY",
      alias: routing.publicModelAlias,
      modelRoutingId: routing.id,
      complianceDomain: "CN_MAINLAND",
      tiers: {
        SIMPLE: "tali/google/gemini-flash",
        MEDIUM: "tali/google/gemini-flash",
        COMPLEX: "tali/anthropic/sonnet",
        REASONING: "tali/anthropic/sonnet",
      },
      defaultModel: "tali/google/gemini-flash",
      fallbackModels: ["tali/qwen/max"],
      retries: 2,
      requestAudit: true,
    });
  });

  it("rejects a routing candidate outside the Routing compliance boundary before writing LiteLLM", async () => {
    const store = createTestStore();
    const simpleId = "11111111-1111-4111-8111-111111111111";
    const complexId = "22222222-2222-4222-8222-222222222222";
    await saveRoutingModel(
      store,
      simpleId,
      "Gemini Flash",
      "tali/google/gemini-flash",
    );
    await saveRoutingModel(
      store,
      complexId,
      "Claude Sonnet",
      "tali/anthropic/sonnet",
      "GLOBAL",
    );
    const client = adapter({
      exists: true,
      modelCount: 2,
      complianceDomains: ["CN_MAINLAND"],
      complianceUnknown: false,
      capabilities,
    });
    const service = new ModelRoutingService(store, client);

    await expect(
      service.create(
        createModelRoutingSchema.parse({
          name: "Invalid mixed region",
          gatewayId: "litellm-default",
          complianceDomain: "CN_MAINLAND",
          routingPolicy: {
            version: 1,
            mode: "COMPLEXITY",
            simpleModelDeploymentId: simpleId,
            complexModelDeploymentId: complexId,
          },
        }),
      ),
    ).rejects.toThrow("complex tier does not match");
    expect(client.reconcileModelRoutingRoute).not.toHaveBeenCalled();
  });

  it("reconciles semantic intents with a registered embedding model", async () => {
    const store = createTestStore();
    const defaultId = "11111111-1111-4111-8111-111111111111";
    const codingId = "22222222-2222-4222-8222-222222222222";
    const embeddingId = "33333333-3333-4333-8333-333333333333";
    await saveRoutingModel(store, defaultId, "General", "tali/openai/general");
    await saveRoutingModel(store, codingId, "Code", "tali/anthropic/code");
    await saveRoutingModel(
      store,
      embeddingId,
      "Embedding",
      "tali/openai/embedding",
      "CN_MAINLAND",
      "text-embedding",
    );
    const semanticCapabilities = {
      ...capabilities,
      routerType: "SEMANTIC_ROUTER",
      semanticRouteCount: 1,
    } as const;
    const client = adapter({
      exists: true,
      version: "1.86.2",
      modelCount: 3,
      complianceDomains: ["CN_MAINLAND"],
      complianceUnknown: false,
      capabilities: semanticCapabilities,
    });
    const service = new ModelRoutingService(store, client);

    const routing = await service.create(
      createModelRoutingSchema.parse({
        name: "Intent router",
        gatewayId: "litellm-default",
        complianceDomain: "CN_MAINLAND",
        routingPolicy: {
          version: 1,
          mode: "SEMANTIC",
          defaultModelDeploymentId: defaultId,
          embeddingModelDeploymentId: embeddingId,
          routes: [
            {
              intent: "coding",
              description: "Programming and debugging requests.",
              modelDeploymentId: codingId,
              utterances: [
                "Help me debug this function",
                "Design an API for this service",
              ],
              scoreThreshold: 0.5,
            },
          ],
          fallbackModelDeploymentIds: [],
          retries: 2,
        },
      }),
    );

    expect(routing).toMatchObject({
      status: "READY",
      routingPolicy: { mode: "SEMANTIC" },
    });
    expect(client.reconcileModelRoutingRoute).toHaveBeenCalledWith({
      strategy: "SEMANTIC",
      alias: routing.publicModelAlias,
      modelRoutingId: routing.id,
      complianceDomain: "CN_MAINLAND",
      defaultModel: "tali/openai/general",
      embeddingModel: "tali/openai/embedding",
      routes: [
        {
          intent: "coding",
          description: "Programming and debugging requests.",
          model: "tali/anthropic/code",
          utterances: [
            "Help me debug this function",
            "Design an API for this service",
          ],
          scoreThreshold: 0.5,
        },
      ],
      fallbackModels: [],
      retries: 2,
      requestAudit: true,
    });
  });

  it("becomes READY and default only after a matching LiteLLM inspection", async () => {
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const service = new ModelRoutingService(
      store,
      adapter({
        exists: true,
        version: "1.94.1",
        modelCount: 2,
        complianceDomains: ["CN_MAINLAND"],
        complianceUnknown: false,
        capabilities,
      }),
    );
    const routing = await service.create(input());
    expect(routing).toMatchObject({
      status: "READY",
      isDefault: true,
      capabilities,
    });
    expect(routing.conditions).toContainEqual(
      expect.objectContaining({ type: "COMPLIANCE", status: "PASS" }),
    );
  });

  it("atomically replaces the Project default Model Routing", async () => {
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const service = new ModelRoutingService(
      store,
      adapter({
        exists: true,
        modelCount: 1,
        complianceDomains: ["CN_MAINLAND"],
        complianceUnknown: false,
        capabilities,
      }),
    );
    const first = await service.create(input());
    const second = await service.create({
      ...input(),
      name: "Interactive inference",
      isDefault: false,
    });

    await service.update(second.id, { isDefault: true });

    expect((await service.get(first.id))?.isDefault).toBe(false);
    expect((await service.get(second.id))?.isDefault).toBe(true);
    expect((await service.resolver.resolveDefault()).id).toBe(second.id);
  });

  it("keeps the Project default usable until another Routing replaces it", async () => {
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const service = new ModelRoutingService(
      store,
      adapter({
        exists: true,
        modelCount: 1,
        complianceDomains: ["CN_MAINLAND"],
        complianceUnknown: false,
        capabilities,
      }),
    );
    const routing = await service.create(input());

    await expect(
      service.update(routing.id, { isDefault: false }),
    ).rejects.toThrow("Choose another default");
    await expect(
      service.update(routing.id, { suspended: true }),
    ).rejects.toThrow("Choose another default");
    await expect(service.delete(routing.id)).rejects.toThrow(
      "Choose another default",
    );
  });

  it("rejects CN/GLOBAL mixing", async () => {
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const service = new ModelRoutingService(
      store,
      adapter({
        exists: true,
        version: "1.94.1",
        modelCount: 2,
        complianceDomains: ["CN_MAINLAND", "GLOBAL"],
        complianceUnknown: false,
        capabilities,
      }),
    );
    const routing = await service.create(input());
    expect(routing.status).toBe("NON_COMPLIANT");
    expect(routing.isDefault).toBe(false);
  });

  it("uses LiteLLM model metadata instead of a configured Gateway domain", async () => {
    const client = adapter({
      exists: true,
      version: "1.94.1",
      modelCount: 1,
      complianceDomains: ["CN_MAINLAND"],
      complianceUnknown: false,
      capabilities,
    });
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const service = new ModelRoutingService(store, client);

    const routing = await service.create(input("CN_MAINLAND"));

    expect(routing.status).toBe("READY");
    expect(routing.conditions).toContainEqual(
      expect.objectContaining({ type: "COMPLIANCE", status: "PASS" }),
    );
    expect(client.inspectModelRouting).toHaveBeenCalledWith("production-chat");
  });

  it("fails closed when compliance metadata is UNKNOWN", async () => {
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const service = new ModelRoutingService(
      store,
      adapter({
        exists: true,
        modelCount: 1,
        complianceDomains: [],
        complianceUnknown: true,
        capabilities,
      }),
    );
    const routing = await service.create(input());
    expect(routing.status).toBe("NON_COMPLIANT");
    expect(routing.conditions).toContainEqual(
      expect.objectContaining({ type: "COMPLIANCE", status: "UNKNOWN" }),
    );
  });

  it("marks unsupported Auto Router versions explicitly", async () => {
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const service = new ModelRoutingService(
      store,
      adapter({
        exists: true,
        version: "1.86.2",
        modelCount: 1,
        complianceDomains: ["CN_MAINLAND"],
        complianceUnknown: false,
        capabilities,
        unsupportedReason:
          "LiteLLM 1.86.2 cannot safely support Auto Router v2.",
      }),
    );
    expect((await service.create(input())).status).toBe("UNSUPPORTED");
  });
});

describe("ModelRoutingResolver", () => {
  it("requires exactly one READY default", async () => {
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const service = new ModelRoutingService(
      store,
      adapter({
        exists: true,
        modelCount: 1,
        complianceDomains: ["CN_MAINLAND"],
        complianceUnknown: false,
        capabilities,
      }),
    );
    const ready = await service.create(input());
    expect((await new ModelRoutingResolver(store).resolveDefault()).id).toBe(
      ready.id,
    );
    await store.saveModelRouting({
      ...ready,
      id: "second",
      name: "Second default",
      createdAt: new Date().toISOString(),
    });
    await expect(
      new ModelRoutingResolver(store).resolveDefault(),
    ).rejects.toThrow("Multiple default");
  });

  it("does not resolve an explicitly selected suspended routing", async () => {
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const service = new ModelRoutingService(
      store,
      adapter({
        exists: true,
        modelCount: 1,
        complianceDomains: ["CN_MAINLAND"],
        complianceUnknown: false,
        capabilities,
      }),
    );
    await service.create(input());
    const selected = await service.create({
      ...input(),
      name: "Suspendable inference",
      isDefault: false,
    });
    await service.update(selected.id, { suspended: true });
    await expect(service.resolver.resolve(selected.id)).rejects.toThrow(
      "suspended",
    );
  });

  it("binds an explicitly selected READY routing instead of the default", async () => {
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const client = adapter({
      exists: true,
      modelCount: 1,
      complianceDomains: ["CN_MAINLAND"],
      complianceUnknown: false,
      capabilities,
    });
    const service = new ModelRoutingService(store, client);
    const defaultRouting = await service.create(input());
    const selectedRouting = await store.saveModelRouting({
      ...defaultRouting,
      id: "2f3d37d9-fd85-49ee-80b3-06861b8c44b1",
      name: "Selected inference",
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const binding = await service.bindAgent(
      "agent-selected",
      selectedRouting.id,
    );

    expect(binding.routing.id).toBe(selectedRouting.id);
    expect(client.createModelRoutingKey).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRoutingId: selectedRouting.id,
        modelAlias: `tali-routing-${selectedRouting.id}`,
      }),
    );
  });
});

describe("Model Routing deletion", () => {
  it("blocks active consumers and deletes the LiteLLM team after they are removed", async () => {
    const store = createTestStore();
    await saveDefaultRoutingModel(store);
    const client = adapter({
      exists: true,
      modelCount: 1,
      complianceDomains: ["CN_MAINLAND"],
      complianceUnknown: false,
      capabilities,
    });
    const service = new ModelRoutingService(store, client);
    await service.create(input());
    const routing = await service.create({
      ...input(),
      name: "Removable inference",
      isDefault: false,
    });
    await service.bindAgent("agent-consumer", routing.id);

    await expect(service.delete(routing.id)).rejects.toThrow(
      "Remove all Consumers",
    );
    expect(await service.get(routing.id)).toBeDefined();

    await service.unbindAgent("agent-consumer");
    expect(client.blockKey).toHaveBeenCalledWith("token-hash");
    expect(client.revokeKey).not.toHaveBeenCalled();
    await service.delete(routing.id);

    expect(await service.get(routing.id)).toBeUndefined();
    expect(client.deleteModelRoutingTeam).toHaveBeenCalledWith("team-a");
  });
});
