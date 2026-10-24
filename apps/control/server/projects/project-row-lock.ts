import type { Prisma } from "../generated/prisma/client";

/**
 * Call inside the transaction that reads and writes the protected state.
 * The lock lasts until commit/rollback; a missing Project is checked by callers.
 * Prisma model queries do not express SELECT FOR UPDATE.
 */
export async function lockProjectRow(
  transaction: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT id FROM tasklattice.projects WHERE id = ${projectId} FOR UPDATE
  `;
}

/** Acquire after lockProjectRow when both rows are needed. */
export async function lockProjectRuntimeTargetRow(
  transaction: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT project_id FROM tasklattice.project_runtime_targets
    WHERE project_id = ${projectId} FOR UPDATE
  `;
}
