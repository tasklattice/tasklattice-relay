import { randomUUID } from "node:crypto";
import {
  defaultNativeAgentMemoryConfiguration,
  getAgentPlatformDefinition,
  hasValidatedEmbeddingModel,
  type Instance as Agent,
  type AgentMemoryConfiguration,
  type CreateInstanceInput,
  type ModelRouting,
  type RunnerSandbox,
  type SandboxAuditEvent,
} from "@tali/contracts";
import { AccessPolicyService } from "../access-policies/access-policy-service";
import { AccessPolicyStore } from "../access-policies/access-policy-store";
import { ProjectStore } from "../projects/project-store";
import {
  ResourceCatalogService,
  VectorDatabaseEmbeddingRequiredError,
} from "../catalog/resource-catalog-service";
import {
  NemoClawRunnerClient,
  type CreateSandboxInput,
  type RunnerClient,
  type RunnerRuntimeTarget,
} from "../runtime/nemoclaw-runner-client";
import {
  LiteLLMClient,
  type LiteLLMAdminClient,
  type LiteLLMInstanceServiceAccountInput,
  type LiteLLMVirtualKey,
} from "../providers/litellm-client";
import { RuntimePolicyService } from "../runtime-policies/runtime-policy-service";
import { ModelRoutingService } from "../model-routings/model-routing-service";
import { ProjectQuotaService } from "../quotas/project-quota-service";
import { signRunTelemetryToken } from "../runs/run-telemetry-token";
import { PlatformSettingsService } from "../platform/platform-settings-service";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";
import { signProjectRuntimeCoordinatorToken } from "../runtime-bridge/project-runtime-bridge-token";
import { getControlConfig } from "../config/control-config";
import {
  controlJobQueue,
  type ControlJobPublisher,
} from "../jobs/control-job-queue";
import { MemoryRepository } from "../memories/memory-repository";
import {
  MemoryService,
  type PreparedAgentMemory,
  type ResolvedAgentMemory,
} from "../memories/memory-service";
import {
  DurableMemoryEmbeddingRequiredError,
  DurableMemoryFeatureDisabledError,
  durableMemoryEnabledForProject,
} from "../memories/durable-memory-feature";
import { InstanceLifecycleOperationService } from "./instance-lifecycle-service";

export function agentSandboxName(id: string): string {
  const compactId = BigInt(`0x${id.replaceAll("-", "")}`)
    .toString(36)
    .padStart(25, "0")
    .slice(-17);
  return `i-${compactId}`;
}

export function isRunnerRuntimeTargetRoutable(target: {
  generation: number;
  observedGeneration: number;
  status: string;
}): boolean {
  return target.observedGeneration === target.generation
    && (target.status === "ready" || target.status === "reconciling");
}

export function applyObservedState(
  agent: Agent,
  observed: RunnerSandbox,
): Agent {
  const transientNotFound =
    observed.phase === "NOT_FOUND" && agent.status === "PROVISIONING";
  const status: Agent["status"] =
    observed.phase === "READY"
      ? "READY"
      : observed.phase === "FAILED"
        ? "FAILED"
        : transientNotFound
          ? "PROVISIONING"
          : observed.phase === "NOT_FOUND"
            ? "FAILED"
            : observed.phase === "DESTROYING"
              ? "DESTROYING"
              : "PROVISIONING";
  const {
    error: _previousError,
    httpEndpoint: _previousHttpEndpoint,
    ...current
  } = agent;
  return {
    ...current,
    status,
    runtimePhase: observed.phase,
    ...(observed.provisioningStage
      ? { provisioningStage: observed.provisioningStage }
      : {}),
    logs: observed.logs.length > 0 ? observed.logs : agent.logs,
    ...(observed.httpEndpoint ? { httpEndpoint: observed.httpEndpoint } : {}),
    updatedAt: new Date().toISOString(),
    ...(observed.error
      ? { error: observed.error }
      : observed.phase === "NOT_FOUND" && !transientNotFound
        ? {
            error:
              "The OpenShell Sandbox was not found while reconciling the Instance lifecycle.",
          }
        : {}),
  };
}

export class InstanceService {
  constructor(
    readonly store = new ProjectStore(),
    readonly runner: RunnerClient = new NemoClawRunnerClient(),
    readonly litellm: LiteLLMAdminClient = new LiteLLMClient(),
    readonly runtimePolicies = new RuntimePolicyService(store),
    readonly catalog = new ResourceCatalogService(store),
    readonly modelRoutings = new ModelRoutingService(store, litellm),
    readonly quotas = new ProjectQuotaService(store, litellm),
    readonly accessPolicies = new AccessPolicyService(
      new AccessPolicyStore(store.projectId, store.database()),
      store,
      litellm,
    ),
    readonly jobs: ControlJobPublisher = controlJobQueue(),
    readonly memories = new MemoryService(
      new MemoryRepository(store.projectId, store.database()),
    ),
    readonly lifecycle = new InstanceLifecycleOperationService(
      store.projectId,
      store.database(),
    ),
  ) {}

  async list(ownerUserId?: string): Promise<Agent[]> {
    return Promise.all(
      (await this.store.list(ownerUserId)).map((agent) => this.refresh(agent)),
    );
  }

  async get(id: string): Promise<Agent | undefined> {
    const agent = await this.store.get(id);
    return agent ? this.refresh(agent) : undefined;
  }

  async getAudit(id: string): Promise<SandboxAuditEvent[] | undefined> {
    const agent = await this.store.get(id);
    if (!agent) return undefined;
    const target = await this.runnerRuntimeTarget();
    return target
      ? this.runner.getSandboxAudit(agent.sandboxName, target)
      : this.runner.getSandboxAudit(agent.sandboxName);
  }

  async runnerRuntimeTarget(): Promise<RunnerRuntimeTarget | undefined> {
    if (process.env.PROJECT_OPENSHELL_TARGET_ROUTING_ENABLED !== "true") {
      return undefined;
    }
    const runtime = await loadPlatformRuntimeConfiguration(
      this.store.database(),
    );
    if (!runtime.runtimeNamespaces.enabled) return undefined;
    const target = await this.store.database().projectRuntimeTarget.findUnique({
      where: { projectId: this.store.projectId },
      select: {
        generation: true,
        namespace: true,
        observedGeneration: true,
        status: true,
      },
    });
    if (!target || !isRunnerRuntimeTargetRoutable(target)) {
      throw new Error(
        "The Project Runtime Target is not ready for Agent lifecycle operations.",
      );
    }
    return { namespace: target.namespace };
  }

  async create(
    input: CreateInstanceInput,
    ownerUserId?: string,
    creationIdempotencyKey?: string,
  ): Promise<Agent> {
    const requestKey = creationIdempotencyKey?.trim();
    if (
      requestKey
      && (!/^[A-Za-z0-9._:-]+$/.test(requestKey) || requestKey.length > 200)
    ) {
      throw new Error(
        "The Instance idempotency key must use 1-200 letters, numbers, dots, colons, underscores, or hyphens.",
      );
    }
    if (ownerUserId && requestKey) {
      const replay = await this.store.getByCreationIdempotencyKey(
        ownerUserId,
        requestKey,
      );
      if (replay) return replay;
    }
    await this.quotas.assertCanCreate("instances");
    const catalog = await this.catalog.catalog();
    const embeddingModelAvailable = hasValidatedEmbeddingModel(
      await this.store.listModelDeployments(),
    );
    if (input.knowledgeSourceIds?.length && !embeddingModelAvailable) {
      throw new VectorDatabaseEmbeddingRequiredError();
    }
    if (
      input.specializationId &&
      !catalog.specializations.some(
        (item) => item.id === input.specializationId,
      )
    )
      throw new Error(
        "Select an available Agent Role before creating an Instance.",
      );
    const references: Array<
      [string, readonly string[] | undefined, Set<string>]
    > = [
      ["Skill", input.skillIds, new Set(catalog.skills.map((item) => item.id))],
      [
        "MCP server",
        input.mcpServerIds,
        new Set(catalog.mcpServers.map((item) => item.id)),
      ],
      [
        "Vector Database",
        input.knowledgeSourceIds,
        new Set(catalog.vectorDatabases.map((item) => item.id)),
      ],
    ];
    for (const [label, ids, available] of references) {
      const missing = (ids ?? []).filter((id) => !available.has(id));
      if (missing.length)
        throw new Error(
          `${label} configuration is unavailable: ${missing.join(", ")}.`,
        );
    }
    const policy = await this.runtimePolicies.resolve(input.policyId);
    const id = randomUUID();
    const effectiveRequestKey = requestKey ?? `instance:${id}`;
    const now = new Date().toISOString();
    const sandboxName = agentSandboxName(id);
    await this.accessPolicies.assertActivePolicyIds(input.accessPolicyIds);
    const routing = await this.modelRoutings.resolver.resolve(input.modelRoutingId);
    const gateway = await this.store.getInferenceGateway(routing.gatewayId);
    if (!gateway)
      throw new Error(
        "The selected Routing LiteLLM Gateway is unavailable.",
      );
    const durableRuntime = input.agentPlatform === "openclaw"
      ? "openclaw"
      : input.agentPlatform === "hermes"
        ? "hermes"
        : undefined;
    const durableMemoryEnabled = durableMemoryEnabledForProject(
      this.store.projectId,
    );
    if (input.durableMemoryId && !durableMemoryEnabled) {
      throw new DurableMemoryFeatureDisabledError();
    }
    if (input.durableMemoryId && !durableRuntime) {
      throw new Error(
        "Durable Memory is currently available only for OpenClaw and Hermes Instances.",
      );
    }
    if (input.durableMemoryId && input.memory) {
      throw new Error(
        "Choose either Project Durable Memory or an Instance-native Memory mode.",
      );
    }
    if (input.durableMemoryId && !embeddingModelAvailable) {
      throw new DurableMemoryEmbeddingRequiredError();
    }
    const durableMemoryAvailable = durableMemoryEnabled
      && embeddingModelAvailable;
    const memoryConfiguration = input.memory
      ?? (durableRuntime && !durableMemoryAvailable
        ? defaultNativeAgentMemoryConfiguration
        : undefined);
    await this.resolveMemory(
      input.agentPlatform,
      memoryConfiguration,
      routing,
    );
    const actorId = ownerUserId ?? "memory-service";
    let resolvedMemory: ResolvedAgentMemory | undefined;
    if (durableRuntime && durableMemoryAvailable && !memoryConfiguration) {
      resolvedMemory = await this.memories.resolveForAgent({
        actorId,
        displayName: input.name,
        ...(input.durableMemoryId
          ? { existingMemoryId: input.durableMemoryId }
          : {}),
        instanceId: id,
        requestIdempotencyKey: effectiveRequestKey,
      });
    }
    const costKeyAlias = `tali-instance-${id}`;
    const serviceAccountId = `tali-instance-${id}`;
    const modelKeyRouting = await this.modelKeyRouting(routing);
    let agent: Agent = {
      schemaVersion: 2,
      id,
      ...input,
      ...(resolvedMemory ? { durableMemoryId: resolvedMemory.memory.id } : {}),
      ...(memoryConfiguration ? { memory: memoryConfiguration } : {}),
      policyId: policy.id,
      modelDeploymentId: `model-routing:${routing.id}`,
      providerAccountId: gateway.id,
      providerName: "LiteLLM managed",
      model: modelKeyRouting.runtimeModel,
      modelType: "llm",
      inferenceMode: "PLATFORM_MANAGED",
      modelRoutingId: routing.id,
      modelRoutingBindingId: `instance-selected:${routing.id}`,
      modelRoutingStatus: routing.status,
      modelRoutingComplianceDomain: routing.complianceDomain,
      modelRoutingCapabilities: routing.capabilities,
      modelRoutingKeyFingerprint: `pending:${id.slice(-12)}`,
      costKeyAlias,
      serviceAccountId,
      sandboxName,
      status: "PROVISIONING",
      provisioningStage: "QUEUED",
      createdAt: now,
      updatedAt: now,
      logs: ["Agent request accepted. Waiting for the Control Worker."],
    };
    let preparedMemory: PreparedAgentMemory | undefined;
    try {
      try {
        await this.store.save(agent, ownerUserId, requestKey);
      } catch (error) {
        if (ownerUserId && requestKey) {
          const replay = await this.store.getByCreationIdempotencyKey(
            ownerUserId,
            requestKey,
          );
          if (replay) return replay;
        }
        throw error;
      }
      if (resolvedMemory && durableRuntime) {
        const binding = await this.memories.bindToAgent({
          actorId,
          instanceId: id,
          memoryId: resolvedMemory.memory.id,
          requestIdempotencyKey: effectiveRequestKey,
          runtimeType: durableRuntime,
        });
        preparedMemory = { ...resolvedMemory, binding };
      }
      await this.store.replaceAgentAccessPolicies(id, input.accessPolicyIds);
      if (!this.jobs.enqueueInstanceLifecycle) {
        throw new Error(
          "The Control Worker queue does not support Instance lifecycle jobs.",
        );
      }
      const operation = await this.lifecycle.create(id, "provision");
      const queueJobId = await this.jobs.enqueueInstanceLifecycle({
        projectId: this.store.projectId,
        instanceId: id,
        operationId: operation.id,
        action: "provision",
      });
      if (!queueJobId) {
        throw new Error("Unable to enqueue Instance provisioning.");
      }
      await this.lifecycle.attachQueueJob(operation.id, queueJobId);
      agent = await this.store.save({
        ...agent,
        operationId: operation.id,
        logs: [...agent.logs, "Instance provisioning queued in the Control Worker."],
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (preparedMemory) {
        await this.memories.rollbackAgentPreparation(
          preparedMemory,
          actorId,
        ).catch(() => undefined);
      } else if (resolvedMemory) {
        await this.memories.rollbackAgentResolution(
          resolvedMemory,
          actorId,
        ).catch(() => undefined);
      }
      await this.store.hardDelete(id).catch(() => undefined);
      throw error;
    }
    return agent;
  }

  async provision(id: string, operationId?: string): Promise<Agent | undefined> {
    if (operationId) await this.lifecycle.start(operationId);
    let agent = await this.store.get(id);
    if (!agent || agent.status === "DESTROYING") return agent;
    if (agent.status === "READY") return agent;

    const {
      error: _previousError,
      httpEndpoint: _previousHttpEndpoint,
      ...pendingAgent
    } = agent;
    agent = await this.store.save({
      ...pendingAgent,
      status: "PROVISIONING",
      logs: [
        ...pendingAgent.logs.filter(
          (line) => !line.startsWith("Provisioning retry pending:"),
        ),
        "Control Worker started Instance provisioning.",
      ].slice(-100),
      updatedAt: new Date().toISOString(),
    });

    let observed = await this.getRunnerSandbox(agent);
    if (agent.liteLLMTokenId && observed.phase === "READY") {
      if (operationId) {
        await this.lifecycle.recordStage(
          operationId,
          "READY",
          "Agent runtime is ready.",
          observed.logs,
        );
      }
      return this.store.save(applyObservedState(agent, observed));
    }
    if (agent.liteLLMTokenId && observed.phase === "PROVISIONING") {
      observed = await this.waitForRunnerProvisioning(agent);
      agent = await this.store.save(applyObservedState(agent, observed));
      if (observed.phase === "READY") {
        if (operationId) {
          await this.lifecycle.recordStage(
            operationId,
            "READY",
            "Agent runtime is ready.",
            observed.logs,
          );
        }
        return agent;
      }
    }
    if (observed.phase !== "NOT_FOUND") {
      await this.destroyRunnerSandbox(agent);
    }
    if (agent.liteLLMTokenId) {
      await this.litellm.revokeKey(agent.liteLLMTokenId);
      await this.closeInstanceAttributions(id);
      const {
        liteLLMTokenId: _tokenId,
        liteLLMTeamId: _teamId,
        ...withoutPreviousKey
      } = agent;
      agent = await this.store.save({
        ...withoutPreviousKey,
        modelRoutingKeyFingerprint: `pending:${id.slice(-12)}`,
        updatedAt: new Date().toISOString(),
      });
    }

    const policy = await this.runtimePolicies.resolve(agent.policyId);
    const routing = await this.modelRoutings.resolver.resolve(
      agent.modelRoutingId,
    );
    const gateway = await this.store.getInferenceGateway(routing.gatewayId);
    if (!gateway) {
      throw new Error("The selected Routing LiteLLM Gateway is unavailable.");
    }
    const memory = await this.resolveMemory(
      agent.agentPlatform,
      agent.memory,
      routing,
    );
    const modelKeyRouting = await this.modelKeyRouting(routing);
    const objectPermissions = await this.accessPolicies.permissionsForAgent(
      agent,
    );
    let instanceKey: LiteLLMVirtualKey | undefined;
    try {
      const created = await this.quotas.createInstanceKey({
        alias: agent.costKeyAlias,
        models: memory.keyModel
          ? [...new Set([...modelKeyRouting.models, memory.keyModel])]
          : modelKeyRouting.models,
        ...modelKeyRouting.keyConfiguration,
        metadata: {
          managed_by: "tali",
          tali_project_id: this.store.projectId,
          tali_instance_id: id,
          service_account_id: agent.serviceAccountId ?? `tali-instance-${id}`,
        },
        objectPermissions,
      });
      instanceKey = created.key;
      const keyedAt = new Date().toISOString();
      agent = await this.store.save({
        ...agent,
        model: modelKeyRouting.runtimeModel,
        modelRoutingKeyFingerprint: `token:${instanceKey.tokenId.slice(-12)}`,
        liteLLMTokenId: instanceKey.tokenId,
        liteLLMTeamId: created.teamId,
        updatedAt: keyedAt,
      });
      await this.store.costAnalytics().saveAttribution({
        id: `instance-key:${id}:${instanceKey.tokenId.slice(-12)}`,
        projectId: this.store.projectId,
        instanceId: id,
        instanceName: agent.name,
        liteLLMVirtualKeyId: instanceKey.tokenId,
        hashedToken: instanceKey.tokenId,
        virtualKeyAlias: agent.costKeyAlias,
        liteLLMTeamId: created.teamId,
        providerAccountId: gateway.id,
        validFrom: keyedAt,
        createdAt: keyedAt,
        updatedAt: keyedAt,
      });
      const runtimeConfiguration = await loadPlatformRuntimeConfiguration(
        this.store.database(),
      );
      const controlOrigin = runtimeConfiguration.controlInternalUrl;
      if (!controlOrigin) {
        throw new Error(
          "Control server URL is required for Instance Run telemetry.",
        );
      }
      const platformSettings = new PlatformSettingsService(this.store.database());
      const [sandboxImage, sandboxResources] = await Promise.all([
        platformSettings.runtimeImageOverride(agent.agentPlatform),
        platformSettings.sandboxProvisioningOverrides(),
      ]);
      const litellmBaseUrl = this.litellm.connectionBaseUrl
        ? await this.litellm.connectionBaseUrl()
        : this.litellm.baseUrl;
      let runnerState = await this.createRunnerSandbox({
        name: agent.sandboxName,
        agentPlatform: agent.agentPlatform,
        providerName: "LiteLLM",
        model: modelKeyRouting.runtimeModel,
        inferenceEndpoint: `${litellmBaseUrl}/v1`,
        policyYaml: policy.policyYaml,
        systemPrompt: agent.systemPrompt,
        apiKey: instanceKey.secret,
        instanceId: id,
        ...(sandboxImage ? { sandboxImage } : {}),
        ...(sandboxResources ? { sandboxResources } : {}),
        runTelemetry: {
          endpoint: `${controlOrigin.replace(/\/$/, "")}/api/internal/run-events`,
          token: signRunTelemetryToken({
            projectId: this.store.projectId,
            instanceId: id,
            agentPlatform: agent.agentPlatform,
          }),
        },
        ...(memory.runtime ? { memory: memory.runtime } : {}),
      }, agent.durableMemoryId);
      agent = await this.store.save(applyObservedState(agent, runnerState));
      if (operationId) {
        await this.recordObservedLifecycle(operationId, runnerState);
      }
      if (runnerState.phase === "PROVISIONING") {
        runnerState = await this.waitForRunnerProvisioning(agent);
        agent = await this.store.save(applyObservedState(agent, runnerState));
        if (operationId) {
          await this.recordObservedLifecycle(operationId, runnerState);
        }
      }
      if (runnerState.phase !== "READY") {
        throw new Error(
          runnerState.error
            ?? `Instance provisioning ended in ${runnerState.phase}.`,
        );
      }
    } catch (error) {
      if (instanceKey) {
        await this.litellm.revokeKey(instanceKey.tokenId).catch(() => undefined);
        await this.closeInstanceAttributions(id).catch(() => undefined);
      }
      const {
        liteLLMTokenId: _tokenId,
        liteLLMTeamId: _teamId,
        ...withoutFailedKey
      } = agent;
      await this.store.save({
        ...withoutFailedKey,
        modelRoutingKeyFingerprint: `pending:${id.slice(-12)}`,
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);
      throw error;
    }
    return agent;
  }

  async recordProvisioningFailure(
    id: string,
    error: unknown,
    terminal: boolean,
    operationId?: string,
  ): Promise<void> {
    const current = await this.store.get(id);
    if (!current || current.status === "DESTROYING") return;
    const message = error instanceof Error ? error.message : String(error);
    const logs = current.logs.filter(
      (line) => !line.startsWith("Provisioning retry pending:"),
    );
    await this.store.save({
      ...current,
      status: terminal ? "FAILED" : "PROVISIONING",
      error: terminal ? message : `Provisioning retry pending: ${message}`,
      logs: [
        ...logs,
        terminal
          ? `Instance provisioning failed: ${message}`
          : `Provisioning retry pending: ${message}`,
      ].slice(-100),
      updatedAt: new Date().toISOString(),
    });
    if (operationId) {
      await this.lifecycle.recordFailure(operationId, error, terminal);
    }
  }

  async destroy(id: string): Promise<boolean> {
    const agent = await this.store.get(id);
    if (!agent) return false;
    if (agent.status !== "DESTROYING") {
      const { error: _previousError, ...current } = agent;
      await this.store.save({
        ...current,
        status: "DESTROYING",
        logs: [
          ...current.logs,
          "Instance deletion accepted. Runtime cleanup is continuing in the background.",
        ],
        updatedAt: new Date().toISOString(),
      });
    }
    try {
      await this.store.softDelete(id);
      if (!this.jobs.enqueueInstanceLifecycle) {
        throw new Error(
          "The Control Worker queue does not support Instance lifecycle jobs.",
        );
      }
      const operation = await this.lifecycle.create(id, "delete");
      const queueJobId = await this.jobs.enqueueInstanceLifecycle({
        projectId: this.store.projectId,
        instanceId: id,
        operationId: operation.id,
        action: "delete",
      });
      if (!queueJobId) {
        throw new Error("Unable to enqueue Instance deletion.");
      }
      await this.lifecycle.attachQueueJob(operation.id, queueJobId);
      const queued = await this.store.getIncludingDeleted(id);
      if (queued) {
        await this.store.save({
          ...queued,
          operationId: operation.id,
          updatedAt: new Date().toISOString(),
        });
      }
      return true;
    } catch (error) {
      await this.store.restore(id).catch(() => undefined);
      await this.store.save(agent).catch(() => undefined);
      throw error;
    }
  }

  async deleteRuntime(id: string, operationId?: string): Promise<void> {
    if (operationId) await this.lifecycle.start(operationId);
    const agent = await this.store.getIncludingDeleted(id);
    if (!agent) return;
    if (agent.deletionCompletedAt && agent.modelRoutingBindingRevokedAt) {
      if (operationId) {
        await this.lifecycle.recordStage(
          operationId,
          "READY",
          "Instance deletion completed.",
        );
      }
      return;
    }
    if (!agent.deletionCompletedAt) await this.destroyRunnerSandbox(agent);
    const binding = await this.store.getModelRoutingBindingForAgent(id);
    const tokensToBlock = new Set<string>();
    if (binding?.status === "ACTIVE") {
      tokensToBlock.add(binding.liteLLMTokenId);
    }
    if (
      agent.liteLLMTokenId
      && (!binding || binding.liteLLMTokenId !== agent.liteLLMTokenId)
    ) {
      tokensToBlock.add(agent.liteLLMTokenId);
    }
    await Promise.all(
      [...tokensToBlock].map((tokenId) => this.litellm.blockKey(tokenId)),
    );
    const finalizedAt = new Date().toISOString();
    if (binding?.status === "ACTIVE") {
      await this.store.saveModelRoutingBinding({
        ...binding,
        status: "REVOKED",
        revokedAt: finalizedAt,
      });
    }
    await this.memories.detachFromAgent(id, "control-worker");
    await this.closeInstanceAttributions(id);
    const completedAt = agent.deletionCompletedAt ?? finalizedAt;
    const { error: _previousError, ...completed } = agent;
    await this.store.save({
      ...completed,
      ...(agent.liteLLMTokenId
        ? { liteLLMKeyBlockedAt: agent.liteLLMKeyBlockedAt ?? finalizedAt }
        : {}),
      modelRoutingBindingRevokedAt: finalizedAt,
      deletionCompletedAt: completedAt,
      logs: [
        ...completed.logs,
        ...(agent.liteLLMTokenId
          ? ["LiteLLM Virtual Key blocked and retained for billing reconciliation."]
          : []),
        "Instance deletion completed.",
      ].slice(-100),
      updatedAt: finalizedAt,
    });
    if (operationId) {
      await this.lifecycle.recordStage(
        operationId,
        "READY",
        "Instance deletion completed.",
      );
    }
  }

  async recordDeletionFailure(
    id: string,
    error: unknown,
    operationId?: string,
  ): Promise<void> {
    const current = await this.store.getIncludingDeleted(id);
    if (!current) return;
    const message = error instanceof Error ? error.message : String(error);
    const logs = current.logs.filter(
      (line) => !line.startsWith("Deletion retry pending:"),
    );
    await this.store.save({
      ...current,
      status: "DESTROYING",
      error: `Runtime cleanup is retrying: ${message}`,
      logs: [...logs, `Deletion retry pending: ${message}`].slice(-100),
      updatedAt: new Date().toISOString(),
    });
    if (operationId) {
      await this.lifecycle.recordFailure(operationId, error, false);
    }
  }

  async updateAccessPolicies(
    id: string,
    accessPolicyIds: string[],
    actor: string,
  ): Promise<Agent> {
    const current = await this.store.get(id);
    if (!current) throw new Error("Agent Instance not found.");
    await this.accessPolicies.assertActivePolicyIds(accessPolicyIds);
    const next = {
      ...current,
      accessPolicyIds,
      updatedAt: new Date().toISOString(),
      logs: [...current.logs, `Access Policies updated by ${actor}.`],
    };
    const [permissions, previousPermissions] = await Promise.all([
      this.accessPolicies.permissionsForAgent(next),
      this.accessPolicies.permissionsForAgent(current),
    ]);
    if (current.liteLLMTokenId) {
      if (!this.litellm.updateInstanceObjectPermissions) {
        throw new Error("LiteLLM key permission updates are unavailable.");
      }
      await this.litellm.updateInstanceObjectPermissions(
        current.liteLLMTokenId,
        permissions,
      );
    }
    try {
      await this.store.replaceAgentAccessPolicies(id, accessPolicyIds, actor);
      return await this.store.save(next);
    } catch (error) {
      const rollbackFailures: string[] = [];
      try {
        await this.store.replaceAgentAccessPolicies(
          id,
          current.accessPolicyIds,
          `${actor} (rollback)`,
        );
      } catch (rollbackError) {
        rollbackFailures.push(
          `database: ${rollbackError instanceof Error ? rollbackError.message : "unknown error"}`,
        );
      }
      if (current.liteLLMTokenId) {
        try {
          await this.litellm.updateInstanceObjectPermissions!(
            current.liteLLMTokenId,
            previousPermissions,
          );
        } catch (rollbackError) {
          rollbackFailures.push(
            `LiteLLM: ${rollbackError instanceof Error ? rollbackError.message : "unknown error"}`,
          );
        }
      }
      if (rollbackFailures.length) {
        throw new Error(
          `Access Policy assignment failed and rollback was incomplete (${rollbackFailures.join("; ")}).`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async modelKeyRouting(routing: ModelRouting): Promise<{
    models: string[];
    runtimeModel: string;
    keyConfiguration: Pick<
      LiteLLMInstanceServiceAccountInput,
      "aliases" | "routerSettings"
    >;
  }> {
    if (routing.routingPolicy.mode !== "SINGLE") {
      return {
        models: [routing.publicModelAlias],
        runtimeModel: routing.publicModelAlias,
        keyConfiguration: {},
      };
    }
    const deployments = await Promise.all([
      this.store.getModelDeployment(routing.routingPolicy.modelDeploymentId),
      ...routing.routingPolicy.fallbackModelDeploymentIds.map((id) =>
        this.store.getModelDeployment(id),
      ),
    ]);
    const missingIndex = deployments.findIndex((deployment) => !deployment);
    if (missingIndex >= 0) {
      const role = missingIndex === 0 ? "primary" : `fallback ${missingIndex}`;
      throw new Error(`The ${role} Routing deployment is unavailable.`);
    }
    const primary = deployments[0]!;
    const fallbacks = deployments.slice(1).map((deployment) => deployment!);
    const fallbackModels = fallbacks.map(
      (deployment) => deployment.litellmModelName,
    );
    return {
      // Keep the Instance permission boundary on the stable Routing identity.
      // LiteLLM resolves this key-scoped alias to the physical deployment, so
      // neither the Runner nor the key allow-list needs direct deployment access.
      models: [routing.publicModelAlias],
      runtimeModel: routing.publicModelAlias,
      keyConfiguration: {
        aliases: {
          [routing.publicModelAlias]: primary.litellmModelName,
        },
        routerSettings: {
          num_retries: routing.routingPolicy.retries,
          ...(fallbackModels.length
            ? { fallbacks: [{ [primary.litellmModelName]: fallbackModels }] }
            : {}),
        },
      },
    };
  }

  private async resolveMemory(
    agentPlatform: CreateInstanceInput["agentPlatform"],
    memory: AgentMemoryConfiguration | undefined,
    routing: ModelRouting,
  ): Promise<{
    keyModel?: string;
    runtime?: NonNullable<CreateSandboxInput["memory"]>;
  }> {
    if (!memory) return {};
    if (
      getAgentPlatformDefinition(agentPlatform).capabilities.memory === "none"
    ) {
      throw new Error("This Agent does not support Instance-native Memory.");
    }
    if (memory.mode === "native") {
      return {
        runtime: {
          mode: "native",
          citations: memory.citations,
        },
      };
    }
    if (
      getAgentPlatformDefinition(agentPlatform).capabilities.memory
        !== "native-hybrid"
    ) {
      throw new Error(
        "Hybrid Memory is currently available only for OpenClaw Instances.",
      );
    }
    const embedding = await this.store.getModelDeployment(
      memory.embeddingModelDeploymentId,
    );
    if (
      !embedding ||
      embedding.status !== "VALIDATED" ||
      embedding.modelType !== "text-embedding"
    ) {
      throw new Error(
        "Select a validated text embedding model for hybrid Memory.",
      );
    }
    if (embedding.complianceDomain !== routing.complianceDomain) {
      throw new Error(
        "Memory embedding and model Routing must use the same compliance boundary.",
      );
    }
    return {
      keyModel: embedding.litellmModelName,
      runtime: {
        mode: "hybrid",
        embeddingModel: embedding.litellmModelName,
        includeSessionTranscripts: memory.includeSessionTranscripts,
        citations: memory.citations,
        maxResults: memory.maxResults,
        minScore: memory.minScore,
      },
    };
  }

  private async refresh(agent: Agent): Promise<Agent> {
    if (agent.status === "DESTROYING") return agent;
    if (agent.status === "FAILED" && agent.runtimePhase !== "NOT_FOUND") {
      return agent;
    }
    try {
      return await this.store.save(
        applyObservedState(
          agent,
          await this.getRunnerSandbox(agent),
        ),
      );
    } catch (error) {
      return {
        ...agent,
        logs: [
          ...agent.logs,
          `Runtime observation unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
        ],
      };
    }
  }

  private async recordObservedLifecycle(
    operationId: string,
    observed: RunnerSandbox,
  ): Promise<void> {
    const stage = observed.provisioningStage
      ?? (observed.phase === "READY" ? "READY" : "RUNTIME");
    const message = observed.phase === "READY"
      ? "Agent runtime is ready."
      : observed.phase === "FAILED"
        ? "Agent runtime reported a provisioning failure."
        : `Agent provisioning reached ${stage.toLowerCase()}.`;
    await this.lifecycle.recordStage(
      operationId,
      stage,
      message,
      observed.logs,
    );
  }

  private async closeInstanceAttributions(instanceId: string): Promise<void> {
    const now = new Date();
    await this.store.database().costAttributionMappingRecord.updateMany({
      where: {
        projectId: this.store.projectId,
        instanceId,
        validTo: null,
      },
      data: { validTo: now, updatedAt: now },
    });
  }

  private async createRunnerSandbox(
    input: CreateSandboxInput,
    durableMemoryId?: string,
  ): Promise<RunnerSandbox> {
    const target = await this.runnerRuntimeTarget();
    const projectRuntimeBridgeToken =
      target
      && (
        input.agentPlatform === "hermes"
        || (input.agentPlatform === "openclaw" && Boolean(durableMemoryId))
      )
      && process.env.PROJECT_RUNTIME_BRIDGES_ENABLED === "true"
        ? signProjectRuntimeCoordinatorToken(
            {
              coordinatorInstanceId: input.instanceId,
              ...(durableMemoryId ? { memoryId: durableMemoryId } : {}),
              namespace: target.namespace,
              projectId: this.store.projectId,
            },
            getControlConfig().auth.secret,
          )
        : undefined;
    const runtimeInput: CreateSandboxInput = {
      ...input,
      durableMemoryEnabled: Boolean(durableMemoryId),
      ...(projectRuntimeBridgeToken ? { projectRuntimeBridgeToken } : {}),
    };
    return target
      ? this.runner.createSandbox(runtimeInput, target)
      : this.runner.createSandbox(runtimeInput);
  }

  private async getRunnerSandbox(agent: Agent): Promise<RunnerSandbox> {
    const target = await this.runnerRuntimeTarget();
    return target
      ? this.runner.getSandbox(agent.sandboxName, agent.agentPlatform, target)
      : this.runner.getSandbox(agent.sandboxName, agent.agentPlatform);
  }

  private async destroyRunnerSandbox(agent: Agent): Promise<RunnerSandbox> {
    const target = await this.runnerRuntimeTarget();
    return target
      ? this.runner.destroySandbox(
          agent.sandboxName,
          agent.agentPlatform,
          target,
        )
      : this.runner.destroySandbox(agent.sandboxName, agent.agentPlatform);
  }

  private async waitForRunnerProvisioning(agent: Agent): Promise<RunnerSandbox> {
    const timeoutMs = Number(
      process.env.INSTANCE_PROVISION_TIMEOUT_MS ?? "600000",
    );
    const deadline = Date.now() + timeoutMs;
    let observed: RunnerSandbox = {
      name: agent.sandboxName,
      agentPlatform: agent.agentPlatform,
      phase: "PROVISIONING",
      logs: [],
    };
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      observed = await this.getRunnerSandbox(agent);
      if (observed.phase === "READY" || observed.phase === "FAILED") {
        return observed;
      }
    }
    throw new Error(
      `Instance provisioning did not become ready within ${Math.round(timeoutMs / 1_000)} seconds.`,
    );
  }
}
