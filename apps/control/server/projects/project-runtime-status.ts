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
      const target = await transaction.projectRuntimeTarget.findUnique({
        where: { projectId },
      });
      if (
        target?.leaseOwner &&
        target.leaseExpiresAt &&
        target.leaseExpiresAt > new Date()
      ) {
        throw new Error("Project initialization is still running.");
      }
      if (target?.status === "ready" || target?.status === "pending") return;
      await transaction.projectRuntimeTarget.upsert({
        where: { projectId },
        create: {
          projectId,
          clusterId: runtime.clusterId,
          namespace: projectRuntimeNamespace(projectId),
        },
        update: {
          generation: { increment: 1 },
          status: "pending",
          attempts: 0,
          lastError: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      // A retry may coalesce with the durable job that already owns this Project.
      await this.jobs!.enqueueProjectRuntimeReconcile(
        projectId,
        "retry",
        transaction,
      );
    });
    return this.get(projectId);
  }
}
