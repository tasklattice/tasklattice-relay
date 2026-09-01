import type { ExpertAgentDefinitionInput } from "@tali/contracts";
import type { ExpertAgentResourceClient } from "@tali/expert-agent-runtime/library";
import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createTestStore } from "../test/store";
import { ExpertAgentLifecycleService } from "./expert-agent-lifecycle-service";
import { ExpertAgentTestService } from "./expert-agent-validation-service";

let database: PrismaClient | undefined;

afterEach(async () => {
  await database?.$disconnect();
  database = undefined;
});

function unsupportedDefinition(): ExpertAgentDefinitionInput {
  return {
    expectedRevision: 0,
    delegations: [],
    product: {
      name: "Unsupported development Agent",
      purpose: "Exercise the developer test harness without inventing output.",
      targetUsers: ["Agent developers"],
      capabilities: ["Accept a developer test message"],
      outOfScope: ["Pretend an unavailable runtime exists"],
      inputContract: { type: "object", required: ["text"] },
      outputContract: { type: "object", required: ["outcome", "text", "citations"] },
    },
    policy: {
      preset: "CONTROLLED",
      groundingPolicy: "OPTIONAL",
      outputMode: "STRUCTURED",
      actionPolicy: "ALLOWLIST",
    },
    acceptance: {
      cases: [{
        id: "reports-unavailable-engine",
        title: "Reports an unavailable engine",
        kind: "FAILURE_PATH",
        given: "The Agent has no registered execution engine",
        when: "A developer sends a test message",
        then: ["The request fails explicitly"],
        required: true,
      }],
      minimumRequiredPassRate: 1,
    },
    safety: {
      guardrails: [{
        id: "no-fake-result",
        category: "OPERATIONAL",
        rule: "Do not fabricate a result when no runtime engine is available.",
        violationBehavior: "REJECT",
        required: true,
      }],
      prohibitedBehaviors: ["Invent a runtime response"],
      noEvidenceBehavior: "UNKNOWN",
      allowGeneralModelFallback: false,
    },
    execution: {
      mode: "AGENTIC",
      engine: { framework: "GOOGLE_ADK", version: "2.0" },
      modelRoutingId: "unassigned-model-routing",
      instruction: "Return a real runtime result or an explicit failure.",
      configuration: { engineType: "UNREGISTERED_TEST_ENGINE" },
      maxSteps: 8,
      timeoutMs: 60_000,
    },
    resources: [],
  };
}

const resources: ExpertAgentResourceClient = {
  async callMcpTool() {
    throw new Error("No MCP call expected.");
  },
  async searchKnowledge() {
    return [];
  },
  async completeModel() {
    throw new Error("No model call expected.");
  },
};

describe("Agent developer test harness", () => {
  it("returns and records an explicit failure when no real engine supports the Agent", async () => {
    const store = createTestStore();
    database = store.database();
    const lifecycle = new ExpertAgentLifecycleService(database);
    const agent = await lifecycle.createAgent({
      projectId: store.projectId,
      actorId: "local-admin",
      slug: "unsupported-development-agent",
      executionMode: "AGENTIC",
      definition: unsupportedDefinition(),
    });

    const result = await new ExpertAgentTestService(store.projectId, {
      db: database,
      lifecycle,
      runtimeResources: resources,
    }).runDeveloperTry({
      agentId: agent.id,
      actorId: "local-admin",
      message: "hello",
    });

    expect(result).toMatchObject({ outcome: "FAILED", toolCallCount: 0, knowledgeSourceCount: 0 });
    expect(result.text).toContain("Expected one execution engine");
    await expect(database.projectRunRecord.findFirst({
      where: { projectId: store.projectId, traceId: result.traceId },
      select: { source: true, triggerType: true, status: true },
    })).resolves.toEqual({
      source: "expert-agent",
      triggerType: "USER",
      status: "FAILED",
    });
  });
});
