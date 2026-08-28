import { createHash, randomUUID } from "node:crypto";
import {
  projectIdSchema,
  projectNameSchema,
  type ProjectMembershipRole,
} from "@tali/contracts";
import { ensureDefaultAccessPolicy } from "../access-policies/default-access-policy";
import { RoleCatalogService } from "../authorization/role-catalog";
import type { PlatformPrincipal } from "../auth/auth";
import { requireAuth } from "../auth/auth";
import { prisma } from "../db/prisma";
import { requireDepartmentAdministrator } from "../departments/department-access";
import type { DepartmentRole } from "../departments/department-service";
import {
  SmtpInvitationMailer,
  type InvitationMailer,
} from "../email/smtp-invitation-mailer";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import {
  controlJobQueue,
  type ControlJobPublisher,
} from "../jobs/control-job-queue";
import {
  LiteLLMClient,
  type LiteLLMAdminClient,
} from "../providers/litellm-client";
import { type BudgetDuration, nextBudgetWindow } from "../quotas/budget-window";
import { ProjectQuotaService } from "../quotas/project-quota-service";
import { ProjectStore } from "./project-store";
import { developmentResourceCatalog } from "../catalog/development-resource-catalog";
import { BuiltInRuntimePolicyCatalogSource } from "../runtime-policies/runtime-policy-service";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";
import {
  accessForMembership,
  activeRoleForMembership,
  membershipHasAccess,
  membershipAccessInclude,
  projectRoleFromBuiltinRole,
  projectAccessForMember,
  type ProjectAccessView,
} from "./project-access";
import {
  PROJECT_DELETION_GRACE_PERIOD_MINUTES,
  PROJECT_DELETION_GRACE_PERIOD_MS,
  type ProjectDeletionSchedule,
} from "./project-deletion-service";
import {
  projectRuntimeNamespace,
  ProjectRuntimeTargetService,
  type ProjectRuntimeNamespaceProvisioner,
} from "./project-runtime-target-service";
import { durableMemoryEnabledForProject } from "../memories/durable-memory-feature";

export type ProjectRole = ProjectMembershipRole;

export interface ProjectView extends ProjectAccessView {
  department: {
    id: string;
    name: string;
    role: DepartmentRole | null;
  };
  id: string;
  name: string;
  avatar?: string;
  memberCount: number;
  features: {
    durableMemory: boolean;
  };
}

export interface ProjectDeletionActiveResource {
  id: string;
  kind:
    | "instance"
    | "provider"
    | "model"
    | "gateway"
    | "routing"
    | "mcp-server"
    | "vector-database"
    | "memory";
  kindLabel: string;
  name: string;
  status: string;
}

export interface ProjectDeletionImpact {
  activeResources: ProjectDeletionActiveResource[];
  auditLogsRetained: true;
  delayMinutes: number;
  projectId: string;
  projectName: string;
  resourceCounts: Array<{
    count: number;
    kind: string;
    label: string;
  }>;
  totalResourceCount: number;
}

export interface HumanProjectMemberView {
  id: string;
  kind: "human";
  name: string;
  email: string;
  roles: readonly ProjectRole[];
  activeRole?: ProjectRole;
  status: "active" | "invited";
}

function invitationRoleView(
  role: ProjectRole,
): Pick<HumanProjectMemberView, "roles"> {
  return { roles: [role] };
}

export type ProjectMemberView = HumanProjectMemberView;

export interface InitialProjectInvitation {
  email: string;
  role: ProjectRole;
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "project"
  );
}

function auditorMemberView(member: ProjectMemberView): ProjectMemberView {
  const [localPart = "", domain = ""] = member.email.split("@", 2);
  const maskedEmail = domain
    ? `${localPart.slice(0, 1) || "*"}***@${domain}`
    : "[redacted]";
  const pseudonym = createHash("sha256")
    .update(member.id)
    .digest("hex")
    .slice(0, 8);
  return {
    ...member,
    name: `Project member ${pseudonym}`,
    email: maskedEmail,
  };
}

const administratorMutationLocks = new Map<string, Promise<void>>();
const administratorAdvisoryLockNamespace = 0x54414c49; // "TALI"

function administratorAdvisoryLockKey(projectId: string): number {
  return createHash("sha256").update(projectId).digest().readInt32BE(0);
}

async function withAdministratorMutationLock<T>(
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous =
    administratorMutationLocks.get(projectId) ?? Promise.resolve();
  const turn = previous.catch(() => undefined);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = turn.then(() => gate);
  administratorMutationLocks.set(projectId, tail);
  await turn;
  try {
    return await operation();
  } finally {
    release();
    if (administratorMutationLocks.get(projectId) === tail) {
      administratorMutationLocks.delete(projectId);
    }
  }
}

export class ProjectService {
  constructor(
    private readonly db: PrismaClient = prisma(),
    private readonly litellm: LiteLLMAdminClient = new LiteLLMClient(),
    private readonly invitationMailer: InvitationMailer = new SmtpInvitationMailer(),
    private runtimeNamespaces?: ProjectRuntimeNamespaceProvisioner,
    private controlJobs?: ControlJobPublisher,
  ) {}

  /**
   * Serialize administrator-set mutations. Locking the complete admin set in
   * a stable order prevents two concurrent removals/downgrades from both
   * observing a stale count and leaving a Project without an administrator.
   */
  private async lockAdministrators(
    transaction: Prisma.TransactionClient,
    projectId: string,
    actorId: string,
  ): Promise<void> {
    // The advisory lock is shared across Control replicas. The surrounding
    // in-process mutex also prevents local request races and gives pg-mem an
    // equivalent serialization primitive in unit tests.
    await transaction.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock($1::integer, $2::integer)::text AS lock_result",
      administratorAdvisoryLockNamespace,
      administratorAdvisoryLockKey(projectId),
    );
    await transaction.$queryRawUnsafe(
      `SELECT user_id
         FROM tasklattice.project_members
        WHERE project_id = $1 AND role = 'admin'
        ORDER BY user_id
        FOR UPDATE`,
      projectId,
    );
    await transaction.$queryRawUnsafe(
      `SELECT user_id
         FROM tasklattice.project_member_role_assignments
        WHERE project_id = $1 AND role = 'admin'
        ORDER BY user_id
        FOR UPDATE`,
      projectId,
    );
    const actor = await transaction.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actorId } },
      include: membershipAccessInclude,
    });
    if (!actor || activeRoleForMembership(actor) !== "admin") {
      throw new Error("You do not have permission to manage this project.");
    }
  }

  private async administratorCount(
    transaction: Prisma.TransactionClient,
    projectId: string,
  ): Promise<number> {
    const [permanent, assigned] = await Promise.all([
      transaction.projectMember.findMany({
        where: { projectId, role: "admin" },
        select: { userId: true },
      }),
      transaction.projectMemberRoleAssignment.findMany({
        where: { projectId, role: "admin" },
        select: { userId: true },
      }),
    ]);
    return new Set([
      ...permanent.map(({ userId }) => userId),
      ...assigned.map(({ userId }) => userId),
    ]).size;
  }

  private async acceptPendingInvitations(auth: PlatformPrincipal): Promise<string> {
    const id = await this.requireUser(auth);
    const user = await this.db.user.findUniqueOrThrow({
      where: { id },
      select: { email: true },
    });
    const email = user.email.trim().toLowerCase();
    const invitations = await this.db.projectInvitation.findMany({
      where: {
        email,
        status: "pending",
        project: { deletedAt: null },
      },
    });
    for (const invitation of invitations) {
      await this.db.$transaction(async (transaction) => {
        await transaction.projectMember.upsert({
          where: {
            projectId_userId: {
              projectId: invitation.projectId,
              userId: id,
            },
          },
          create: {
            projectId: invitation.projectId,
            userId: id,
            role: invitation.role,
          },
          update: { manualAccess: true },
        });
        await transaction.projectMemberRoleAssignment.upsert({
          where: {
            projectId_userId_role: {
              projectId: invitation.projectId,
              userId: id,
              role: invitation.role,
            },
          },
          create: {
            projectId: invitation.projectId,
            userId: id,
            role: invitation.role,
          },
          update: { manualAssignment: true },
        });
        await transaction.projectInvitation.update({
          where: { id: invitation.id },
          data: { status: "accepted" },
        });
      });
      await this.syncProjectTeam(invitation.projectId);
    }
    return id;
  }

  async requireUser(auth: PlatformPrincipal): Promise<string> {
    const user = await this.db.user.findUnique({
      where: { id: auth.user.id },
      select: { id: true, status: true },
    });
    if (!user || user.status !== "active") {
      throw new Error(
        "The authenticated TaskLattice Relay user is unavailable.",
      );
    }
    return user.id;
  }

  async authenticate(
    request: Request,
  ): Promise<{ auth: PlatformPrincipal; userId: string }> {
    const auth = await requireAuth(request);
    return { auth, userId: await this.requireUser(auth) };
  }

  async list(auth: PlatformPrincipal): Promise<ProjectView[]> {
    const currentUserId = await this.acceptPendingInvitations(auth);
    const memberships = await this.db.projectMember.findMany({
      where: {
        userId: currentUserId,
        OR: [
          { manualAccess: true },
          { externalAccessActive: true },
        ],
        project: { deletedAt: null },
      },
      include: {
        ...membershipAccessInclude,
        project: {
          include: {
            department: {
              select: {
                id: true,
                name: true,
                status: true,
                members: {
                  where: { userId: currentUserId, status: "active" },
                  select: { role: true },
                  take: 1,
                },
              },
            },
            _count: {
              select: {
                humanMembers: {
                  where: {
                    OR: [
                      { manualAccess: true },
                      { externalAccessActive: true },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });
    const visibleProjects = await Promise.all(
      memberships.map(async (membership) => {
        const { project } = membership;
        if (project.department.status !== "active") return null;
        const access = await accessForMembership(membership, this.db);
        return {
          department: {
            id: project.department.id,
            name: project.department.name,
            role: project.department.members[0]?.role ?? null,
          },
          id: project.id,
          name: project.name,
          ...(project.avatar ? { avatar: project.avatar } : {}),
          memberCount: project._count.humanMembers,
          features: {
            durableMemory: durableMemoryEnabledForProject(project.id),
          },
          ...access,
        };
      }),
    );
    return visibleProjects.filter(
      (project): project is ProjectView => project !== null,
    );
  }

  async resolve(request: Request): Promise<{
    auth: PlatformPrincipal;
    userId: string;
    projectId: string;
    activeRole: ProjectRole;
  }> {
    const { auth, userId: currentUserId } = await this.authenticate(request);
    const match = new URL(request.url).pathname.match(
      /^\/api\/v1\/projects\/([^/]+)(?:\/|$)/,
    );
    if (!match)
      throw new Error("Project scope is required in the request path.");
    const projectId = decodeURIComponent(match[1]!);
    const membership = await this.db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: currentUserId } },
      include: {
        project: {
          select: {
            deletedAt: true,
            department: { select: { status: true } },
          },
        },
        ...membershipAccessInclude,
      },
    });
    if (
      !membership ||
      !membershipHasAccess(membership) ||
      membership.project.deletedAt ||
      membership.project.department.status !== "active"
    ) {
      throw new Error("Project not found or access denied.");
    }
    const selectedRole = auth.accessContext?.level === "project"
      && auth.accessContext.resourceId === projectId
      ? projectRoleFromBuiltinRole(auth.accessContext.roleId)
      : undefined;
    if (auth.sessionId && !selectedRole) {
      throw new Error(
        "Access denied: select access for this Project and Role for the session.",
      );
    }
    const access = await accessForMembership(membership, this.db, selectedRole);
    return {
      auth,
      userId: currentUserId,
      projectId,
      activeRole: access.activeRole,
    };
  }

  async create(
    auth: PlatformPrincipal,
    departmentId: string,
    name: string,
    invitations: InitialProjectInvitation[],
    authority: "department" | "platform" = "department",
    requestedProjectId?: string,
  ): Promise<ProjectView> {
    const currentUserId = await this.acceptPendingInvitations(auth);
    if (authority === "platform") {
      if (
        auth.user.systemRole !== "platform_administrator"
        || !await new RoleCatalogService(this.db).hasCapability(
          "ROLE_PLATFORM_ADMIN",
          "CAP_PLATFORM_PROJECT_CREATE",
        )
      ) {
        throw new Error(
          "You do not have permission to create Projects at the platform level.",
        );
      }
    } else {
      await requireDepartmentAdministrator(auth, departmentId, this.db, {
        capability: "CAP_DEPARTMENT_PROJECT_CREATE",
        requireActiveDepartment: true,
      });
    }
    const department = await this.db.department.findUnique({
      where: { id: departmentId },
      select: {
        id: true,
        name: true,
        status: true,
        hardBudgetUsd: true,
        hardMaxInstances: true,
        hardMaxMcpIntegrations: true,
        hardMaxKnowledgeBaseIntegrations: true,
        defaultChatModel: true,
        defaultEmbeddingModel: true,
        defaultRoutingMode: true,
        defaultFallbackModel: true,
        defaultProjectHardBudgetUsd: true,
        defaultProjectBudgetDuration: true,
        defaultProjectTpmLimit: true,
        defaultProjectMaxInstances: true,
        defaultProjectMaxMcpIntegrations: true,
        defaultProjectMaxKnowledgeBaseIntegrations: true,
        settingsRevision: true,
      },
    });
    if (!department || department.status !== "active") {
      throw new Error("Department not found or unavailable.");
    }
    const projectName = projectNameSchema.parse(name);
    const suffix = randomUUID().slice(0, 8);
    const generatedProjectId = `${slug(projectName)
      .slice(0, 48 - suffix.length - 1)
      .replace(/-+$/, "")}-${suffix}`;
    const projectId = projectIdSchema.parse(
      requestedProjectId ?? generatedProjectId,
    );
    const duplicateId = await this.db.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (duplicateId) {
      throw new Error(`A Project with ID "${projectId}" already exists.`);
    }
    const duplicate = await this.db.project.findFirst({
      where: {
        departmentId,
        name: { equals: projectName, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate)
      throw new Error(`A Project named "${projectName}" already exists.`);
    const creator = await this.db.user.findUniqueOrThrow({
      where: { id: currentUserId },
      select: { email: true },
    });
    const normalizedInvitations = invitations.map((invitation) => ({
      email: invitation.email.trim().toLowerCase(),
      role: invitation.role,
    }));
    const invitationEmails = normalizedInvitations.map(({ email }) => email);
    if (new Set(invitationEmails).size !== invitationEmails.length) {
      throw new Error("Each invited email address must be unique.");
    }
    if (invitationEmails.includes(creator.email)) {
      throw new Error(
        "The Project creator is already included as an administrator.",
      );
    }

    const existingUsers = invitationEmails.length
      ? await this.db.user.findMany({
          where: { email: { in: invitationEmails } },
          select: { email: true, id: true },
        })
      : [];
    const existingUserByEmail = new Map(
      existingUsers.map((user) => [user.email, user]),
    );
    const inheritedQuota = {
      hardBudgetUsd: department.defaultProjectHardBudgetUsd === null
        ? (department.hardBudgetUsd === null ? null : 0)
        : Number(department.defaultProjectHardBudgetUsd),
      budgetDuration: department.defaultProjectHardBudgetUsd === null
        ? (department.hardBudgetUsd === null ? null : "30d")
        : (department.defaultProjectBudgetDuration ?? "30d") as BudgetDuration | null,
      tpmLimit: department.defaultProjectTpmLimit === null
        ? null
        : Number(department.defaultProjectTpmLimit),
      maxInstances: department.defaultProjectMaxInstances
        ?? (department.hardMaxInstances === null ? null : 0),
      maxMcpIntegrations: department.defaultProjectMaxMcpIntegrations
        ?? (department.hardMaxMcpIntegrations === null ? null : 0),
      maxKnowledgeBaseIntegrations:
        department.defaultProjectMaxKnowledgeBaseIntegrations
        ?? (department.hardMaxKnowledgeBaseIntegrations === null ? null : 0),
    } as const;
    await assertDepartmentAllocationAvailable(this.db, department, inheritedQuota);
    const runtimeNamespaceConfig = (
      await loadPlatformRuntimeConfiguration(this.db)
    ).runtimeNamespaces;
    const project = await this.db.project.create({
      data: {
        id: projectId,
        name: projectName,
        departmentId,
        createdBy: currentUserId,
        inheritedDepartmentSettingsRevision: department.settingsRevision,
        inheritedDepartmentDefaults: {
          departmentId: department.id,
          departmentSettingsRevision: department.settingsRevision,
          models: {
            defaultChatModel: department.defaultChatModel,
            defaultEmbeddingModel: department.defaultEmbeddingModel,
          },
          routing: {
            mode: department.defaultRoutingMode,
            fallbackModel: department.defaultFallbackModel,
          },
        },
        humanMembers: {
          create: [
            {
              userId: currentUserId,
              role: "admin",
              roleAssignments: {
                create: { role: "admin" },
              },
            },
            ...normalizedInvitations.flatMap((invitation) => {
              const user = existingUserByEmail.get(invitation.email);
              return user
                ? [
                    {
                      userId: user.id,
                      role: invitation.role,
                      roleAssignments: {
                        create: { role: invitation.role },
                      },
                    },
                  ]
                : [];
            }),
          ],
        },
        invitations: {
          create: normalizedInvitations.flatMap((invitation) =>
            existingUserByEmail.has(invitation.email)
              ? []
              : [
                  {
                    id: `invite-${randomUUID()}`,
                    email: invitation.email,
                    role: invitation.role,
                    invitedBy: currentUserId,
                  },
                ],
          ),
        },
        runtimeTarget: {
          create: {
            clusterId: runtimeNamespaceConfig.clusterId,
            namespace: projectRuntimeNamespace(projectId),
          },
        },
      },
    });
    try {
      this.runtimeNamespaces ??= new ProjectRuntimeTargetService(this.db);
      await this.runtimeNamespaces.ensureProjectNamespace(project.id);
    } catch (error) {
      // Project creation is successful only when its runtime Namespace is
      // ready. The Namespace operation is idempotent, so an operator can use
      // the one-shot reconciliation command after a crash between systems.
      await this.db.project.delete({ where: { id: project.id } }).catch(
        (cleanupError) =>
          console.error(
            "Failed to compensate Project creation after Namespace provisioning failed.",
            { cleanupError, projectId: project.id },
          ),
      );
      throw error;
    }
    const hardBudgetUsd = inheritedQuota.hardBudgetUsd;
    const budgetDuration = inheritedQuota.budgetDuration;
    const initialBudgetWindow = budgetDuration
      ? nextBudgetWindow(new Date(), budgetDuration, null, null)
      : null;
    await this.db.projectQuotaRecord.create({
      data: {
        projectId: project.id,
        tpmLimit: inheritedQuota.tpmLimit === null
          ? null
          : BigInt(inheritedQuota.tpmLimit),
        maxInstances: inheritedQuota.maxInstances,
        maxMcpIntegrations: inheritedQuota.maxMcpIntegrations,
        maxKnowledgeBaseIntegrations:
          inheritedQuota.maxKnowledgeBaseIntegrations,
        ...(hardBudgetUsd !== null && initialBudgetWindow
          ? {
              hardBudgetUsd,
              budgetDuration,
              budgetPeriodStartedAt: initialBudgetWindow.startedAt,
              budgetResetsAt: initialBudgetWindow.resetsAt,
            }
          : {}),
      },
    });
    await ensureDefaultAccessPolicy(this.db, project.id);
    await this.seedProject(project.id);
    await this.syncProjectTeam(project.id);
    const access = await accessForMembership({
      role: "admin",
      roleAssignments: [{ role: "admin" }],
    }, this.db);
    const departmentMembership = await this.db.departmentMember.findUnique({
      where: {
        departmentId_userId: { departmentId: department.id, userId: currentUserId },
      },
      select: { role: true, status: true },
    });
    return {
      department: {
        id: department.id,
        name: department.name,
        role:
          departmentMembership?.status === "active"
            ? departmentMembership.role
            : null,
      },
      id: project.id,
      name: project.name,
      memberCount: existingUsers.length + 1,
      features: {
        durableMemory: durableMemoryEnabledForProject(project.id),
      },
      ...access,
    };
  }

  private async seedProject(projectId: string): Promise<void> {
    const resources = [
      [this.db.skillRecord, developmentResourceCatalog.skills],
      [
        this.db.knowledgeSourceRecord,
        developmentResourceCatalog.vectorDatabases,
      ],
      [
        this.db.agentSpecializationRecord,
        developmentResourceCatalog.specializations,
      ],
    ] as const;
    for (const [delegate, records] of resources) {
      if (records.length) {
        await (delegate.createMany as Function)({
          data: records.map((record, sortOrder) => ({
            projectId,
            id: record.id,
            payload: JSON.parse(JSON.stringify(record)),
            sortOrder,
          })),
          skipDuplicates: true,
        });
      }
    }
    const policies = new BuiltInRuntimePolicyCatalogSource().load().policies;
    if (policies.length) {
      await this.db.sandboxPolicyRecord.createMany({
        data: policies.map((policy) => ({
          projectId,
          id: policy.id,
          payload: JSON.parse(JSON.stringify(policy)),
          createdAt: new Date(0),
        })),
        skipDuplicates: true,
      });
    }
  }

  async requireRole(
    projectId: string,
    currentUserId: string,
    roles: ProjectRole[],
  ): Promise<ProjectRole> {
    const membership = await this.db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: currentUserId } },
      include: {
        project: { select: { deletedAt: true } },
        ...membershipAccessInclude,
      },
    });
    const access = membership
      ? await accessForMembership(membership, this.db)
      : undefined;
    const matchedRole =
      access && roles.includes(access.activeRole)
        ? access.activeRole
        : undefined;
    if (!membership || membership.project.deletedAt || !matchedRole) {
      throw new Error("You do not have permission to manage this project.");
    }
    return matchedRole;
  }

  async switchRole(
    projectId: string,
    currentUserId: string,
    role: ProjectRole,
  ): Promise<ProjectAccessView> {
    const membership = await this.db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: currentUserId } },
      include: {
        project: { select: { deletedAt: true } },
        roleAssignments: { select: { role: true } },
      },
    });
    if (!membership || membership.project.deletedAt) {
      throw new Error("Project not found or access denied.");
    }
    const assignedRoles = new Set([
      membership.role,
      ...membership.roleAssignments.map((assignment) => assignment.role),
    ]);
    if (!assignedRoles.has(role)) {
      throw new Error("This Project role is not assigned to your Account.");
    }
    if (membership.role !== role) {
      await this.db.projectMember.update({
        where: { projectId_userId: { projectId, userId: currentUserId } },
        data: { role },
      });
    }
    return (await projectAccessForMember(this.db, projectId, currentUserId))!;
  }

  async rename(
    projectId: string,
    currentUserId: string,
    name: string,
  ): Promise<ProjectView> {
    await this.requireRole(projectId, currentUserId, ["admin"]);
    const existing = await this.db.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!existing) throw new Error("Project not found.");
    void name;
    throw new Error("Project names are immutable after creation.");
  }

  async deletionImpact(
    projectId: string,
    currentUserId: string,
  ): Promise<ProjectDeletionImpact> {
    await this.requireRole(projectId, currentUserId, ["admin"]);
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        deletedAt: true,
      },
    });
    if (!project || project.deletedAt) throw new Error("Project not found.");
    const store = new ProjectStore(projectId, this.db);
    const [
      instances,
      providers,
      models,
      gateways,
      routings,
      mcpServers,
      knowledgeSources,
      memories,
      accessPolicyCount,
      skillCount,
    ] = await Promise.all([
      store.list(),
      store.listProviderAccounts(),
      store.listModelDeployments(),
      store.listInferenceGateways(),
      store.listModelRoutings(),
      store.listMcpServerDefinitions(),
      store.listKnowledgeSourceDefinitions(),
      this.db.memoryRecord.findMany({
        where: { projectId, deletedAt: null },
        select: { id: true, displayName: true, status: true },
      }),
      this.db.accessPolicyRecord.count({ where: { projectId, deletedAt: null } }),
      this.db.skillRecord.count({ where: { projectId, deletedAt: null } }),
    ]);
    const activeResources: ProjectDeletionActiveResource[] = [
      ...instances
        .filter((resource) => resource.status !== "FAILED")
        .map((resource) => ({
          id: resource.id,
          kind: "instance" as const,
          kindLabel: "Agent Instance",
          name: resource.name,
          status: resource.status,
        })),
      ...providers
        .filter((resource) => resource.status !== "FAILED")
        .map((resource) => ({
          id: resource.id,
          kind: "provider" as const,
          kindLabel: "Provider connection",
          name: resource.name,
          status: resource.status,
        })),
      ...models
        .filter((resource) => resource.status !== "FAILED")
        .map((resource) => ({
          id: resource.id,
          kind: "model" as const,
          kindLabel: "Registered model",
          name: resource.modelId,
          status: resource.status,
        })),
      ...gateways
        .filter(
          (resource) =>
            resource.status === "READY" || resource.status === "DEGRADED",
        )
        .map((resource) => ({
          id: resource.id,
          kind: "gateway" as const,
          kindLabel: "Inference gateway",
          name: resource.name,
          status: resource.status,
        })),
      ...routings
        .filter((resource) =>
          ["VALIDATING", "READY", "DEGRADED"].includes(resource.status),
        )
        .map((resource) => ({
          id: resource.id,
          kind: "routing" as const,
          kindLabel: "Model routing",
          name: resource.name,
          status: resource.status,
        })),
      ...mcpServers
        .filter((resource) => resource.status !== "UNAVAILABLE")
        .map((resource) => ({
          id: resource.id,
          kind: "mcp-server" as const,
          kindLabel: "MCP connection",
          name: resource.name,
          status: resource.status,
        })),
      ...knowledgeSources
        .filter((resource) => resource.status === "REGISTERED")
        .map((resource) => ({
          id: resource.id,
          kind: "vector-database" as const,
          kindLabel: "Vector Database",
          name: resource.name,
          status: resource.status,
        })),
      ...memories.map((resource) => ({
        id: resource.id,
        kind: "memory" as const,
        kindLabel: "Memory",
        name: resource.displayName,
        status: resource.status,
      })),
    ].sort(
      (left, right) =>
        left.kindLabel.localeCompare(right.kindLabel) ||
        left.name.localeCompare(right.name),
    );
    const resourceCounts = [
      { kind: "instances", label: "Agent Instances", count: instances.length },
      {
        kind: "providers",
        label: "Provider connections",
        count: providers.length,
      },
      { kind: "models", label: "Registered models", count: models.length },
      { kind: "gateways", label: "Inference gateways", count: gateways.length },
      { kind: "routings", label: "Model routings", count: routings.length },
      {
        kind: "mcp-servers",
        label: "MCP connections",
        count: mcpServers.length,
      },
      {
        kind: "vector-databases",
        label: "Vector Databases",
        count: knowledgeSources.length,
      },
      { kind: "memories", label: "Memories", count: memories.length },
      { kind: "skills", label: "Skills", count: skillCount },
      {
        kind: "access-policies",
        label: "Access Policies",
        count: accessPolicyCount,
      },
    ];
    return {
      activeResources,
      auditLogsRetained: true,
      delayMinutes: PROJECT_DELETION_GRACE_PERIOD_MINUTES,
      projectId: project.id,
      projectName: project.name,
      resourceCounts,
      totalResourceCount: resourceCounts.reduce(
        (total, item) => total + item.count,
        0,
      ),
    };
  }

  async delete(
    projectId: string,
    currentUserId: string,
  ): Promise<ProjectDeletionSchedule> {
    await this.requireRole(projectId, currentUserId, ["admin"]);
    const requestedAt = new Date();
    const scheduledFor = new Date(
      requestedAt.getTime() + PROJECT_DELETION_GRACE_PERIOD_MS,
    );
    this.controlJobs ??= controlJobQueue();
    // Initialize/migrate the library-owned queue schema before opening the
    // product transaction. Enqueuing below still uses that same product
    // transaction, so the tombstone and job commit or roll back together.
    await this.controlJobs.start();
    await this.db.$transaction(async (transaction) => {
      await transaction.project.update({
        where: { id: projectId },
        data: {
          deletedAt: requestedAt,
          deletedBy: currentUserId,
        },
      });
      await transaction.projectDeletionTask.create({
        data: {
          projectId,
          nextAttemptAt: scheduledFor,
          scheduledFor,
          status: "scheduled",
        },
      });
      const queueJobId = await this.controlJobs!.enqueueProjectDeletion(
        projectId,
        scheduledFor,
        transaction,
      );
      await transaction.projectDeletionTask.update({
        where: { projectId },
        data: { queueJobId },
      });
    });
    return {
      delayMinutes: PROJECT_DELETION_GRACE_PERIOD_MINUTES,
      projectId,
      requestedAt: requestedAt.toISOString(),
      scheduledFor: scheduledFor.toISOString(),
      status: "scheduled",
    };
  }

  async members(
    projectId: string,
    currentUserId: string,
  ): Promise<ProjectMemberView[]> {
    const viewerRole = await this.requireRole(projectId, currentUserId, [
      "admin",
      "auditor",
    ]);
    const [members, invitations] = await Promise.all([
      this.db.projectMember.findMany({
        where: { projectId },
        include: {
          user: true,
          ...membershipAccessInclude,
        },
        orderBy: { joinedAt: "asc" },
      }),
      this.db.projectInvitation.findMany({
        where: { projectId, status: "pending" },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const activeMembers = await Promise.all(
      members.map(async (membership) => {
        const access = await accessForMembership(membership, this.db);
        return {
          id: membership.user.id,
          kind: "human" as const,
          name: membership.user.displayName,
          email: membership.user.email,
          roles: access.assignedRoles,
          activeRole: access.activeRole,
          status: "active" as const,
        };
      }),
    );
    const result: ProjectMemberView[] = [
      ...activeMembers,
      ...invitations.map((invite) => ({
        id: invite.id,
        kind: "human" as const,
        name: invite.email.split("@")[0] || invite.email,
        email: invite.email,
        ...invitationRoleView(invite.role as ProjectRole),
        status: "invited" as const,
      })),
    ];
    return viewerRole === "auditor" ? result.map(auditorMemberView) : result;
  }

  async invite(
    projectId: string,
    currentUserId: string,
    email: string,
    role: ProjectRole,
  ): Promise<HumanProjectMemberView> {
    await this.requireRole(projectId, currentUserId, ["admin"]);
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.db.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      const membership = await withAdministratorMutationLock(projectId, () =>
        this.db.$transaction(async (transaction) => {
          await this.lockAdministrators(transaction, projectId, currentUserId);
          await transaction.projectMember.upsert({
            where: { projectId_userId: { projectId, userId: existing.id } },
            create: {
              projectId,
              userId: existing.id,
              role,
            },
            update: { manualAccess: true },
            include: membershipAccessInclude,
          });
          await transaction.projectMemberRoleAssignment.upsert({
            where: {
              projectId_userId_role: {
                projectId,
                userId: existing.id,
                role,
              },
            },
            create: {
              projectId,
              userId: existing.id,
              role,
            },
            update: { manualAssignment: true },
          });
          return transaction.projectMember.findUniqueOrThrow({
            where: { projectId_userId: { projectId, userId: existing.id } },
            include: membershipAccessInclude,
          });
        }),
      );
      await this.syncProjectTeam(projectId);
      const access = await accessForMembership(membership, this.db);
      return {
        id: existing.id,
        kind: "human",
        name: existing.displayName,
        email: existing.email,
        roles: access.assignedRoles,
        activeRole: access.activeRole,
        status: "active",
      };
    }
    await this.invitationMailer.assertConfigured();
    const [project, inviter] = await Promise.all([
      this.db.project.findUnique({
        where: { id: projectId },
        select: { name: true },
      }),
      this.db.user.findUnique({
        where: { id: currentUserId },
        select: { displayName: true, email: true },
      }),
    ]);
    if (!project) throw new Error("Project not found.");
    if (!inviter) throw new Error("Inviting user not found.");
    const invite = await withAdministratorMutationLock(projectId, () =>
      this.db.$transaction(async (transaction) => {
        await this.lockAdministrators(transaction, projectId, currentUserId);
        return transaction.projectInvitation.upsert({
          where: { projectId_email: { projectId, email: normalizedEmail } },
          create: {
            id: `invite-${randomUUID()}`,
            projectId,
            email: normalizedEmail,
            role,
            invitedBy: currentUserId,
          },
          update: { role, status: "pending", invitedBy: currentUserId },
        });
      }),
    );
    try {
      await this.invitationMailer.sendProjectInvitation({
        email: normalizedEmail,
        inviterEmail: inviter.email,
        inviterName: inviter.displayName,
        projectName: project.name,
        role,
      });
    } catch (error) {
      throw new Error(
        `Invitation saved, but ${
          error instanceof Error
            ? error.message
            : "SMTP delivery failed with an unknown error."
        }`,
      );
    }
    return {
      id: invite.id,
      kind: "human",
      name: normalizedEmail.split("@")[0] || normalizedEmail,
      email: normalizedEmail,
      ...invitationRoleView(role),
      status: "invited",
    };
  }

  async removeMember(
    projectId: string,
    currentUserId: string,
    memberId: string,
  ): Promise<void> {
    await this.requireRole(projectId, currentUserId, ["admin"]);
    const removedInvitation = await withAdministratorMutationLock(
      projectId,
      () =>
        this.db.$transaction(async (transaction) => {
          await this.lockAdministrators(transaction, projectId, currentUserId);
          const invitation = await transaction.projectInvitation.deleteMany({
            where: { projectId, id: memberId },
          });
          if (invitation.count) return true;
          const target = await transaction.projectMember.findUnique({
            where: { projectId_userId: { projectId, userId: memberId } },
            include: {
              roleAssignments: {
                select: { role: true },
              },
            },
          });
          if (!target) throw new Error("Project member not found.");
          const [ownedInstances, ownedRegisteredAgents] = await Promise.all([
            transaction.agentRecord.count({
              where: { projectId, ownerUserId: target.userId },
            }),
            transaction.agentCatalogRecord.count({
              where: { projectId, ownerUserId: target.userId },
            }),
          ]);
          if (ownedInstances || ownedRegisteredAgents) {
            throw new Error(
              `Transfer the member's ${ownedInstances} Agent Instance(s) and ${ownedRegisteredAgents} registered Agent(s) before removing them.`,
            );
          }
          if (
            target.role === "admin" ||
            target.roleAssignments.some(({ role }) => role === "admin")
          ) {
            const adminCount = await this.administratorCount(
              transaction,
              projectId,
            );
            if (adminCount <= 1) {
              throw new Error(
                "A project must retain at least one administrator.",
              );
            }
          }
          await transaction.projectMember.delete({
            where: { projectId_userId: { projectId, userId: memberId } },
          });
          return false;
        }),
    );
    if (removedInvitation) return;
  }

  private async syncProjectTeam(projectId: string): Promise<void> {
    if (!(await loadPlatformRuntimeConfiguration(this.db)).litellm.masterKey) return;
    await new ProjectQuotaService(
      new ProjectStore(projectId, this.db),
      this.litellm,
    )
      .sync()
      .catch(() => undefined);
  }

}

async function assertDepartmentAllocationAvailable(
  database: PrismaClient,
  department: {
    id: string;
    hardBudgetUsd: { toString(): string } | null;
    hardMaxInstances: number | null;
    hardMaxMcpIntegrations: number | null;
    hardMaxKnowledgeBaseIntegrations: number | null;
  },
  defaults: {
    hardBudgetUsd: number | null;
    maxInstances: number | null;
    maxMcpIntegrations: number | null;
    maxKnowledgeBaseIntegrations: number | null;
  },
) {
  const allocated = await database.projectQuotaRecord.aggregate({
    where: { project: { departmentId: department.id, deletedAt: null } },
    _sum: {
      hardBudgetUsd: true,
      maxInstances: true,
      maxMcpIntegrations: true,
      maxKnowledgeBaseIntegrations: true,
    },
  });
  const checks = [
    ["budget", Number(allocated._sum.hardBudgetUsd ?? 0), defaults.hardBudgetUsd, department.hardBudgetUsd === null ? null : Number(department.hardBudgetUsd)],
    ["Instance", Number(allocated._sum.maxInstances ?? 0), defaults.maxInstances, department.hardMaxInstances],
    ["MCP integration", Number(allocated._sum.maxMcpIntegrations ?? 0), defaults.maxMcpIntegrations, department.hardMaxMcpIntegrations],
    ["Vector Database integration", Number(allocated._sum.maxKnowledgeBaseIntegrations ?? 0), defaults.maxKnowledgeBaseIntegrations, department.hardMaxKnowledgeBaseIntegrations],
  ] as const;
  for (const [label, current, projectDefault, hard] of checks) {
    if (hard !== null && current + Number(projectDefault ?? 0) > hard) {
      throw new Error(
        `The new Project's default ${label} allocation would exceed the Department hard quota (${current} allocated + ${projectDefault ?? 0} requested > ${hard}).`,
      );
    }
  }
}
