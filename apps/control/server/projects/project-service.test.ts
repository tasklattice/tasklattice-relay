import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ACCESS_POLICY_ID } from "../access-policies/default-access-policy";
import { AuditLogService } from "../audit-logs/audit-log-service";
import type { PlatformPrincipal, AuthUser } from "../auth/auth";
import {
  developmentControlConfig,
  setControlConfigForTests,
} from "../config/control-config";
import type {
  InvitationMailer,
  ProjectInvitationEmail,
} from "../email/smtp-invitation-mailer";
import type { LiteLLMAdminClient } from "../providers/litellm-client";
import { createTestPrisma } from "../test/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import type { ControlJobPublisher } from "../jobs/control-job-queue";
import { ProjectService } from "./project-service";
import {
  projectRuntimeNamespace,
  type ProjectRuntimeNamespaceProvisioner,
} from "./project-runtime-target-service";

class RecordingInvitationMailer implements InvitationMailer {
  readonly invitations: ProjectInvitationEmail[] = [];

  constructor(
    private readonly configured = true,
    private readonly deliveryError?: Error,
  ) {}

  async assertConfigured(): Promise<void> {
    if (!this.configured)
      throw new Error("SMTP invitation delivery is not configured.");
  }

  async sendProjectInvitation(
    invitation: ProjectInvitationEmail,
  ): Promise<void> {
    if (this.deliveryError) throw this.deliveryError;
    this.invitations.push(invitation);
  }
}

function auth(
  input: Omit<AuthUser, "id" | "systemRole"> &
    Partial<Pick<AuthUser, "id" | "systemRole">>,
): PlatformPrincipal {
  const user: AuthUser = {
    ...input,
    id:
      input.id ??
      (input.hasPassword ? "local-admin" : `test-${input.username}`),
    systemRole:
      input.systemRole ??
      (input.hasPassword ? "platform_administrator" : "user"),
  };
  return { user };
}

async function switchToAdministrator(
  db: PrismaClient,
  projectId: string,
  userId: string,
): Promise<void> {
  await new ProjectService(db).switchRole(projectId, userId, "admin");
}

async function grantDepartmentAdministrator(
  db: PrismaClient,
  userId: string,
): Promise<void> {
  await db.departmentMember.upsert({
    where: { departmentId_userId: { departmentId: "dep1", userId } },
    create: {
      departmentId: "dep1",
      userId,
      role: "administrator",
    },
    update: { role: "administrator", status: "active" },
  });
}

async function syncAuthUser(
  db: PrismaClient,
  service: ProjectService,
  user: AuthUser,
): Promise<string> {
  await db.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      systemRole: user.systemRole,
      status: "active",
    },
    update: {
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      systemRole: user.systemRole,
      status: "active",
    },
  });
  await service.list({ user });
  return user.id;
}

describe("ProjectService", () => {
  it("creates a Project with a normalized name and requested immutable ID", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const local = auth({
      displayName: "Local Administrator",
      email: "admin@tali.local",
      hasPassword: true,
      username: "admin",
    });

    const project = await service.create(
      local,
      "dep1",
      "  Agent\tPlatform  ",
      [],
      "department",
      "agent-platform",
    );

    expect(project).toMatchObject({
      id: "agent-platform",
      name: "Agent Platform",
    });
    await expect(
      service.create(
        local,
        "dep1",
        "Another Project",
        [],
        "department",
        "Agent_Platform",
      ),
    ).rejects.toThrow("Project ID");
  });

  it("lists the seeded project and copies its metadata into new Projects", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const local = auth({
      displayName: "Local Administrator",
      email: "admin@tali.local",
      hasPassword: true,
      username: "admin",
    });

    const initialProjects = await service.list(local);
    expect(initialProjects).toEqual([
      expect.objectContaining({
        department: expect.objectContaining({ role: "administrator" }),
        effectiveCapabilities: expect.arrayContaining([
          "CAP_AGENT_INSTANCE_CREATE",
        ]),
        id: "individual",
        name: "admin",
        features: { durableMemory: true },
        activeRole: "admin",
        assignedRoles: ["admin", "developer"],
      }),
    ]);
    expect(initialProjects[0]).not.toHaveProperty("type");

    const team = await service.create(local, "dep1", "AI Platform", []);
    expect(team).toMatchObject({
      name: "AI Platform",
      features: { durableMemory: true },
      activeRole: "admin",
      assignedRoles: ["admin"],
    });
    expect(team.id).toMatch(/^ai-platform-[a-f0-9]{8}$/);
    expect(team).not.toHaveProperty("type");
    await expect(db.projectQuotaRecord.findUniqueOrThrow({
      where: { projectId: team.id },
    })).resolves.toMatchObject({
      hardBudgetUsd: null,
      tpmLimit: null,
      maxInstances: null,
      maxMcpIntegrations: null,
      maxKnowledgeBaseIntegrations: null,
    });
    await expect(db.projectRuntimeTarget.findUnique({
      where: { projectId: team.id },
    })).resolves.toMatchObject({
      clusterId: "in-cluster",
      namespace: projectRuntimeNamespace(team.id),
      observedGeneration: 0,
      status: "pending",
    });
    expect(
      await db.skillRecord.count({
        where: { projectId: team.id },
      }),
    ).toBe(
      await db.skillRecord.count({
        where: { projectId: "individual" },
      }),
    );
    for (const projectId of ["individual", team.id]) {
      const policy = await db.accessPolicyRecord.findUnique({
        where: {
          projectId_id: { projectId, id: DEFAULT_ACCESS_POLICY_ID },
        },
      });
      expect(policy?.payload).toMatchObject({
        id: DEFAULT_ACCESS_POLICY_ID,
        name: "Default",
        status: "ACTIVE",
        serverRules: [],
        revision: 1,
        createdBy: "system:setup",
      });
      expect(
        await db.accessPolicyVersionRecord.count({
          where: { projectId, policyId: DEFAULT_ACCESS_POLICY_ID },
        }),
      ).toBe(1);
    }
  });

  it("starts new Projects at zero allocation inside a budget-limited Department", async () => {
    const db = createTestPrisma();
    await db.department.update({
      where: { id: "dep1" },
      data: { hardBudgetUsd: 100 },
    });
    const service = new ProjectService(db);
    const local = auth({
      displayName: "Local Administrator",
      email: "admin@tali.local",
      hasPassword: true,
      username: "admin",
    });

    const project = await service.create(local, "dep1", "Budgeted Project", []);
    const quota = await db.projectQuotaRecord.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    expect(Number(quota.hardBudgetUsd)).toBe(0);
    expect(quota.budgetDuration).toBe("30d");
  });

  it("provisions the runtime Namespace before Project creation succeeds", async () => {
    const db = createTestPrisma();
    const runtimeNamespaces: ProjectRuntimeNamespaceProvisioner = {
      ensureProjectNamespace: vi.fn(async () => true),
    };
    const service = new ProjectService(
      db,
      undefined,
      undefined,
      runtimeNamespaces,
    );
    const local = auth({
      displayName: "Local Administrator",
      email: "admin@tali.local",
      hasPassword: true,
      username: "admin",
    });

    const project = await service.create(local, "dep1", "Runtime Project", []);

    expect(runtimeNamespaces.ensureProjectNamespace).toHaveBeenCalledWith(
      project.id,
    );
  });

  it("removes the database Project when Namespace provisioning fails", async () => {
    const db = createTestPrisma();
    const runtimeNamespaces: ProjectRuntimeNamespaceProvisioner = {
      ensureProjectNamespace: vi.fn(async () => {
        throw new Error("Kubernetes API unavailable");
      }),
    };
    const service = new ProjectService(
      db,
      undefined,
      undefined,
      runtimeNamespaces,
    );
    const local = auth({
      displayName: "Local Administrator",
      email: "admin@tali.local",
      hasPassword: true,
      username: "admin",
    });

    await expect(
      service.create(local, "dep1", "Failed Runtime Project", []),
    ).rejects.toThrow("Kubernetes API unavailable");
    await expect(db.project.findFirst({
      where: { name: "Failed Runtime Project" },
    })).resolves.toBeNull();
  });

  it("switches directly between roles assigned to the Account", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);

    const developer = await service.switchRole(
      "individual",
      "local-admin",
      "developer",
    );
    expect(developer.activeRole).toBe("developer");
    expect(developer.assignedRoles).toEqual(["admin", "developer"]);
    expect(developer.effectiveCapabilities).not.toContain(
      "CAP_PROJECT_SETTINGS_UPDATE",
    );

    const administrator = await service.switchRole(
      "individual",
      "local-admin",
      "admin",
    );
    expect(administrator.activeRole).toBe("admin");
    expect(administrator.effectiveCapabilities).toContain(
      "CAP_PROJECT_SETTINGS_UPDATE",
    );

    await expect(
      service.switchRole("individual", "local-admin", "auditor"),
    ).rejects.toThrow(/not assigned/i);
  });

  it("creates the initial member set and pending invitations with assigned roles", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const administrator = auth({
      displayName: "Administrator",
      email: "administrator@tali.local",
      hasPassword: false,
      username: "administrator",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);
    await syncAuthUser(db, service, {
      displayName: "Existing Member",
      email: "member@example.com",
      id: "test-existing-member",
      hasPassword: false,
      systemRole: "user",
      username: "existing-member",
    });

    const team = await service.create(
      administrator,
      "dep1",
      "Agent Operations",
      [
        { email: "member@example.com", role: "user" },
        { email: "future-admin@example.com", role: "admin" },
      ],
    );
    const administratorId = await service.requireUser(administrator);
    await switchToAdministrator(db, team.id, administratorId);

    expect(team).toMatchObject({
      memberCount: 2,
      name: "Agent Operations",
      activeRole: "admin",
      assignedRoles: ["admin"],
    });
    expect(await service.members(team.id, administratorId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "administrator@tali.local",
          kind: "human",
          roles: ["admin"],
          activeRole: "admin",
          status: "active",
        }),
        expect.objectContaining({
          email: "member@example.com",
          roles: ["user"],
          status: "active",
        }),
        expect.objectContaining({
          email: "future-admin@example.com",
          kind: "human",
          roles: ["admin"],
          status: "invited",
        }),
      ]),
    );
    expect(await service.list(administrator)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          department: expect.objectContaining({ role: "administrator" }),
          id: team.id,
          memberCount: 2,
        }),
      ]),
    );
  });

  it("redacts member and invitation identities for the Auditor role", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const administrator = auth({
      displayName: "Administrator Name",
      email: "administrator@example.com",
      hasPassword: false,
      username: "identity-admin",
    });
    const auditor = auth({
      displayName: "Compliance Auditor",
      email: "auditor@example.com",
      hasPassword: false,
      username: "compliance-auditor",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);
    await syncAuthUser(db, service, auditor.user);
    const administratorId = await service.requireUser(administrator);
    const auditorId = await service.requireUser(auditor);
    const team = await service.create(
      administrator,
      "dep1",
      "Redacted Membership",
      [],
    );
    await db.projectMember.create({
      data: { projectId: team.id, userId: auditorId, role: "auditor" },
    });
    await db.projectInvitation.create({
      data: {
        id: "invite-sensitive",
        projectId: team.id,
        email: "future.developer@example.com",
        role: "developer",
        invitedBy: administratorId,
      },
    });

    const result = await service.members(team.id, auditorId);
    expect(JSON.stringify(result)).not.toContain("Administrator Name");
    expect(JSON.stringify(result)).not.toContain("administrator@example.com");
    expect(JSON.stringify(result)).not.toContain(
      "future.developer@example.com",
    );
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "a***@example.com",
          name: expect.stringMatching(/^Project member [a-f0-9]{8}$/),
        }),
        expect.objectContaining({
          email: "f***@example.com",
          status: "invited",
        }),
      ]),
    );
  });

  it("rejects duplicate invitations and inviting the creator", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const administrator = auth({
      displayName: "Administrator",
      email: "administrator@tali.local",
      hasPassword: false,
      username: "administrator",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);

    await expect(
      service.create(administrator, "dep1", "Duplicate Team", [
        { email: "member@example.com", role: "user" },
        { email: "MEMBER@example.com", role: "admin" },
      ]),
    ).rejects.toThrow(/unique/i);
    await expect(
      service.create(administrator, "dep1", "Creator Team", [
        { email: "administrator@tali.local", role: "user" },
      ]),
    ).rejects.toThrow(/already included/i);
  });

  it("requires Project names to be unique and immutable", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const administrator = auth({
      displayName: "Administrator",
      email: "administrator@tali.local",
      hasPassword: false,
      username: "administrator",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);

    const project = await service.create(
      administrator,
      "dep1",
      "Security Research",
      [],
    );
    const administratorId = await service.requireUser(administrator);
    await switchToAdministrator(db, project.id, administratorId);

    await expect(
      service.create(administrator, "dep1", "security research", []),
    ).rejects.toThrow(/already exists/i);
    await expect(
      service.rename(project.id, administratorId, "Renamed Security Research"),
    ).rejects.toThrow(/immutable/i);
  });

  it("soft deletes Projects while retaining their unique name and audit history", async () => {
    const db = createTestPrisma();
    const enqueueProjectDeletion = vi.fn(async () =>
      "00000000-0000-4000-8000-000000000027"
    );
    const controlJobs: ControlJobPublisher = {
      enqueueProjectDeletion,
      enqueueProjectRuntimeReconcile: vi.fn(async () =>
        "00000000-0000-4000-8000-000000000028"
      ),
      start: vi.fn(async () => undefined),
    };
    const service = new ProjectService(
      db,
      undefined,
      undefined,
      undefined,
      controlJobs,
    );
    const administrator = auth({
      displayName: "Administrator",
      email: "administrator@tali.local",
      hasPassword: false,
      username: "administrator",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);
    const project = await service.create(
      administrator,
      "dep1",
      "Retained Project",
      [],
    );
    const administratorId = await service.requireUser(administrator);
    await switchToAdministrator(db, project.id, administratorId);
    await new AuditLogService(project.id, db).record({
      projectId: project.id,
      actor: {
        type: "user",
        id: administratorId,
        name: administrator.user.displayName,
      },
      authorization: { role: "admin", decision: "allowed" },
      action: "project.test",
      verb: "tested",
      object: { type: "Project", id: project.id, name: project.name },
      outcome: "success",
      summary: "Project audit retention test.",
      request: {
        id: "project-retention-test",
        method: "POST",
        route: "/project-retention-test",
        ipAddress: "127.0.0.1",
        userAgent: "vitest",
      },
    });
    const memory = await db.memoryRecord.create({
      data: {
        projectId: project.id,
        displayName: "Retained Project Memory",
        idempotencyKey: "retained-project-memory",
        providerRef: "bank-retained-project",
        status: "unbound",
      },
    });

    const impact = await service.deletionImpact(project.id, administratorId);
    expect(impact).toMatchObject({
      activeResources: expect.any(Array),
      auditLogsRetained: true,
      delayMinutes: 10,
      projectId: project.id,
      projectName: "Retained Project",
    });
    expect(impact.resourceCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "skills", count: expect.any(Number) }),
        expect.objectContaining({ kind: "access-policies", count: 1 }),
        expect.objectContaining({ kind: "memories", count: 1 }),
      ]),
    );
    expect(impact.activeResources).toContainEqual(expect.objectContaining({
      id: memory.id,
      kind: "memory",
      name: "Retained Project Memory",
      status: "unbound",
    }));

    const schedule = await service.delete(project.id, administratorId);

    expect(schedule).toMatchObject({
      delayMinutes: 10,
      projectId: project.id,
      status: "scheduled",
    });
    expect(
      new Date(schedule.scheduledFor).getTime() -
        new Date(schedule.requestedAt).getTime(),
    ).toBe(10 * 60 * 1_000);
    expect(enqueueProjectDeletion).toHaveBeenCalledWith(
      project.id,
      new Date(schedule.scheduledFor),
      expect.any(Object),
    );
    expect(
      await db.projectDeletionTask.findUnique({
        where: { projectId: project.id },
      }),
    ).toMatchObject({
      attempts: 0,
      nextAttemptAt: new Date(schedule.scheduledFor),
      queueJobId: "00000000-0000-4000-8000-000000000027",
      scheduledFor: new Date(schedule.scheduledFor),
      status: "scheduled",
    });

    expect(
      await db.project.findUnique({ where: { id: project.id } }),
    ).toMatchObject({
      deletedAt: expect.any(Date),
      deletedBy: administratorId,
      name: "Retained Project",
    });
    expect(
      (await service.list(administrator)).map(({ id }) => id),
    ).not.toContain(project.id);
    expect(
      await db.auditLogRecord.count({ where: { projectId: project.id } }),
    ).toBe(1);
    await expect(
      service.create(administrator, "dep1", "Retained Project", []),
    ).rejects.toThrow(/already exists/i);
    await expect(
      service.requireRole(project.id, administratorId, ["admin"]),
    ).rejects.toThrow(/permission/i);
  });

  it("rejects a Project deletion when the durable job cannot be enqueued", async () => {
    const db = createTestPrisma();
    const controlJobs: ControlJobPublisher = {
      enqueueProjectDeletion: vi.fn(async () => {
        throw new Error("Control queue unavailable");
      }),
      enqueueProjectRuntimeReconcile: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
    };
    const service = new ProjectService(
      db,
      undefined,
      undefined,
      undefined,
      controlJobs,
    );

    await expect(service.delete("individual", "local-admin")).rejects.toThrow(
      "Control queue unavailable",
    );
    expect(controlJobs.enqueueProjectDeletion).toHaveBeenCalledWith(
      "individual",
      expect.any(Date),
      expect.any(Object),
    );
  });

  it("does not create a Project when a user signs in", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const alex = auth({
      displayName: "Alex Chen",
      email: "alex@example.com",
      hasPassword: false,
      username: "alex",
    });
    await syncAuthUser(db, service, alex.user);

    expect(await service.list(alex)).toEqual([]);
    expect(await db.project.count({ where: { createdBy: alex.user.id } })).toBe(
      0,
    );

    await expect(
      service.create(alex, "dep1", "Research", []),
    ).rejects.toThrow(/administer this Department/i);
    await grantDepartmentAdministrator(db, alex.user.id);
    const project = await service.create(alex, "dep1", "Research", []);
    expect(await service.list(alex)).toEqual([
      expect.objectContaining({
        id: project.id,
        name: "Research",
        activeRole: "admin",
        assignedRoles: ["admin"],
      }),
    ]);
  });

  it("enforces project roles and keeps records isolated by project", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const administrator = auth({
      displayName: "Administrator",
      email: "administrator@tali.local",
      hasPassword: false,
      username: "administrator",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);
    const member = {
      displayName: "Member",
      email: "member@example.com",
      id: "test-member",
      hasPassword: false as const,
      systemRole: "user" as const,
      username: "project-user",
    };
    const administratorId = await service.requireUser(administrator);
    const memberId = await syncAuthUser(db, service, member);
    const team = await service.create(administrator, "dep1", "DevOps", []);
    await switchToAdministrator(db, team.id, administratorId);

    await service.invite(team.id, administratorId, member.email, "user");
    await expect(
      service.requireRole(team.id, memberId, ["admin"]),
    ).rejects.toThrow(/permission/i);

    await db.skillRecord.delete({
      where: {
        projectId_id: {
          projectId: team.id,
          id: "kubernetes-expert",
        },
      },
    });
    expect(
      await db.skillRecord.findUnique({
        where: {
          projectId_id: {
            projectId: "individual",
            id: "kubernetes-expert",
          },
        },
      }),
    ).not.toBeNull();
  });

  it("accepts a pending invitation when the invited user first signs in", async () => {
    const db = createTestPrisma();
    const mailer = new RecordingInvitationMailer();
    const service = new ProjectService(db, undefined, mailer);
    const administrator = auth({
      displayName: "Administrator",
      email: "administrator@tali.local",
      hasPassword: false,
      username: "administrator",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);
    const administratorId = await service.requireUser(administrator);
    const team = await service.create(administrator, "dep1", "SRE", []);
    await switchToAdministrator(db, team.id, administratorId);
    await service.invite(
      team.id,
      administratorId,
      "new-user@example.com",
      "admin",
    );

    const invitedUser = auth({
      displayName: "New User",
      email: "new-user@example.com",
      hasPassword: false,
      username: "new-user",
    });
    await syncAuthUser(db, service, invitedUser.user);
    expect(await service.list(invitedUser)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          department: expect.objectContaining({ role: null }),
          id: team.id,
          activeRole: "admin",
          assignedRoles: ["admin"],
        }),
      ]),
    );
    expect(
      await db.projectInvitation.findFirst({
        where: { projectId: team.id, email: "new-user@example.com" },
      }),
    ).toMatchObject({ status: "accepted" });
    expect(mailer.invitations).toEqual([
      expect.objectContaining({
        email: "new-user@example.com",
        projectName: "SRE",
        role: "admin",
      }),
    ]);
  });

  it("rejects an unknown-user invitation before persisting when SMTP is disabled", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(
      db,
      undefined,
      new RecordingInvitationMailer(false),
    );
    const administrator = auth({
      displayName: "Administrator",
      email: "administrator@tali.local",
      hasPassword: false,
      username: "administrator",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);
    const administratorId = await service.requireUser(administrator);
    const team = await service.create(
      administrator,
      "dep1",
      "Email disabled",
      [],
    );
    await switchToAdministrator(db, team.id, administratorId);

    await expect(
      service.invite(team.id, administratorId, "new-user@example.com", "user"),
    ).rejects.toThrow(/SMTP invitation delivery is not configured/i);
    expect(
      await db.projectInvitation.count({ where: { projectId: team.id } }),
    ).toBe(0);
  });

  it("keeps a pending invitation when SMTP delivery fails so it can be retried", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(
      db,
      undefined,
      new RecordingInvitationMailer(
        true,
        new Error("SMTP delivery failed: connection refused"),
      ),
    );
    const administrator = auth({
      displayName: "Administrator",
      email: "administrator@tali.local",
      hasPassword: false,
      username: "administrator",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);
    const administratorId = await service.requireUser(administrator);
    const team = await service.create(
      administrator,
      "dep1",
      "Retry delivery",
      [],
    );
    await switchToAdministrator(db, team.id, administratorId);

    await expect(
      service.invite(team.id, administratorId, "retry@example.com", "user"),
    ).rejects.toThrow(/Invitation saved.*SMTP delivery failed/i);
    expect(
      await db.projectInvitation.findUnique({
        where: {
          projectId_email: {
            projectId: team.id,
            email: "retry@example.com",
          },
        },
      }),
    ).toMatchObject({ status: "pending" });
  });

  it("prevents removing the last project administrator", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const administrator = auth({
      displayName: "Administrator",
      email: "administrator@tali.local",
      hasPassword: false,
      username: "administrator",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);
    const administratorId = await service.requireUser(administrator);
    const team = await service.create(administrator, "dep1", "Security", []);
    await switchToAdministrator(db, team.id, administratorId);

    await expect(
      service.removeMember(team.id, administratorId, administratorId),
    ).rejects.toThrow(/at least one administrator/i);
  });

  it("adds roles without replacing the current Project role", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const administrator = auth({
      displayName: "Administrator",
      email: "administrator@tali.local",
      hasPassword: false,
      username: "administrator",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);
    const administratorId = await service.requireUser(administrator);
    const team = await service.create(administrator, "dep1", "Role Safety", []);
    await switchToAdministrator(db, team.id, administratorId);

    await service.invite(
      team.id,
      administratorId,
      administrator.user.email,
      "auditor",
    );
    expect(await service.members(team.id, administratorId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: administrator.user.email,
          roles: ["admin", "auditor"],
          activeRole: "admin",
        }),
      ]),
    );
  });

  it("serializes concurrent administrator removals and retains one administrator", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const first = auth({
      displayName: "First Administrator",
      email: "first-admin@example.com",
      hasPassword: false,
      username: "first-admin",
    });
    const second = auth({
      displayName: "Second Administrator",
      email: "second-admin@example.com",
      hasPassword: false,
      username: "second-admin",
    });
    await syncAuthUser(db, service, first.user);
    await grantDepartmentAdministrator(db, first.user.id);
    await syncAuthUser(db, service, second.user);
    const firstId = await service.requireUser(first);
    const secondId = await service.requireUser(second);
    const team = await service.create(
      first,
      "dep1",
      "Concurrent Admin Safety",
      [],
    );
    await switchToAdministrator(db, team.id, firstId);
    await service.invite(team.id, firstId, second.user.email, "admin");
    await switchToAdministrator(db, team.id, secondId);

    const outcomes = await Promise.allSettled([
      service.removeMember(team.id, firstId, secondId),
      service.removeMember(team.id, secondId, firstId),
    ]);
    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    await expect(
      db.projectMemberRoleAssignment.count({
        where: { projectId: team.id, role: "admin" },
      }),
    ).resolves.toBe(1);
  });

  it("prevents removing a member who still owns Project Agent resources", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const administrator = auth({
      displayName: "Administrator",
      email: "administrator@tali.local",
      hasPassword: false,
      username: "administrator",
    });
    await syncAuthUser(db, service, administrator.user);
    await grantDepartmentAdministrator(db, administrator.user.id);
    const administratorId = await service.requireUser(administrator);
    const developer = {
      displayName: "Developer",
      email: "developer-owner@example.com",
      id: "developer-owner",
      hasPassword: false as const,
      systemRole: "user" as const,
      username: "developer-owner",
    };
    await syncAuthUser(db, service, developer);
    const team = await service.create(
      administrator,
      "dep1",
      "Owned Resource Safety",
      [],
    );
    await switchToAdministrator(db, team.id, administratorId);
    await service.invite(
      team.id,
      administratorId,
      developer.email,
      "developer",
    );
    const now = new Date().toISOString();
    await db.agentRecord.create({
      data: {
        projectId: team.id,
        id: "owned-agent",
        ownerUserId: developer.id,
        createdAt: new Date(now),
        payload: { id: "owned-agent" },
      },
    });

    await expect(
      service.removeMember(team.id, administratorId, developer.id),
    ).rejects.toThrow(/Transfer.*Agent Instance/i);
    await expect(
      db.projectMember.findUnique({
        where: {
          projectId_userId: { projectId: team.id, userId: developer.id },
        },
      }),
    ).resolves.not.toBeNull();
  });

  it("removes membership without synchronizing human users to LiteLLM", async () => {
    const config = developmentControlConfig();
    config.litellm!.master_key = "test-master-key";
    setControlConfigForTests(config);
    try {
      const db = createTestPrisma();
      const removeProjectTeamMember = vi.fn(async () => {
        throw new Error("LiteLLM is unavailable");
      });
      const litellm = {
        removeProjectTeamMember,
      } as unknown as LiteLLMAdminClient;
      const service = new ProjectService(db, litellm);
      const administrator = auth({
        displayName: "Administrator",
        email: "revoke-admin@example.com",
        hasPassword: false,
        username: "revoke-admin",
      });
      const member = auth({
        displayName: "Member",
        email: "revoke-member@example.com",
        hasPassword: false,
        username: "revoke-member",
      });
      await syncAuthUser(db, service, administrator.user);
      await grantDepartmentAdministrator(db, administrator.user.id);
      await syncAuthUser(db, service, member.user);
      const administratorId = await service.requireUser(administrator);
      const memberId = await service.requireUser(member);
      const team = await service.create(
        administrator,
        "dep1",
        "Revocation Safety",
        [],
      );
      await switchToAdministrator(db, team.id, administratorId);
      await db.projectMember.create({
        data: { projectId: team.id, userId: memberId, role: "user" },
      });
      await db.projectQuotaRecord.update({
        where: { projectId: team.id },
        data: { litellmTeamId: "team-revocation" },
      });

      await service.removeMember(team.id, administratorId, memberId);
      expect(removeProjectTeamMember).not.toHaveBeenCalled();
      await expect(
        db.projectMember.findUnique({
          where: {
            projectId_userId: { projectId: team.id, userId: memberId },
          },
        }),
      ).resolves.toBeNull();
    } finally {
      setControlConfigForTests(developmentControlConfig());
    }
  });

  it("does not let the Platform Administrator bypass Project membership", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const owner = auth({
      displayName: "Project Owner",
      email: "owner@example.com",
      hasPassword: false,
      username: "owner",
    });
    await syncAuthUser(db, service, owner.user);
    await grantDepartmentAdministrator(db, owner.user.id);
    const team = await service.create(owner, "dep1", "Restricted Project", []);
    const local = auth({
      displayName: "Local Administrator",
      email: "admin@tali.local",
      hasPassword: true,
      username: "admin",
    });

    expect(
      await db.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: team.id,
            userId: "local-admin",
          },
        },
      }),
    ).toBeNull();
    expect(await service.list(local)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: team.id })]),
    );
    await expect(
      service.rename(team.id, "local-admin", "Managed Globally"),
    ).rejects.toThrow(/permission/i);
  });

  it("uses explicit platform authority to create a Project without granting Department authority", async () => {
    const db = createTestPrisma();
    const service = new ProjectService(db);
    const platformAdministrator = auth({
      displayName: "Platform Administrator",
      email: "platform@example.com",
      hasPassword: false,
      id: "platform-only",
      systemRole: "platform_administrator",
      username: "platform-admin",
    });
    await syncAuthUser(db, service, platformAdministrator.user);

    const project = await service.create(
      platformAdministrator,
      "dep1",
      "Platform Created Project",
      [],
      "platform",
    );

    await expect(
      db.departmentMember.findUnique({
        where: {
          departmentId_userId: {
            departmentId: "dep1",
            userId: platformAdministrator.user.id,
          },
        },
      }),
    ).resolves.toBeNull();
    expect(project.department.role).toBeNull();
    await expect(
      db.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: project.id,
            userId: platformAdministrator.user.id,
          },
        },
      }),
    ).resolves.toMatchObject({ role: "admin" });
  });
});
