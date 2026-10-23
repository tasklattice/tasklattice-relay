import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createTestPrisma } from "../test/prisma";
import { errorResponse } from "../http/responses";
import {
  CapabilityAdmissionError,
  ProjectAdmissionService,
  evaluateAdmission,
} from "./admission-control";
import { admissionEvidenceForRequest } from "./authorization-context";
import { RoleCatalogService } from "./role-catalog";

let database: PrismaClient;
let roleDefinitions: Awaited<ReturnType<RoleCatalogService["catalog"]>>["roles"];

beforeEach(async () => {
  database = createTestPrisma();
  roleDefinitions = (await new RoleCatalogService(database).catalog()).roles;
});

afterEach(async () => {
  await database?.$disconnect();
});

function admit(input: Parameters<typeof evaluateAdmission>[0]) {
  return evaluateAdmission(input, roleDefinitions);
}

describe("capability admission evaluator", () => {
  it("allows a matching capability and resource relation", () => {
    expect(admit({
      actorId: "developer-1",
      capability: "CAP_AGENT_INSTANCE_DELETE",
      projectId: "project-1",
      relation: "OWNER",
      resourceType: "AgentInstance",
      roleIds: ["ROLE_AGENT_DEVELOPER"],
    })).toMatchObject({
      decision: "ALLOW",
      roleId: "ROLE_AGENT_DEVELOPER",
      relation: "OWNER",
    });
  });

  it("uses capability-level scopes and treats PROJECT_ANY as a grant wildcard", () => {
    expect(admit({
      actorId: "developer-1",
      capability: "CAP_PROJECT_QUOTA_VIEW",
      projectId: "project-1",
      relation: "PROJECT_ANY",
      resourceType: "ProjectQuota",
      roleIds: ["ROLE_AGENT_DEVELOPER"],
    }).decision).toBe("ALLOW");
    expect(admit({
      actorId: "developer-1",
      capability: "CAP_AGENT_INSTANCE_DELETE",
      projectId: "project-1",
      relation: "PROJECT_ANY",
      resourceType: "AgentInstance",
      roleIds: ["ROLE_AGENT_DEVELOPER"],
    }).decision).toBe("DENY");
    expect(admit({
      actorId: "admin-1",
      capability: "CAP_AGENT_INSTANCE_CONFIG_VIEW",
      projectId: "project-1",
      relation: "OWNER",
      resourceType: "AgentInstance",
      roleIds: ["ROLE_PROJECT_ADMIN"],
    }).decision).toBe("ALLOW");
  });

  it("fails closed when a capability or relation is missing", () => {
    expect(admit({
      actorId: "user-1",
      capability: "CAP_AGENT_INSTANCE_DELETE",
      projectId: "project-1",
      relation: "ASSIGNED",
      resourceType: "AgentInstance",
      roleIds: ["ROLE_USER"],
    }).decision).toBe("DENY");
    expect(admit({
      actorId: "developer-1",
      capability: "CAP_AGENT_INSTANCE_DELETE",
      projectId: "project-1",
      relation: "PROJECT_ANY",
      resourceType: "AgentInstance",
      roleIds: ["ROLE_AGENT_DEVELOPER"],
    })).toMatchObject({ decision: "DENY", roleId: "ROLE_AGENT_DEVELOPER" });
    expect(admit({
      actorId: "orphan",
      capability: "CAP_PROJECT_VIEW",
      projectId: "project-1",
      resourceType: "Project",
      roleIds: [],
    }).decision).toBe("DENY");
  });

  it("does not let the builtin Auditor read raw Instance sandbox audit", () => {
    const common = {
      actorId: "auditor-1",
      projectId: "project-1",
      relation: "PROJECT_ANY" as const,
      roleIds: ["ROLE_AUDITOR"] as const,
    };
    expect(admit({
      ...common,
      capability: "CAP_AUDIT_DETAIL_VIEW",
      resourceType: "AgentInstance",
    }).decision).toBe("ALLOW");
    expect(admit({
      ...common,
      capability: "CAP_AUDIT_SENSITIVE_CONTENT_VIEW",
      resourceType: "AgentInstanceAudit",
    }).decision).toBe("DENY");
  });

  it("prioritizes explicit deny and enforces explicit approval policy", () => {
    expect(admit({
      actorId: "developer-1",
      capability: "CAP_AGENT_INSTANCE_DELETE",
      explicitDeny: true,
      projectId: "project-1",
      relation: "OWNER",
      resourceType: "AgentInstance",
      roleIds: ["ROLE_AGENT_DEVELOPER"],
    }).decision).toBe("DENY");
    const approval = admit({
      actorId: "developer-1",
      capability: "CAP_AGENT_INSTANCE_DELETE",
      projectId: "project-1",
      relation: "OWNER",
      requireApproval: true,
      resourceType: "AgentInstance",
      roleIds: ["ROLE_AGENT_DEVELOPER"],
    });
    expect(approval).toMatchObject({
      decision: "APPROVAL_REQUIRED",
      policyId: "builtin:governed-change",
    });
    const response = errorResponse(new CapabilityAdmissionError(approval));
    expect(response.status).toBe(403);
    return expect(response.json()).resolves.toMatchObject({
      authorization: {
        capability: "CAP_AGENT_INSTANCE_DELETE",
        decision: "APPROVAL_REQUIRED",
        policyId: "builtin:governed-change",
      },
    });
  });

  it("resolves every builtin membership role and records request-scoped evidence", async () => {
    const roles = [
      ["admin", "CAP_PROVIDER_VALIDATE", "PROJECT_ANY"],
      ["auditor", "CAP_AUDIT_DETAIL_VIEW", "PROJECT_ANY"],
      ["developer", "CAP_AGENT_INSTANCE_CREATE", "OWNER"],
      ["user", "CAP_AGENT_INSTANCE_INTERACT", "ASSIGNED"],
      ["reviewer", "CAP_APPROVAL_REQUEST_DECIDE", "PROJECT_ANY"],
    ] as const;
    await database.user.createMany({
      data: roles.map(([role]) => ({
        id: `user-${role}`,
        username: `user-${role}`,
        email: `${role}@example.test`,
        displayName: role,
      })),
    });
    await database.projectMember.createMany({
      data: roles.map(([role]) => ({
        projectId: "individual",
        userId: `user-${role}`,
        role,
      })),
    });
    const service = new ProjectAdmissionService(database);
    for (const [role, capability, relation] of roles) {
      const request = new Request("http://tali.test/api/v1/projects/individual/resource");
      await expect(service.authorize(
        request,
        `user-${role}`,
        capability,
        { relation, resourceType: "TestResource" },
      )).resolves.toMatchObject({ decision: "ALLOW" });
      expect(admissionEvidenceForRequest(request)).toHaveLength(1);
    }
  });

  it("does not infer service-only capabilities from Project identity", async () => {
    const service = new ProjectAdmissionService(database);
    await database.project.create({
      data: {
        id: "team-admin-boundary",
        name: "Team Admin Boundary",
        departmentId: "dep1",
        createdBy: "local-admin",
        humanMembers: { create: { userId: "local-admin", role: "admin" } },
      },
    });
    const request = new Request(
      "http://tali.test/api/v1/projects/team-admin-boundary/resource",
    );
    await expect(service.authorize(
      request,
      "local-admin",
      "CAP_APPROVAL_OVERRIDE",
      { relation: "PROJECT_ANY", resourceType: "ApprovalRequest" },
    )).rejects.toBeInstanceOf(CapabilityAdmissionError);
    expect(admissionEvidenceForRequest(request)[0]?.decision).toBe("DENY");
  });

  it("does not let a Platform Administrator bypass Project membership", async () => {
    const service = new ProjectAdmissionService(database);
    const request = new Request("http://tali.test/api/v1/projects/individual/resource");
    await expect(service.authorize(
      request,
      "missing-platform-administrator",
      "CAP_PROJECT_SETTINGS_UPDATE",
      { resourceType: "Project" },
    )).rejects.toBeInstanceOf(CapabilityAdmissionError);
    expect(admissionEvidenceForRequest(request)[0]).toMatchObject({
      decision: "DENY",
      reason: "The actor has no Project role binding.",
    });
  });
});

describe("personal billing read access", () => {
  it("allows only an active personal owner to read costs, without quota-edit grants", async () => {
    const { createHash } = await import("node:crypto");
    const userId = "billing-personal-owner";
    const depId = `personal-${createHash("sha256").update(userId).digest("hex").slice(0,24)}`;
    await database.user.create({data:{id:userId,email:"billing@example.invalid",displayName:"Billing test"}});
    await database.department.create({data:{id:depId,name:"Personal",createdBy:userId}});
    await database.project.create({data:{id:"billing-personal",name:"Personal",departmentId:depId,createdBy:userId}});
    await database.projectMember.create({data:{projectId:"billing-personal",userId,role:"user"}});
    const service = new ProjectAdmissionService(database);
    const request = new Request("http://local/api/v1/projects/billing-personal/costs/summary");
    expect(await service.authorize(request,userId,"CAP_COST_VIEW",{resourceType:"Cost"},"user")).toMatchObject({decision:"ALLOW",policyId:"personal-owner:cost-read"});
    await expect(service.authorize(new Request("http://local/api/v1/projects/billing-personal/quota",{method:"PUT"}),userId,"CAP_PROJECT_QUOTA_UPDATE",{resourceType:"ProjectQuota"},"user")).rejects.toBeInstanceOf(CapabilityAdmissionError);
    await database.project.update({where:{id:"billing-personal"},data:{departmentId:"dep1"}});
    await expect(service.authorize(request,userId,"CAP_COST_VIEW",{resourceType:"Cost"},"user")).rejects.toBeInstanceOf(CapabilityAdmissionError);
    await database.project.update({where:{id:"billing-personal"},data:{departmentId:depId}});
    await database.projectMember.update({where:{projectId_userId:{projectId:"billing-personal",userId}},data:{manualAccess:false,externalAccessActive:false}});
    await expect(service.authorize(request,userId,"CAP_COST_VIEW",{resourceType:"Cost"},"user")).rejects.toBeInstanceOf(CapabilityAdmissionError);
  });
});
