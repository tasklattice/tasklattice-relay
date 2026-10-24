import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";

const deletionResultSchema = z.tuple([z.object({ deleted: z.boolean() })]);

/**
 * Keep the cross-table timestamp comparison in PostgreSQL: loading timestamps
 * into JavaScript Date would lose the microseconds used by historical jobs.
 * Caller holds the Project row lock while deciding whether to cancel the job.
 */
export async function hasA2aInstanceDeletedSinceOperation(
  transaction: Prisma.TransactionClient,
  input: { projectId: string; operationId: string; agentId: string },
): Promise<boolean> {
  const rows = await transaction.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM tasklattice.agents a
      JOIN tasklattice.resource_operations o ON o.project_id = a.project_id
      WHERE o.id = ${input.operationId}::uuid
        AND a.project_id = ${input.projectId}
        AND a.catalog_agent_id = ${input.agentId}
        AND a.kind = 'A2A' AND a.deleted_at >= o.created_at
    ) AS deleted
  `;
  // Raw query generics alone do not validate database result shapes.
  return deletionResultSchema.parse(rows)[0].deleted;
}
