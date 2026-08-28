import {
  createInstanceSchema,
  type Instance as Agent,
  type CreateInstanceInput,
  type RunnerSandbox,
} from "@tali/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimePolicyService } from "../runtime-policies/runtime-policy-service";
import { ProjectAgentRuntimeService } from "../runtime-bridge/project-agent-runtime-service";
import { AgentGardenStore } from "../agent-garden/agent-garden-store";
import { AgentGardenService } from "../agent-garden/agent-garden-service";
import { demoAgentEndpoint } from "../agent-garden/demo-agent-runtime";
import { databaseAgentCatalog } from "../agent-garden/database-agent-catalog";
import { createTestStore } from "../test/store";
import {
  configuredService,
  createConfiguredInstance,
} from "../test/configured-agent-service";
import {
  InstanceService,
  agentSandboxName,
  applyObservedState,
  isRunnerRuntimeTargetRoutable,
} from "./instance-service";

const accessPolicyId = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Agent sandbox naming", () => {
  it("derives the runtime identifier only from the Instance UUID", () => {
    const name = agentSandboxName("12345678-1234-4000-8000-123456789abc");

    expect(name).toBe("i-3k63vmz25el99oe64");
    expect(name).toHaveLength(19);
    expect(name).toMatch(/^[a-z][a-z0-9-]+[a-z0-9]$/);
  });

  it("keeps separate UUIDs distinct within the compact identifier", () => {
    expect(agentSandboxName("abcdef01-1234-4000-8000-123456789abc"))
      .toBe("i-td6hwjapuayo42xmk");
  });
});

describe("Project Runtime Target availability", () => {
  it("keeps the last observed generation routable during periodic reconciliation", () => {
    expect(isRunnerRuntimeTargetRoutable({
      generation: 3,
      observedGeneration: 3,
      status: "reconciling",
    })).toBe(true);
  });

  it("blocks an unobserved generation while reconciliation is in progress", () => {
    expect(isRunnerRuntimeTargetRoutable({
      generation: 4,
      observedGeneration: 3,
      status: "reconciling",
    })).toBe(false);
  });
});

describe("Instance lifecycle reconciliation", () => {
  const now = new Date().toISOString();
  const agent: Agent = {
    schemaVersion: 2,
    id: "agent-a",
    name: "Research Assistant",
    description: "",
    runtime: "openshell",
    agentPlatform: "openclaw",
    accessPolicyIds: [accessPolicyId],
    modelDeploymentId: "model-a",
    providerAccountId: "provider-a",
    providerName: "DeepSeek",
    model: "deepseek-chat",
    modelType: "llm",
    inferenceMode: "PLATFORM_MANAGED",
    modelRoutingId: "routing-a",
    modelRoutingBindingId: "binding-a",
    modelRoutingStatus: "READY",
    modelRoutingComplianceDomain: "GLOBAL",
    modelRoutingCapabilities: {
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
    modelRoutingKeyFingerprint: "sha256:123456789abc",
    costKeyAlias: "tali-research:deepseek-chat",
    sandboxName: "tali-research",
    status: "PROVISIONING",
    provisioningStage: "QUEUED",
    policyId: "restricted",
    systemPrompt: "Research the request and report the resulting evidence.",
    createdAt: now,
    updatedAt: now,
    logs: ["Instance creation accepted."],
  };

  it("preserves initialization logs when a recovered Runner has none", () => {
    expect(
      applyObservedState(agent, {
        name: agent.sandboxName,
        agentPlatform: "openclaw",
        phase: "PROVISIONING",
        provisioningStage: "POD",
        logs: [],
      }),
    ).toMatchObject({
      status: "PROVISIONING",
      provisioningStage: "POD",
      logs: ["Instance creation accepted."],
    });
  });

  it("keeps a newly queued Instance provisioning while the Sandbox is not visible yet", () => {
    expect(
      applyObservedState(agent, {
        name: agent.sandboxName,
        agentPlatform: "openclaw",
        phase: "NOT_FOUND",
        logs: [],
      }),
    ).toMatchObject({
      status: "PROVISIONING",
      runtimePhase: "NOT_FOUND",
    });
  });

  it("records NOT_FOUND as a failure after an Instance was already ready", () => {
    expect(
      applyObservedState(
        { ...agent, status: "READY" },
        {
          name: agent.sandboxName,
          agentPlatform: "openclaw",
          phase: "NOT_FOUND",
          logs: [],
        },
      ),
    ).toMatchObject({
      status: "FAILED",
      runtimePhase: "NOT_FOUND",
      error: expect.stringContaining("OpenShell Sandbox was not found"),
    });
  });
});

describe("OpenShell policy assignment", () => {
  it("loads the full-access GitHub example from the deployment catalog", async () => {
    const policy = await new RuntimePolicyService(createTestStore()).resolve(
      "github-full-access",
    );

    expect(policy?.policyYaml).toContain("host: api.github.com");
    expect(policy?.policyYaml).toContain("access: full");
    expect(
      createInstanceSchema.parse({
        name: "GitHub Operator",
        description: "",
        runtime: "openshell",
        accessPolicyIds: [accessPolicyId],
        modelRoutingId: "routing-a",
        policyId: "github-full-access",
        systemPrompt: "Operate on GitHub and report the resulting evidence.",
      }).policyId,
    ).toBe("github-full-access");
  });
});

describe("Agent selection", () => {
  const input = {
    name: "Research Assistant",
    description: "",
    runtime: "openshell" as const,
    accessPolicyIds: [accessPolicyId],
    modelRoutingId: "routing-a",
    policyId: "restricted" as const,
    systemPrompt: "Research the request and report the resulting evidence.",
  };

  it("uses Hermes as the default Agent implementation", () => {
    expect(createInstanceSchema.parse(input).agentPlatform).toBe("hermes");
  });

  it("accepts Hermes as an Agent configured by NemoClaw", () => {
    expect(
      createInstanceSchema.parse({ ...input, agentPlatform: "hermes" })
        .agentPlatform,
    ).toBe("hermes");
  });

  it("keeps specialization and capability references in the create contract", () => {
    expect(
      createInstanceSchema.parse({
        ...input,
        specializationId: "hr",
        skillIds: ["employee-policy-search"],
        mcpServerIds: ["workday"],
        knowledgeSourceIds: ["company-hr-handbook"],
      }),
    ).toMatchObject({
      specializationId: "hr",
      skillIds: ["employee-policy-search"],
      mcpServerIds: ["workday"],
      knowledgeSourceIds: ["company-hr-handbook"],
    });
  });

  it("accepts an Instance-specific Model Routing selection", () => {
    expect(
      createInstanceSchema.parse({
        ...input,
        modelRoutingId: "routing-selected",
      }).modelRoutingId,
    ).toBe("routing-selected");
  });

  it("accepts Native Memory for OpenClaw and Hermes but keeps Hybrid OpenClaw-only", () => {
    expect(
      createInstanceSchema.parse({
        ...input,
        agentPlatform: "openclaw",
        memory: { mode: "native" },
      }).memory,
    ).toEqual({ mode: "native", citations: "auto" });
    expect(
      createInstanceSchema.parse({
        ...input,
        agentPlatform: "hermes",
        memory: { mode: "native" },
      }).memory,
    ).toEqual({ mode: "native", citations: "auto" });
    expect(() => createInstanceSchema.parse({
      ...input,
        agentPlatform: "hermes",
        memory: {
          mode: "hybrid",
          embeddingModelDeploymentId: "22222222-2222-4222-8222-222222222222",
        },
    })).toThrow("Hybrid Memory is currently available only for OpenClaw Instances");
  });

  it("resolves Role and capability references from the PostgreSQL catalog", async () => {
    const service = new InstanceService(createTestStore());
    await expect(
      service.create({
        ...input,
        agentPlatform: "openclaw",
        specializationId: "missing-role",
      }),
    ).rejects.toThrow("available Agent Role");
    await expect(
      service.create({
        ...input,
        agentPlatform: "openclaw",
        specializationId: "general-purpose",
        skillIds: ["missing-skill"],
      }),
    ).rejects.toThrow("Skill configuration is unavailable");
  });
});

async function instantiateAsExternalRegistryFixture(
  garden: AgentGardenService,
  agentId: string,
) {
  await garden.snapshot();
  const agent = await garden.store.getAgent(agentId);
  if (!agent) throw new Error(`Missing Agent Garden fixture: ${agentId}`);
  const configuration = { ...agent.configuration };
  for (const key of [
    "onboardingSource",
    "imageReference",
    "containerPort",
    "agentCardPath",
    "imagePullSecretName",
    "command",
    "args",
    "runtimeOwnership",
  ]) {
    delete configuration[key];
  }
  await garden.store.saveAgent({ ...agent, configuration });
  return garden.instantiate(agentId, "local-admin");
}

describe("Instance Access Policy lifecycle", () => {
  it("keeps the existing Agent create path when Durable Memory is disabled", async () => {
    vi.stubEnv("TALI_DURABLE_MEMORY_ENABLED", "false");
    vi.stubEnv("TALI_DURABLE_MEMORY_PROJECTS", "");
    const setup = await configuredService();
    const queued = await setup.service.create({
      name: "Feature-disabled Agent",
      description: "",
      runtime: "openshell",
      accessPolicyIds: [setup.policy.id],
      modelRoutingId: "routing-a",
      agentPlatform: "openclaw",
      policyId: "restricted",
      systemPrompt: "Research the request and report the resulting evidence.",
      knowledgeSourceIds: ["engineering-handbook"],
    }, "local-admin");

    expect(queued.durableMemoryId).toBeUndefined();
    expect(queued.memory).toEqual({ mode: "native", citations: "auto" });
    expect(setup.memoryProvider.bankCount()).toBe(0);
    await expect(setup.store.database().memoryRecord.count()).resolves.toBe(0);
    await expect(setup.service.create({
      name: "Invalid explicit Memory",
      description: "",
      runtime: "openshell",
      accessPolicyIds: [setup.policy.id],
      modelRoutingId: "routing-a",
      agentPlatform: "openclaw",
      durableMemoryId: "memory-a",
      policyId: "restricted",
      systemPrompt: "Research the request and report the resulting evidence.",
      knowledgeSourceIds: ["engineering-handbook"],
    }, "local-admin")).rejects.toThrow("not enabled for this Project");
  });

  it.each(["openclaw", "hermes"] as const)(
    "falls back to Native text Memory for %s when the Project has no embedding model",
    async (agentPlatform) => {
      const setup = await configuredService({
        includeValidatedEmbeddingModel: false,
      });
      const agent = await createConfiguredInstance(setup, {
        agentPlatform,
        knowledgeSourceIds: [],
      });

      expect(agent.memory).toEqual({ mode: "native", citations: "auto" });
      expect(agent.durableMemoryId).toBeUndefined();
      expect(setup.memoryProvider.bankCount()).toBe(0);
      await expect(setup.store.database().memoryRecord.count()).resolves.toBe(0);
      expect(setup.runner.createSandbox).toHaveBeenCalledWith(
        expect.objectContaining({
          durableMemoryEnabled: false,
          memory: { mode: "native", citations: "auto" },
        }),
      );
    },
  );

  it("rejects assigning a Vector Database when the Project has no embedding model", async () => {
    const setup = await configuredService({
      includeValidatedEmbeddingModel: false,
    });

    await expect(setup.service.create({
      name: "Vector-backed Agent",
      description: "",
      runtime: "openshell",
      accessPolicyIds: [setup.policy.id],
      modelRoutingId: "routing-a",
      agentPlatform: "hermes",
      policyId: "restricted",
      systemPrompt: "Research the request and report the resulting evidence.",
      knowledgeSourceIds: ["engineering-handbook"],
    }, "local-admin")).rejects.toThrow(
      "require a validated text embedding model",
    );
  });

  it("replays an Agent create key without creating another Agent or Memory Bank", async () => {
    const setup = await configuredService();
    const input: CreateInstanceInput = {
      name: "Idempotent Research Assistant",
      description: "",
      runtime: "openshell",
      accessPolicyIds: [setup.policy.id],
      modelRoutingId: "routing-a",
      agentPlatform: "openclaw",
      policyId: "restricted",
      systemPrompt: "Research the request and report the resulting evidence.",
      knowledgeSourceIds: ["engineering-handbook"],
    };

    const first = await setup.service.create(
      input,
      "local-admin",
      "agent-create-request-a",
    );
    const replay = await setup.service.create(
      input,
      "local-admin",
      "agent-create-request-a",
    );

    expect(replay.id).toBe(first.id);
    expect(replay.durableMemoryId).toBe(first.durableMemoryId);
    expect(setup.memoryProvider.bankCount()).toBe(1);
    await expect(setup.store.database().agentRecord.count()).resolves.toBe(1);
    await expect(setup.store.database().memoryRecord.count()).resolves.toBe(1);
    await expect(setup.store.database().memoryBinding.count()).resolves.toBe(1);
    expect(setup.jobs.enqueueInstanceLifecycle).toHaveBeenCalledOnce();
  });

  it("returns a queued Instance before LiteLLM and OpenShell provisioning starts", async () => {
    const setup = await configuredService();
    const queued = await setup.service.create(
      {
        name: "Asynchronous Research Assistant",
        description: "",
        runtime: "openshell",
        accessPolicyIds: [setup.policy.id],
        modelRoutingId: "routing-a",
        agentPlatform: "openclaw",
        policyId: "restricted",
        systemPrompt: "Research the request and report the resulting evidence.",
        knowledgeSourceIds: ["engineering-handbook"],
      },
      "local-admin",
    );

    expect(queued).toMatchObject({
      status: "PROVISIONING",
      provisioningStage: "QUEUED",
      operationId: expect.any(String),
    });
    expect(setup.jobs.enqueueInstanceLifecycle).toHaveBeenCalledWith({
      projectId: setup.store.projectId,
      instanceId: queued.id,
      operationId: queued.operationId,
      action: "provision",
    });
    expect(setup.litellm.createInstanceServiceAccountKey).not.toHaveBeenCalled();
    expect(setup.runner.createSandbox).not.toHaveBeenCalled();

    await setup.service.provision(queued.id);
    expect(setup.litellm.createInstanceServiceAccountKey).toHaveBeenCalledOnce();
    expect(setup.runner.createSandbox).toHaveBeenCalledOnce();
  });

  it("recovers a false NOT_FOUND failure after the Sandbox becomes ready", async () => {
    const setup = await configuredService();
    const agent = await createConfiguredInstance(setup);
    await setup.store.save({
      ...agent,
      status: "FAILED",
      runtimePhase: "NOT_FOUND",
      error: "The OpenShell Sandbox was not found.",
    });
    vi.mocked(setup.runner.getSandbox).mockResolvedValueOnce({
      name: agent.sandboxName,
      agentPlatform: agent.agentPlatform,
      phase: "READY",
      logs: ["Sandbox ready."],
    });

    const recovered = await setup.service.get(agent.id);
    expect(recovered).toMatchObject({
      status: "READY",
      runtimePhase: "READY",
    });
    expect(recovered).not.toHaveProperty("error");
  });

  it("discovers READY callable A2A Instances from the Project registry", async () => {
    const setup = await configuredService();
    const garden = new AgentGardenService(
      new AgentGardenStore(setup.store.projectId, setup.store.database()),
    );
    const github = await instantiateAsExternalRegistryFixture(
      garden,
      "a2a-github-daily-triage",
    );
    const risk = await instantiateAsExternalRegistryFixture(
      garden,
      "a2a-pull-request-risk-scanner",
    );
    const release = await garden.instantiate(
      "a2a-release-notes-composer",
      "local-admin",
    );
    await garden.store.saveManagedInstance({
      ...release,
      status: "FAILED",
      error: "Endpoint health check failed.",
    });
    const agent = await createConfiguredInstance(setup, {
      agentPlatform: "hermes",
    });

    const runtime = new ProjectAgentRuntimeService(
      setup.store.projectId,
      setup.store.database(),
    );
    await expect(runtime.listPeers(agent.id)).resolves.toEqual([
      expect.objectContaining({
        id: github.id,
        name: "GitHub Daily Triage",
        protocolVersion: "1.0",
      }),
      expect.objectContaining({
        id: risk.id,
        name: "Pull Request Risk Scanner",
        protocolVersion: "1.0",
      }),
    ]);
    const fetchRequest = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "dispatch-1",
        result: {
          message: {
            role: "ROLE_AGENT",
            parts: [{ text: "Triage complete." }],
          },
        },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    await expect(runtime.sendMessage(
      agent.id,
      github.id,
      {
        jsonrpc: "2.0",
        id: "dispatch-1",
        method: "SendMessage",
        params: {
          message: {
            messageId: "message-1",
            role: "ROLE_USER",
            parts: [{ text: "Triage today's work." }],
          },
        },
      },
    )).resolves.toMatchObject({
      status: 200,
      body: { id: "dispatch-1" },
    });
    expect(fetchRequest).toHaveBeenCalledWith(
      demoAgentEndpoint("a2a-github-daily-triage"),
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
    fetchRequest.mockRestore();
  });

  it("translates Hermes JSON-RPC delegation to an HTTP+JSON A2A Agent", async () => {
    const setup = await configuredService();
    const coordinator = await createConfiguredInstance(setup, {
      agentPlatform: "hermes",
    });
    const garden = new AgentGardenStore(
      setup.store.projectId,
      setup.store.database(),
    );
    await garden.ensureAgents(databaseAgentCatalog);
    const peer = await garden.getAgent("a2a-github-daily-triage");
    expect(peer?.a2a).toBeDefined();
    const updatedPeer = await garden.saveAgent({
      ...peer!,
      endpoint: "https://expert.example/a2a",
      a2a: { ...peer!.a2a!, protocolBinding: "HTTP+JSON" },
      configuration: Object.fromEntries(
        Object.entries(peer!.configuration).filter(([key]) => ![
          "onboardingSource",
          "imageReference",
          "containerPort",
          "agentCardPath",
          "imagePullSecretName",
          "command",
          "args",
          "runtimeOwnership",
        ].includes(key)),
      ),
    });
    const callable = await new AgentGardenService(garden).instantiate(
      updatedPeer.id,
      "local-admin",
    );
    const fetchRequest = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        message: {
          messageId: "reply-1",
          role: "ROLE_AGENT",
          parts: [{ text: "HTTP+JSON complete." }],
        },
      }), { status: 200, headers: { "content-type": "application/a2a+json" } }),
    );
    const request = {
      jsonrpc: "2.0",
      id: "dispatch-http-json",
      method: "SendMessage",
      params: {
        message: {
          messageId: "message-1",
          role: "ROLE_USER",
          parts: [{ text: "Run the HTTP+JSON specialist." }],
        },
      },
    };

    await expect(new ProjectAgentRuntimeService(
      setup.store.projectId,
      setup.store.database(),
    ).sendMessage(
      coordinator.id,
      callable.id,
      request,
    )).resolves.toEqual({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: "dispatch-http-json",
        result: expect.objectContaining({
          message: expect.objectContaining({ messageId: "reply-1" }),
        }),
      },
    });
    expect(fetchRequest).toHaveBeenCalledWith(
      "https://expert.example/a2a/message:send",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(request.params),
      }),
    );
    fetchRequest.mockRestore();
  });

  it("rejects an oversized A2A Agent response", async () => {
    const setup = await configuredService();
    const coordinator = await createConfiguredInstance(setup, {
      agentPlatform: "hermes",
    });
    const garden = new AgentGardenService(
      new AgentGardenStore(setup.store.projectId, setup.store.database()),
    );
    const callable = await instantiateAsExternalRegistryFixture(
      garden,
      "a2a-github-daily-triage",
    );
    const fetchRequest = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("x".repeat(1024 * 1024 + 1), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(new ProjectAgentRuntimeService(
      setup.store.projectId,
      setup.store.database(),
    ).sendMessage(
      coordinator.id,
      callable.id,
      {
        jsonrpc: "2.0",
        id: "oversized",
        method: "SendMessage",
        params: {
          message: {
            messageId: "message-oversized",
            role: "ROLE_USER",
            parts: [{ text: "Return too much data." }],
          },
        },
      },
    )).rejects.toThrow("exceeded the 1 MiB limit");
    fetchRequest.mockRestore();
  });

  it("passes Platform Sandbox resource overrides to the Runner", async () => {
    const setup = await configuredService();
    await setup.store.database().platformSettingsRecord.create({
      data: {
        id: "platform",
        sandboxCpu: "1500m",
        sandboxMemory: "4Gi",
      },
    });

    await createConfiguredInstance(setup);

    expect(setup.runner.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxResources: { cpu: "1500m", memory: "4Gi" },
      }),
    );
  });

  it("provisions native Memory without adding an embedding model to the Instance key", async () => {
    const setup = await configuredService();
    const agent = await createConfiguredInstance(setup, {
      memory: { mode: "native", citations: "auto" },
    });

    expect(agent.memory).toEqual({ mode: "native", citations: "auto" });
    expect(setup.runner.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: { mode: "native", citations: "auto" },
      }),
    );
    expect(
      vi.mocked(setup.litellm.createInstanceServiceAccountKey!).mock.calls[0]![0]
        .models,
    ).not.toContain("tali/provider-a/text-embedding-3-small");
  });

  it("binds a validated same-boundary embedding model for hybrid Memory", async () => {
    const setup = await configuredService();
    const now = new Date().toISOString();
    const embeddingModelDeploymentId = "22222222-2222-4222-8222-222222222222";
    await setup.store.saveModelDeployment({
      id: embeddingModelDeploymentId,
      providerAccountId: "provider-a",
      modelId: "text-embedding-3-small",
      displayName: "Text Embedding 3 Small",
      modelType: "text-embedding",
      capabilities: [],
      inputModalities: ["text"],
      outputModalities: ["embedding"],
      providerPresetId: "deepseek",
      providerName: "DeepSeek",
      endpoint: "https://api.deepseek.com/v1",
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
    });

    await createConfiguredInstance(setup, {
      memory: {
        mode: "hybrid",
        embeddingModelDeploymentId,
        includeSessionTranscripts: true,
        citations: "auto",
        maxResults: 6,
        minScore: 0.35,
      },
    });

    expect(
      vi.mocked(setup.litellm.createInstanceServiceAccountKey!).mock.calls[0]![0]
        .models,
    ).toContain("tali/provider-a/text-embedding-3-small");
    expect(setup.runner.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: {
          mode: "hybrid",
          embeddingModel: "tali/provider-a/text-embedding-3-small",
          includeSessionTranscripts: true,
          citations: "auto",
          maxResults: 6,
          minScore: 0.35,
        },
      }),
    );
  });

  it("creates and revokes an Instance Service Account Key under the Project Team", async () => {
    const setup = await configuredService();
    const agent = await createConfiguredInstance(setup);
    const memory = await setup.memories.repository.getMemory(
      agent.durableMemoryId!,
    );
    expect(memory).toMatchObject({ status: "ready" });
    expect(setup.memoryProvider.hasBank(memory!.providerRef!)).toBe(true);

    expect(setup.litellm.createInstanceServiceAccountKey).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-a",
        models: ["tali-routing-routing-a"],
        aliases: {
          "tali-routing-routing-a": "tali/provider-a/deepseek-chat",
        },
        routerSettings: {
          num_retries: 2,
        },
        metadata: expect.objectContaining({
          tali_project_id: "individual",
          tali_instance_id: agent.id,
        }),
        objectPermissions: expect.objectContaining({
          vectorStores: ["vs_engineering_handbook"],
        }),
      }),
    );
    const keyInput = vi.mocked(setup.litellm.createInstanceServiceAccountKey!)
      .mock.calls[0]![0];
    expect(keyInput.metadata).toEqual({
      managed_by: "tali",
      tali_project_id: "individual",
      tali_instance_id: agent.id,
      service_account_id: `tali-instance-${agent.id}`,
    });
    expect(setup.runner.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-instance-service-account",
        inferenceEndpoint: "http://litellm:4000/v1",
        model: "tali-routing-routing-a",
      }),
    );
    expect(setup.runner.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        policyYaml: expect.stringContaining("/dev/null"),
      }),
    );
    expect((await setup.store.get(agent.id))?.accessPolicyIds).toEqual([
      setup.policy.id,
    ]);
    const attribution = await setup.store
      .database()
      .costAttributionMappingRecord.findFirst({
        where: { projectId: setup.store.projectId, instanceId: agent.id },
      });
    expect(attribution?.instanceId).toBe(agent.id);

    await setup.service.destroy(agent.id);
    expect(setup.litellm.blockKey).not.toHaveBeenCalled();
    await setup.service.deleteRuntime(agent.id);
    expect(setup.litellm.blockKey).toHaveBeenCalledWith(
      "instance-hashed-token",
    );
    expect(setup.litellm.revokeKey).not.toHaveBeenCalled();
    await expect(setup.memories.repository.getMemory(agent.durableMemoryId!))
      .resolves.toMatchObject({ status: "unbound" });
    expect(setup.memoryProvider.hasBank(memory!.providerRef!)).toBe(true);
    await expect(
      setup.memories.repository.countBindings(agent.durableMemoryId!, "detached"),
    ).resolves.toBe(1);
    expect(await setup.store.getIncludingDeleted(agent.id)).toMatchObject({
      liteLLMKeyBlockedAt: expect.any(String),
      modelRoutingBindingRevokedAt: expect.any(String),
      deletionCompletedAt: expect.any(String),
      logs: expect.arrayContaining([
        "LiteLLM Virtual Key blocked and retained for billing reconciliation.",
        "Instance deletion completed.",
      ]),
    });
    await expect(setup.store.database().costAttributionMappingRecord.findFirst({
      where: { projectId: setup.store.projectId, instanceId: agent.id },
    })).resolves.toMatchObject({
      liteLLMVirtualKeyId: "instance-hashed-token",
      validTo: expect.any(Date),
    });
    await setup.service.deleteRuntime(agent.id);
    expect(setup.runner.destroySandbox).toHaveBeenCalledOnce();
    expect(setup.litellm.blockKey).toHaveBeenCalledOnce();
  });

  it("accepts deletion before background runtime cleanup completes", async () => {
    const setup = await configuredService();
    const agent = await createConfiguredInstance(setup);
    let finishRuntimeCleanup!: (sandbox: RunnerSandbox) => void;
    vi.mocked(setup.runner.destroySandbox).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRuntimeCleanup = resolve;
      }),
    );

    await expect(setup.service.destroy(agent.id)).resolves.toBe(true);
    expect(await setup.store.get(agent.id)).toBeUndefined();
    expect((await setup.store.getIncludingDeleted(agent.id))?.status).toBe(
      "DESTROYING",
    );
    expect(setup.litellm.blockKey).not.toHaveBeenCalled();

    const cleanup = setup.service.deleteRuntime(agent.id);
    finishRuntimeCleanup({
      name: agent.sandboxName,
      agentPlatform: agent.agentPlatform,
      phase: "NOT_FOUND",
      logs: [],
    });
    await cleanup;
    expect(setup.litellm.blockKey).toHaveBeenCalledWith(
      "instance-hashed-token",
    );
    expect(setup.litellm.revokeKey).not.toHaveBeenCalled();
    await vi.waitFor(async () => {
      expect(await setup.store.get(agent.id)).toBeUndefined();
      expect(await setup.store.getIncludingDeleted(agent.id)).toMatchObject({
        liteLLMKeyBlockedAt: expect.any(String),
        modelRoutingBindingRevokedAt: expect.any(String),
        deletionCompletedAt: expect.any(String),
      });
    });
    await expect(setup.store.database().agentRecord.findUnique({
      where: {
        projectId_id: { projectId: setup.store.projectId, id: agent.id },
      },
    })).resolves.toMatchObject({ deletedAt: expect.any(Date) });
  });

  it("rebinds a retained Memory to a replacement Hermes Instance", async () => {
    const setup = await configuredService();
    const original = await createConfiguredInstance(setup);
    const originalMemory = await setup.memories.repository.getMemory(
      original.durableMemoryId!,
    );

    await setup.service.destroy(original.id);
    await setup.service.deleteRuntime(original.id);
    const replacement = await createConfiguredInstance(setup, {
      agentPlatform: "hermes",
      durableMemoryId: original.durableMemoryId,
      name: "Hermes Replacement",
    });
    const reboundMemory = await setup.memories.repository.getMemory(
      replacement.durableMemoryId!,
    );

    expect(replacement.durableMemoryId).toBe(original.durableMemoryId);
    expect(reboundMemory).toMatchObject({
      id: originalMemory!.id,
      providerRef: originalMemory!.providerRef,
      status: "ready",
    });
    expect(setup.memoryProvider.bankCount()).toBe(1);
    await expect(
      setup.memories.repository.getActiveBindingForInstance(replacement.id),
    ).resolves.toMatchObject({ runtimeType: "hermes", status: "active" });
  });

  it("updates permissions without recreating the Sandbox", async () => {
    const setup = await configuredService();
    const agent = await createConfiguredInstance(setup);
    const replacement = await setup.service.accessPolicies.create(
      { name: "Restricted replacement", status: "ACTIVE", serverRules: [] },
      "test",
    );

    const updated = await setup.service.updateAccessPolicies(
      agent.id,
      [replacement.id],
      "Security Admin",
    );

    expect(updated.accessPolicyIds).toEqual([replacement.id]);
    expect((await setup.store.get(agent.id))?.accessPolicyIds).toEqual([
      replacement.id,
    ]);
    const binding =
      await setup.store.database().agentInstanceAccessPolicyBindingRecord.findFirst({
        where: { projectId: setup.store.projectId, instanceId: agent.id },
      });
    expect(binding?.boundBy).toBe("Security Admin");
    expect(setup.litellm.updateInstanceObjectPermissions).toHaveBeenCalledWith(
      "instance-hashed-token",
      expect.objectContaining({
        mcpServers: [],
        vectorStores: ["vs_engineering_handbook"],
      }),
    );
    expect(setup.runner.createSandbox).toHaveBeenCalledTimes(1);
    expect(setup.runner.destroySandbox).not.toHaveBeenCalled();
  });

  it("removes a queued Instance without creating a key when binding persistence fails", async () => {
    const setup = await configuredService();
    vi.spyOn(setup.store, "replaceAgentAccessPolicies").mockRejectedValueOnce(
      new Error("binding write failed"),
    );

    await expect(createConfiguredInstance(setup)).rejects.toThrow(
      "binding write failed",
    );
    expect(setup.litellm.revokeKey).not.toHaveBeenCalled();
    expect(await setup.store.list()).toEqual([]);
    expect(setup.runner.createSandbox).not.toHaveBeenCalled();
  });

  it("binds the Model Routing selected for the Instance", async () => {
    const setup = await configuredService();
    const projectDefault = await setup.store.getModelRouting("routing-a");
    expect(projectDefault).toBeDefined();
    await setup.store.saveModelRouting({
      ...projectDefault!,
      id: "routing-selected",
      name: "Selected inference",
      publicModelAlias: "tali-routing-routing-selected",
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const agent = await createConfiguredInstance(setup, {
      modelRoutingId: "routing-selected",
    });

    expect(agent.modelRoutingId).toBe("routing-selected");
    expect(agent.model).toBe("tali-routing-routing-selected");
    expect(agent.modelRoutingBindingId).toBe(
      "instance-selected:routing-selected",
    );
    expect(
      vi.mocked(setup.litellm.createInstanceServiceAccountKey!).mock.calls[0]![0]
        .models,
    ).toContain("tali-routing-routing-selected");
    expect(setup.runner.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ model: "tali-routing-routing-selected" }),
    );
  });

  it("uses the Routing referenced by the Instance even if Project defaults conflict", async () => {
    const setup = await configuredService();
    const ready = await setup.store.getModelRouting("routing-a");
    expect(ready).toBeDefined();
    await setup.store.saveModelRouting({
      ...ready!,
      id: "routing-b",
      name: "Degraded duplicate default",
      status: "DEGRADED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const agent = await createConfiguredInstance(setup);

    expect(agent.modelRoutingId).toBe("routing-a");
    expect(setup.litellm.createInstanceServiceAccountKey).toHaveBeenCalledOnce();
    expect(setup.runner.createSandbox).toHaveBeenCalledOnce();
  });
});
