import { describe, expect, it, vi } from "vitest";
import type {
  AgentPlatformId,
  Instance as Agent,
  OnboardContainerImageAgentInput,
  OnboardExistingAgentInput,
} from "@tali/contracts";
import { createTestStore } from "../test/store";
import type { ManagedAgentRuntimeClient } from "../kubernetes/managed-agent-runtime-client";
import type { SecretStore } from "../secrets/secret-store";
import type { AgentDiscoveryClient } from "./agent-discovery";
import { AgentGardenService } from "./agent-garden-service";
import { AgentGardenStore } from "./agent-garden-store";
import { databaseAgentCatalog } from "./database-agent-catalog";

function coordinator(
  id = "coordinator-a",
  agentPlatform: AgentPlatformId = "hermes",
): Agent {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id,
    name: "Hermes Coordinator",
    description: "",
    runtime: "openshell",
    agentPlatform,
    modelDeploymentId: "model-a",
    providerAccountId: "provider-a",
    providerName: "LiteLLM",
    model: "production-chat",
    modelType: "llm",
    inferenceMode: "PLATFORM_MANAGED",
    accessPolicyIds: ["11111111-1111-4111-8111-111111111111"],
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
    costKeyAlias: `tali-${id}`,
    sandboxName: `tali-${id}`,
    status: "READY",
    policyId: "restricted",
    systemPrompt: "Coordinate work and report the resulting evidence.",
    createdAt: now,
    updatedAt: now,
    logs: [],
  };
}

const githubAgentInput: OnboardExistingAgentInput = {
  sourceType: "existing-agent",
  name: "GitHub Operations",
  description: "Handles repository triage and pull request review tasks.",
  agentCardUrl: "https://agents.example.com/.well-known/agent-card.json",
  category: "Developer Tools",
  owner: "Developer Experience",
  tags: ["GitHub", "Automation"],
  authType: "none",
  authReference: "",
  internalNetworkOnly: false,
};

const a2aProfile = {
  protocolBinding: "JSONRPC" as const,
  protocolVersion: "1.0" as const,
  tenant: null,
  streaming: false,
  pushNotifications: false,
  extendedAgentCard: false,
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
};

const imageAgentInput: OnboardContainerImageAgentInput = {
  sourceType: "container-image",
  name: "Research Container",
  description: "Handles delegated research and source validation tasks.",
  category: "Research",
  owner: "Research Platform",
  tags: ["Research", "A2A"],
  usageMode: "CALLABLE",
  image: "ghcr.io/acme/research-agent:v1.4.0",
  containerPort: 8_080,
  agentCardPath: "/.well-known/agent-card.json",
  imagePullSecretName: "",
  command: [],
  args: [],
};

describe("AgentGardenService", () => {
  it("replaces an older catalog seed before parsing its current schema", async () => {
    const projectStore = createTestStore();
    const current = databaseAgentCatalog[0]!;
    const { a2a: _a2a, ...legacyPayload } = current;
    await projectStore.database().agentCatalogRecord.create({
      data: {
        projectId: projectStore.projectId,
        id: current.id,
        payload: {
          ...legacyPayload,
          configuration: {
            ...legacyPayload.configuration,
            catalogVersion: "older-schema",
          },
        },
      },
    });
    const service = new AgentGardenService(
      new AgentGardenStore(projectStore.projectId, projectStore.database()),
      projectStore,
    );

    await expect(service.snapshot()).resolves.toBeDefined();
    await expect(service.store.getAgent(current.id)).resolves.toMatchObject({
      a2a: {
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    });
  });

  it("keeps interactive runtimes out of the delegatable Agent set", async () => {
    const projectStore = createTestStore();
    const service = new AgentGardenService(
      new AgentGardenStore(projectStore.projectId, projectStore.database()),
      projectStore,
    );

    const snapshot = await service.snapshot();
    const openClaw = snapshot.agents.find(
      (agent) => agent.integrationType === "openclaw",
    );
    const deepAgents = snapshot.agents.find(
      (agent) => agent.integrationType === "deepagents",
    );
    const claudeCode = snapshot.agents.find(
      (agent) => agent.integrationType === "claude-code",
    );

    expect(openClaw?.usageCapabilities).toEqual({
      interactive: true,
      canDelegate: true,
      acceptsDelegation: false,
    });
    expect(deepAgents).toMatchObject({
      id: "deepagents-code",
      status: "READY",
      usageCapabilities: {
        interactive: true,
        canDelegate: true,
        acceptsDelegation: false,
      },
    });
    expect(claudeCode).toMatchObject({
      source: "BUILT_IN",
      status: "COMING_SOON",
      usageCapabilities: { acceptsDelegation: false },
    });
    expect(
      snapshot.agents.filter((agent) => agent.integrationType === "a2a"),
    ).toHaveLength(16);
    expect(
      snapshot.agents.some(
        (agent) => agent.id === "openclaw-incident-investigator",
      ),
    ).toBe(false);
    expect(
      snapshot.agents.filter(
        (agent) => agent.configuration.catalogKind === "EXAMPLE_BLUEPRINT",
      ),
    ).toHaveLength(12);
    await expect(
      service.store.getAgent("adk-customer-service"),
    ).resolves.toMatchObject({
      name: "Customer Service",
      source: "BUILT_IN",
      platformLabel: "ADK",
    });

    await service.snapshot();
    await expect(service.store.listAgents()).resolves.toHaveLength(16);
    await expect(
      service.store.ownerUserId("adk-customer-service"),
    ).resolves.toBeUndefined();
  });

  it("instantiates a callable built-in demo in an observable Kubernetes runtime", async () => {
    const projectStore = createTestStore();
    await projectStore.save(
      coordinator("deepagents-coordinator", "deepagents"),
      "local-admin",
    );
    await projectStore.database().projectRuntimeTarget.create({
      data: {
        projectId: projectStore.projectId,
        clusterId: "in-cluster",
        namespace: "tp-abcdefghijklm",
        status: "ready",
      },
    });
    const runtime: ManagedAgentRuntimeClient = {
      onboard: vi.fn(async (input) => ({
        endpoint: `http://managed.${input.namespace}.svc.cluster.local:3000`,
        agentCardUrl: `http://managed.${input.namespace}.svc.cluster.local:3000/.well-known/agent-card.json`,
        deploymentName: "tali-a2a-managed",
        serviceName: "tali-a2a-managed",
        podName: "tali-a2a-managed-76d8d9f4d9-h7k2p",
        namespace: input.namespace,
        imageReference: input.image,
        imageDigest: "ghcr.io/tasklattice/demo-test@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      })),
      remove: vi.fn(async () => undefined),
    };
    let discoveryAttempts = 0;
    const discovery: AgentDiscoveryClient = {
      discover: vi.fn(async (agent) => {
        discoveryAttempts += 1;
        if (discoveryAttempts === 1) {
          throw new Error("The operation was aborted due to timeout");
        }
        return {
          endpoint: agent.endpoint!,
          agentCardUrl: agent.agentCardUrl!,
          a2a: a2aProfile,
          skills: agent.skills,
        };
      }),
    };
    const service = new AgentGardenService(
      new AgentGardenStore(projectStore.projectId, projectStore.database()),
      projectStore,
      discovery,
      undefined,
      runtime,
    );

    await service.snapshot();
    const managedCatalogAgent = await service.store.getAgent(
      "a2a-github-daily-triage",
    );
    if (!managedCatalogAgent) throw new Error("Managed catalog Agent was not seeded.");
    const externalConfiguration = { ...managedCatalogAgent.configuration };
    delete externalConfiguration.onboardingSource;
    await service.store.saveAgent({
      ...managedCatalogAgent,
      configuration: externalConfiguration,
    });
    const previousExternal = await service.instantiate(
      "a2a-github-daily-triage",
      "local-admin",
    );
    expect(previousExternal.runtime).toBe("external");
    await service.store.saveAgent(managedCatalogAgent);

    const instance = await service.instantiate(
      "a2a-github-daily-triage",
      "local-admin",
    );
    expect(instance.id).toBe(previousExternal.id);
    expect(instance).toMatchObject({
      agentId: "a2a-github-daily-triage",
      runtime: "kubernetes",
      status: "READY",
      runtimeNamespace: "tp-abcdefghijklm",
      deploymentName: "tali-a2a-managed",
      podName: "tali-a2a-managed-76d8d9f4d9-h7k2p",
      imageDigest: expect.stringContaining("demo-test@sha256:"),
    });
    expect(runtime.onboard).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "a2a-github-daily-triage",
      image: "ghcr.io/tasklattice/demo-test:dev",
      args: ["a2a", "a2a-github-daily-triage"],
    }));
    expect(discovery.discover).toHaveBeenCalledTimes(2);
    await expect(
      projectStore.database().agentRecord.findUniqueOrThrow({
        where: {
          projectId_id: {
            projectId: projectStore.projectId,
            id: "deepagents-coordinator",
          },
        },
        select: { kind: true },
      }),
    ).resolves.toEqual({ kind: "SUPERVISOR" });

    const snapshot = await service.snapshot();
    expect(
      snapshot.agents.filter((agent) => agent.id === "a2a-github-daily-triage"),
    ).toHaveLength(1);
    await expect(service.removeInstance(instance.id)).resolves.toBe(true);
    expect(runtime.remove).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "a2a-github-daily-triage",
      instanceId: instance.id,
      namespace: "tp-abcdefghijklm",
    }));
    await expect(service.remove("a2a-github-daily-triage")).rejects.toThrow(
      "managed by TaskLattice Relay",
    );
  });

  it("instantiates a database-seeded example blueprint", async () => {
    const projectStore = createTestStore();
    await projectStore.save(coordinator(), "local-admin");
    const service = new AgentGardenService(
      new AgentGardenStore(projectStore.projectId, projectStore.database()),
      projectStore,
    );

    const instance = await service.instantiate(
      "adk-customer-service",
      "local-admin",
    );

    expect(instance).toMatchObject({
      agentId: "adk-customer-service",
      runtime: "external",
      status: "READY",
    });
    await expect(
      service.store.getAgent("adk-customer-service"),
    ).resolves.toMatchObject({
      configuration: {
        catalogKind: "EXAMPLE_BLUEPRINT",
      },
    });
  });

  it("registers, discovers, and instantiates an external A2A Agent", async () => {
    const projectStore = createTestStore();
    await projectStore.save(coordinator(), "local-admin");
    const discovery: AgentDiscoveryClient = {
      discover: vi.fn(async (agent) => ({
        endpoint: "https://agents.example.com/a2a",
        agentCardUrl: "https://agents.example.com/.well-known/agent-card.json",
        a2a: a2aProfile,
        skills: [
          {
            id: "daily-repository-triage",
            name: "Daily repository triage",
            description: "Reviews the current day of repository activity.",
            tags: ["GitHub"],
          },
        ],
      })),
    };
    const secrets: SecretStore = {
      referenceFor: (projectId, resourceId) => `memory://${projectId}/${resourceId}`,
      put: vi.fn(async () => "memory://test/secret"),
      get: vi.fn(async () => "secret"),
      delete: vi.fn(async () => undefined),
    };
    const service = new AgentGardenService(
      new AgentGardenStore(projectStore.projectId, projectStore.database()),
      projectStore,
      discovery,
      secrets,
    );

    await expect(service.onboard(githubAgentInput)).rejects.toThrow(
      "owner user is required",
    );
    const agent = await service.onboard(githubAgentInput, "local-admin");
    expect(agent).toMatchObject({
      source: "PROJECT_REGISTERED",
      integrationType: "a2a",
      status: "READY",
      endpoint: "https://agents.example.com/a2a",
      a2a: a2aProfile,
      usageCapabilities: {
        interactive: false,
        canDelegate: false,
        acceptsDelegation: true,
      },
    });
    expect(agent.skills.map((skill) => skill.id)).toEqual([
      "daily-repository-triage",
    ]);
    await projectStore.database().user.create({
      data: {
        id: "other-owner",
        username: "other-owner",
        email: "other-owner@tasklattice.local",
        displayName: "Other Owner",
      },
    });
    await projectStore.database().projectMember.create({
      data: {
        projectId: projectStore.projectId,
        userId: "other-owner",
        role: "developer",
      },
    });
    await service.store.saveAgent(
      { ...agent, description: "Updated without ownership transfer." },
      "other-owner",
    );
    await expect(service.store.ownerUserId(agent.id)).resolves.toBe(
      "local-admin",
    );

    await expect(service.store.listManagedInstances()).resolves.toEqual([
      expect.objectContaining({
        agentId: agent.id,
        runtime: "external",
        status: "READY",
        endpoint: "https://agents.example.com/a2a",
      }),
    ]);
    expect(await service.remove(agent.id)).toBe(true);
    await expect(service.remove(agent.id)).resolves.toBe(false);
    await expect(service.store.listManagedInstances()).resolves.toEqual([]);
  });

  it("deploys, discovers, and removes a Container Image Agent", async () => {
    const projectStore = createTestStore();
    await projectStore.database().projectRuntimeTarget.create({
      data: {
        projectId: projectStore.projectId,
        clusterId: "in-cluster",
        namespace: "tp-abcdefghijklm",
        status: "ready",
      },
    });
    const runtime: ManagedAgentRuntimeClient = {
      onboard: vi.fn(async (input) => ({
        endpoint: `http://managed.${input.namespace}.svc.cluster.local:8080`,
        agentCardUrl: `http://managed.${input.namespace}.svc.cluster.local:8080/.well-known/agent-card.json`,
        deploymentName: "tali-a2a-managed",
        serviceName: "tali-a2a-managed",
        podName: "tali-a2a-managed-76d8d9f4d9-h7k2p",
        namespace: input.namespace,
        imageReference: input.image,
        imageDigest: "ghcr.io/acme/research-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      })),
      remove: vi.fn(async () => undefined),
    };
    const discovery: AgentDiscoveryClient = {
      discover: vi.fn(async (agent) => ({
        endpoint: agent.endpoint!,
        agentCardUrl: agent.agentCardUrl!,
        a2a: a2aProfile,
        skills: [{
          id: "research",
          name: "Research",
          description: "Researches a delegated topic.",
          tags: ["Research"],
        }],
      })),
    };
    const secrets: SecretStore = {
      referenceFor: (projectId, resourceId) => `memory://${projectId}/${resourceId}`,
      put: vi.fn(async () => "memory://test/secret"),
      get: vi.fn(async () => "secret"),
      delete: vi.fn(async () => undefined),
    };
    const service = new AgentGardenService(
      new AgentGardenStore(projectStore.projectId, projectStore.database()),
      projectStore,
      discovery,
      secrets,
      runtime,
    );

    const agent = await service.onboard(imageAgentInput, "local-admin");

    expect(agent).toMatchObject({
      platformLabel: "A2A Container",
      status: "READY",
      internalNetworkOnly: true,
      usageMode: "CALLABLE",
      configuration: {
        onboardingSource: "CONTAINER_IMAGE",
        imageReference: imageAgentInput.image,
        imageDigest: expect.stringContaining("@sha256:"),
        deploymentName: "tali-a2a-managed",
      },
    });
    expect(agent.skills.map((skill) => skill.id)).toEqual(["research"]);
    expect(runtime.onboard).toHaveBeenCalledWith(expect.objectContaining({
      agentId: agent.id,
      instanceId: agent.configuration.managedInstanceId,
      image: imageAgentInput.image,
      projectId: projectStore.projectId,
    }));
    await expect(service.store.listManagedInstances()).resolves.toEqual([
      expect.objectContaining({
        agentId: agent.id,
        id: agent.configuration.managedInstanceId,
        status: "READY",
        runtimeNamespace: "tp-abcdefghijklm",
        deploymentName: "tali-a2a-managed",
        podName: "tali-a2a-managed-76d8d9f4d9-h7k2p",
        imageDigest: expect.stringContaining("@sha256:"),
      }),
    ]);
    await expect(
      projectStore.database().agentRecord.findUniqueOrThrow({
        where: {
          projectId_id: {
            projectId: projectStore.projectId,
            id: agent.configuration.managedInstanceId!,
          },
        },
        select: { kind: true, catalogAgentId: true },
      }),
    ).resolves.toEqual({ kind: "A2A", catalogAgentId: agent.id });

    await service.discover(agent.id);
    expect(runtime.onboard).toHaveBeenLastCalledWith(expect.objectContaining({
      image: "ghcr.io/acme/research-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }));

    await expect(service.remove(agent.id)).resolves.toBe(true);
    await expect(service.remove(agent.id)).resolves.toBe(false);
    expect(runtime.remove).toHaveBeenCalledTimes(1);
    expect(runtime.remove).toHaveBeenCalledWith(expect.objectContaining({
      agentId: agent.id,
      instanceId: agent.configuration.managedInstanceId,
      projectId: projectStore.projectId,
    }));
    await expect(service.store.listManagedInstances()).resolves.toEqual([]);
  });

  it("keeps a failed Container Image onboarding visible for retry", async () => {
    const projectStore = createTestStore();
    await projectStore.database().projectRuntimeTarget.create({
      data: {
        projectId: projectStore.projectId,
        clusterId: "in-cluster",
        namespace: "tp-abcdefghijklm",
        status: "ready",
      },
    });
    const runtime: ManagedAgentRuntimeClient = {
      onboard: vi.fn(async () => {
        throw new Error("ImagePullBackOff: registry authentication failed");
      }),
      remove: vi.fn(async () => undefined),
    };
    const discovery: AgentDiscoveryClient = {
      discover: vi.fn(),
    };
    const service = new AgentGardenService(
      new AgentGardenStore(projectStore.projectId, projectStore.database()),
      projectStore,
      discovery,
      undefined,
      runtime,
    );

    const agent = await service.onboard(imageAgentInput, "local-admin");

    expect(agent).toMatchObject({
      status: "UNAVAILABLE",
      lastDiscoveryError: "ImagePullBackOff: registry authentication failed",
    });
    expect(discovery.discover).not.toHaveBeenCalled();
    await expect(service.store.getAgent(agent.id)).resolves.toMatchObject({
      status: "UNAVAILABLE",
    });
    await expect(service.store.listManagedInstances()).resolves.toEqual([
      expect.objectContaining({
        agentId: agent.id,
        id: agent.configuration.managedInstanceId,
        status: "FAILED",
        error: "ImagePullBackOff: registry authentication failed",
      }),
    ]);
  });

  it("rejects Repository onboarding until the isolated builder is enabled", async () => {
    const projectStore = createTestStore();
    const service = new AgentGardenService(
      new AgentGardenStore(projectStore.projectId, projectStore.database()),
      projectStore,
    );

    await expect(service.onboard({
      sourceType: "git-repository",
      name: "Repository Agent",
      description: "Builds and runs the Agent from a Git repository.",
      category: "Developer Tools",
      owner: "Developer Experience",
      tags: [],
      usageMode: "CALLABLE",
      repositoryUrl: "https://github.com/acme/repository-agent",
      revision: "main",
      contextDir: ".",
      dockerfile: "Dockerfile",
      containerPort: 8_080,
      agentCardPath: "/.well-known/agent-card.json",
    }, "local-admin")).rejects.toThrow("not enabled yet");
  });
});
