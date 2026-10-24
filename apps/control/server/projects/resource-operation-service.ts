import { randomUUID } from "node:crypto";
import { getControlConfig } from "../config/control-config";
import { prisma } from "../db/prisma";
import { hasA2aInstanceDeletedSinceOperation } from "../agent-garden/a2a-lifecycle-queries";
import { lockProjectRow } from "./project-row-lock";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import {
  controlJobQueue,
  type PgBossControlJobQueue,
} from "../jobs/control-job-queue";
import { decryptPlatformSecret, encryptPlatformSecret } from "../platform/platform-secret-crypto";

export type ResourceAction =
  "onboard" | "discover" | "instantiate" | "remove" | "removeInstance";

/** Check old jobs against tombstones before allowing them to provision again. */
export async function a2aCreationWasDeleted(
  transaction: Prisma.TransactionClient,
  operation: { id: string; projectId: string; action: string; inputEncrypted: string },
): Promise<boolean> {
  if (!["onboard", "discover", "instantiate"].includes(operation.action)) return false;
  const input = JSON.parse(decryptPlatformSecret(operation.inputEncrypted, getControlConfig().auth.secret));
  const agentId = operation.action === "onboard" ? operation.id : input.id;
  if (typeof agentId !== "string") return false;
  const agent = await transaction.agentCatalogRecord.findFirst({
    where: { projectId: operation.projectId, id: agentId }, select: { deletedAt: true },
  });
  if (agent?.deletedAt) return true;
  // New requests share the Project lock with deletion and are cancelled atomically.
  // They may be explicit replacements, including requests waiting on that lock.
  if (operation.action !== "onboard" && input.a2aDeletionFenceVersion === 1) return false;
  return hasA2aInstanceDeletedSinceOperation(transaction, {
    operationId: operation.id, projectId: operation.projectId, agentId,
  });
}

/** Caller holds the Project row lock, shared with creation claims and writes. */
export async function prepareA2aDeletion(
  transaction: Prisma.TransactionClient,
  projectId: string,
  action: "remove" | "removeInstance",
  input: unknown,
): Promise<boolean> {
  if (!input || typeof input !== "object" || !("id" in input) || typeof input.id !== "string") return false;
  let agentId: string | null;
  let alreadyDeleted = false;
  if (action === "remove") {
    const agent = await transaction.agentCatalogRecord.findFirst({ where: { projectId, id: input.id } });
    if (!agent) return false;
    if ((agent.payload as { source?: string }).source !== "PROJECT_REGISTERED") {
      throw new Error("Built-in Agents are managed by TaskLattice Relay.");
    }
    alreadyDeleted = Boolean(agent.deletedAt);
    agentId = agent.id;
    if (!alreadyDeleted) await transaction.agentCatalogRecord.update({
      where: { projectId_id: { projectId, id: agent.id } }, data: { deletedAt: new Date() },
    });
  } else {
    const instance = await transaction.agentRecord.findFirst({
      where: { projectId, id: input.id, kind: "A2A" },
    });
    if (!instance) return false;
    // A repeated delete must not cancel an explicitly created replacement.
    alreadyDeleted = Boolean(instance.deletedAt);
    agentId = instance.catalogAgentId;
  }
  const instances = alreadyDeleted ? [] : await transaction.agentRecord.findMany({
    where: { projectId, kind: "A2A", deletedAt: null,
      ...(action === "remove" ? { catalogAgentId: agentId } : { id: input.id }),
    },
  });
  for (const instance of instances) {
    const payload = instance.payload as Record<string, Prisma.InputJsonValue>;
    await transaction.agentRecord.update({
      where: { projectId_id: { projectId, id: instance.id } },
      data: { deletedAt: new Date(), payload: { ...payload, status: "DESTROYING" } },
    });
  }
  const creations = await transaction.resourceOperationRecord.findMany({
    where: { projectId, action: { in: ["instantiate", "onboard", "discover"] },
      status: { in: ["pending", "running", "retry"] },
    },
  });
  for (const creation of creations) {
    const request = JSON.parse(decryptPlatformSecret(creation.inputEncrypted, getControlConfig().auth.secret));
    const targetAgentId = creation.action === "onboard" ? creation.id : request.id;
    if (targetAgentId !== agentId) continue;
    if (alreadyDeleted && !(await a2aCreationWasDeleted(transaction, creation))) continue;
    await transaction.resourceOperationRecord.updateMany({
      where: { id: creation.id, status: { in: ["pending", "running", "retry"] } },
      data: { status: "cancelled", lastError: "A2A creation cancelled by deletion." },
    });
  }
  return true;
}

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
    let background = false;
    await this.db.$transaction(async (transaction) => {
      await lockProjectRow(transaction, projectId);
      const project = await transaction.project.findUnique({
        where: { id: projectId },
        select: { deletedAt: true },
      });
      if (!project || project.deletedAt)
        throw new Error("Project is unavailable or being deleted.");
      if (action === "removeInstance" || action === "remove") {
        background = await prepareA2aDeletion(transaction, projectId, action, input);
      }
      await transaction.resourceOperationRecord.create({
        data: {
          id,
          projectId,
          actorId,
          action,
          inputEncrypted: encryptPlatformSecret(
            JSON.stringify(
              (action === "instantiate" || action === "discover") && input && typeof input === "object"
                ? { ...input, a2aDeletionFenceVersion: 1 }
                : input,
            ),
            getControlConfig().auth.secret,
          ),
        },
      });
      await this.jobs.enqueueResourceOperation(projectId, id, transaction, action === "removeInstance" || action === "remove");
    });
    return {
      kind: "resource-operation" as const,
      operationId: id,
      status: background ? "DESTROYING" : "pending",
      ...(background ? { background: true, accepted: true, id: (input as { id: string }).id } : {}),
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
