import type { AuthUser } from "../auth/auth";
import {
  developmentControlConfig,
  setControlConfigForTests,
} from "../config/control-config";
import type { PrismaClient } from "../generated/prisma/client";
import { createTestPrisma } from "../test/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admissionEvidenceForRequest,
  isProjectAdmissionComplete,
} from "../authorization/authorization-context";

type AdmissionMiddleware = (event: {
  context: Record<string, unknown>;
  req: Request;
}) => Promise<Response | undefined> | Response | undefined;

let database: PrismaClient;

const users = {
  admin: {
    displayName: "Project Administrator",
    email: "administrator@example.test",
    id: "middleware-admin",
    hasPassword: false,
    systemRole: "user",
    username: "middleware-admin",
  },
  developer: {
    displayName: "Agent Developer",
    email: "developer@example.test",
    id: "middleware-developer",
    hasPassword: false,
    systemRole: "user",
    username: "middleware-developer",
  },
  user: {
    displayName: "User",
    email: "user@example.test",
    id: "middleware-user",
    hasPassword: false,
    systemRole: "user",
    username: "middleware-user",
  },
} as const satisfies Record<string, AuthUser>;

const projectAgentIds = {
  maintained: "00000000-0000-4000-8000-000000000002",
  other: "00000000-0000-4000-8000-000000000003",
  owned: "00000000-0000-4000-8000-000000000001",
} as const;

function authorizedRequest(
  user: AuthUser,
  path: string,
  init: RequestInit = {},
): Request {
  const request = new Request(`http://tali.test${path}`, {
    ...init,
    headers: {
      "x-test-user-id": user.id,
      ...init.headers,
    },
  });
  (request as Request & { context: Record<string, unknown> }).context = {};
  return request;
}

async function middleware(): Promise<AdmissionMiddleware> {
  vi.doMock("../auth/auth", async (importOriginal) => {
    const original = await importOriginal<typeof import("../auth/auth")>();
    return {
      ...original,
      requireAuth: async (request: Request) => {
        const userId = request.headers.get("x-test-user-id");
        const user = Object.values(users).find((candidate) => candidate.id === userId);
        if (!user) throw new Error("Authentication required.");
        return { user };
      },
    };
  });
  const module = await import("../middleware/project-capability-admission");
  return module.default as unknown as AdmissionMiddleware;
}

beforeEach(async () => {
  vi.resetModules();
  setControlConfigForTests(developmentControlConfig());
  database = createTestPrisma();
  globalThis.taliPrisma = database;
  await database.user.createMany({
    data: Object.values(users).map((user) => ({
      displayName: user.displayName,
      email: user.email,
      id: user.id,
      systemRole: user.systemRole,
      username: user.username,
    })),
  });
  await database.projectMember.createMany({
    data: [
      {
        projectId: "individual",
        userId: users.admin.id,
        role: "admin",
      },
      {
        projectId: "individual",
        userId: users.developer.id,
        role: "developer",
      },
      {
        projectId: "individual",
        userId: users.user.id,
        role: "user",
      },
    ],
  });
  await database.agentRecord.createMany({
    data: [
      {
        createdAt: new Date(),
        id: "owned-agent",
        ownerUserId: users.developer.id,
        payload: { id: "owned-agent" },
        projectId: "individual",
      },
      {
        createdAt: new Date(),
        id: "other-agent",
        ownerUserId: "local-admin",
        payload: { id: "other-agent" },
        projectId: "individual",
      },
    ],
  });
  await database.expertAgentRecord.createMany({
    data: [
      {
        createdBy: users.developer.id,
        description: "Owned Project Agent",
        executionMode: "AGENTIC",
        id: projectAgentIds.owned,
        name: "Owned Project Agent",
        projectId: "individual",
        slug: "owned-project-agent",
      },
      {
        createdBy: users.admin.id,
        description: "Maintained Project Agent",
        executionMode: "AGENTIC",
        id: projectAgentIds.maintained,
        name: "Maintained Project Agent",
        projectId: "individual",
        slug: "maintained-project-agent",
      },
      {
        createdBy: users.admin.id,
        description: "Other Project Agent",
        executionMode: "AGENTIC",
        id: projectAgentIds.other,
        name: "Other Project Agent",
        projectId: "individual",
        slug: "other-project-agent",
      },
    ].map((agent) => ({
      ...agent,
      executionMode: agent.executionMode as "AGENTIC",
      contentDigest: `sha256:${"0".repeat(64)}`,
      productSpec: {},
      policySpec: {},
      delegationSpec: [],
      acceptanceSpec: {},
      safetySpec: {},
      executionSpec: {},
      resourceBindings: [],
      updatedBy: agent.createdBy,
    })),
  });
  await database.expertAgentMemberRecord.createMany({
    data: [
      {
        agentId: projectAgentIds.owned,
        projectId: "individual",
        relation: "OWNER",
        userId: users.developer.id,
      },
      {
        agentId: projectAgentIds.maintained,
        projectId: "individual",
        relation: "OWNER",
        userId: users.admin.id,
      },
      {
        agentId: projectAgentIds.maintained,
        projectId: "individual",
        relation: "MAINTAINER",
        userId: users.developer.id,
      },
      {
        agentId: projectAgentIds.other,
        projectId: "individual",
        relation: "OWNER",
        userId: users.admin.id,
      },
    ],
  });
});

afterEach(async () => {
  globalThis.taliPrisma = undefined;
  setControlConfigForTests(undefined);
  await database.$disconnect();
  vi.resetModules();
});

describe("Project Capability admission middleware", () => {
  it("proves OWNER from the database and marks an admitted request", async () => {
    const request = authorizedRequest(
      users.developer,
      "/api/v1/projects/individual/instances/owned-agent",
    );
    await expect((await middleware())({ context: {}, req: request }))
      .resolves.toBeUndefined();
    expect(isProjectAdmissionComplete(request)).toBe(true);
    expect(admissionEvidenceForRequest(request)).toEqual([
      expect.objectContaining({
        capability: "CAP_AGENT_INSTANCE_CONFIG_VIEW",
        decision: "ALLOW",
        relation: "OWNER",
        resourceId: "owned-agent",
        roleId: "ROLE_AGENT_DEVELOPER",
      }),
    ]);
  });

  it("allows a Developer to inspect a Project Instance they did not create", async () => {
    const request = authorizedRequest(
      users.developer,
      "/api/v1/projects/individual/instances/other-agent",
    );
    await expect((await middleware())({ context: {}, req: request }))
      .resolves.toBeUndefined();
    expect(isProjectAdmissionComplete(request)).toBe(true);
    expect(admissionEvidenceForRequest(request)[0]).toMatchObject({
      decision: "ALLOW",
      relation: "PROJECT_ANY",
    });
  });

  it.each([
    ["OWNER", projectAgentIds.owned],
    ["MAINTAINER", projectAgentIds.maintained],
  ] as const)(
    "admits a Developer to a Project Agent Instance with the %s relation",
    async (relation, instanceId) => {
      const request = authorizedRequest(
        users.developer,
        `/api/v1/projects/individual/instances/${instanceId}`,
      );

      await expect((await middleware())({ context: {}, req: request }))
        .resolves.toBeUndefined();
      expect(isProjectAdmissionComplete(request)).toBe(true);
      expect(admissionEvidenceForRequest(request)).toEqual([
        expect.objectContaining({
          capability: "CAP_AGENT_INSTANCE_CONFIG_VIEW",
          decision: "ALLOW",
          relation,
          resourceId: instanceId,
          roleId: "ROLE_AGENT_DEVELOPER",
        }),
      ]);
    },
  );

  it("allows a Developer to inspect a Project Agent Instance without a per-Agent relation", async () => {
    const request = authorizedRequest(
      users.developer,
      `/api/v1/projects/individual/instances/${projectAgentIds.other}`,
    );

    await expect((await middleware())({ context: {}, req: request }))
      .resolves.toBeUndefined();
    expect(admissionEvidenceForRequest(request)[0]).toMatchObject({
      capability: "CAP_AGENT_INSTANCE_CONFIG_VIEW",
      decision: "ALLOW",
      relation: "PROJECT_ANY",
    });
  });

  it("allows a Developer into the shared Agent authoring collection", async () => {
    const request = authorizedRequest(
      users.developer,
      "/api/v1/projects/individual/agents",
    );
    await expect((await middleware())({ context: {}, req: request }))
      .resolves.toBeUndefined();
    expect(admissionEvidenceForRequest(request)[0]).toMatchObject({
      capability: "CAP_AGENT_REGISTRATION_VIEW",
      decision: "ALLOW",
      relation: "PROJECT_ANY",
    });
  });

  it("denies Project Admin access to Agent definition routes", async () => {
    const request = authorizedRequest(
      users.admin,
      "/api/v1/projects/individual/agents",
    );
    const response = await (await middleware())({ context: {}, req: request });
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      code: "agent_developer_role_required",
      detail: "Agent definition and development require the active Agent Developer role.",
    });
    expect(isProjectAdmissionComplete(request)).toBe(false);
  });

  it("keeps Agent Garden available to Project Admin", async () => {
    const request = authorizedRequest(
      users.admin,
      "/api/v1/projects/individual/agent-garden",
    );
    await expect((await middleware())({ context: {}, req: request }))
      .resolves.toBeUndefined();
  });

  it("does not synthesize ASSIGNED from the User role", async () => {
    const request = authorizedRequest(
      users.user,
      "/api/v1/projects/individual/instances",
    );
    const response = await (await middleware())({ context: {}, req: request });
    expect(response?.status).toBe(403);
    expect(admissionEvidenceForRequest(request)[0]).toMatchObject({
      capability: "CAP_AGENT_INSTANCE_CONFIG_VIEW",
      decision: "DENY",
      relation: "PROJECT_ANY",
    });
  });

  it("checks body-derived Memory and binding CAPs on a trailing-slash create", async () => {
    const request = authorizedRequest(
      users.developer,
      "/api/v1/projects/individual/instances/",
      {
        body: JSON.stringify({ agentPlatform: "openclaw" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    await expect((await middleware())({ context: {}, req: request }))
      .resolves.toBeUndefined();
    expect(admissionEvidenceForRequest(request).map(({ capability }) => capability))
      .toEqual([
        "CAP_AGENT_INSTANCE_CREATE",
        "CAP_AGENT_INSTANCE_ACCESS_POLICY_ASSIGN",
        "CAP_AGENT_INSTANCE_MODEL_ROUTING_ASSIGN",
        "CAP_AGENT_MEMORY_CONFIG_UPDATE",
      ]);
  });

  it("keeps the default Project Administrator Instance creation path usable", async () => {
    const request = authorizedRequest(
      users.admin,
      "/api/v1/projects/individual/instances/",
      {
        body: JSON.stringify({
          accessPolicyIds: ["default-access"],
          agentPlatform: "openclaw",
          knowledgeSourceIds: ["project-docs"],
          mcpServerIds: ["tools"],
          memory: { mode: "hybrid" },
          modelRoutingId: "default-routing",
          policyId: "runtime-default",
          skillIds: ["summarize"],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    await expect((await middleware())({ context: {}, req: request }))
      .resolves.toBeUndefined();
    expect(admissionEvidenceForRequest(request).every(
      ({ decision }) => decision === "ALLOW",
    )).toBe(true);
  });

  it("lets Project Administrator complete Provider, model, and routing management", async () => {
    const managementRequests = [
      ["POST", "/api/v1/projects/individual/providers/discover", "CAP_PROVIDER_DISCOVER"],
      ["POST", "/api/v1/projects/individual/providers", "CAP_PROVIDER_CREATE"],
      ["POST", "/api/v1/projects/individual/models", "CAP_MODEL_CREATE"],
      ["POST", "/api/v1/projects/individual/model-routings", "CAP_MODEL_ROUTING_CREATE"],
      ["PUT", "/api/v1/projects/individual/model-routings/routing-1", "CAP_MODEL_ROUTING_UPDATE"],
      ["POST", "/api/v1/projects/individual/model-routings/routing-1/refresh", "CAP_MODEL_ROUTING_RECONCILE"],
      ["DELETE", "/api/v1/projects/individual/model-routings/routing-1", "CAP_MODEL_ROUTING_DELETE"],
      ["DELETE", "/api/v1/projects/individual/models/model-1", "CAP_MODEL_DELETE"],
      ["DELETE", "/api/v1/projects/individual/providers/provider-1", "CAP_PROVIDER_DELETE"],
    ] as const;

    for (const [method, path, capability] of managementRequests) {
      const request = authorizedRequest(users.admin, path, {
        headers: { "content-type": "application/json" },
        method,
        ...(method === "DELETE" ? {} : { body: "{}" }),
      });
      await expect((await middleware())({ context: {}, req: request }))
        .resolves.toBeUndefined();
      expect(admissionEvidenceForRequest(request)[0]).toMatchObject({
        capability,
        decision: "ALLOW",
        roleId: "ROLE_PROJECT_ADMIN",
      });
    }
  });

  it("fails closed for an undeclared nested Project route", async () => {
    const request = authorizedRequest(
      users.developer,
      "/api/v1/projects/individual/instances/owned-agent/logs/raw",
    );
    const response = await (await middleware())({ context: {}, req: request });
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      detail: expect.stringMatching(/no Capability admission policy/i),
      status: 403,
    });
  });
});
