import type {
  AuthorizationDecision,
  BuiltinRoleView,
  BuiltinProjectRoleId,
  ProjectCapability,
  ResourceRelation,
} from "@tali/contracts";
import { ownsPersonalProject } from "../projects/personal-project-access";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { appendAdmissionEvidence, type AdmissionEvidence } from "./authorization-context";
import { RoleCatalogService } from "./role-catalog";
import {
  activeBuiltinRoleIds,
  membershipHasAccess,
  membershipAccessInclude,
  type ProjectRole,
} from "../projects/project-access";

export interface AdmissionInput {
  actorId: string;
  capability: ProjectCapability;
  explicitDeny?: boolean;
  projectId: string;
  relation?: ResourceRelation;
  requireApproval?: boolean;
  resourceId?: string;
  resourceType: string;
  roleIds: readonly BuiltinProjectRoleId[];
}

export interface AdmissionResult extends AdmissionEvidence {}

function relationCovered(
  granted: readonly ResourceRelation[],
  requested: ResourceRelation,
): boolean {
  // PROJECT_ANY is a wildcard only within this particular Capability grant.
  // It never widens the scope of another Capability on the same role.
  return granted.includes("PROJECT_ANY") || granted.includes(requested);
}

function result(
  input: AdmissionInput,
  decision: AuthorizationDecision,
  reason: string,
  roleId?: BuiltinProjectRoleId,
  policyId?: string,
): AdmissionResult {
  return {
    actorId: input.actorId,
    capability: input.capability,
    decision,
    projectId: input.projectId,
    reason,
    relation: input.relation ?? "PROJECT_ANY",
    resourceType: input.resourceType,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    ...(roleId ? { roleId } : {}),
    ...(policyId ? { policyId } : {}),
  };
}

type AdmissionRoleDefinition = Pick<BuiltinRoleView, "grants" | "id">;

export function evaluateAdmission(
  input: AdmissionInput,
  roleDefinitions: readonly AdmissionRoleDefinition[],
): AdmissionResult {
  if (input.explicitDeny) {
    return result(input, "DENY", "An explicit policy denied this request.");
  }
  if (!input.roleIds.length) {
    return result(input, "DENY", "The actor has no Project role binding.");
  }

  const relation = input.relation ?? "PROJECT_ANY";
  const definitions = new Map(
    roleDefinitions.map((definition) => [definition.id, definition]),
  );
  const capabilityRole = input.roleIds.find((id) =>
    definitions.get(id)?.grants.some(
      (grant) => grant.capability === input.capability,
    ),
  );
  if (!capabilityRole) {
    return result(
      input,
      "DENY",
      `No bound role grants ${input.capability}.`,
    );
  }
  const relationRole = input.roleIds.find((id) => {
    const definition = definitions.get(id);
    return definition?.grants.some((grant) =>
      grant.capability === input.capability
      && relationCovered(grant.relations, relation)
    ) ?? false;
  });
  if (!relationRole) {
    return result(
      input,
      "DENY",
      `The grant does not cover resource relation ${relation}.`,
      capabilityRole,
    );
  }

  const requiresApproval = input.requireApproval ?? false;
  if (requiresApproval) {
    const maySubmit = input.roleIds.some((id) => {
      const definition = definitions.get(id);
      return definition?.grants.some((grant) =>
        grant.capability === "CAP_APPROVAL_REQUEST_SUBMIT"
        && relationCovered(grant.relations, relation)
      ) ?? false;
    });
    if (!maySubmit) {
      return result(
        input,
        "DENY",
        `The actor may not submit the approval required for ${input.capability}.`,
        relationRole,
      );
    }
    return result(
      input,
      "APPROVAL_REQUIRED",
      `${input.capability} requires an approved governed change.`,
      relationRole,
      "builtin:governed-change",
    );
  }
  return result(
    input,
    "ALLOW",
    `${relationRole} grants ${input.capability} for ${relation}.`,
    relationRole,
  );
}

export class CapabilityAdmissionError extends Error {
  readonly evidence: AdmissionEvidence;

  constructor(evidence: AdmissionEvidence) {
    super(
      evidence.decision === "APPROVAL_REQUIRED"
        ? `Approval required for ${evidence.capability}.`
        : `Access denied: ${evidence.capability} is not granted.`,
    );
    this.name = "CapabilityAdmissionError";
    this.evidence = evidence;
  }
}

export interface ProjectCapabilityRequirement {
  relation?: ResourceRelation;
  resourceId?: string;
  resourceType: string;
}

function projectIdFromRequest(request: Request): string {
  const match = new URL(request.url).pathname.match(
    /^\/api\/v1\/projects\/([^/]+)(?:\/|$)/,
  );
  if (!match) throw new Error("Project scope is required in the request path.");
  return decodeURIComponent(match[1]!);
}

export class ProjectAdmissionService {
  constructor(private readonly db: PrismaClient = prisma()) {}

  async authorize(
    request: Request,
    actorId: string,
    capability: ProjectCapability,
    requirement: ProjectCapabilityRequirement,
    preferredRole?: ProjectRole | null,
  ): Promise<AdmissionResult> {
    const projectId = projectIdFromRequest(request);
    const membership = await this.db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actorId } },
      include: {
        ...membershipAccessInclude,
        project: {
          select: {
            deletedAt: true,
          },
        },
      },
    });
    const roleIds = membership
      && membershipHasAccess(membership)
      && !membership.project.deletedAt
      && preferredRole !== null
      ? activeBuiltinRoleIds(membership, preferredRole)
      : [];
    const roleDefinitions = await new RoleCatalogService(this.db).roles(roleIds);
    let evidence = evaluateAdmission({
      actorId,
      capability,
      projectId,
      roleIds,
      ...requirement,
    }, roleDefinitions);
    // Personal owners can inspect their own bill without receiving enterprise
    // administrator/developer grants. Enterprise Projects keep normal RBAC.
    if (evidence.decision === "DENY" && roleIds.length > 0
      && request.method === "GET"
      && /^\/api\/v1\/projects\/[^/]+\/costs\/[^/]+$/.test(new URL(request.url).pathname)
      && ["CAP_COST_VIEW", "CAP_USAGE_DATA_QUALITY_VIEW"].includes(capability)
      && await ownsPersonalProject(this.db, projectId, actorId)) {
      evidence = { ...evidence, decision: "ALLOW", policyId: "personal-owner:cost-read",
        reason: "The active personal Project owner may read their own usage and cost." };
    }
    appendAdmissionEvidence(request, evidence);
    if (evidence.decision !== "ALLOW") {
      throw new CapabilityAdmissionError(evidence);
    }
    return evidence;
  }
}
