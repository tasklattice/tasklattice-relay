import { describe, expect, it, vi } from "vitest";
import type { LiteLLMAdminClient } from "../providers/litellm-client";
import { createTestStore } from "../test/store";
import { ProjectQuotaService } from "./project-quota-service";
import type { ModelUsageFact } from "../providers/cost-analytics-store";

function adapter(): LiteLLMAdminClient {
  return {
    baseUrl: "http://litellm:4000",
    registerModel: vi.fn(),
    deleteModelById: vi.fn(async () => undefined),
    deleteModel: vi.fn(),
    probeModel: vi.fn(),
    createInstanceKey: vi.fn(),
    blockKey: vi.fn(),
    revokeKey: vi.fn(),
    listSpendLogs: vi.fn(),
    ensureProjectTeam: vi.fn(async () => "team-project"),
    updateProjectTeam: vi.fn(async () => undefined),
    addProjectTeamMember: vi.fn(async () => undefined),
    createInstanceServiceAccountKey: vi.fn(async () => ({
      secret: "sk-instance",
      tokenId: "hashed-instance",
    })),
  };
}

function usageFact(
  requestId: string,
  at: string,
  spend: number,
): ModelUsageFact {
  return {
    eventId: `litellm:${requestId}`,
    requestId,
    requestStartTime: at,
    usageDate: at.slice(0, 10),
    usageHour: new Date(at).getUTCHours(),
    projectId: "individual",
    requestedModel: "production-chat",
    resolvedModel: "production-chat",
    modelGroup: "production-chat",
    provider: "LiteLLM",
    callType: "chat",
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningTokens: 0,
    totalCostUsd: spend,
    costStatus: "known",
    costSource: "litellm:spend",
    priceVersion: "test",
    requestCount: 1,
    successCount: 1,
    failureCount: 0,
    retryCount: 0,
    cacheHit: false,
    fallbackUsed: false,
    status: "success",
    tags: [],
    metadata: {},
    sourceRecordHash: requestId,
    createdAt: at,
  };
}

describe("ProjectQuotaService", () => {
  it("persists Project limits without synchronizing human users to LiteLLM", async () => {
    const litellm = adapter();
    const service = new ProjectQuotaService(createTestStore(), litellm);

    const quota = await service.update(
      {
        hardBudgetUsd: 250,
        budgetDuration: "30d",
        tpmLimit: 500_000,
        maxInstances: 3,
        maxMcpIntegrations: 4,
        maxKnowledgeBaseIntegrations: 2,
      },
      "admin",
    );

    expect(quota).toMatchObject({
      hardBudgetUsd: 250,
      budgetDuration: "30d",
      tpmLimit: 500_000,
      maxInstances: 3,
      syncStatus: "synced",
      litellmTeamId: "team-project",
    });
    expect(quota.budgetPeriodStartedAt).toBeTruthy();
    expect(quota.budgetResetsAt).toBeTruthy();
    expect(litellm.updateProjectTeam).toHaveBeenCalledWith("team-project", {
      maxBudget: 250,
      budgetDuration: "30d",
      tpmLimit: 500_000,
    });
    expect(litellm.addProjectTeamMember).not.toHaveBeenCalled();
  });

  it("reports budget usage only inside the current reset window", async () => {
    const store = createTestStore();
    let current = new Date("2026-08-01T00:00:00.000Z");
    const service = new ProjectQuotaService(store, adapter(), () => current);
    await service.update(
      {
        hardBudgetUsd: 100,
        budgetDuration: "30d",
        tpmLimit: null,
        maxInstances: null,
        maxMcpIntegrations: null,
        maxKnowledgeBaseIntegrations: null,
      },
      "admin",
    );
    await store
      .costAnalytics()
      .insertFact(usageFact("before-window", "2026-07-31T23:59:59.000Z", 80));
    await store
      .costAnalytics()
      .insertFact(usageFact("inside-window", "2026-08-02T00:00:00.000Z", 25));
    current = new Date("2026-08-13T00:00:00.000Z");

    const quota = await service.get();

    expect(quota.usage).toMatchObject({ spendUsd: 25, totalTokens: 15 });
    expect(quota.budgetPeriodStartedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(quota.budgetResetsAt).toBe("2026-08-31T00:00:00.000Z");
  });

  it("treats null as unlimited and zero as blocking new resources", async () => {
    const service = new ProjectQuotaService(createTestStore(), adapter());
    await service.update(
      {
        hardBudgetUsd: null,
        budgetDuration: null,
        tpmLimit: null,
        maxInstances: 0,
        maxMcpIntegrations: null,
        maxKnowledgeBaseIntegrations: 0,
      },
      "admin",
    );

    await expect(service.assertCanCreate("instances")).rejects.toThrow(
      "Instance quota exceeded",
    );
    await expect(service.assertCanCreate("mcp")).resolves.toBeUndefined();
    await expect(service.assertCanCreate("knowledge-base")).rejects.toThrow(
      "Vector Database integration quota exceeded",
    );
  });

  it("creates an Instance Service Account with Project and Instance metadata", async () => {
    const litellm = adapter();
    const service = new ProjectQuotaService(createTestStore(), litellm);

    const result = await service.createInstanceKey({
      alias: "tali-instance-1",
      models: ["production-chat"],
      metadata: {
        tali_project_id: "individual",
        tali_instance_id: "instance-1",
        service_account_id: "tali-instance-instance-1",
      },
      objectPermissions: {
        mcpServers: [],
      },
    });

    expect(result.teamId).toBe("team-project");
    expect(litellm.createInstanceServiceAccountKey).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-project",
        metadata: expect.objectContaining({
          tali_project_id: "individual",
          tali_instance_id: "instance-1",
        }),
      }),
    );
  });

  it("prevents child Project allocations from exceeding the Department budget", async () => {
    const store = createTestStore();
    const database = store.database();
    await database.department.update({
      where: { id: "dep1" },
      data: { hardBudgetUsd: 100 },
    });
    await database.project.create({
      data: {
        id: "sibling-project",
        name: "Sibling Project",
        departmentId: "dep1",
        createdBy: "local-admin",
      },
    });
    await database.projectQuotaRecord.create({
      data: {
        projectId: "sibling-project",
        hardBudgetUsd: 30,
        budgetDuration: "30d",
        budgetPeriodStartedAt: new Date("2026-08-01T00:00:00.000Z"),
        budgetResetsAt: new Date("2026-08-31T00:00:00.000Z"),
      },
    });
    const service = new ProjectQuotaService(store, adapter());
    const quota = {
      hardBudgetUsd: 80,
      budgetDuration: "30d" as const,
      tpmLimit: null,
      maxInstances: null,
      maxMcpIntegrations: null,
      maxKnowledgeBaseIntegrations: null,
    };

    await expect(service.update(quota, "admin")).rejects.toThrow(
      "Department's $100.00 limit",
    );
    await expect(
      service.update({ ...quota, hardBudgetUsd: null }, "admin"),
    ).rejects.toThrow("must have an explicit budget");
    await expect(
      service.update({ ...quota, hardBudgetUsd: 70 }, "admin"),
    ).resolves.toMatchObject({ hardBudgetUsd: 70 });
  });

  it("enforces Department capacity for both Project allocations and actual resources", async () => {
    const store = createTestStore();
    const database = store.database();
    await database.department.update({
      where: { id: "dep1" },
      data: { hardMaxInstances: 5, hardMaxMcpIntegrations: 0 },
    });
    await database.project.create({
      data: {
        id: "capacity-sibling",
        name: "Capacity Sibling",
        departmentId: "dep1",
        createdBy: "local-admin",
      },
    });
    await database.projectQuotaRecord.create({
      data: { projectId: "capacity-sibling", maxInstances: 3 },
    });
    const service = new ProjectQuotaService(store, adapter());
    const quota = {
      hardBudgetUsd: null,
      budgetDuration: null,
      tpmLimit: null,
      maxInstances: 3,
      maxMcpIntegrations: 0,
      maxKnowledgeBaseIntegrations: null,
    };

    await expect(service.update(quota, "admin")).rejects.toThrow(
      "Department's 5 hard limit",
    );
    await expect(
      service.update({ ...quota, maxInstances: null }, "admin"),
    ).rejects.toThrow("must have an explicit Instance quota");
    await expect(
      service.update({ ...quota, maxInstances: 2 }, "admin"),
    ).resolves.toMatchObject({ maxInstances: 2 });
    await database.projectQuotaRecord.update({
      where: { projectId: "individual" },
      data: { maxMcpIntegrations: 1 },
    });
    await expect(service.assertCanCreate("mcp")).rejects.toThrow(
      "Department hard quota exceeded",
    );
  });
});
