import type {
  CreateInstanceInput,
  HttpEndpoint,
} from "@tali/contracts";
import { vi } from "vitest";
import type { ControlJobPublisher } from "../jobs/control-job-queue";
import { InstanceService } from "../instances/instance-service";
import { MemoryRepository } from "../memories/memory-repository";
import { MemoryService } from "../memories/memory-service";
import { FakeMemoryProvider } from "../memories/testing/fake-memory-provider";
import type { LiteLLMAdminClient } from "../providers/litellm-client";
import type { RunnerClient } from "../runtime/nemoclaw-runner-client";
import { createTestStore } from "./store";

function runnerAdapter(httpEndpoint?: HttpEndpoint): RunnerClient {
  return {
    createSandbox: vi.fn(async (input) => ({
      name: input.name,
      agentPlatform: input.agentPlatform,
      phase: "READY" as const,
      logs: [],
      ...(httpEndpoint ? { httpEndpoint } : {}),
    })),
    getSandbox: vi.fn(async (name, agentPlatform) => ({
      name,
      agentPlatform,
      phase: "NOT_FOUND" as const,
      logs: [],
    })),
    getSandboxInteraction: vi.fn(),
    getSandboxAudit: vi.fn(),
    destroySandbox: vi.fn(async (name, agentPlatform) => ({
      name,
      agentPlatform,
      phase: "NOT_FOUND" as const,
      logs: [],
    })),
    getHealth: vi.fn(async () => ({ ok: true, mode: "fixture" })),
    terminalWebSocketUrl: vi.fn(async () => "ws://runner/terminal"),
    authorizationHeaders: vi.fn(async () => ({
      authorization: "Bearer token",
    })),
  };
}

function liteLLMAdapter(): LiteLLMAdminClient {
  return {
    baseUrl: "http://litellm:4000",
    registerModel: vi.fn(),
    deleteModel: vi.fn(),
    probeModel: vi.fn(),
    createInstanceKey: vi.fn(async () => ({
      secret: "sk-instance",
      tokenId: "hashed-token",
    })),
    ensureProjectTeam: vi.fn(async () => "team-a"),
    addProjectTeamMember: vi.fn(async () => undefined),
    createInstanceServiceAccountKey: vi.fn(async () => ({
      secret: "sk-instance-service-account",
      tokenId: "instance-hashed-token",
    })),
    updateInstanceObjectPermissions: vi.fn(async () => undefined),
    blockKey: vi.fn(async () => undefined),
    revokeKey: vi.fn(async () => undefined),
    listSpendLogs: vi.fn(async () => []),
  };
}

export async function configuredService(options: {
  httpEndpoint?: HttpEndpoint;
} = {}) {
  const store = createTestStore();
  const now = new Date().toISOString();
  await store.saveInferenceGateway({
    id: "litellm-default",
    name: "LiteLLM",
    baseUrl: "http://litellm:4000",
    adminUiUrl: "http://litellm:4000",
    credentialSource: "ENVIRONMENT",
    status: "READY",
    validationMessage: "Ready",
    validatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await store.saveProviderAccount(
    {
      id: "provider-a",
      name: "DeepSeek",
      providerKind: "deepseek",
      presetId: "deepseek",
      endpoint: "https://api.deepseek.com/v1",
      config: {},
      complianceDomain: "GLOBAL",
      endpointRegion: "global",
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
  await store.saveModelDeployment({
    id: "model-a",
    providerAccountId: "provider-a",
    modelId: "deepseek-chat",
    displayName: "DeepSeek Chat",
    modelType: "llm",
    capabilities: ["tool-calling"],
    inputModalities: ["text"],
    outputModalities: ["text"],
    providerPresetId: "deepseek",
    providerName: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1",
    complianceDomain: "GLOBAL",
    endpointRegion: "global",
    crossBorderTransfer: false,
    litellmModelName: "tali/provider-a/deepseek-chat",
    status: "VALIDATED",
    checks: [],
    validationMessage: "Ready",
    validatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await store.saveModelRouting({
    id: "routing-a",
    name: "Production inference",
    description: "Managed inference for production Instances.",
    gatewayId: "litellm-default",
    managementMode: "LITELLM_MANAGED",
    publicModelAlias: "tali-routing-routing-a",
    routingPolicy: {
      version: 1,
      mode: "SINGLE",
      modelDeploymentId: "model-a",
      fallbackModelDeploymentIds: [],
      retries: 2,
    },
    complianceDomain: "GLOBAL",
    status: "READY",
    isDefault: true,
    keyPolicy: { perInstance: true, rotationDays: 90 },
    auditPolicy: {
      controlPlane: true,
      requestLogs: true,
      capturePrompts: false,
    },
    capabilities: {
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
    },
    conditions: [{
      type: "COMPLIANCE",
      status: "PASS",
      reason: "All backing deployments are GLOBAL.",
    }],
    configurationHash: "sha256:test",
    observedGeneration: 1,
    validationMessage: "LiteLLM binding is ready.",
    consumers: 0,
    createdAt: now,
    updatedAt: now,
  });
  await store.saveKnowledgeSourceDefinition({
    id: "engineering-handbook",
    name: "Engineering Handbook",
    description: "Approved engineering standards and operational runbooks.",
    vectorStoreId: "vs_engineering_handbook",
    provider: "openai",
    credentialReference: "",
    status: "REGISTERED",
    lastReconciliationError: null,
    topK: 8,
  });
  const runner = runnerAdapter(options.httpEndpoint);
  const litellm = liteLLMAdapter();
  let lifecycleJobSequence = 400;
  const jobs = {
    enqueueInstanceLifecycle: vi.fn(async () => {
      lifecycleJobSequence += 1;
      return `00000000-0000-4000-8000-${String(lifecycleJobSequence).padStart(12, "0")}`;
    }),
  } as unknown as ControlJobPublisher;
  const memoryProvider = new FakeMemoryProvider();
  const memories = new MemoryService(
    new MemoryRepository(store.projectId, store.database()),
    () => memoryProvider,
    () => "test-memory-outbox-secret-with-32-characters",
  );
  const service = new InstanceService(
    store,
    runner,
    litellm,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    jobs,
    memories,
  );
  const policy = await service.accessPolicies.create(
    { name: "Default Instance access", status: "ACTIVE", serverRules: [] },
    "test",
  );
  return {
    store,
    runner,
    litellm,
    service,
    policy,
    jobs,
    memories,
    memoryProvider,
  };
}

export async function createConfiguredInstance(
  setup: Awaited<ReturnType<typeof configuredService>>,
  overrides: Partial<CreateInstanceInput> = {},
) {
  const queued = await setup.service.create(
    {
      name: "Research Assistant",
      description: "",
      runtime: "openshell",
      accessPolicyIds: [setup.policy.id],
      modelRoutingId: "routing-a",
      agentPlatform: "openclaw",
      policyId: "restricted",
      systemPrompt: "Research the request and report the resulting evidence.",
      knowledgeSourceIds: ["engineering-handbook"],
      ...overrides,
    },
    "local-admin",
  );
  await setup.service.provision(queued.id);
  return (await setup.store.get(queued.id))!;
}
