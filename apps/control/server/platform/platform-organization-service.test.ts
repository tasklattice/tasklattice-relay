import { describe, expect, it } from "vitest";
import { createTestPrisma } from "../test/prisma";
import { PlatformOrganizationService } from "./platform-organization-service";

describe("PlatformOrganizationService", () => {
  it("returns every person with explicit Department and Project assignments", async () => {
    const service = new PlatformOrganizationService(createTestPrisma());

    const organization = await service.get();

    expect(organization.departments).toEqual([
      expect.objectContaining({ id: "dep1", name: "dep1" }),
    ]);
    expect(organization.people).toEqual([
      expect.objectContaining({
        id: "local-admin",
        departments: [
          expect.objectContaining({ id: "dep1", role: "administrator" }),
        ],
        projects: [
          expect.objectContaining({
            id: "individual",
            departmentId: "dep1",
            activeRole: "admin",
            roles: ["admin", "developer"],
          }),
        ],
      }),
    ]);
  });

  it("creates a Department with an explicit initial administrator", async () => {
    const service = new PlatformOrganizationService(createTestPrisma());

    const department = await service.createDepartment({
      name: "Research",
      description: "Research organization boundary.",
      administratorUserId: "local-admin",
    }, "local-admin");

    expect(department.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(department).toMatchObject({
      name: "Research",
      members: [
        expect.objectContaining({ id: "local-admin", role: "administrator" }),
      ],
      projects: [],
    });
    await expect(service.get()).resolves.toMatchObject({
      departments: expect.arrayContaining([
        expect.objectContaining({ id: department.id }),
      ]),
    });
  });

  it("searches and pages people by Department and Project membership", async () => {
    const database = createTestPrisma();
    await database.user.create({
      data: {
        id: "department-admin",
        username: "department-admin",
        displayName: "Department Administrator",
        email: "department-admin@example.com",
        departmentMemberships: {
          create: {
            departmentId: "dep1",
            role: "administrator",
          },
        },
      },
    });
    const service = new PlatformOrganizationService(database);

    await expect(service.listPeople({
      departmentId: "dep1",
      page: 1,
      pageSize: 10,
      projectId: undefined,
      search: "department administrator",
    })).resolves.toMatchObject({
      data: [
        {
          id: "department-admin",
          systemRole: "user",
          departments: [
            expect.objectContaining({ id: "dep1", role: "administrator" }),
          ],
          projects: [],
        },
      ],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });

    const secondPage = await service.listPeople({
      departmentId: "dep1",
      page: 2,
      pageSize: 1,
      projectId: undefined,
      search: "",
    });
    expect(secondPage.filters).toMatchObject({
      departments: [expect.objectContaining({ id: "dep1" })],
      projects: [expect.objectContaining({ id: "individual", departmentId: "dep1" })],
    });
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.pagination).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2 });

    await expect(service.listPeople({
      departmentId: "dep1",
      page: 1,
      pageSize: 10,
      projectId: "individual",
      search: "",
    })).resolves.toMatchObject({
      data: [expect.objectContaining({ id: "local-admin" })],
      pagination: { total: 1 },
    });
  });

  it("requires an active initial Department Administrator", async () => {
    const database = createTestPrisma();
    await database.user.create({
      data: {
        id: "disabled-person",
        username: "disabled-person",
        displayName: "Disabled Person",
        email: "disabled@example.com",
        status: "disabled",
      },
    });
    const service = new PlatformOrganizationService(database);

    await expect(service.createDepartment({
      name: "Operations",
      description: null,
      administratorUserId: "disabled-person",
    }, "local-admin")).rejects.toThrow(
      "initial Department Administrator must be an active person",
    );
  });
});
