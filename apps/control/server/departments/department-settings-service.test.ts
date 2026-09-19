import { describe, expect, it, vi } from "vitest";
vi.mock("../jobs/control-job-queue", async (importOriginal) => ({
  ...await importOriginal<object>(),
  controlJobQueue: () => ({ start: vi.fn(async () => undefined),
    enqueueProjectRuntimeReconcile: vi.fn(async () => "00000000-0000-4000-8000-000000000028"),
    enqueueProjectDeletion: vi.fn(async () => "00000000-0000-4000-8000-000000000027") }),
}));

import type { UpdateDepartmentSettingsInput } from "@tali/contracts";
import type { AuthUser, PlatformPrincipal } from "../auth/auth";
import { ProjectService } from "../projects/project-service";
import { createTestPrisma } from "../test/prisma";
import { DepartmentSettingsService } from "./department-settings-service";

function auth(user: AuthUser): PlatformPrincipal {
  return { user };
}

const administrator = auth({
  id: "local-admin",
  displayName: "Local Administrator",
  email: "admin@tali.local",
  hasPassword: true,
  systemRole: "platform_administrator",
  username: "admin",
});

function input(
  overrides: {
    [Key in keyof UpdateDepartmentSettingsInput]?: Partial<
      UpdateDepartmentSettingsInput[Key]
    >;
  } = {},
): UpdateDepartmentSettingsInput {
  return {
    models: {
      defaultChatModel: null,
      defaultEmbeddingModel: null,
      ...overrides.models,
    },
    routing: {
      mode: "PROJECT_MANAGED",
      fallbackModel: null,
      ...overrides.routing,
    },
    quota: {
      softBudgetUsd: null,
      hardBudgetUsd: null,
      softMaxInstances: null,
      hardMaxInstances: null,
      softMaxMcpIntegrations: null,
      hardMaxMcpIntegrations: null,
      softMaxKnowledgeBaseIntegrations: null,
      hardMaxKnowledgeBaseIntegrations: null,
      ...overrides.quota,
    },
    projectDefaults: {
      hardBudgetUsd: null,
      budgetDuration: null,
      tpmLimit: null,
      maxInstances: null,
      maxMcpIntegrations: null,
      maxKnowledgeBaseIntegrations: null,
      ...overrides.projectDefaults,
    },
  };
}

describe("DepartmentSettingsService", () => {
  it("persists model, routing, soft quota, and hard quota as one revision", async () => {
    const database = createTestPrisma();
    const service = new DepartmentSettingsService(database);

    const result = await service.update(administrator, "dep1", input({
      models: {
        defaultChatModel: "openai/gpt-5",
        defaultEmbeddingModel: "openai/text-embedding-3-large",
      },
      routing: {
        mode: "FAILOVER",
        fallbackModel: "anthropic/claude-sonnet",
      },
      quota: {
        softBudgetUsd: 800,
        hardBudgetUsd: 1_000,
        softMaxInstances: 8,
        hardMaxInstances: 10,
        softMaxMcpIntegrations: 16,
        hardMaxMcpIntegrations: 20,
        softMaxKnowledgeBaseIntegrations: 8,
        hardMaxKnowledgeBaseIntegrations: 10,
      },
      projectDefaults: {
        hardBudgetUsd: 100,
        budgetDuration: "30d",
        tpmLimit: 250_000,
        maxInstances: 2,
        maxMcpIntegrations: 4,
        maxKnowledgeBaseIntegrations: 2,
      },
    }));

    expect(result).toMatchObject({
      revision: 2,
      models: { defaultChatModel: "openai/gpt-5" },
      routing: { mode: "FAILOVER", fallbackModel: "anthropic/claude-sonnet" },
      quota: { softMaxInstances: 8, hardMaxInstances: 10 },
      projectDefaults: { maxInstances: 2 },
      usage: { allocatedInstances: 0, actualInstances: 0 },
    });
  });

  it("does not place a hard boundary below existing Project allocations", async () => {
    const database = createTestPrisma();
    await database.projectQuotaRecord.update({
      where: { projectId: "individual" },
      data: { maxInstances: 4 },
    });

    await expect(
      new DepartmentSettingsService(database).update(
        administrator,
        "dep1",
        input({ quota: { hardMaxInstances: 3 } }),
      ),
    ).rejects.toThrow("already allocated");
  });

  it("copies Department defaults into a newly created Project", async () => {
    const database = createTestPrisma();
    await new DepartmentSettingsService(database).update(
      administrator,
      "dep1",
      input({
        models: {
          defaultChatModel: "openai/gpt-5",
          defaultEmbeddingModel: "openai/text-embedding-3-large",
        },
        routing: { mode: "SINGLE", fallbackModel: null },
        quota: { hardMaxInstances: 10 },
        projectDefaults: { maxInstances: 2 },
      }),
    );

    const project = await new ProjectService(database).create(
      administrator,
      "dep1",
      "Inherited Project",
      [],
      "department",
    );
    await expect(database.projectQuotaRecord.findUniqueOrThrow({
      where: { projectId: project.id },
    })).resolves.toMatchObject({ maxInstances: 2 });
    await expect(database.project.findUniqueOrThrow({
      where: { id: project.id },
      select: {
        inheritedDepartmentDefaults: true,
        inheritedDepartmentSettingsRevision: true,
      },
    })).resolves.toMatchObject({
      inheritedDepartmentSettingsRevision: 2,
      inheritedDepartmentDefaults: {
        departmentId: "dep1",
        departmentSettingsRevision: 2,
        models: { defaultChatModel: "openai/gpt-5" },
        routing: { mode: "SINGLE" },
      },
    });
  });
});
