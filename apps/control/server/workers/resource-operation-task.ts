import { randomUUID } from "node:crypto";
import { getControlConfig } from "../config/control-config";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { decryptPlatformSecret } from "../platform/platform-secret-crypto";
import { AgentGardenService } from "../agent-garden/agent-garden-service";
import { AgentGardenStore } from "../agent-garden/agent-garden-store";
import type { ControlJobMetadata } from "../jobs/control-job-queue";

export async function runResourceOperation(
  db: PrismaClient,
  job: ControlJobMetadata<{ projectId: string; operationId: string }>,
  factory?: () => Pick<
    AgentGardenService,
    "onboard" | "discover" | "instantiate" | "remove" | "removeInstance"
  >,
) {
  const { projectId, operationId } = job.data;
  const leaseId = randomUUID();
  const operation = await db.resourceOperationRecord.findFirst({
    where: { id: operationId, projectId },
  });
  if (
    !operation ||
    ["completed", "failed", "cancelled"].includes(operation.status)
  )
    return;
  const acquired = await db
    .$transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(
        "SELECT id FROM tasklattice.projects WHERE id = $1 FOR UPDATE",
        projectId,
      );
      const project = await transaction.project.findUnique({
        where: { id: projectId },
        select: { deletedAt: true },
      });
      if (!project || project.deletedAt) {
        await transaction.resourceOperationRecord.update({
          where: { id: operationId },
          data: { status: "cancelled" },
        });
        return false;
      }
      const claim = await transaction.projectRuntimeTarget.updateMany({
        where: {
          projectId,
          status: "ready",
          OR: [{ leaseOwner: null }, { leaseExpiresAt: { lte: new Date() } }],
        },
        data: {
          leaseOwner: leaseId,
          leaseExpiresAt: new Date(Date.now() + 600000),
        },
      });
      if (!claim.count)
        throw new Error(
          "Waiting for Project initialization or another resource operation.",
        );
      await transaction.resourceOperationRecord.update({
        where: { id: operationId },
        data: { status: "running", lastError: null },
      });
      return true;
    })
    .catch(async (error) => {
      await db.resourceOperationRecord.updateMany({
        where: { id: operationId, status: { in: ["pending", "retry"] } },
        data: {
          status: job.retryCount >= job.retryLimit ? "failed" : "retry",
          lastError: String(error).slice(0, 4000),
        },
      });
      throw error;
    });
  if (!acquired) return;
  let leaseLost = false;
  const timer = setInterval(() => {
    void db.projectRuntimeTarget
      .updateMany({
        where: { projectId, leaseOwner: leaseId },
        data: { leaseExpiresAt: new Date(Date.now() + 600000) },
      })
      .then((result) => {
        if (!result.count) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, 30000);
  timer.unref();
  try {
    const input = JSON.parse(
      decryptPlatformSecret(
        operation.inputEncrypted,
        getControlConfig().auth.secret,
      ),
    );
    const garden =
      factory?.() ??
      new AgentGardenService(
        new AgentGardenStore(projectId, db),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        operationId,
      );
    let result: unknown;
    switch (operation.action) {
      case "onboard":
        result = await garden.onboard(input, operation.actorId);
        break;
      case "discover":
        result = await garden.discover(input.id, operation.actorId);
        break;
      case "instantiate":
        result = await garden.instantiate(
          input.id,
          operation.actorId,
          input.versionId,
        );
        break;
      case "remove":
        await garden.remove(input.id);
        result = { message: "Registered Agent removed." };
        break;
      case "removeInstance":
        await garden.removeInstance(input.id);
        result = { id: input.id, status: "DESTROYING", accepted: true };
        break;
      default:
        throw new Error("Unknown resource operation.");
    }
    if (
      result &&
      typeof result === "object" &&
      "status" in result &&
      ["FAILED", "ERROR"].includes(String(result.status))
    ) {
      throw new Error(
        "Runtime provisioning failed; inspect the Instance or Agent error for details.",
      );
    }
    const lease = await db.projectRuntimeTarget.findUnique({
      where: { projectId },
      select: { leaseOwner: true },
    });
    if (leaseLost || lease?.leaseOwner !== leaseId)
      throw new Error("Resource operation lease was lost.");
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { deletedAt: true },
    });
    await db.resourceOperationRecord.update({
      where: { id: operationId },
      data: {
        status: !project || project.deletedAt ? "cancelled" : "completed",
        result: result as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    const lease = await db.projectRuntimeTarget.findUnique({
      where: { projectId },
      select: { leaseOwner: true },
    });
    if (lease?.leaseOwner !== leaseId) throw error;
    await db.resourceOperationRecord.updateMany({
      where: { id: operationId },
      data: {
        status: job.retryCount >= job.retryLimit ? "failed" : "retry",
        lastError: (error instanceof Error
          ? error.message
          : "Resource operation failed"
        ).slice(0, 4000),
      },
    });
    throw error;
  } finally {
    clearInterval(timer);
    await db.projectRuntimeTarget.updateMany({
      where: { projectId, leaseOwner: leaseId },
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
  }
}
