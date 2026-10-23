import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { membershipHasAccess } from "./project-access";
import { WorkError } from "../works/work-domain";

export async function ownsPersonalProject(db: PrismaClient | Prisma.TransactionClient, projectId: string, userId: string) {
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, include: { user: true, project: { include: { department: true } } } });
  const departmentId = `personal-${createHash("sha256").update(userId).digest("hex").slice(0, 24)}`;
  return Boolean(member && membershipHasAccess(member) && member.user.status === "active" && !member.project.deletedAt
    && member.project.createdBy === userId && member.project.departmentId === departmentId
    && member.project.department.createdBy === userId && member.project.department.status === "active");
}
export async function requirePersonalProject(db: PrismaClient | Prisma.TransactionClient, projectId: string, userId: string) {
  if (!await ownsPersonalProject(db, projectId, userId)) throw new WorkError("仅能初始化你自己的个人 Project。", 403, "personal_project_required");
}
