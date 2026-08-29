import {
  isAgentPlatformId,
  type AgentPlatformId,
} from "@tali/contracts";
import { prisma } from "../db/prisma";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import {
  LiteLLMClient,
  type LiteLLMAdminClient,
} from "../providers/litellm-client";
import {
  NemoClawRunnerClient,
  type RunnerClient,
} from "../runtime/nemoclaw-runner-client";
import { MemoryRepository } from "../memories/memory-repository";
import { MemoryService } from "../memories/memory-service";
import { ProjectRuntimeTargetService } from "./project-runtime-target-service";

export const PROJECT_DELETION_GRACE_PERIOD_MINUTES = 10;
export const PROJECT_DELETION_GRACE_PERIOD_MS =
  PROJECT_DELETION_GRACE_PERIOD_MINUTES * 60 * 1_000;

export interface ProjectDeletionSchedule {
  delayMinutes: number;
  projectId: string;
  requestedAt: string;
  scheduledFor: string;
  status: "scheduled";
}

interface CleanupOptions {
  externalCleanupEnabled?: boolean;
  memoryServiceFactory?: (projectId: string) => Pick<
    MemoryService,
    "deleteForProjectCleanup"
  >;
}

export interface ProjectRuntimeTargetCleanup {
  deleteProjectNamespace(projectId: string): Promise<boolean>;
}

interface DeletionAgent {
  agentPlatform: AgentPlatformId;
  id: string;
  liteLLMTokenId?: string;
  name: string;
  sandboxName: string;
}

function record(payload: Prisma.JsonValue): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function deletionAgent(payload: Prisma.JsonValue): DeletionAgent {
  const value = record(payload);
  const agentPlatform = value.agentPlatform;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.sandboxName !== "string" ||
    typeof agentPlatform !== "string" ||
    !isAgentPlatformId(agentPlatform)
  ) {
    throw new Error(
      "Project cleanup stopped because stored Agent Instance data is incomplete.",
    );
  }
  return {
    agentPlatform,
    id: value.id,
    name: value.name,
    sandboxName: value.sandboxName,
    ...(typeof value.liteLLMTokenId === "string"
      ? { liteLLMTokenId: value.liteLLMTokenId }
      : {}),
  };
}

function optionalString(payload: Prisma.JsonValue, field: string): string | undefined {
  const value = record(payload)[field];
  return typeof value === "string" && value ? value : undefined;
}

function remoteResourceAlreadyAbsent(error: unknown): boolean {
  return error instanceof Error && /not found|does not exist|unknown (?:key|team|model)/i.test(error.message);
}

async function deleteRemote(operation: (() => Promise<void>) | undefined): Promise<void> {
  if (!operation) return;
  try {
    await operation();
  } catch (error) {
    if (!remoteResourceAlreadyAbsent(error)) throw error;
  }
}

export class ProjectDeletionService {
  private readonly externalCleanupEnabled: boolean;
  private readonly memoryServiceFactory: NonNullable<
    CleanupOptions["memoryServiceFactory"]
  >;
  private readonly runtimeTargets: ProjectRuntimeTargetCleanup;

  constructor(
    private readonly db: PrismaClient = prisma(),
    private readonly runner: RunnerClient = new NemoClawRunnerClient(),
    private readonly litellm: LiteLLMAdminClient = new LiteLLMClient(),
    options: CleanupOptions = {},
    runtimeTargets?: ProjectRuntimeTargetCleanup,
  ) {
    this.externalCleanupEnabled =
      options.externalCleanupEnabled ?? true;
    this.memoryServiceFactory = options.memoryServiceFactory
      ?? ((projectId) => new MemoryService(new MemoryRepository(projectId, this.db)));
    this.runtimeTargets =
      runtimeTargets ?? new ProjectRuntimeTargetService(this.db);
  }

  async purge(projectId: string): Promise<boolean> {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: {
        deletedAt: true,
        agents: {
          where: { kind: "SUPERVISOR" },
          select: { payload: true },
        },
        mcpServers: { select: { litellmServerId: true } },
        knowledgeSources: { select: { payload: true } },
        memories: {
          where: { deletedAt: null },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        },
        modelDeployments: { select: { payload: true } },
        modelRoutings: { select: { id: true, payload: true } },
        quota: { select: { litellmTeamId: true } },
      },
    });
    if (!project) return false;
    if (!project.deletedAt) {
      throw new Error("Project cleanup requires a scheduled deletion request.");
    }

    const agents = project.agents.map(({ payload }) => deletionAgent(payload));
    await Promise.all(
      agents.map((agent) =>
        deleteRemote(() =>
          this.runner.destroySandbox(agent.sandboxName, agent.agentPlatform)
            .then(() => undefined),
        ),
      ),
    );

    const memoryService = this.memoryServiceFactory(projectId);
    for (const memory of project.memories) {
      await memoryService.deleteForProjectCleanup(
        memory.id,
        `project-deletion:${projectId}`,
      );
    }

    if (this.externalCleanupEnabled) {
      await Promise.all(
        agents.map((agent) =>
          deleteRemote(
            agent.liteLLMTokenId
              ? () => this.litellm.revokeKey(agent.liteLLMTokenId!)
              : undefined,
          ),
        ),
      );
      await Promise.all(
        project.modelRoutings.flatMap(({ id, payload }) => {
          const alias = optionalString(payload, "publicModelAlias");
          const teamId = optionalString(payload, "liteLLMTeamId");
          return [
            alias
              ? deleteRemote(
                  this.litellm.deleteModelRoutingRoute
                    ? () => this.litellm.deleteModelRoutingRoute!(alias, id)
                    : undefined,
                )
              : Promise.resolve(),
            teamId
              ? deleteRemote(
                  this.litellm.deleteModelRoutingTeam
                    ? () => this.litellm.deleteModelRoutingTeam!(teamId)
                    : undefined,
                )
              : Promise.resolve(),
          ];
        }),
      );
      await Promise.all(
        project.modelDeployments.map(({ payload }) => {
          const modelName = optionalString(payload, "litellmModelName");
          return deleteRemote(
            modelName ? () => this.litellm.deleteModel(modelName) : undefined,
          );
        }),
      );
      await Promise.all(
        project.mcpServers.map(({ litellmServerId }) =>
          deleteRemote(
            this.litellm.deleteMcpServer
              ? () => this.litellm.deleteMcpServer!(litellmServerId)
              : undefined,
          ),
        ),
      );
      await Promise.all(
        project.knowledgeSources.map(({ payload }) => {
          const vectorStoreId = optionalString(payload, "vectorStoreId");
          return deleteRemote(
            vectorStoreId && this.litellm.deleteVectorStore
              ? () => this.litellm.deleteVectorStore!(vectorStoreId)
              : undefined,
          );
        }),
      );
      await deleteRemote(
        project.quota?.litellmTeamId && this.litellm.deleteProjectTeam
          ? () => this.litellm.deleteProjectTeam!(project.quota!.litellmTeamId!)
          : undefined,
      );
    }

    // Namespace deletion is deliberately last among external cleanup steps.
    // The database tombstone remains available for retry until Kubernetes
    // confirms that the Project Runtime Namespace is absent.
    await this.runtimeTargets.deleteProjectNamespace(projectId);

    await this.db.$transaction(async (transaction) => {
      // Business records remain as tombstones. Only runtime and external
      // integration resources above are physically destroyed.
      await transaction.agentRecord.updateMany({
        where: { projectId, deletedAt: null },
        data: { deletedAt: project.deletedAt },
      });
      await Promise.all([
        transaction.agentCatalogRecord.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: project.deletedAt } }),
        transaction.providerAccountRecord.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: project.deletedAt } }),
        transaction.modelDeploymentRecord.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: project.deletedAt } }),
        transaction.modelRoutingRecord.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: project.deletedAt } }),
        transaction.sandboxPolicyRecord.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: project.deletedAt } }),
        transaction.accessPolicyRecord.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: project.deletedAt } }),
        transaction.skillRecord.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: project.deletedAt } }),
        transaction.mcpServerRecord.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: project.deletedAt } }),
        transaction.knowledgeSourceRecord.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: project.deletedAt } }),
        transaction.agentSpecializationRecord.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: project.deletedAt } }),
      ]);
      await transaction.projectDeletionTask.updateMany({
        where: { projectId, status: "running" },
        data: {
          lastError: null,
          leaseExpiresAt: null,
          leaseOwner: null,
          status: "completed",
        },
      });
    });
    return true;
  }
}
