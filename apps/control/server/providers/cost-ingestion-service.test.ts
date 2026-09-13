import { describe, expect, it, vi } from "vitest";
import { createTestPrisma } from "../test/prisma";
import type { LiteLLMAdminClient } from "./litellm-client";
import { CostIngestionService } from "./cost-ingestion-service";

function client(): LiteLLMAdminClient {
  return {
    baseUrl: "http://litellm:4000",
    registerModel: vi.fn(),
    deleteModelById: vi.fn(async () => undefined),
    deleteModel: vi.fn(),
    probeModel: vi.fn(),
    createInstanceKey: vi.fn(),
    blockKey: vi.fn(),
    revokeKey: vi.fn(),
    listSpendLogs: vi.fn(async (_from, _to, teamId) => [{
      request_id: "request-1",
      request_start_time: "2026-08-13T10:00:00.000Z",
      team_id: teamId ?? "missing-team",
      model: "production-chat",
      spend: 2.5,
      prompt_tokens: 100,
      completion_tokens: 25,
      status: "success",
    }]),
  };
}

describe("CostIngestionService", () => {
  it("polls each Project through its own LiteLLM Team and stores Project-owned facts", async () => {
    const db = createTestPrisma();
    await db.projectQuotaRecord.update({
      where: { projectId: "individual" },
      data: { litellmTeamId: "team-individual" },
    });
    const litellm = client();
    const service = new CostIngestionService(
      db,
      litellm,
      () => new Date("2026-08-13T12:00:00.000Z"),
    );

    await expect(service.syncAll()).resolves.toEqual({
      attemptedProjects: 1,
      syncedProjects: 1,
      failedProjects: [],
    });
    expect(litellm.listSpendLogs).toHaveBeenCalledWith(
      "2026-06-12",
      "2026-08-13",
      "team-individual",
    );
    const facts = await db.modelUsageFactRecord.findMany();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      projectId: "individual",
      requestId: "request-1",
    });
    expect(Number(facts[0]?.totalCostUsd)).toBe(2.5);
  });

  it("does not ingest a Project until a LiteLLM Team establishes ownership", async () => {
    const db = createTestPrisma();
    const litellm = client();
    const result = await new CostIngestionService(db, litellm).syncAll();

    expect(result).toMatchObject({ attemptedProjects: 0, syncedProjects: 0 });
    expect(litellm.listSpendLogs).not.toHaveBeenCalled();
  });
});
