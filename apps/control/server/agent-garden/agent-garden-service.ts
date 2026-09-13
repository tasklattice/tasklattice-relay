import { randomUUID } from "node:crypto";
import {
  agentGardenEntrySchema,
  a2aAgentInstanceSchema,
  expertAgentRuntimeEnvelopeSchema,
  expertAgentVersionManifestSchema,
  expertAgentVersionSnapshotSchema,
  onboardAgentSchema,
  onboardContainerImageAgentSchema,
  projectAgentRuntimeInstanceSchema,
  type A2aAgentInstance,
  type AgentGardenEntry,
  type AgentGardenSnapshot,
  type OnboardAgentInput,
  type OnboardContainerImageAgentInput,
  type OnboardExistingAgentInput,
  type ProjectAgentRuntimeInstance,
} from "@tali/contracts";
import { getControlConfig } from "../config/control-config";
import { Prisma } from "../generated/prisma/client";
import {
  createExpertAgentRuntimeClient,
  type ExpertAgentRuntimeClient,
} from "../kubernetes/expert-agent-runtime-client";
import {
  createManagedAgentRuntimeClient,
  managedAgentResourceName,
  type ManagedAgentRuntimeClient,
  type ManagedAgentRuntimeResult,
} from "../kubernetes/managed-agent-runtime-client";
import { ProjectStore } from "../projects/project-store";
import {
  deriveProjectRuntimeExpertAgentA2aToken,
  signProjectRuntimeExpertAgentToken,
} from "../runtime-bridge/project-runtime-bridge-token";
import { createSecretStore, type SecretStore } from "../secrets/secret-store";
import {
  HttpAgentDiscoveryClient,
  type AgentDiscoveryClient,
} from "./agent-discovery";
import { AgentGardenStore } from "./agent-garden-store";
import { builtInAgentCatalog } from "./built-in-agent-catalog";
import { databaseAgentCatalog } from "./database-agent-catalog";

function resourceId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-$/, "") || "agent";
  return `${slug}-${randomUUID().slice(0, 8)}`;
}

function safeError(error: unknown): string {
  return (
    error instanceof Error ? error.message : String(error)
  ).slice(0, 4_000);
}

function usageCapabilities(
  mode: AgentGardenEntry["usageMode"],
): AgentGardenEntry["usageCapabilities"] {
  return {
    interactive: mode !== "CALLABLE",
    canDelegate: false,
    acceptsDelegation: mode !== "INTERACTIVE",
  };
}

function developedSkillId(value: string, index: number): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
  return slug || `capability-${index + 1}`;
}

const CONTAINER_IMAGE_SOURCE = "CONTAINER_IMAGE";
const EXISTING_AGENT_SOURCE = "EXISTING_AGENT";
const MANAGED_DISCOVERY_ATTEMPTS = 3;
const MANAGED_DISCOVERY_RETRY_DELAY_MS = 250;

function transientDiscoveryFailure(error: unknown): boolean {
  const message = safeError(error).toLowerCase();
  return error instanceof TypeError
    || message.includes("timeout")
    || message.includes("fetch failed")
    || /http (408|429|502|503|504)\b/.test(message);
}

function configurationList(value: string | undefined): string[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("Stored Agent container command configuration is invalid.");
  }
  return parsed;
}

function containerInputFromAgent(
  agent: AgentGardenEntry,
): OnboardContainerImageAgentInput {
  return onboardContainerImageAgentSchema.parse({
    sourceType: "container-image",
    name: agent.name,
    description: agent.description,
    category: agent.category,
    owner: agent.owner,
    tags: agent.tags,
    usageMode: "CALLABLE",
    image:
      agent.configuration.imageDigest
      ?? agent.configuration.imageReference,
    containerPort: Number(agent.configuration.containerPort),
    agentCardPath: agent.configuration.agentCardPath,
    imagePullSecretName: agent.configuration.imagePullSecretName ?? "",
    command: configurationList(agent.configuration.command),
    args: configurationList(agent.configuration.args),
  });
}

function managedConfiguration(
  input: OnboardContainerImageAgentInput,
  instanceId: string,
  runtime?: ManagedAgentRuntimeResult,
  imageReference = input.image,
): Record<string, string> {
  return {
    onboardingSource: CONTAINER_IMAGE_SOURCE,
    managedInstanceId: instanceId,
    imageReference,
    containerPort: String(input.containerPort),
    agentCardPath: input.agentCardPath,
    imagePullSecretName: input.imagePullSecretName,
    command: JSON.stringify(input.command),
    args: JSON.stringify(input.args),
    ...(runtime
      ? {
          imageDigest: runtime.imageDigest,
          runtimeNamespace: runtime.namespace,
          deploymentName: runtime.deploymentName,
          podName: runtime.podName,
          serviceName: runtime.serviceName,
        }
      : {}),
  };
}

function appendLifecycleLog(
  logs: readonly string[] | undefined,
  message: string,
): string[] {
  return logs?.at(-1) === message ? [...logs] : [...(logs ?? []), message];
}

function managedInstance(
  agent: AgentGardenEntry,
  input: OnboardContainerImageAgentInput,
  instanceId: string,
  namespace: string,
  previous?: A2aAgentInstance,
  runtime?: ManagedAgentRuntimeResult,
  discovery?: {
    a2a: AgentGardenEntry["a2a"];
    endpoint: string;
    agentCardUrl: string;
    skills: AgentGardenEntry["skills"];
  },
  failure?: string,
): A2aAgentInstance {
  const now = new Date().toISOString();
  const resourceName = managedAgentResourceName(instanceId);
  const status = failure ? "FAILED" : discovery ? "READY" : "PROVISIONING";
  const lifecycleMessage = failure
    ? `Managed A2A Instance failed: ${failure}`
    : discovery
      ? `A2A Agent Card validated. Pod ${runtime?.podName ?? previous?.podName ?? resourceName} is ready.`
      : `Provisioning ${resourceName} in Project Main Space ${namespace}.`;
  return a2aAgentInstanceSchema.parse({
    id: instanceId,
    agentId: agent.id,
    kind: "A2A",
    name: agent.name,
    description: agent.description,
    runtime: "kubernetes",
    status,
    provisioningStage: discovery ? "READY" : runtime ? "ENDPOINT" : "POD",
    runtimeNamespace: namespace,
    deploymentName: runtime?.deploymentName ?? previous?.deploymentName ?? resourceName,
    serviceName: runtime?.serviceName ?? previous?.serviceName ?? resourceName,
    podName: runtime?.podName ?? previous?.podName ?? null,
    labelSelector: `app.kubernetes.io/instance=${resourceName}`,
    imageReference:
      agent.configuration.imageReference ?? previous?.imageReference ?? input.image,
    imageDigest: runtime?.imageDigest ?? previous?.imageDigest ?? null,
    endpoint: discovery?.endpoint ?? runtime?.endpoint ?? previous?.endpoint ?? null,
    agentCardUrl:
      discovery?.agentCardUrl
      ?? runtime?.agentCardUrl
      ?? previous?.agentCardUrl
      ?? null,
    a2a: discovery?.a2a ?? previous?.a2a ?? null,
    skills: discovery?.skills ?? previous?.skills ?? [],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    logs: appendLifecycleLog(previous?.logs, lifecycleMessage),
    error: failure ?? null,
  });
}

function externalInstance(
  agent: AgentGardenEntry,
  instanceId: string,
  previous?: A2aAgentInstance,
  failure?: string,
): A2aAgentInstance {
  const now = new Date().toISOString();
  const ready = !failure
    && agent.status === "READY"
    && Boolean(agent.endpoint)
    && Boolean(agent.agentCardUrl)
    && Boolean(agent.a2a);
  return a2aAgentInstanceSchema.parse({
    id: instanceId,
    agentId: agent.id,
    kind: "A2A",
    name: agent.name,
    description: agent.description,
    runtime: "external",
    status: failure || !ready ? "FAILED" : "READY",
    provisioningStage: ready ? "READY" : "ENDPOINT",
    runtimeNamespace: null,
    deploymentName: null,
    serviceName: null,
    podName: null,
    labelSelector: null,
    imageReference: null,
    imageDigest: null,
    endpoint: agent.endpoint ?? previous?.endpoint ?? null,
    agentCardUrl: agent.agentCardUrl ?? previous?.agentCardUrl ?? null,
    a2a: agent.a2a ?? previous?.a2a ?? null,
    skills: agent.skills.length ? agent.skills : previous?.skills ?? [],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    logs: appendLifecycleLog(
      previous?.logs,
      failure
        ? `External A2A Instance discovery failed: ${failure}`
        : "A2A Agent Card validated. The external runtime is available through the Project Runtime Bridge.",
    ),
    error: failure ?? null,
  });
}

export class AgentGardenService {
  constructor(
    readonly store = new AgentGardenStore(),
    readonly projects = new ProjectStore(
      store.projectId,
      store.database(),
    ),
    readonly discovery: AgentDiscoveryClient = new HttpAgentDiscoveryClient(),
    readonly secrets: SecretStore = createSecretStore(),
    readonly runtime: ManagedAgentRuntimeClient = createManagedAgentRuntimeClient(),
    readonly expertRuntime: ExpertAgentRuntimeClient = createExpertAgentRuntimeClient(),
  ) {}

  async snapshot(ownerUserId?: string): Promise<AgentGardenSnapshot> {
    const [, managedInstances, developedInstances, developedAgents] = await Promise.all([
      this.store.ensureAgents(databaseAgentCatalog),
      this.store.listManagedInstances(ownerUserId),
      this.store.listProjectAgentInstances(ownerUserId),
      this.developedAgents(ownerUserId),
    ]);
    const persistedAgents = await this.store.listAgents(ownerUserId);
    const builtInIds = new Set(
      builtInAgentCatalog.map((agent) => agent.id),
    );
    const databaseIds = new Set(
      databaseAgentCatalog.map((agent) => agent.id),
    );
    const persistedById = new Map(
      persistedAgents.map((agent) => [agent.id, agent]),
    );
    return {
      agents: [
        ...builtInAgentCatalog,
        ...databaseAgentCatalog.map(
          (agent) => persistedById.get(agent.id) ?? agent,
        ),
        ...persistedAgents.filter(
          (agent) =>
            !builtInIds.has(agent.id) &&
            !databaseIds.has(agent.id),
        ),
        ...developedAgents,
      ],
      instances: [...managedInstances, ...developedInstances],
    };
  }

  private async developedAgents(_ownerUserId?: string): Promise<AgentGardenEntry[]> {
    const database = this.store.database();
    const agents = await database.expertAgentRecord.findMany({
      where: {
        projectId: this.store.projectId,
        deletedAt: null,
        latestReleasedVersionId: { not: null },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      include: {
        creator: { include: { user: { select: { displayName: true } } } },
        latestReleasedVersion: true,
        versions: {
          where: { gardenStatus: "PUBLISHED" },
          orderBy: { versionNumber: "desc" },
          include: {
            _count: {
              select: { runtimeInstances: { where: { deletedAt: null } } },
            },
          },
        },
      },
    });

    return agents.flatMap((agent) => {
      const latest = agent.latestReleasedVersion;
      if (!latest || latest.gardenStatus !== "PUBLISHED" || !agent.versions.length) return [];
      const product = expertAgentVersionSnapshotSchema.parse(latest.snapshot).product;
      return agentGardenEntrySchema.parse({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        source: "PROJECT_DEVELOPED",
        integrationType: "a2a",
        platformLabel: "A2A Agent",
        category: "Developed Agent",
        owner: agent.creator.user.displayName,
        tags: ["A2A", "Developed", agent.executionMode],
        status: "READY",
        usageMode: "CALLABLE",
        usageCapabilities: {
          interactive: false,
          canDelegate: false,
          acceptsDelegation: true,
        },
        endpoint: null,
        agentCardUrl: null,
        a2a: null,
        authType: "none",
        authReference: "",
        internalNetworkOnly: true,
        distribution: {
          type: "VERSION_BUNDLE",
          agentId: agent.id,
          defaultVersionId: latest.id,
          versions: agent.versions.map((version) => ({
            id: version.id,
            versionNumber: version.versionNumber,
            contentDigest: version.contentDigest,
            manifestDigest: version.manifestDigest,
            artifactSetDigest: version.artifactSetDigest,
            publishedAt: version.publishedAt.toISOString(),
            instanceCount: version._count.runtimeInstances,
          })),
        },
        configuration: {
          lifecycle: "PUBLISHED",
          currentVersion: `v${latest.versionNumber}`,
          executionMode: agent.executionMode,
        },
        skills: product.capabilities.map((capability, index) => ({
          id: developedSkillId(capability, index),
          name: capability,
          description: "Declared by the Agent product contract.",
          tags: [],
        })),
        specializationId: null,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
        lastDiscoveredAt: null,
        lastDiscoveryError: null,
      });
    });
  }

  private async instantiateDevelopedAgent(
    gardenAgent: AgentGardenEntry,
    ownerUserId: string,
    requestedVersionId?: string,
  ): Promise<ProjectAgentRuntimeInstance> {
    const bundle = gardenAgent.distribution;
    if (!bundle || bundle.type !== "VERSION_BUNDLE") {
      throw new Error("The Agent Garden entry has no releasable Version bundle.");
    }
    const versionId = requestedVersionId ?? bundle.defaultVersionId;
    if (!bundle.versions.some((version) => version.id === versionId)) {
      throw new Error("The selected Version is not published in Agent Garden.");
    }
    const database = this.store.database();
    const [version, target, project, creator] = await Promise.all([
      database.expertAgentVersionRecord.findFirst({
        where: {
          projectId: this.store.projectId,
          id: versionId,
          agentId: bundle.agentId,
          gardenStatus: "PUBLISHED",
          agent: { deletedAt: null },
        },
        include: { agent: true },
      }),
      this.requireRuntimeTarget(),
      database.project.findUnique({
        where: { id: this.store.projectId },
        select: { name: true },
      }),
      database.user.findUnique({
        where: { id: ownerUserId },
        select: { id: true, displayName: true, username: true },
      }),
    ]);
    if (!version || !project || !creator) {
      throw new Error("The selected Agent Version cannot be materialized.");
    }

    const snapshot = expertAgentVersionSnapshotSchema.parse(version.snapshot);
    const manifest = expertAgentVersionManifestSchema.parse(version.manifest);
    const envelope = expertAgentRuntimeEnvelopeSchema.parse({
      versionId: version.id,
      versionNumber: version.versionNumber,
      contentDigest: version.contentDigest,
      snapshot,
      manifest,
    });
    const instanceId = randomUUID();
    const now = new Date().toISOString();
    const createdBy = {
      id: creator.id,
      displayName: creator.displayName,
      username: creator.username ?? creator.displayName,
    };
    const base = projectAgentRuntimeInstanceSchema.parse({
      id: instanceId,
      agentId: version.agentId,
      developedAgentId: version.agentId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      contentDigest: version.contentDigest,
      kind: "PROJECT_AGENT",
      name: snapshot.product.name,
      description: snapshot.product.purpose,
      runtime: "kubernetes",
      status: "PROVISIONING",
      provisioningStage: "RUNTIME",
      runtimeNamespace: target.namespace,
      deploymentName: null,
      serviceName: null,
      podName: null,
      labelSelector: null,
      imageReference: null,
      imageDigest: null,
      endpoint: null,
      agentCardUrl: null,
      a2a: null,
      skills: gardenAgent.skills,
      createdBy,
      createdAt: now,
      updatedAt: now,
      logs: [`Creating Instance from v${version.versionNumber}.`],
      error: null,
    });
    const payload = (value: ProjectAgentRuntimeInstance): Prisma.InputJsonValue => {
      const { createdBy: _createdBy, ...stored } = value;
      return JSON.parse(JSON.stringify(stored)) as Prisma.InputJsonValue;
    };
    await database.agentRecord.create({
      data: {
        projectId: this.store.projectId,
        id: instanceId,
        kind: "PROJECT_AGENT",
        developedAgentId: version.agentId,
        agentVersionId: version.id,
        ownerUserId,
        createdByUserId: ownerUserId,
        payload: payload(base),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    });

    const identity = {
      projectId: this.store.projectId,
      namespace: target.namespace,
      agentId: version.agentId,
      versionId: version.id,
      contentDigest: version.contentDigest,
    };
    try {
      const secret = getControlConfig().auth.secret;
      const runtime = await this.expertRuntime.activate({
        projectId: this.store.projectId,
        projectName: project.name,
        namespace: target.namespace,
        instanceId,
        agentId: version.agentId,
        agentName: snapshot.product.name,
        envelope,
        runtimeToken: signProjectRuntimeExpertAgentToken({
          ...identity,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000).toISOString(),
        }, secret),
        a2aBearerToken: deriveProjectRuntimeExpertAgentA2aToken(identity, secret),
      });
      const endpointRoot = runtime.endpoint.replace(/\/a2a\/?$/, "");
      const ready = projectAgentRuntimeInstanceSchema.parse({
        ...base,
        status: "READY",
        provisioningStage: "READY",
        deploymentName: runtime.resourceName,
        serviceName: runtime.resourceName,
        labelSelector: `app.kubernetes.io/instance=${runtime.resourceName}`,
        endpoint: runtime.endpoint,
        agentCardUrl: `${endpointRoot}/.well-known/agent-card.json`,
        a2a: {
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
          tenant: this.store.projectId,
          streaming: false,
          pushNotifications: false,
          extendedAgentCard: false,
          defaultInputModes: ["text/plain", "application/json"],
          defaultOutputModes: ["text/plain", "application/json"],
        },
        updatedAt: new Date().toISOString(),
        logs: [...base.logs, `Instance is ready on v${version.versionNumber}.`],
      });
      await database.agentRecord.update({
        where: { projectId_id: { projectId: this.store.projectId, id: instanceId } },
        data: { payload: payload(ready) },
      });
      return ready;
    } catch (error) {
      const failed = projectAgentRuntimeInstanceSchema.parse({
        ...base,
        status: "FAILED",
        updatedAt: new Date().toISOString(),
        logs: [...base.logs, "Instance creation failed."],
        error: safeError(error),
      });
      await database.agentRecord.update({
        where: { projectId_id: { projectId: this.store.projectId, id: instanceId } },
        data: { payload: payload(failed) },
      });
      return failed;
    }
  }

  private async onboardExisting(
    input: OnboardExistingAgentInput,
    ownerUserId?: string,
  ): Promise<AgentGardenEntry> {
    const now = new Date().toISOString();
    const agent = agentGardenEntrySchema.parse({
      id: resourceId(input.name),
      name: input.name,
      description: input.description,
      source: "PROJECT_REGISTERED",
      integrationType: "a2a",
      platformLabel: "A2A Standard",
      category: input.category,
      owner: input.owner,
      tags: input.tags,
      status: "UNCHECKED",
      usageMode: "CALLABLE",
      usageCapabilities: usageCapabilities("CALLABLE"),
      endpoint: null,
      agentCardUrl: input.agentCardUrl,
      a2a: null,
      authType: input.authType,
      authReference: input.authReference,
      internalNetworkOnly: input.internalNetworkOnly,
      configuration: { onboardingSource: EXISTING_AGENT_SOURCE },
      skills: [],
      specializationId: null,
      createdAt: now,
      updatedAt: now,
      lastDiscoveredAt: null,
      lastDiscoveryError: null,
    });
    await this.store.saveAgent(agent, ownerUserId);
    return this.discover(agent.id, ownerUserId);
  }

  async instantiate(
    id: string,
    ownerUserId?: string,
    versionId?: string,
  ): Promise<A2aAgentInstance | ProjectAgentRuntimeInstance> {
    if (!ownerUserId) {
      throw new Error("An owner user is required when creating an A2A Instance.");
    }
    const agent = await this.requireCallableAgent(id);
    if (agent.status !== "READY") {
      throw new Error("Only a READY Agent can be instantiated.");
    }
    if (!agent.usageCapabilities.acceptsDelegation) {
      throw new Error("This Agent does not accept delegated tasks.");
    }
    if (agent.source === "PROJECT_DEVELOPED") {
      return this.instantiateDevelopedAgent(agent, ownerUserId, versionId);
    }
    if (!agent.endpoint || !agent.agentCardUrl || !agent.a2a) {
      throw new Error("A validated A2A Agent Card is required before creating an Instance.");
    }
    const managedCatalogAgent =
      agent.source === "BUILT_IN"
      && agent.configuration.onboardingSource === CONTAINER_IMAGE_SOURCE;
    const existing = await this.store.getManagedInstanceForAgent(agent.id);
    if (managedCatalogAgent) {
      return this.instantiateManagedCatalogAgent(agent, ownerUserId, existing);
    }
    if (existing) return existing;
    return this.store.saveManagedInstance(
      externalInstance(agent, randomUUID()),
      ownerUserId,
    );
  }

  async onboard(
    rawInput: OnboardAgentInput,
    ownerUserId?: string,
  ): Promise<AgentGardenEntry> {
    const input = onboardAgentSchema.parse(rawInput);
    if (input.sourceType === "git-repository") {
      throw new Error(
        "Git Repository onboarding is not enabled yet. Build and publish the repository as an OCI image, then use Container Image onboarding.",
      );
    }
    if (input.sourceType === "existing-agent") {
      return this.onboardExisting(input, ownerUserId);
    }

    const now = new Date().toISOString();
    const instanceId = randomUUID();
    const agent = agentGardenEntrySchema.parse({
      id: resourceId(input.name),
      name: input.name,
      description: input.description,
      source: "PROJECT_REGISTERED",
      integrationType: "a2a",
      platformLabel: "A2A Container",
      category: input.category,
      owner: input.owner,
      tags: input.tags,
      status: "UNCHECKED",
      usageMode: "CALLABLE",
      usageCapabilities: usageCapabilities("CALLABLE"),
      endpoint: null,
      agentCardUrl: null,
      a2a: null,
      authType: "none",
      authReference: "",
      internalNetworkOnly: true,
      configuration: managedConfiguration(input, instanceId),
      skills: [],
      specializationId: null,
      createdAt: now,
      updatedAt: now,
      lastDiscoveredAt: null,
      lastDiscoveryError: null,
    });
    await this.store.saveAgent(agent, ownerUserId);
    return this.discover(agent.id);
  }

  async discover(
    id: string,
    ownerUserId?: string,
  ): Promise<AgentGardenEntry> {
    const current = await this.requireProjectRegisteredAgent(id);
    let checking = await this.store.saveAgent({
      ...current,
      status: "UNCHECKED",
      updatedAt: new Date().toISOString(),
      lastDiscoveryError: null,
    });
    let runtimeInstance: A2aAgentInstance | undefined;
    let runtimeResult: ManagedAgentRuntimeResult | undefined;
    try {
      if (checking.configuration.onboardingSource === CONTAINER_IMAGE_SOURCE) {
        const input = containerInputFromAgent(checking);
        const target = await this.requireRuntimeTarget();
        const instanceId = checking.configuration.managedInstanceId || randomUUID();
        if (!checking.configuration.managedInstanceId) {
          checking = await this.store.saveAgent({
            ...checking,
            configuration: managedConfiguration(
              input,
              instanceId,
              undefined,
              checking.configuration.imageReference ?? input.image,
            ),
            updatedAt: new Date().toISOString(),
          });
        }
        const ownerUserId = await this.store.ownerUserId(checking.id);
        if (!ownerUserId) {
          throw new Error("Managed A2A Instance ownership could not be resolved.");
        }
        const previous = await this.store.getManagedInstanceForAgent(checking.id);
        runtimeInstance = managedInstance(
          checking,
          input,
          instanceId,
          target.namespace,
          previous,
        );
        await this.store.saveManagedInstance(runtimeInstance, ownerUserId);
        const runtime = await this.runtime.onboard({
          ...input,
          agentId: checking.id,
          instanceId,
          namespace: target.namespace,
          projectId: this.store.projectId,
        });
        runtimeResult = runtime;
        runtimeInstance = managedInstance(
          checking,
          input,
          instanceId,
          target.namespace,
          runtimeInstance,
          runtime,
        );
        await this.store.saveManagedInstance(runtimeInstance);
        checking = await this.store.saveAgent({
          ...checking,
          endpoint: runtime.endpoint,
          agentCardUrl: runtime.agentCardUrl,
          configuration: managedConfiguration(
            input,
            instanceId,
            runtime,
            checking.configuration.imageReference ?? input.image,
          ),
          updatedAt: new Date().toISOString(),
        });
      }
      const credential = checking.authReference
        ? await this.secrets.get(checking.authReference)
        : undefined;
      const result = runtimeResult
        ? await this.discoverManagedAgent(checking, credential)
        : await this.discovery.discover(checking, credential);
      const ready = await this.store.saveAgent({
        ...checking,
        endpoint: result.endpoint,
        agentCardUrl: result.agentCardUrl,
        a2a: result.a2a,
        skills: result.skills,
        status: "READY",
        updatedAt: new Date().toISOString(),
        lastDiscoveredAt: new Date().toISOString(),
        lastDiscoveryError: null,
      });
      if (runtimeInstance) {
        const input = containerInputFromAgent(ready);
        const target = await this.requireRuntimeTarget();
        const instanceId = ready.configuration.managedInstanceId;
        if (!instanceId) {
          throw new Error("Managed A2A Instance identifier was not persisted.");
        }
        await this.store.saveManagedInstance(managedInstance(
          ready,
          input,
          instanceId,
          target.namespace,
          runtimeInstance,
          runtimeResult,
          result,
        ));
      } else if (checking.configuration.onboardingSource === EXISTING_AGENT_SOURCE) {
        const previous = await this.store.getManagedInstanceForAgent(ready.id);
        if (previous || ownerUserId) {
          await this.store.saveManagedInstance(
            externalInstance(ready, previous?.id ?? randomUUID(), previous),
            previous ? undefined : ownerUserId,
          );
        }
      }
      return ready;
    } catch (error) {
      const message = safeError(error);
      if (runtimeInstance) {
        const input = containerInputFromAgent(checking);
        if (!runtimeInstance.runtimeNamespace) {
          throw new Error("Managed A2A Instance Runtime Namespace is missing.");
        }
        await this.store.saveManagedInstance(managedInstance(
          checking,
          input,
          runtimeInstance.id,
          runtimeInstance.runtimeNamespace,
          runtimeInstance,
          undefined,
          undefined,
          message,
        ));
      } else if (checking.configuration.onboardingSource === EXISTING_AGENT_SOURCE) {
        const previous = await this.store.getManagedInstanceForAgent(checking.id);
        if (previous) {
          await this.store.saveManagedInstance(
            externalInstance(checking, previous.id, previous, message),
          );
        }
      }
      return this.store.saveAgent({
        ...checking,
        status: "UNAVAILABLE",
        updatedAt: new Date().toISOString(),
        lastDiscoveryError: message,
      });
    }
  }

  async remove(id: string): Promise<boolean> {
    const agent = await this.requireProjectRegisteredAgent(id);
    if (agent.configuration.onboardingSource === CONTAINER_IMAGE_SOURCE) {
      const target = await this.requireRuntimeTarget();
      const instance = await this.store.getManagedInstanceForAgent(agent.id);
      const instanceId = instance?.id ?? agent.configuration.managedInstanceId;
      if (!instanceId) {
        throw new Error(
          "Managed A2A Instance metadata is missing. Reconcile the Agent before removal.",
        );
      }
      await this.runtime.remove({
        agentId: agent.id,
        instanceId,
        namespace: target.namespace,
        projectId: this.store.projectId,
      });
      await this.store.deleteManagedInstanceForAgent(agent.id);
    } else {
      await this.store.deleteManagedInstanceForAgent(agent.id);
    }
    return this.store.deleteAgent(id);
  }

  async removeInstance(id: string): Promise<boolean> {
    const instance = await this.store.getManagedInstance(id);
    if (!instance) {
      const database = this.store.database();
      const projectAgent = await database.agentRecord.findFirst({
        where: {
          projectId: this.store.projectId,
          id,
          kind: "PROJECT_AGENT",
          deletedAt: null,
        },
        select: { payload: true },
      });
      if (!projectAgent) return false;
      const stored = projectAgent.payload as Record<string, unknown>;
      const namespace = typeof stored.runtimeNamespace === "string"
        ? stored.runtimeNamespace
        : null;
      if (namespace) {
        await this.expertRuntime.deactivate({ namespace, instanceId: id });
      }
      const removedAt = new Date();
      const logs = Array.isArray(stored.logs)
        ? stored.logs.filter((item): item is string => typeof item === "string")
        : [];
      const removed = await database.agentRecord.updateMany({
        where: {
          projectId: this.store.projectId,
          id,
          kind: "PROJECT_AGENT",
          deletedAt: null,
        },
        data: {
          deletedAt: removedAt,
          updatedAt: removedAt,
          payload: {
            ...stored,
            status: "DESTROYING",
            updatedAt: removedAt.toISOString(),
            logs: [...logs, "Instance runtime removed."].slice(-100),
          } as Prisma.InputJsonValue,
        },
      });
      return removed.count === 1;
    }
    if (instance.runtime !== "external") {
      const agent = await this.store.getAgent(instance.agentId);
      if (agent?.source !== "BUILT_IN") {
        throw new Error(
          "Remove the managed Agent definition to delete its Kubernetes runtime.",
        );
      }
      if (!instance.runtimeNamespace) {
        throw new Error("Managed A2A Instance Runtime Namespace is missing.");
      }
      await this.runtime.remove({
        agentId: instance.agentId,
        instanceId: instance.id,
        namespace: instance.runtimeNamespace,
        projectId: this.store.projectId,
      });
    }
    return this.store.deleteManagedInstance(id);
  }

  private async instantiateManagedCatalogAgent(
    agent: AgentGardenEntry,
    ownerUserId: string,
    previous?: A2aAgentInstance,
  ): Promise<A2aAgentInstance> {
    const input = containerInputFromAgent(agent);
    const target = await this.requireRuntimeTarget();
    const instanceId = previous?.id ?? randomUUID();
    let instance = managedInstance(
      agent,
      input,
      instanceId,
      target.namespace,
      previous,
    );
    await this.store.saveManagedInstance(
      instance,
      previous ? undefined : ownerUserId,
    );
    try {
      const runtime = await this.runtime.onboard({
        ...input,
        agentId: agent.id,
        instanceId,
        namespace: target.namespace,
        projectId: this.store.projectId,
      });
      instance = managedInstance(
        agent,
        input,
        instanceId,
        target.namespace,
        instance,
        runtime,
      );
      await this.store.saveManagedInstance(instance);
      const discovery = await this.discoverManagedAgent({
        ...agent,
        endpoint: runtime.endpoint,
        agentCardUrl: runtime.agentCardUrl,
      });
      return this.store.saveManagedInstance(managedInstance(
        agent,
        input,
        instanceId,
        target.namespace,
        instance,
        runtime,
        discovery,
      ));
    } catch (error) {
      return this.store.saveManagedInstance(managedInstance(
        agent,
        input,
        instanceId,
        target.namespace,
        instance,
        undefined,
        undefined,
        safeError(error),
      ));
    }
  }

  private async requireProjectRegisteredAgent(
    id: string,
  ): Promise<AgentGardenEntry> {
    const agent = await this.store.getAgent(id);
    if (!agent) throw new Error("Registered Agent was not found.");
    if (agent.source !== "PROJECT_REGISTERED") {
      throw new Error("Built-in Agents are managed by TaskLattice Relay.");
    }
    return agent;
  }

  private async discoverManagedAgent(
    agent: AgentGardenEntry,
    credential?: string,
  ) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.discovery.discover(agent, credential);
      } catch (error) {
        if (
          attempt >= MANAGED_DISCOVERY_ATTEMPTS
          || !transientDiscoveryFailure(error)
        ) throw error;
        await new Promise((resolve) => setTimeout(
          resolve,
          MANAGED_DISCOVERY_RETRY_DELAY_MS * attempt,
        ));
      }
    }
  }

  private async requireRuntimeTarget(): Promise<{ namespace: string }> {
    const target = await this.store.database().projectRuntimeTarget.findUnique({
      where: { projectId: this.store.projectId },
      select: { namespace: true, status: true },
    });
    if (!target) {
      throw new Error(
        "This Project does not have a Runtime Namespace. Reconcile Project runtime targets before onboarding a Container Image.",
      );
    }
    if (target.status !== "ready") {
      throw new Error(
        `Project Runtime Namespace is ${target.status}. Reconcile it before onboarding a Container Image.`,
      );
    }
    return target;
  }

  private async requireCallableAgent(id: string): Promise<AgentGardenEntry> {
    const existing = await this.store.getAgent(id);
    if (existing) return existing;
    const developed = (await this.developedAgents()).find((agent) => agent.id === id);
    if (developed) return developed;
    const seeded = databaseAgentCatalog.find((candidate) => candidate.id === id);
    if (!seeded) throw new Error("Agent Garden entry was not found.");
    return this.store.saveAgent(seeded);
  }
}
