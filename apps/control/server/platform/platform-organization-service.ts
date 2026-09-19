import { randomUUID } from "node:crypto";
import {
  createPlatformDepartmentSchema,
  platformPeopleQuerySchema,
  type CreatePlatformDepartmentInput,
  type PlatformOrganizationView,
  type PlatformPeopleQuery,
  type PlatformPeopleView,
  type PlatformPersonView,
} from "@tali/contracts";
import { prisma } from "../db/prisma";
import { Prisma, type PrismaClient } from "../generated/prisma/client";

const activeAccess = [
  { manualAccess: true },
  { externalAccessActive: true },
] satisfies Prisma.DepartmentMemberWhereInput[];

const personInclude = {
  departmentMemberships: {
    where: { OR: activeAccess },
    include: { department: true },
    orderBy: { joinedAt: "asc" },
  },
  memberships: {
    where: {
      project: { deletedAt: null },
      OR: activeAccess,
    },
    include: {
      project: { include: { department: true } },
      roleAssignments: {
        where: {
          OR: [
            { manualAssignment: true },
            { externalAssignmentActive: true },
          ],
        },
        orderBy: { assignedAt: "asc" },
      },
    },
    orderBy: { joinedAt: "asc" },
  },
} satisfies Prisma.UserInclude;

type PersonWithAccess = Prisma.UserGetPayload<{ include: typeof personInclude }>;

function platformPerson(person: PersonWithAccess): PlatformPersonView {
  return {
    id: person.id,
    displayName: person.displayName,
    email: person.email,
    systemRole: person.systemRole === "platform_administrator"
      || person.externalPlatformAdministrator
      ? "platform_administrator"
      : "user",
    status: person.status,
    departments: person.departmentMemberships.map((membership) => ({
      id: membership.departmentId,
      name: membership.department.name,
      role: membership.role,
      status: membership.status as "active" | "suspended",
    })),
    projects: person.memberships.map((membership) => ({
      activeRole: membership.role,
      departmentId: membership.project.departmentId,
      departmentName: membership.project.department.name,
      id: membership.projectId,
      name: membership.project.name,
      roles: membership.roleAssignments.length
        ? membership.roleAssignments.map((assignment) => assignment.role)
        : [membership.role],
    })),
  };
}

export class PlatformOrganizationService {
  constructor(private readonly db: PrismaClient = prisma()) {}

  async get(): Promise<PlatformOrganizationView> {
    const [departments, people] = await Promise.all([
      this.db.department.findMany({
        include: {
          members: {
            where: {
              OR: [
                { manualAccess: true },
                { externalAccessActive: true },
              ],
            },
            include: { user: true },
            orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
          },
          projects: {
            where: { deletedAt: null },
            include: {
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
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: [{ status: "asc" }, { name: "asc" }],
      }),
      this.db.user.findMany({
        include: personInclude,
        orderBy: [{ status: "asc" }, { displayName: "asc" }, { email: "asc" }],
      }),
    ]);
    return {
      departments: departments.map((department) => ({
        id: department.id,
        name: department.name,
        description: department.description,
        status: department.status as "active" | "suspended",
        members: department.members.map((membership) => ({
          id: membership.userId,
          displayName: membership.user.displayName,
          email: membership.user.email,
          role: membership.role,
          status: membership.status as "active" | "suspended",
        })),
        projects: department.projects.map((project) => ({
          id: project.id,
          name: project.name,
          memberCount: project._count.humanMembers,
        })),
      })),
      people: people.map(platformPerson),
    };
  }

  async listPeople(input: PlatformPeopleQuery): Promise<PlatformPeopleView> {
    const query = platformPeopleQuerySchema.parse(input);
    const filters: Prisma.UserWhereInput[] = [];
    const [departmentMembers, projectMembers] = await Promise.all([
      query.departmentId
        ? this.db.departmentMember.findMany({
            where: {
              departmentId: query.departmentId,
              OR: activeAccess,
            },
            select: { userId: true },
          })
        : Promise.resolve(null),
      query.projectId
        ? this.db.projectMember.findMany({
            where: {
              projectId: query.projectId,
              project: {
                deletedAt: null,
                ...(query.departmentId ? { departmentId: query.departmentId } : {}),
              },
              OR: activeAccess,
            },
            select: { userId: true },
          })
        : Promise.resolve(null),
    ]);
    if (query.search) {
      filters.push({
        OR: [
          { displayName: { contains: query.search, mode: "insensitive" } },
          { email: { contains: query.search, mode: "insensitive" } },
          { username: { contains: query.search, mode: "insensitive" } },
        ],
      });
    }
    if (departmentMembers) {
      filters.push({ id: { in: departmentMembers.map(({ userId }) => userId) } });
    }
    if (projectMembers) {
      filters.push({ id: { in: projectMembers.map(({ userId }) => userId) } });
    }
    const where: Prisma.UserWhereInput = filters.length ? { AND: filters } : {};
    const total = await this.db.user.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const [people, departments, projects] = await Promise.all([
      this.db.user.findMany({
        where,
        include: personInclude,
        orderBy: [{ status: "asc" }, { displayName: "asc" }, { email: "asc" }],
        skip: (page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.department.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.db.project.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          departmentId: true,
          department: { select: { name: true } },
        },
        orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
      }),
    ]);
    return {
      data: people.map(platformPerson),
      filters: {
        departments,
        projects: projects.map((project) => ({
          departmentId: project.departmentId,
          departmentName: project.department.name,
          id: project.id,
          name: project.name,
        })),
      },
      pagination: {
        page,
        pageSize: query.pageSize,
        total,
        totalPages,
      },
    };
  }

  async createDepartment(
    input: CreatePlatformDepartmentInput,
    actorId: string,
  ): Promise<PlatformOrganizationView["departments"][number]> {
    const normalized = createPlatformDepartmentSchema.parse(input);
    const administrator = await this.db.user.findUnique({
      where: { id: normalized.administratorUserId },
      select: { id: true, status: true },
    });
    if (!administrator || administrator.status !== "active") {
      throw new Error("The initial Department Administrator must be an active person.");
    }

    const department = await this.db.$transaction(async (transaction) => {
      const existing = await transaction.department.findFirst({
        where: {
          name: { equals: normalized.name, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (existing) {
        throw new Error("A Department with this name already exists.");
      }
      return transaction.department.create({
        data: {
          id: randomUUID(),
          name: normalized.name,
          description: normalized.description,
          createdBy: actorId,
          members: {
            create: {
              userId: normalized.administratorUserId,
              role: "administrator",
              status: "active",
            },
          },
        },
        include: {
          members: { include: { user: true } },
          projects: {
            where: { deletedAt: null },
            include: { _count: { select: { humanMembers: true } } },
          },
        },
      });
    });

    return {
      id: department.id,
      name: department.name,
      description: department.description,
      status: department.status as "active" | "suspended",
      members: department.members.map((membership) => ({
        id: membership.userId,
        displayName: membership.user.displayName,
        email: membership.user.email,
        role: membership.role,
        status: membership.status as "active" | "suspended",
      })),
      projects: department.projects.map((project) => ({
        id: project.id,
        name: project.name,
        memberCount: project._count.humanMembers,
      })),
    };
  }
}
