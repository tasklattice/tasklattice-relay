import {
  expertAgentVersionSnapshotSchema,
  getAgentPlatformDefinition,
  projectAgentRuntimeInstanceSchema,
  type A2aStandardAgentInstanceDetail,
  type AgentGardenUsageCapabilities,
  type AgentInstanceDetail,
  type AgentInstanceRole,
  type ProjectAgentInstanceDetail,
  type SupervisorAgentInstanceDetail,
} from "@tali/contracts";
import { AgentGardenStore } from "../agent-garden/agent-garden-store";
import { InstanceService } from "./instance-service";

function roleFor(
  capabilities: AgentGardenUsageCapabilities,
): AgentInstanceRole {
  if (capabilities.canDelegate && capabilities.acceptsDelegation) return "HYBRID";
  if (capabilities.canDelegate) return "SUPERVISOR";
  return "SPECIALIST";
}

export class AgentInstanceDetailService {
  constructor(
    readonly supervisors: InstanceService,
    readonly garden: AgentGardenStore,
  ) {}

  async get(id: string): Promise<AgentInstanceDetail | undefined> {
    const supervisor = await this.supervisors.get(id);
    if (supervisor) {
      const platform = getAgentPlatformDefinition(supervisor.agentPlatform);
      const detail: SupervisorAgentInstanceDetail = {
        resourceType: "AGENT_INSTANCE",
        kind: "SUPERVISOR",
        id: supervisor.id,
        name: supervisor.name,
        description: supervisor.description,
        form: "INTERACTIVE",
        role: roleFor(platform.capabilities),
        executionStrategy: null,
        status: supervisor.status,
        platform: { id: platform.id, name: platform.name },
        runtimeView: {
          type: "OPENSHELL",
          managed: true,
          workloadName: supervisor.sandboxName,
        },
        protocols: platform.capabilities.canDelegate
          ? [{
              type: "A2A",
              version: "1.0",
              direction: ["CLIENT"],
              agentCardStatus: "UNCHECKED",
              capabilities: {
                streaming: false,
                pushNotifications: false,
                extendedAgentCard: false,
                defaultInputModes: ["text/plain"],
                defaultOutputModes: ["text/plain"],
              },
              skills: [],
            }]
          : [],
        capabilities: {
          interactive: platform.capabilities.interactive,
          canPlan: true,
          canDelegate: platform.capabilities.canDelegate,
          acceptsDelegation: platform.capabilities.acceptsDelegation,
          terminal: true,
          liveLogs: false,
        },
        observability: {
          logSources: ["LIFECYCLE", "AUDIT"],
          terminal: { supported: true },
        },
        ...(supervisor.createdBy ? { createdBy: supervisor.createdBy } : {}),
        createdAt: supervisor.createdAt,
        updatedAt: supervisor.updatedAt,
        instance: supervisor,
        definition: null,
      };
      return detail;
    }

    const instance = await this.garden.getManagedInstance(id);
    if (instance) {
      const definition = await this.garden.getAgent(instance.agentId);
      if (!definition) return undefined;
      return this.a2aDetail(instance, definition);
    }

    return this.projectAgentDetail(id);
  }

  private async projectAgentDetail(
    id: string,
  ): Promise<ProjectAgentInstanceDetail | undefined> {
    const row = await this.garden.database().agentRecord.findFirst({
      where: {
        projectId: this.garden.projectId,
        id,
        kind: "PROJECT_AGENT",
        deletedAt: null,
      },
      include: {
        developedAgent: true,
        agentVersion: true,
        ownerMembership: { include: { user: true } },
        creatorMembership: { include: { user: true } },
      },
    });
    if (!row?.developedAgent || !row.agentVersion) return undefined;
    const creatorUser = row.creatorMembership?.user ?? row.ownerMembership.user;
    const createdBy = {
      id: creatorUser.id,
      displayName: creatorUser.displayName,
      username: creatorUser.username ?? creatorUser.displayName,
    };
    const instance = projectAgentRuntimeInstanceSchema.parse({
      ...(row.payload as object),
      createdBy,
    });
    const snapshot = expertAgentVersionSnapshotSchema.parse(row.agentVersion.snapshot);
    const enabledDelegations = snapshot.delegations.filter(
      (delegation) => delegation.enabled,
    );
    const canDelegate = enabledDelegations.length > 0;
    const skills = snapshot.product.capabilities.map((capability, index) => ({
      id: `capability-${index + 1}`,
      name: capability,
      description: capability,
      tags: ["Project Agent"],
    }));
    return {
      resourceType: "AGENT_INSTANCE",
      kind: "PROJECT_AGENT",
      id: instance.id,
      name: instance.name,
      description: instance.description,
      form: "SERVICE",
      role: canDelegate ? "HYBRID" : "SPECIALIST",
      executionStrategy: row.developedAgent.executionMode,
      status: instance.status,
      platform: { id: "agent-developer", name: "Agent Developer" },
      runtimeView: {
        type: "KUBERNETES",
        managed: true,
        ...(instance.runtimeNamespace ? { namespace: instance.runtimeNamespace } : {}),
        ...(instance.deploymentName
          ? { workloadName: instance.deploymentName }
          : {}),
        ...(instance.serviceName ? { serviceName: instance.serviceName } : {}),
      },
      protocols: [{
        type: "A2A",
        version: "1.0",
        direction: canDelegate ? ["CLIENT", "SERVER"] : ["SERVER"],
        binding: "JSONRPC",
        ...(instance.endpoint ? { endpoint: instance.endpoint } : {}),
        ...(instance.agentCardUrl ? { agentCardUrl: instance.agentCardUrl } : {}),
        agentCardStatus: instance.status === "READY" && instance.endpoint
          ? "VALID"
          : "UNCHECKED",
        capabilities: {
          streaming: false,
          pushNotifications: false,
          extendedAgentCard: false,
          defaultInputModes: ["text/plain"],
          defaultOutputModes: ["application/json"],
        },
        skills,
      }],
      capabilities: {
        interactive: false,
        canPlan: row.developedAgent.executionMode === "AGENTIC",
        canDelegate,
        acceptsDelegation: true,
        terminal: false,
        liveLogs: Boolean(instance.runtimeNamespace && instance.deploymentName),
      },
      observability: {
        logSources: ["RUNTIME", "PROTOCOL"],
        terminal: {
          supported: false,
          reason: "Project Agent runtimes expose read-only logs and traces, not an executable terminal.",
        },
      },
      createdBy,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      instance,
      definition: {
        id: row.developedAgent.id,
        slug: row.developedAgent.slug,
        source: "AGENT_DEVELOPER",
        executionStrategy: row.developedAgent.executionMode,
        activeVersion: {
          id: row.agentVersion.id,
          versionNumber: row.agentVersion.versionNumber,
          contentDigest: row.agentVersion.contentDigest,
        },
      },
    };
  }

  private a2aDetail(
    instance: A2aStandardAgentInstanceDetail["instance"],
    definition: A2aStandardAgentInstanceDetail["definition"],
  ): A2aStandardAgentInstanceDetail {
    const a2a = definition.a2a ?? instance.a2a;
    const validAgentCard = definition.status === "READY" && Boolean(a2a);
    const invalidAgentCard = definition.status === "UNAVAILABLE";
    return {
      resourceType: "AGENT_INSTANCE",
      kind: "A2A",
      id: instance.id,
      name: instance.name,
      description: instance.description,
      form: definition.usageMode === "CALLABLE"
        ? "SERVICE"
        : definition.usageMode,
      role: roleFor(definition.usageCapabilities),
      executionStrategy: null,
      status: instance.status,
      platform: { id: "custom", name: definition.platformLabel },
      runtimeView: {
        type: instance.runtime === "kubernetes" ? "KUBERNETES" : "EXTERNAL",
        managed: instance.runtime === "kubernetes",
        ...(instance.runtimeNamespace
          ? { namespace: instance.runtimeNamespace }
          : {}),
        ...(instance.deploymentName
          ? { workloadName: instance.deploymentName }
          : {}),
        ...(instance.serviceName ? { serviceName: instance.serviceName } : {}),
        ...(instance.podName ? { podName: instance.podName } : {}),
        ...(instance.imageReference
          ? { imageReference: instance.imageReference }
          : {}),
        ...(instance.imageDigest ? { imageDigest: instance.imageDigest } : {}),
      },
      protocols: [{
        type: "A2A",
        version: "1.0",
        direction: ["SERVER"],
        ...(a2a?.protocolBinding ? { binding: a2a.protocolBinding } : {}),
        ...(instance.endpoint ? { endpoint: instance.endpoint } : {}),
        ...(instance.agentCardUrl ? { agentCardUrl: instance.agentCardUrl } : {}),
        agentCardStatus: validAgentCard
          ? "VALID"
          : invalidAgentCard
            ? "INVALID"
            : "UNCHECKED",
        ...(definition.lastDiscoveredAt
          ? { lastDiscoveredAt: definition.lastDiscoveredAt }
          : {}),
        ...(definition.lastDiscoveryError
          ? { lastDiscoveryError: definition.lastDiscoveryError }
          : {}),
        capabilities: {
          streaming: a2a?.streaming ?? false,
          pushNotifications: a2a?.pushNotifications ?? false,
          extendedAgentCard: a2a?.extendedAgentCard ?? false,
          defaultInputModes: a2a?.defaultInputModes ?? ["text/plain"],
          defaultOutputModes: a2a?.defaultOutputModes ?? ["text/plain"],
        },
        skills: definition.skills,
      }],
      capabilities: {
        interactive: definition.usageCapabilities.interactive,
        canPlan: false,
        canDelegate: definition.usageCapabilities.canDelegate,
        acceptsDelegation: definition.usageCapabilities.acceptsDelegation,
        terminal: false,
        liveLogs: instance.runtime === "kubernetes",
      },
      observability: {
        logSources: instance.runtime === "kubernetes"
          ? ["RUNTIME"]
          : [],
        terminal: {
          supported: false,
          reason:
            instance.runtime === "kubernetes"
              ? "This managed A2A Instance exposes read-only runtime logs, not an executable terminal."
              : "This external A2A Instance does not expose an executable terminal through Relay.",
        },
      },
      ...(instance.createdBy ? { createdBy: instance.createdBy } : {}),
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      instance,
      definition,
    };
  }
}
