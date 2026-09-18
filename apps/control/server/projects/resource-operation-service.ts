import { randomUUID } from "node:crypto";
import { getControlConfig } from "../config/control-config";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import {
  controlJobQueue,
  type PgBossControlJobQueue,
} from "../jobs/control-job-queue";
import { encryptPlatformSecret } from "../platform/platform-secret-crypto";

export type ResourceAction =
  "onboard" | "discover" | "instantiate" | "remove" | "removeInstance";
export class ResourceOperationService {
  constructor(
    private db: PrismaClient = prisma(),
    private jobs: PgBossControlJobQueue = controlJobQueue(),
  ) {}
  async enqueue(
    projectId: string,
    actorId: string,
    action: ResourceAction,
    input: unknown,
  ) {
    await this.jobs.start();
    const id = randomUUID();
    await this.db.$transaction(async (transaction) => {
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
      await transaction.resourceOperationRecord.create({
        data: {
          id,
          projectId,
          actorId,
          action,
          inputEncrypted: encryptPlatformSecret(
            JSON.stringify(input),
            getControlConfig().auth.secret,
          ),
        },
      });
      await this.jobs.enqueueResourceOperation(projectId, id, transaction);
    });
    return {
      kind: "resource-operation" as const,
      operationId: id,
      status: "pending",
      statusUrl: `/api/v1/projects/${encodeURIComponent(projectId)}/resource-operations/${id}`,
    };
  }
  async get(
    projectId: string,
    id: string,
    actorId: string,
    administrator: boolean,
  ) {
    const operation = await this.db.resourceOperationRecord.findFirst({
      where: { id, projectId, ...(administrator ? {} : { actorId }) },
      select: {
        id: true,
        action: true,
        status: true,
        result: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!operation)
      throw new Error("Resource operation not found or access denied.");
    return operation;
  }
}
