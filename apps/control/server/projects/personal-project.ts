import { createHash } from "node:crypto";
import type { PlatformPrincipal } from "../auth/auth";
import type { PrismaClient } from "../generated/prisma/client";
import { generateProjectId } from "./project-runtime-identity";

/** First-use personal resource boundary. Never enrolls a user into someone
 * else's Project and never restores a revoked/deleted membership. */
export async function ensurePersonalProject(
  db: PrismaClient,
  auth: PlatformPrincipal,
): Promise<string | null> {
  if (auth.user.systemRole !== "user") return null;
  // Historical assignment is deliberate: revocation must remain fail-closed.
  if (await db.projectMember.count({ where: { userId: auth.user.id } }))
    return null;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasklattice.users WHERE id=${auth.user.id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: auth.user.id } });
    if (!user || user.status !== "active")
      throw new Error("Access denied: account unavailable.");
    if (await tx.projectMember.count({ where: { userId: user.id } }))
      return null;
    const suffix = createHash("sha256")
      .update(user.id)
      .digest("hex")
      .slice(0, 24);
    const departmentId = `personal-${suffix}`;
    // A prior personal container without access is not an invitation to regain it.
    if (await tx.department.findUnique({ where: { id: departmentId } }))
      return null;
    await tx.department.create({
      data: {
        id: departmentId,
        name: `Personal ${suffix}`,
        description: "Private personal resource container",
        createdBy: user.id,
      },
    });
    const projectId = generateProjectId();
    await tx.project.create({
      data: {
        id: projectId,
        name: "我的 Project",
        departmentId,
        createdBy: user.id,
      },
    });
    await tx.projectMember.create({
      data: { projectId, userId: user.id, role: "user" },
    });
    await tx.projectMemberRoleAssignment.create({
      data: { projectId, userId: user.id, role: "user" },
    });
    // Empty means no inherited models, runtime, tools, seeded Agents or workloads.
    // Funding/provisioning is a separate explicit onboarding operation.
    await tx.projectQuotaRecord.create({
      data: {
        projectId,
        hardBudgetUsd: 0,
        budgetDuration: "30d",
        budgetPeriodStartedAt: new Date(),
        budgetResetsAt: new Date(Date.now() + 30 * 86400_000),
      },
    });
    return projectId;
  });
}
