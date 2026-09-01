import type {
  AgentCollaborationRole,
  AgentProductForm,
  RuntimeInventoryIdentity,
  RuntimeInventoryItem,
  RuntimeInventoryResponse,
} from "@tali/contracts";
import { getAgentPlatformDefinition } from "@tali/contracts";
import { projectAgentRuntimeInstanceSchema } from "@tali/contracts";
import type { PrismaClient } from "../generated/prisma/client";
import { AgentGardenService } from "../agent-garden/agent-garden-service";
import { InstanceService } from "../instances/instance-service";

type MemberUser = {
  id: string;
  displayName: string;
  username: string | null;
};

function identity(user: MemberUser | null | undefined): RuntimeInventoryIdentity | null {
  return user
    ? {
        id: user.id,
        displayName: user.displayName,
        username: user.username ?? user.displayName,
      }
    : null;
}

function roleFor(capabilities: {
  acceptsDelegation: boolean;
  canDelegate: boolean;
}): AgentCollaborationRole {
  if (capabilities.canDelegate && capabilities.acceptsDelegation) return "HYBRID";
  if (capabilities.canDelegate) return "SUPERVISOR";
  return "SPECIALIST";
}

function formFor(mode: "INTERACTIVE" | "CALLABLE" | "HYBRID"): AgentProductForm {
  if (mode === "CALLABLE") return "SERVICE";
  return mode;
}

export class RuntimeInventoryService {
  constructor(
    private readonly projectId: string,
    private readonly db: PrismaClient,
    private readonly instances: InstanceService,
    private readonly agentGarden: AgentGardenService,
  ) {}

  async list(relationActorId?: string): Promise<RuntimeInventoryResponse> {
    const [
      workspaceInstances,
      managedA2aInstances,
      gardenAgents,
      agentRecords,
      projectAgentInstances,
    ] =
      await Promise.all([
        this.instances.list(relationActorId),
        this.agentGarden.store.listManagedInstances(relationActorId),
        this.agentGarden.store.listAgents(),
        this.db.agentRecord.findMany({
          where: {
            projectId: this.projectId,
            deletedAt: null,
            kind: { in: ["SUPERVISOR", "A2A"] },
            ...(relationActorId ? { ownerUserId: relationActorId } : {}),
          },
          select: {
            id: true,
            createdByUserId: true,
            ownerMembership: {
              select: {
                user: {
                  select: { id: true, displayName: true, username: true },
                },
              },
            },
            creatorMembership: {
              select: {
                user: {
                  select: { id: true, displayName: true, username: true },
                },
              },
            },
          },
        }),
        this.db.agentRecord.findMany({
          where: {
            projectId: this.projectId,
            kind: "PROJECT_AGENT",
            deletedAt: null,
            ...(relationActorId ? { ownerUserId: relationActorId } : {}),
          },
          orderBy: { createdAt: "desc" },
          include: {
            developedAgent: {
              include: {
                creator: { include: { user: true } },
                members: { include: { member: { include: { user: true } } } },
              },
            },
            agentVersion: true,
            ownerMembership: { include: { user: true } },
            creatorMembership: { include: { user: true } },
          },
        }),
      ]);

    const recordsById = new Map(agentRecords.map((record) => [record.id, record]));
    const gardenAgentsById = new Map(gardenAgents.map((agent) => [agent.id, agent]));
    const workspaceItems: RuntimeInventoryItem[] = workspaceInstances.map((instance) => {
      const record = recordsById.get(instance.id);
      const platform = getAgentPlatformDefinition(instance.agentPlatform);
      const owner = identity(record?.ownerMembership.user);
      const creator = identity(
        record?.creatorMembership?.user ?? record?.ownerMembership.user,
      );
      return {
        id: `workspace:${instance.id}`,
        sourceType: "WORKSPACE_INSTANCE",
        sourceId: instance.id,
        name: instance.name,
        description: instance.description,
        classification: {
          form: "INTERACTIVE",
          role: roleFor(platform.capabilities),
          executionStrategy: null,
          a2a: {
            version: "1.0",
            directions: platform.capabilities.canDelegate ? ["CLIENT"] : [],
            agentCardStatus: "UNCHECKED",
          },
        },
        subtype: instance.agentPlatform,
        relation: relationActorId ? "OWNER" : null,
        status: instance.status,
        runtime: {
          type: "OPENSHELL",
          label: "OpenShell Sandbox",
          namespace: null,
          workloadName: instance.sandboxName,
          endpoint: null,
        },
        activeVersion: null,
        ownership: {
          createdBy: creator,
          creatorProvenance: record?.createdByUserId
            ? "RECORDED"
            : "INFERRED_FROM_OWNER",
          owners: owner ? [owner] : [],
          maintainers: [],
          lastDeployedBy: null,
        },
        createdAt: instance.createdAt,
        updatedAt: instance.updatedAt,
        activatedAt: instance.status === "READY" ? instance.updatedAt : null,
      };
    });

    const managedItems: RuntimeInventoryItem[] = managedA2aInstances.map((instance) => {
      const record = recordsById.get(instance.id);
      const definition = gardenAgentsById.get(instance.agentId);
      const owner = identity(record?.ownerMembership.user);
      const creator = identity(
        record?.creatorMembership?.user ?? record?.ownerMembership.user,
      );
      return {
        id: `managed-a2a:${instance.id}`,
        sourceType: "MANAGED_A2A",
        sourceId: instance.id,
        name: instance.name,
        description: instance.description,
        classification: {
          form: definition ? formFor(definition.usageMode) : "SERVICE",
          role: definition
            ? roleFor(definition.usageCapabilities)
            : "SPECIALIST",
          executionStrategy: null,
          a2a: {
            version: "1.0",
            directions: definition?.usageCapabilities.canDelegate
              ? ["CLIENT", "SERVER"]
              : ["SERVER"],
            agentCardStatus: definition?.status === "READY" && Boolean(
              definition.a2a ?? instance.a2a,
            )
              ? "VALID"
              : definition?.status === "UNAVAILABLE"
                ? "INVALID"
                : "UNCHECKED",
          },
        },
        subtype: "A2A Standard",
        relation: relationActorId ? "OWNER" : null,
        status: instance.status,
        runtime: {
          type: instance.runtime === "kubernetes" ? "KUBERNETES" : "EXTERNAL",
          label: instance.runtime === "kubernetes"
            ? "Kubernetes · Project Main Space"
            : "External A2A Runtime",
          namespace: instance.runtimeNamespace,
          workloadName: instance.podName ?? instance.deploymentName,
          endpoint: instance.endpoint,
        },
        activeVersion: null,
        ownership: {
          createdBy: creator,
          creatorProvenance: record?.createdByUserId
            ? "RECORDED"
            : "INFERRED_FROM_OWNER",
          owners: owner ? [owner] : [],
          maintainers: [],
          lastDeployedBy: null,
        },
        createdAt: instance.createdAt,
        updatedAt: instance.updatedAt,
        activatedAt: instance.status === "READY" ? instance.updatedAt : null,
      };
    });

    const expertItems: RuntimeInventoryItem[] = projectAgentInstances.flatMap((row) => {
      if (!row.developedAgent || !row.agentVersion) return [];
      const parsed = projectAgentRuntimeInstanceSchema.safeParse({
        ...(row.payload as object),
        createdBy: {
          id: (row.creatorMembership?.user ?? row.ownerMembership.user).id,
          displayName: (row.creatorMembership?.user ?? row.ownerMembership.user).displayName,
          username: (row.creatorMembership?.user ?? row.ownerMembership.user).username
            ?? (row.creatorMembership?.user ?? row.ownerMembership.user).displayName,
        },
      });
      if (!parsed.success) return [];
      const instance = parsed.data;
      const source = row.developedAgent;
      const owners = source.members
        .filter((member) => member.relation === "OWNER")
        .flatMap((member) => identity(member.member.user) ?? []);
      const maintainers = source.members
        .filter((member) => member.relation === "MAINTAINER")
        .flatMap((member) => identity(member.member.user) ?? []);
      return [{
        id: `project-agent:${instance.id}`,
        sourceType: "PROJECT_AGENT",
        sourceId: instance.id,
        name: instance.name,
        description: instance.description,
        classification: {
          form: "SERVICE",
          role: "SPECIALIST",
          executionStrategy: source.executionMode,
          a2a: {
            version: "1.0",
            directions: ["SERVER"],
            agentCardStatus:
              instance.status === "READY"
              && Boolean(instance.endpoint)
                ? "VALID"
                : instance.status === "FAILED"
                  ? "INVALID"
                  : "UNCHECKED",
          },
        },
        subtype: source.executionMode,
        relation: relationActorId ? "OWNER" : null,
        status: instance.status,
        runtime: {
          type: "KUBERNETES",
          label: "Kubernetes · A2A Agent Service",
          namespace: instance.runtimeNamespace,
          workloadName: instance.deploymentName,
          endpoint: instance.endpoint,
        },
        activeVersion: {
          id: row.agentVersion.id,
          versionNumber: row.agentVersion.versionNumber,
        },
        ownership: {
          createdBy: identity(row.creatorMembership?.user ?? row.ownerMembership.user),
          creatorProvenance: "RECORDED",
          owners,
          maintainers,
          lastDeployedBy: identity(row.creatorMembership?.user ?? row.ownerMembership.user),
        },
        createdAt: instance.createdAt,
        updatedAt: instance.updatedAt,
        activatedAt: instance.status === "READY" ? instance.updatedAt : null,
      }];
    });

    return {
      data: [...workspaceItems, ...managedItems, ...expertItems].sort(
        (left, right) => right.updatedAt.localeCompare(left.updatedAt),
      ),
      generatedAt: new Date().toISOString(),
    };
  }
}
