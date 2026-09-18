import { randomUUID } from "node:crypto";
import { ProjectQuotaService } from "../quotas/project-quota-service";
import { ProjectStore } from "./project-store";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { PlatformSettingsService } from "../platform/platform-settings-service";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";
import {
  createProjectNamespaceClient,
  type ProjectNamespaceClient,
} from "../kubernetes/project-namespace-client";
import {
  createProjectOpenShellGatewayClient,
  type ProjectOpenShellGatewayClient,
} from "../kubernetes/project-openshell-gateway-client";
import {
  createProjectRuntimeBridgeClient,
  type ProjectRuntimeBridgeClient,
} from "../kubernetes/project-runtime-bridge-client";
import { signProjectRuntimeBridgeToken } from "../runtime-bridge/project-runtime-bridge-token";

export interface ProjectRuntimeNamespaceProvisioner {
  ensureProjectNamespace(projectId: string): Promise<boolean>;
}

export interface ProjectRuntimeReconciliationFailure {
  error: string;
  projectId: string;
}

export interface ProjectRuntimeReconciliationSummary {
  failed: number;
  failures: ProjectRuntimeReconciliationFailure[];
  ready: number;
  skipped: number;
  total: number;
}

export { projectRuntimeNamespace } from "./project-runtime-identity";
import { projectRuntimeNamespace } from "./project-runtime-identity";

function safeError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown Namespace provisioning error.";
  return message.slice(0, 4_000);
}

const PROJECT_RUNTIME_RECONCILE_LEASE_MS = 10 * 60 * 1_000;

/** Worker-only idempotent provisioning with durable state and a fenced lease. */
export class ProjectRuntimeTargetService implements ProjectRuntimeNamespaceProvisioner {
  constructor(
    private readonly db: PrismaClient = prisma(),
    private readonly namespaces?: ProjectNamespaceClient,
    private readonly gateways?: ProjectOpenShellGatewayClient,
    private readonly bridges?: ProjectRuntimeBridgeClient,
  ) {}

  async ensureProjectNamespace(projectId: string): Promise<boolean> {
    const platformRuntime = await loadPlatformRuntimeConfiguration(this.db);
    const runtime = platformRuntime.runtimeNamespaces;
    const namespaces =
      this.namespaces ??
      createProjectNamespaceClient({ enabled: runtime.enabled });
    const gateways = this.gateways ?? createProjectOpenShellGatewayClient();
    const bridges = this.bridges ?? createProjectRuntimeBridgeClient();
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: {
        deletedAt: true,
        id: true,
        name: true,
        runtimeTarget: {
          select: {
            clusterId: true,
            generation: true,
            namespace: true,
          },
        },
      },
    });
    if (!project || project.deletedAt) {
      throw new Error(
        `Project ${projectId} was not found or is being deleted.`,
      );
    }

    const target =
      project.runtimeTarget ??
      (await this.db.projectRuntimeTarget.create({
        data: {
          clusterId: runtime.clusterId,
          namespace: projectRuntimeNamespace(project.id),
          projectId: project.id,
        },
        select: {
          clusterId: true,
          generation: true,
          namespace: true,
        },
      }));
    this.assertConfiguredCluster(target.clusterId, runtime.clusterId);

    const reconciliationId = randomUUID();
    const referenceTime = new Date();
    let leaseActive = false;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      if (!leaseActive) return;
      void this.db.projectRuntimeTarget
        .updateMany({
          where: { projectId, leaseOwner: reconciliationId },
          data: {
            leaseExpiresAt: new Date(
              Date.now() + PROJECT_RUNTIME_RECONCILE_LEASE_MS,
            ),
          },
        })
        .then((result) => {
          if (!result.count) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        });
    }, 30000);
    heartbeat.unref();
    try {
      const claimed = await this.db.projectRuntimeTarget.updateMany({
        where: {
          generation: target.generation,
          projectId: project.id,
          status: { notIn: ["deleting", "failed"] },
          OR: [
            { leaseOwner: null },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: referenceTime } },
          ],
        },
        data: {
          attempts: { increment: 1 },
          lastError: null,
          leaseExpiresAt: new Date(
            referenceTime.getTime() + PROJECT_RUNTIME_RECONCILE_LEASE_MS,
          ),
          leaseOwner: reconciliationId,
          status: "reconciling",
        },
      });
      if (!claimed.count) {
        throw new Error(
          `Project Runtime Target ${project.id} changed or started deleting before generation ${target.generation} could be reconciled.`,
        );
      }
      leaseActive = true;
      const stillCurrent = async () => {
        if (leaseLost)
          throw new Error("Project initialization lease was lost.");
        const current = await this.db.projectRuntimeTarget.findFirst({
          where: {
            projectId,
            generation: target.generation,
            leaseOwner: reconciliationId,
            status: "reconciling",
          },
          select: { projectId: true },
        });
        const owner = await this.db.project.findUnique({
          where: { id: projectId },
          select: { deletedAt: true },
        });
        if (!current || !owner || owner.deletedAt)
          throw new Error(
            "Project initialization was superseded or cancelled by deletion.",
          );
      };
      await stillCurrent();
      if (platformRuntime.litellm.masterKey) {
        await new ProjectQuotaService(
          new ProjectStore(projectId, this.db),
        ).sync();
      }
      await stillCurrent();
      if (runtime.enabled) {
        await namespaces.reconcile({
          namespace: target.namespace,
          projectId: project.id,
          projectName: project.name,
        });
        await stillCurrent();
        await gateways.reconcile({
          namespace: target.namespace,
          projectId: project.id,
          projectName: project.name,
        });
        await stillCurrent();
        await bridges.reconcile({
          namespace: target.namespace,
          projectId: project.id,
          projectName: project.name,
          controlUrl: platformRuntime.controlInternalUrl,
          token: signProjectRuntimeBridgeToken(
            { namespace: target.namespace, projectId: project.id },
            platformRuntime.runner.token,
          ),
        });
      }
      await stillCurrent();
      const observed = await this.db.projectRuntimeTarget.updateMany({
        where: {
          generation: target.generation,
          leaseOwner: reconciliationId,
          projectId: project.id,
          status: "reconciling",
        },
        data: {
          attempts: 0,
          lastError: null,
          lastReconciledAt: new Date(),
          leaseExpiresAt: null,
          leaseOwner: null,
          observedGeneration: target.generation,
          status: "ready",
        },
      });
      if (!observed.count) {
        throw new Error(
          `Project Runtime Target ${project.id} changed while generation ${target.generation} was being reconciled.`,
        );
      }
      return true;
    } catch (error) {
      await this.db.projectRuntimeTarget.updateMany({
        where: {
          generation: target.generation,
          leaseOwner: reconciliationId,
          projectId: project.id,
          status: "reconciling",
        },
        data: {
          lastError: safeError(error),
          leaseExpiresAt: null,
          leaseOwner: null,
          status: "retry",
        },
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
      // A deletion tombstone must keep its status while releasing our lease.
      await this.db.projectRuntimeTarget.updateMany({
        where: { projectId, leaseOwner: reconciliationId },
        data: { leaseOwner: null, leaseExpiresAt: null },
      });
    }
  }

  async reconciliationCandidateIds(
    referenceTime = new Date(),
    resyncIntervalMs = 5 * 60 * 1_000,
  ): Promise<string[]> {
    const runtime = (await loadPlatformRuntimeConfiguration(this.db))
      .runtimeNamespaces;

    const projects = await this.db.project.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        runtimeTarget: {
          select: {
            lastReconciledAt: true,
            leaseExpiresAt: true,
            status: true,
          },
        },
      },
    });
    const staleBefore = referenceTime.getTime() - resyncIntervalMs;
    return projects
      .filter(
        ({ runtimeTarget }) =>
          !runtimeTarget ||
          (!["failed", "deleting"].includes(runtimeTarget.status) &&
            (runtimeTarget.status !== "reconciling" ||
              !runtimeTarget.leaseExpiresAt ||
              runtimeTarget.leaseExpiresAt <= referenceTime) &&
            (runtimeTarget.status !== "ready" ||
              (runtime.enabled &&
                (!runtimeTarget.lastReconciledAt ||
                  runtimeTarget.lastReconciledAt.getTime() <= staleBefore)))),
      )
      .map(({ id }) => id);
  }

  async reconcileAll(): Promise<ProjectRuntimeReconciliationSummary> {
    const projects = await this.db.project.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const summary: ProjectRuntimeReconciliationSummary = {
      failed: 0,
      failures: [],
      ready: 0,
      skipped: 0,
      total: projects.length,
    };
    for (const project of projects) {
      try {
        if (await this.ensureProjectNamespace(project.id)) summary.ready += 1;
        else summary.skipped += 1;
      } catch (error) {
        summary.failed += 1;
        summary.failures.push({
          error: safeError(error),
          projectId: project.id,
        });
      }
    }
    return summary;
  }

  async deleteProjectNamespace(projectId: string): Promise<boolean> {
    const runtime = (await loadPlatformRuntimeConfiguration(this.db))
      .runtimeNamespaces;
    if (!runtime.enabled) return false;
    const namespaces =
      this.namespaces ??
      createProjectNamespaceClient({
        enabled: runtime.enabled,
      });
    const gateways = this.gateways ?? createProjectOpenShellGatewayClient();
    const target = await this.db.projectRuntimeTarget.findUnique({
      where: { projectId },
      select: {
        clusterId: true,
        namespace: true,
        leaseOwner: true,
        leaseExpiresAt: true,
      },
    });
    if (!target) return false;
    if (
      target.leaseOwner &&
      target.leaseExpiresAt &&
      target.leaseExpiresAt > new Date()
    ) {
      throw new Error(
        "Waiting for the in-flight Project initialization to stop before cleanup.",
      );
    }
    this.assertConfiguredCluster(target.clusterId, runtime.clusterId);
    await this.db.projectRuntimeTarget.update({
      where: { projectId },
      data: { lastError: null, status: "deleting" },
    });
    try {
      await gateways.delete(target.namespace);
      const deletionTimeoutSeconds = await new PlatformSettingsService(
        this.db,
      ).runtimeNamespaceDeletionTimeoutSeconds();
      await namespaces.deleteAndWait(
        target.namespace,
        projectId,
        deletionTimeoutSeconds * 1_000,
      );
      return true;
    } catch (error) {
      await this.db.projectRuntimeTarget.updateMany({
        where: { projectId },
        data: { lastError: safeError(error) },
      });
      throw error;
    }
  }

  private assertConfiguredCluster(
    clusterId: string,
    configuredClusterId: string,
  ): void {
    if (clusterId !== configuredClusterId) {
      throw new Error(
        `Project Runtime Target belongs to cluster ${clusterId}, but this Control Plane manages ${configuredClusterId}.`,
      );
    }
  }
}
