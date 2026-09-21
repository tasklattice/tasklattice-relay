import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import {
  controlJobQueue,
  type ControlJobPublisher,
} from "../jobs/control-job-queue";
import { projectRuntimeNamespace } from "./project-runtime-identity";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";

export class ProjectRuntimeStatusService {
  constructor(
    private readonly db: PrismaClient = prisma(),
    private jobs?: ControlJobPublisher,
  ) {}

  async get(projectId: string) {
    const target = await this.db.projectRuntimeTarget.findUnique({
      where: { projectId },
    });
    return {
      status: target?.status ?? "pending",
      generation: target?.generation ?? 1,
      observedGeneration: target?.observedGeneration ?? 0,
      attempts: target?.attempts ?? 0,
      lastError: target?.lastError ?? null,
      updatedAt: target?.updatedAt.toISOString() ?? null,
    };
  }

  async retry(projectId: string) {
    return this.schedule(projectId, false);
  }

  async reinitialize(projectId: string) {
    return this.schedule(projectId, true);
  }

  private async schedule(projectId: string, reinitialize: boolean) {
    this.jobs ??= controlJobQueue();
    await this.jobs.start();
    const runtime = (await loadPlatformRuntimeConfiguration(this.db))
      .runtimeNamespaces;
    await this.db.$transaction(async (transaction) => {
      // Lock the same Project row as deletion before changing the desired state.
      await transaction.$queryRawUnsafe(
        "SELECT id FROM tasklattice.projects WHERE id = $1 FOR UPDATE",
        projectId,
      );
      const project = await transaction.project.findUnique({
        where: { id: projectId },
        select: { deletedAt: true },
      });
      if (!project || project.deletedAt)
        throw new Error("Project is unavailable or being deleted.");
      // Serialize with Worker lease acquisition, not just other user requests.
      await transaction.$queryRawUnsafe(
        "SELECT project_id FROM tasklattice.project_runtime_targets WHERE project_id = $1 FOR UPDATE",
        projectId,
      );
      const target = await transaction.projectRuntimeTarget.findUnique({
        where: { projectId },
      });
      if (target?.status === "deleting")
        throw Object.assign(new Error("Project is being deleted."), { status: 409 });
      if (
        target?.leaseOwner &&
        target.leaseExpiresAt &&
        target.leaseExpiresAt > new Date()
      ) {
        throw Object.assign(new Error("A Project runtime operation is still running. Try again after it finishes."), { status: 409 });
      }
      if (!reinitialize && (target?.status === "ready" || target?.status === "pending")) return;
      if (reinitialize && !runtime.enabled)
        throw Object.assign(new Error("Enable runtime namespaces in Platform Settings before reinitializing."), { status: 409 });
      if (target && (target.clusterId !== runtime.clusterId || target.namespace !== projectRuntimeNamespace(projectId)))
        throw Object.assign(new Error("The recorded Project runtime target does not match the configured cluster and Namespace."), { status: 409 });
      await transaction.projectRuntimeTarget.upsert({
        where: { projectId },
        create: {
          projectId,
          clusterId: runtime.clusterId,
          namespace: projectRuntimeNamespace(projectId),
        },
        update: {
          generation: { increment: target?.status === "pending" ? 0 : 1 },
          status: "pending",
          attempts: 0,
          lastError: null,
          nextAttemptAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      // A retry may coalesce with the durable job that already owns this Project.
      await this.jobs!.enqueueProjectRuntimeReconcile(
        projectId,
        reinitialize ? "manual" : "retry",
        transaction,
      );
    });
    return this.get(projectId);
  }
}
