import type {
  BuiltinProjectRoleId,
  BuiltinRoleId,
  ProjectMembershipRole,
} from "@tali/contracts";
import { membershipRoleToBuiltinRole } from "../authorization/builtin-roles";
import { ensureBuiltinRoleCatalog } from "../authorization/role-catalog";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { DepartmentService } from "../departments/department-service";
import { ProjectService } from "../projects/project-service";
import type { PlatformPrincipal } from "./auth";

export type AccessContextLevel = "platform" | "department" | "project";

export interface AccessContextOption {
  description: string;
  id: string;
  level: AccessContextLevel;
  resourceId: string | null;
  resourceName: string;
  roleId: BuiltinRoleId;
  roleLabel: string;
  target: string;
}

export interface AccessContextState {
  active: AccessContextOption | null;
  options: AccessContextOption[];
}

export interface SelectAccessContextInput {
  level: AccessContextLevel;
  resourceId: string | null;
  roleId: BuiltinRoleId;
}

const projectRoleLabels: Record<ProjectMembershipRole, string> = {
  admin: "Project Administrator",
  auditor: "Auditor",
  developer: "Agent Developer",
  reviewer: "Reviewer",
  user: "User",
};

const projectRoleDescriptions: Record<ProjectMembershipRole, string> = {
  admin: "Manage Project configuration, members, policies, and resources.",
  auditor: "Review audit evidence and operational records.",
  developer: "Build and operate Agents and Project resources.",
  reviewer: "Review Project changes and governed activity.",
  user: "Use the Project within its assigned permissions.",
};

function projectRoleTarget(projectId: string, role: ProjectMembershipRole): string {
  const projectRoot = `/${encodeURIComponent(projectId)}`;
  return role === "admin" || role === "developer"
    ? projectRoot
    : `${projectRoot}/instances`;
}

const membershipByBuiltinRole = Object.fromEntries(
  Object.entries(membershipRoleToBuiltinRole).map(([membership, builtin]) => [
    builtin,
    membership,
  ]),
) as Record<BuiltinProjectRoleId, ProjectMembershipRole>;

function optionId(
  level: AccessContextLevel,
  resourceId: string | null,
  roleId: BuiltinRoleId,
): string {
  return `${level}:${resourceId ?? "global"}:${roleId}`;
}

function sameContext(
  option: AccessContextOption,
  input: SelectAccessContextInput,
): boolean {
  return option.level === input.level
    && option.resourceId === input.resourceId
    && option.roleId === input.roleId;
}

export class AccessContextService {
  constructor(private readonly db: PrismaClient = prisma()) {}

  private async options(auth: PlatformPrincipal): Promise<AccessContextOption[]> {
    await ensureBuiltinRoleCatalog(this.db);
    const [departments, projects] = await Promise.all([
      new DepartmentService(this.db).list(auth),
      new ProjectService(this.db).list(auth),
    ]);
    const options: AccessContextOption[] = [];

    if (auth.user.systemRole === "platform_administrator") {
      options.push({
        description: "Manage platform-wide identity, infrastructure, runtime, and integrations.",
        id: optionId("platform", null, "ROLE_PLATFORM_ADMIN"),
        level: "platform",
        resourceId: null,
        resourceName: "TaskLattice Relay",
        roleId: "ROLE_PLATFORM_ADMIN",
        roleLabel: "Platform Administrator",
        target: "/platform/settings",
      });
    }

    for (const department of departments) {
      options.push({
        description: "Manage Department projects, people, inference policy, and resource boundaries.",
        id: optionId("department", department.id, "ROLE_DEPARTMENT_ADMIN"),
        level: "department",
        resourceId: department.id,
        resourceName: department.name,
        roleId: "ROLE_DEPARTMENT_ADMIN",
        roleLabel: "Department Administrator",
        target: `/departments/${encodeURIComponent(department.id)}`,
      });
    }

    for (const project of projects) {
      for (const role of project.assignedRoles) {
        const roleId = membershipRoleToBuiltinRole[role];
        options.push({
          description: projectRoleDescriptions[role],
          id: optionId("project", project.id, roleId),
          level: "project",
          resourceId: project.id,
          resourceName: project.name,
          roleId,
          roleLabel: projectRoleLabels[role],
          target: projectRoleTarget(project.id, role),
        });
      }
    }

    return options;
  }

  async get(auth: PlatformPrincipal): Promise<AccessContextState> {
    if (!auth.sessionId) throw new Error("Authentication session is required.");
    const options = await this.options(auth);
    const stored = await this.db.accessContextSession.findUnique({
      where: { sessionId: auth.sessionId },
    });
    const active = stored
      ? options.find((option) => sameContext(option, {
          level: stored.level.toLowerCase() as AccessContextLevel,
          resourceId: stored.resourceId,
          roleId: stored.roleId as BuiltinRoleId,
        })) ?? null
      : null;
    if (stored && !active) {
      await this.db.accessContextSession.delete({
        where: { sessionId: auth.sessionId },
      });
    }
    return { active, options };
  }

  async select(
    auth: PlatformPrincipal,
    input: SelectAccessContextInput,
  ): Promise<AccessContextState> {
    if (!auth.sessionId) throw new Error("Authentication session is required.");
    const options = await this.options(auth);
    const active = options.find((option) => sameContext(option, input));
    if (!active) {
      throw new Error(
        "Access denied: this access context is not assigned to your Account.",
      );
    }

    if (active.level === "project" && active.resourceId) {
      const membershipRole = membershipByBuiltinRole[
        active.roleId as BuiltinProjectRoleId
      ];
      if (!membershipRole) {
        throw new Error("Access denied: the selected Project role is invalid.");
      }
      await new ProjectService(this.db).switchRole(
        active.resourceId,
        auth.user.id,
        membershipRole,
      );
    }

    await this.db.accessContextSession.upsert({
      where: { sessionId: auth.sessionId },
      create: {
        sessionId: auth.sessionId,
        level: active.level.toUpperCase() as "PLATFORM" | "DEPARTMENT" | "PROJECT",
        resourceId: active.resourceId,
        roleId: active.roleId,
      },
      update: {
        level: active.level.toUpperCase() as "PLATFORM" | "DEPARTMENT" | "PROJECT",
        resourceId: active.resourceId,
        roleId: active.roleId,
        selectedAt: new Date(),
      },
    });
    return { active, options };
  }
}
