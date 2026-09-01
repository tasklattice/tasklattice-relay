import {
  builtinRoleIds,
  projectCapabilities,
  projectCapabilityDefinition,
  type ProjectCapability,
} from "@tali/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createTestPrisma } from "../test/prisma";
import {
  builtinProjectRoles,
  builtinRole,
  builtinRoleForMembership,
} from "./builtin-roles";
import { RoleCatalogService } from "./role-catalog";

const forbiddenForEveryHumanRole = [
  "CAP_PROJECT_CREATE",
  "CAP_APPROVED_CHANGE_APPLY",
  "CAP_APPROVAL_OVERRIDE",
] as const satisfies readonly ProjectCapability[];

let database: PrismaClient;

beforeEach(() => {
  database = createTestPrisma();
});

afterEach(async () => {
  await database?.$disconnect();
});

describe("builtin Role catalog", () => {
  it("persists the exact seven system Roles and their Capability grants", async () => {
    const catalog = await new RoleCatalogService(database).catalog();
    expect(catalog.revision).toBeGreaterThan(0);
    expect(catalog.roles.map(({ id }) => id)).toEqual(builtinRoleIds);
    expect(catalog.roles).toHaveLength(7);
    expect(catalog.roles.map(({ name, scope }) => ({ name, scope }))).toEqual([
      { name: "Platform Administrator", scope: "PLATFORM" },
      { name: "Department Administrator", scope: "DEPARTMENT" },
      { name: "Project Administrator", scope: "PROJECT" },
      { name: "Agent Developer", scope: "PROJECT" },
      { name: "User", scope: "PROJECT" },
      { name: "Auditor", scope: "PROJECT" },
      { name: "Reviewer", scope: "PROJECT" },
    ]);
    expect(await database.roleDefinition.count()).toBe(7);
    expect(await database.roleCapabilityGrant.count()).toBeGreaterThan(0);
    expect(catalog.roles.every((role) =>
      role.grants.length > 0
      && role.capabilities.length === role.grants.length
      && role.builtin
      && role.systemManaged
      && role.immutable
    )).toBe(true);
  });

  it("keeps administration Roles inside their own scope", async () => {
    const catalog = await new RoleCatalogService(database).catalog();
    for (const role of catalog.roles) {
      expect(role.capabilities.every((capability) => {
        if (role.scope === "PLATFORM") return capability.startsWith("CAP_PLATFORM_");
        if (role.scope === "DEPARTMENT") return capability.startsWith("CAP_DEPARTMENT_");
        return !capability.startsWith("CAP_PLATFORM_")
          && !capability.startsWith("CAP_DEPARTMENT_");
      })).toBe(true);
    }
    expect((await new RoleCatalogService(database).role(
      "ROLE_DEPARTMENT_ADMIN",
    )).capabilities).toEqual(expect.arrayContaining([
      "CAP_DEPARTMENT_MEMBER_INVITE",
      "CAP_DEPARTMENT_MEMBER_ROLE_ASSIGN",
      "CAP_DEPARTMENT_PROJECT_CREATE",
      "CAP_DEPARTMENT_QUOTA_UPDATE",
    ]));
  });
});

describe("builtin Project roles", () => {
  it("binds unique, registered capabilities to every builtin Project role", async () => {
    const roles = await builtinProjectRoles(database);
    expect(new Set(roles.map(({ id }) => id)).size).toBe(5);
    const registry = new Set(projectCapabilities);
    for (const role of roles) {
      expect(role.immutable).toBe(true);
      expect(role.grants.map(({ capability }) => capability)).toEqual(role.capabilities);
      expect(new Set(role.capabilities).size).toBe(role.capabilities.length);
      expect(role.capabilities.every((capability) => registry.has(
        capability as ProjectCapability,
      ))).toBe(true);
      for (const forbidden of forbiddenForEveryHumanRole) {
        expect(role.capabilities).not.toContain(forbidden);
      }
    }
    expect(projectCapabilities.every((id) => /^CAP_[A-Z0-9_]+$/.test(id))).toBe(true);
    expect(projectCapabilities).not.toContain("CAP_SECRET_READ" as ProjectCapability);
    expect(projectCapabilities).not.toContain("CAP_SECRET_REVEAL" as ProjectCapability);
  });

  it("gives Project Administrator the complete Project-scoped capability set", async () => {
    const capabilities = (await builtinRole("ROLE_PROJECT_ADMIN", database)).capabilities;
    expect(capabilities).toEqual(
      projectCapabilities.filter(
        (capability) => !forbiddenForEveryHumanRole.includes(
          capability as (typeof forbiddenForEveryHumanRole)[number],
        ),
      ),
    );
    expect(capabilities).toEqual(expect.arrayContaining([
      "CAP_PROJECT_SETTINGS_UPDATE",
      "CAP_PROJECT_MEMBER_INVITE",
      "CAP_PROJECT_MEMBER_ROLE_ASSIGN",
      "CAP_PROVIDER_CREATE",
      "CAP_MODEL_CREATE",
      "CAP_AGENT_INSTANCE_TERMINAL_EXEC",
      "CAP_AGENT_INSTANCE_DELETE",
      "CAP_AGENT_MEMORY_CONTENT_VIEW",
      "CAP_AUDIT_EXPORT",
      "CAP_APPROVAL_REQUEST_DECIDE",
    ]));
  });

  it("makes Auditor read-only for governed Memory content", async () => {
    const capabilities = (await builtinRole("ROLE_AUDITOR", database)).capabilities;
    expect(capabilities).toEqual(expect.arrayContaining([
      "CAP_AUDIT_VIEW",
      "CAP_AUDIT_DETAIL_VIEW",
      "CAP_TRACE_VIEW",
      "CAP_AGENT_MEMORY_INDEX_STATUS_VIEW",
      "CAP_AGENT_MEMORY_CONTENT_VIEW",
    ]));
    expect(capabilities).not.toEqual(expect.arrayContaining([
      "CAP_AUDIT_EXPORT",
      "CAP_TRACE_CONTENT_VIEW",
      "CAP_AGENT_MEMORY_CONTENT_WRITE",
      "CAP_AGENT_INSTANCE_INTERACT",
    ]));
    const mutations = /_(?:CREATE|UPDATE|DELETE|ASSIGN|GRANT|REVOKE|EXEC|DECIDE|APPLY|WRITE|PURGE|IMPORT|EXPORT)$/;
    expect(capabilities.filter((capability) => mutations.test(capability))).toEqual([]);
  });

  it("limits Agent Developer to owned or maintained lifecycle operations", async () => {
    const role = await builtinRole("ROLE_AGENT_DEVELOPER", database);
    expect(role.relations).toEqual([
      "PROJECT_ANY",
      "OWNER",
      "MAINTAINER",
      "SESSION_PARTICIPANT",
    ]);
    expect(role.capabilities).toEqual(expect.arrayContaining([
      "CAP_AGENT_INSTANCE_CREATE",
      "CAP_AGENT_INSTANCE_UPDATE",
      "CAP_AGENT_INSTANCE_DELETE",
      "CAP_AGENT_MEMORY_CONFIG_UPDATE",
      "CAP_AGENT_MEMORY_RECALL_USE",
      "CAP_AGENT_MEMORY_CONTENT_VIEW",
      "CAP_AGENT_MEMORY_CONTENT_WRITE",
      "CAP_AGENT_MEMORY_CONTENT_DELETE",
      "CAP_AGENT_MEMORY_CONTENT_PURGE",
      "CAP_AGENT_MEMORY_EXPORT",
      "CAP_APPROVAL_REQUEST_SUBMIT",
      "CAP_TRACE_VIEW",
    ]));
    expect(role.capabilities).not.toEqual(expect.arrayContaining([
      "CAP_PROJECT_MEMBER_INVITE",
      "CAP_PROJECT_ROLE_UPDATE",
      "CAP_AGENT_INSTANCE_TERMINAL_EXEC",
      "CAP_APPROVAL_REQUEST_DECIDE",
    ]));
  });

  it("scopes each Developer grant independently", async () => {
    const grants = new Map(
      (await builtinRole("ROLE_AGENT_DEVELOPER", database)).grants.map((item) => [
        item.capability,
        item.relations,
      ]),
    );
    expect(grants.get("CAP_PROJECT_QUOTA_VIEW")).toEqual(["PROJECT_ANY"]);
    expect(grants.get("CAP_AGENT_INSTANCE_DELETE")).toEqual(["OWNER", "MAINTAINER"]);
    expect(grants.get("CAP_TRACE_VIEW")).toEqual(["OWNER", "MAINTAINER"]);
    expect(grants.get("CAP_AGENT_SESSION_MESSAGE_SEND")).toEqual([
      "SESSION_PARTICIPANT",
    ]);
  });

  it("lets Users read Project Memory without granting curation or settings", async () => {
    const capabilities = (await builtinRole("ROLE_USER", database)).capabilities;
    expect(capabilities).toEqual(expect.arrayContaining([
      "CAP_AGENT_INSTANCE_INTERACT",
      "CAP_AGENT_SESSION_CREATE",
      "CAP_AGENT_SESSION_MESSAGE_SEND",
      "CAP_AGENT_MEMORY_RECALL_USE",
      "CAP_AGENT_MEMORY_ITEM_VIEW",
      "CAP_AGENT_MEMORY_CONTENT_VIEW",
    ]));
    expect(capabilities).not.toEqual(expect.arrayContaining([
      "CAP_AGENT_INSTANCE_CONFIG_VIEW",
      "CAP_AGENT_MEMORY_CONTENT_WRITE",
      "CAP_AGENT_MEMORY_CONFIG_VIEW",
      "CAP_AUDIT_VIEW",
    ]));
  });

  it("keeps Reviewer independent from target mutations", async () => {
    const capabilities = (await builtinRole("ROLE_REVIEWER", database)).capabilities;
    expect(capabilities).toEqual(expect.arrayContaining([
      "CAP_APPROVAL_REQUEST_VIEW",
      "CAP_APPROVAL_REQUEST_COMMENT",
      "CAP_APPROVAL_REQUEST_DECIDE",
    ]));
    expect(capabilities).not.toContain("CAP_AGENT_INSTANCE_DELETE");
    expect(capabilities).not.toContain("CAP_PROJECT_ROLE_UPDATE");
  });

  it("maps the User membership directly to the User builtin Role", async () => {
    expect((await builtinRoleForMembership("user", database)).id).toBe("ROLE_USER");
  });

  it("registers the complete Memory capability boundary", () => {
    const memoryCapabilities = projectCapabilities.filter((capability) =>
      capability.startsWith("CAP_AGENT_MEMORY_"),
    );
    expect(memoryCapabilities).toHaveLength(20);
    expect(projectCapabilityDefinition(
      "CAP_AGENT_MEMORY_CONTENT_VIEW",
    ).sensitiveContent).toBe(true);
  });
});
