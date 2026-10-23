import { createHash } from "node:crypto";
import { workStateSchema } from "@tali/contracts";
import type { PrismaClient, WorkRunRecord } from "../generated/prisma/client";
import { CostAnalyticsStore } from "../providers/cost-analytics-store";
import { tokenIdentifier } from "../providers/cost-service";

/** Durable issuance ledger, written before any inference. Revoking the key must
 * not delete this record: asynchronous spend ingestion still needs its identity.
 * Names are billing-time snapshots; Task IDs are scoped by Work. */
export async function recordWorkModelKey(
  db: PrismaClient,
  run: WorkRunRecord,
  key: { tokenId: string; secret: string },
  teamId: string,
  issuedAt: Date,
): Promise<void> {
  const work = await db.workRecord.findUniqueOrThrow({
    where: { projectId_id: { projectId: run.projectId, id: run.workId } },
  });
  const instance = await db.agentRecord.findUniqueOrThrow({
    where: { projectId_id: { projectId: run.projectId, id: run.instanceId } },
  });
  const state = workStateSchema.parse(work.state);
  const task = state.tasks.find(task => task.id === run.taskId);
  if (run.taskId && !task) throw new Error("Cannot attribute an unknown Work Task.");
  // LiteLLM may return the raw key or its SHA-256 digest as token. Spend logs
  // normally contain the digest. Normalize both without persisting credentials.
  const gatewayDigest = createHash("sha256").update(key.secret).digest("hex");
  await new CostAnalyticsStore(db, run.projectId).saveAttribution({
    id: `work-key:${run.id}:${gatewayDigest}`,
    projectId: run.projectId,
    workId: run.workId,
    workName: state.title,
    ...(run.taskId ? { taskId: run.taskId, taskName: task!.title } : {}),
    workRunId: run.id,
    instanceId: run.instanceId,
    instanceName: (instance.payload as { name?: string }).name ?? instance.id,
    liteLLMVirtualKeyId: tokenIdentifier(key.tokenId)!,
    hashedToken: tokenIdentifier(gatewayDigest)!,
    virtualKeyAlias: `work-${run.id}`,
    liteLLMTeamId: teamId,
    validFrom: issuedAt.toISOString(),
    // No end bound: this unique key is never reassigned, including after revoke.
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}
