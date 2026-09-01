import { describe, expect, it } from "vitest";
import type { PlatformPrincipal } from "./auth";
import { createTestPrisma } from "../test/prisma";
import { AccessContextService } from "./access-context-service";

const user = {
  displayName: "Local Administrator",
  email: "admin@tali.local",
  hasPassword: true,
  id: "local-admin",
  systemRole: "platform_administrator" as const,
  username: "admin",
};

async function createPrincipal(
  sessionId: string,
): Promise<{ auth: PlatformPrincipal; service: AccessContextService }> {
  const db = createTestPrisma();
  await db.authSession.create({
    data: {
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      id: sessionId,
      token: `${sessionId}-token`,
      userId: user.id,
    },
  });
  return {
    auth: { sessionId, user },
    service: new AccessContextService(db),
  };
}

describe("AccessContextService", () => {
  it("lists each assigned Platform, Department, and Project role as an entry option", async () => {
    const { auth, service } = await createPrincipal("access-options");

    const state = await service.get(auth);

    expect(state.active).toBeNull();
    expect(state.options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "platform",
        resourceId: null,
        roleId: "ROLE_PLATFORM_ADMIN",
      }),
      expect.objectContaining({
        level: "department",
        resourceId: "dep1",
        roleId: "ROLE_DEPARTMENT_ADMIN",
      }),
      expect.objectContaining({
        level: "project",
        resourceId: "individual",
        roleId: "ROLE_PROJECT_ADMIN",
        target: "/individual",
      }),
      expect.objectContaining({
        level: "project",
        resourceId: "individual",
        roleId: "ROLE_AGENT_DEVELOPER",
        target: "/individual",
      }),
    ]));
  });

  it("persists the selected role and scope for the current authentication session", async () => {
    const { auth, service } = await createPrincipal("access-selection");

    const department = await service.select(auth, {
      level: "department",
      resourceId: "dep1",
      roleId: "ROLE_DEPARTMENT_ADMIN",
    });
    expect(department.active).toMatchObject({
      level: "department",
      resourceId: "dep1",
      target: "/departments/dep1",
    });
    await expect(service.get(auth)).resolves.toMatchObject({
      active: {
        level: "department",
        resourceId: "dep1",
        roleId: "ROLE_DEPARTMENT_ADMIN",
      },
    });

    const project = await service.select(auth, {
      level: "project",
      resourceId: "individual",
      roleId: "ROLE_AGENT_DEVELOPER",
    });
    expect(project.active).toMatchObject({
      level: "project",
      resourceId: "individual",
      roleId: "ROLE_AGENT_DEVELOPER",
    });
  });

  it("rejects an unassigned role and scope", async () => {
    const { auth, service } = await createPrincipal("access-rejected");

    await expect(service.select(auth, {
      level: "department",
      resourceId: "unassigned-department",
      roleId: "ROLE_DEPARTMENT_ADMIN",
    })).rejects.toThrow("Access denied");
  });
});
