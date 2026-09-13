import { defineMiddleware } from "nitro";
import type { ResourceRelation } from "@tali/contracts";
import { requireAuth, unauthorizedResponse } from "../auth/auth";
import { prisma } from "../db/prisma";
import { errorResponse, problemResponse } from "../http/responses";
import { requireProjectCapability } from "../services";
import { markProjectAdmissionComplete } from "../authorization/authorization-context";
import {
  conditionalRequestRequirements,
  concreteRelation,
  projectRouteAdmissionPolicy,
  type RelationResolver,
} from "../authorization/route-capabilities";
import {
  activeRoleForMembership,
  membershipHasAccess,
  membershipAccessInclude,
  projectRoleFromBuiltinRole,
  type ProjectRole,
} from "../projects/project-access";
import { durableMemoryEnabledForProject } from "../memories/durable-memory-feature";

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.clone().json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function projectId(pathname: string): string {
  return decodeURIComponent(pathname.split("/")[4] ?? "");
}

async function ownership(
  request: Request,
  actorId: string,
  resolver: RelationResolver,
  resourceId?: string,
  preferredRole?: ProjectRole,
): Promise<{
  collectionRole?: ProjectRole;
  ownedByActor: boolean;
  resolvedRelation?: ResourceRelation;
}> {
  const path = new URL(request.url).pathname;
  const scopedProjectId = projectId(path);
  if (
    resolver === "INSTANCE_COLLECTION"
    || resolver === "EXPERT_AGENT_COLLECTION"
    || resolver === "TRACE_COLLECTION"
  ) {
    const membership = await prisma().projectMember.findUnique({
      where: {
        projectId_userId: { projectId: scopedProjectId, userId: actorId },
      },
      include: membershipAccessInclude,
    });
    const collectionRole = membership && membershipHasAccess(membership)
      ? activeRoleForMembership(membership, preferredRole)
      : undefined;
    return {
      ...(collectionRole ? { collectionRole } : {}),
      ownedByActor: false,
    };
  }
  if (resolver === "TRACE") {
    const run = resourceId
      ? await prisma().projectRunRecord.findFirst({
          where: {
            projectId: scopedProjectId,
            traceId: resourceId,
            expertAgentId: { not: null },
          },
          select: { expertAgentId: true },
        })
      : undefined;
    const relation = run?.expertAgentId
      ? await prisma().expertAgentMemberRecord.findFirst({
          where: {
            projectId: scopedProjectId,
            agentId: run.expertAgentId,
            userId: actorId,
            agent: { deletedAt: null },
          },
          select: { relation: true },
        })
      : undefined;
    return {
      ownedByActor: relation?.relation === "OWNER",
      ...(relation ? { resolvedRelation: relation.relation } : {}),
    };
  }
  if (resolver === "EXPERT_AGENT") {
    const relation = resourceId
      ? await prisma().expertAgentMemberRecord.findFirst({
          where: {
            projectId: scopedProjectId,
            agentId: resourceId,
            userId: actorId,
            agent: { deletedAt: null },
          },
          select: { relation: true },
        })
      : undefined;
    return {
      ownedByActor: relation?.relation === "OWNER",
      ...(relation ? { resolvedRelation: relation.relation } : {}),
    };
  }
  if (resolver === "INSTANCE") {
    const row = resourceId
      ? await prisma().agentRecord.findFirst({
          where: { projectId: scopedProjectId, id: resourceId, deletedAt: null },
          select: { ownerUserId: true },
        })
      : undefined;
    if (row) return { ownedByActor: row.ownerUserId === actorId };

    const relation = resourceId
      ? await prisma().expertAgentMemberRecord.findFirst({
          where: {
            projectId: scopedProjectId,
            agentId: resourceId,
            userId: actorId,
            agent: { deletedAt: null },
          },
          select: { relation: true },
        })
      : undefined;
    return {
      ownedByActor: relation?.relation === "OWNER",
      ...(relation ? { resolvedRelation: relation.relation } : {}),
    };
  }
  if (resolver === "REGISTERED_AGENT") {
    const row = resourceId
      ? await prisma().agentCatalogRecord.findFirst({
          where: { projectId: scopedProjectId, id: resourceId, deletedAt: null },
          select: { ownerUserId: true },
        })
      : undefined;
    return { ownedByActor: row?.ownerUserId === actorId };
  }
  return { ownedByActor: resolver === "NEW_OWNER" };
}

export default defineMiddleware(async (event) => {
  const url = new URL(event.req.url);
  const admission = projectRouteAdmissionPolicy(event.req.method, url.pathname);
  const isProjectScoped = /^\/api\/v1\/projects\/[^/]+(?:\/|$)/.test(url.pathname);
  if (!isProjectScoped || event.req.method.toUpperCase() === "OPTIONS") return;
  const scopedProjectId = projectId(url.pathname);
  if (
    /^\/api\/v1\/projects\/[^/]+\/memories(?:\/|$)/.test(url.pathname)
    && !durableMemoryEnabledForProject(scopedProjectId)
  ) {
    return problemResponse(404, "Durable Memory is not enabled for this Project.", {
      code: "feature_disabled",
    });
  }
  if (!admission) {
    return errorResponse(new Error(
      "Access denied: this Project route has no Capability admission policy.",
    ));
  }
  if (admission.skipBecauseCapabilityToken) return;

  let actorId: string;
  let preferredRole: ProjectRole | undefined;
  try {
    const auth = await requireAuth(event.req);
    actorId = auth.user.id;
    preferredRole = auth.accessContext?.level === "project"
      && auth.accessContext.resourceId === projectId(url.pathname)
      ? projectRoleFromBuiltinRole(auth.accessContext.roleId)
      : undefined;
  } catch (error) {
    return unauthorizedResponse(error);
  }

  try {
    if (admission.requiredActiveRole) {
      const membership = await prisma().projectMember.findUnique({
        where: {
          projectId_userId: { projectId: scopedProjectId, userId: actorId },
        },
        include: membershipAccessInclude,
      });
      const activeRole = membership && membershipHasAccess(membership)
        ? activeRoleForMembership(membership, preferredRole)
        : undefined;
      if (activeRole !== admission.requiredActiveRole) {
        return problemResponse(
          403,
          "Agent definition and development require the active Agent Developer role.",
          { code: "agent_developer_role_required" },
        );
      }
    }
    const ownershipResult = await ownership(
      event.req,
      actorId,
      admission.relation,
      admission.resourceId,
      preferredRole,
    );
    const relation = concreteRelation(
      admission.relation,
      ownershipResult.ownedByActor,
      ownershipResult.collectionRole,
      ownershipResult.resolvedRelation,
    );
    const requirements = [...admission.requirements];
    requirements.push(...conditionalRequestRequirements(
      admission,
      url,
      admission.kind === "INSTANCE_CREATE" ? await jsonBody(event.req) : {},
    ));
    for (const requirement of requirements) {
      await requireProjectCapability(event.req, requirement.capability, {
        relation,
        ...(admission.resourceId ? { resourceId: admission.resourceId } : {}),
        resourceType: requirement.resourceType,
      });
    }
    markProjectAdmissionComplete(event.req);
  } catch (error) {
    return errorResponse(error);
  }
});
