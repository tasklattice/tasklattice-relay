import type {
  ExpertAgentVersionSnapshot,
  ExpertAgentRuntimeEnvelope,
} from "@tali/contracts";
import { describe, expect, it } from "vitest";
import {
  enforceGrounding,
  ExpertAgentRuntime,
  type ExpertAgentRuntimeLogRecord,
} from "./expert-agent-runtime.js";
import type {
  ExpertAgentEngine,
  ExpertAgentExecutionResult,
  ExpertAgentResourceClient,
} from "./runtime-types.js";
import { createTestRuntimeEnvelope } from "./test-runtime-envelope.js";

function envelope(groundingPolicy: "OPTIONAL" | "REQUIRED" | "TOOL_GROUNDED"): ExpertAgentRuntimeEnvelope {
  const snapshot: ExpertAgentVersionSnapshot = {
    schemaVersion: "agent-version/v1",
    agentId: "grounding-gate-agent",
    product: {
      name: "Grounding Gate",
      purpose: "Verify evidence before release.",
      targetUsers: ["Developers"],
      capabilities: ["Verify evidence"],
      outOfScope: [],
      inputContract: {},
      outputContract: {},
    },
    policy: {
      preset: "CONTROLLED",
      groundingPolicy,
      outputMode: "STRUCTURED",
      actionPolicy: "ALLOWLIST",
    },
    delegations: [],
    acceptance: {
      cases: [{
        id: "grounding-gate",
        title: "Grounding gate",
        kind: "HAPPY_PATH",
        given: "A result is available",
        when: "The result is released",
        then: ["The grounding policy is enforced"],
        required: true,
      }],
      minimumRequiredPassRate: 1,
    },
    safety: {
      guardrails: [{
        id: "grounding-required",
        category: "GROUNDING",
        rule: "Required grounding must be present before release.",
        violationBehavior: "UNKNOWN",
        required: true,
      }],
      prohibitedBehaviors: ["Release unsupported claims"],
      noEvidenceBehavior: "UNKNOWN",
      allowGeneralModelFallback: false,
    },
    execution: {
      mode: "AGENTIC",
      engine: { framework: "test", version: "1" },
      modelRoutingId: "test",
      instruction: "test",
      configuration: {},
      maxSteps: 1,
      timeoutMs: 1_000,
    },
    resources: [],
  };
  return createTestRuntimeEnvelope(snapshot, "version-1");
}

const unsupported: ExpertAgentExecutionResult = {
  outcome: "COMPLETED",
  text: "An unsupported business claim.",
  data: {},
  citations: [],
  trace: [],
};

describe("Relay grounding gate", () => {
  it("withholds a completed answer when required evidence is absent", () => {
    const result = enforceGrounding(envelope("REQUIRED"), unsupported);
    expect(result.outcome).toBe("UNKNOWN");
    expect(result.text).not.toContain("unsupported business claim");
    expect(result.data).toMatchObject({ grounding: { released: false } });
    expect(result.trace).toContainEqual(expect.objectContaining({
      step: "relay.grounding-gate",
      status: "FAILED",
    }));
  });

  it("does not impose the Controlled evidence gate on optional grounding", () => {
    expect(enforceGrounding(envelope("OPTIONAL"), unsupported)).toBe(unsupported);
  });

  it("emits structured run and Trace logs without logging prompt content", async () => {
    const validEnvelope = envelope("OPTIONAL");
    const records: ExpertAgentRuntimeLogRecord[] = [];
    const engine: ExpertAgentEngine = {
      mode: "AGENTIC",
      supports: () => true,
      execute: async () => ({
        ...unsupported,
        trace: [{
          step: "policy-check",
          status: "COMPLETED",
          summary: "Policy check completed.",
          occurredAt: "2026-08-31T00:00:00.000Z",
          attributes: {
            framework: "langgraph",
            outcome: "DIRECT",
            unsafeDiagnostic: "must-not-be-logged",
          },
        }],
      }),
    };
    const resources: ExpertAgentResourceClient = {
      callMcpTool: async () => ({}),
      searchKnowledge: async () => [],
      completeModel: async () => ({}),
    };
    const runtime = new ExpertAgentRuntime({
      envelope: validEnvelope,
      engines: [engine],
      resources,
      logger: (record) => records.push(record),
    });

    await runtime.execute({
      messageId: "message-log-1",
      contextId: "trace-log-1",
      text: "private customer prompt must never appear in stdout",
      metadata: {},
    });

    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "expert_agent.run.started",
        runId: "message-log-1",
      }),
      expect.objectContaining({
        event: "expert_agent.trace",
        step: "policy-check",
        outcome: "DIRECT",
      }),
      expect.objectContaining({
        event: "expert_agent.run.finished",
        status: "SUCCEEDED",
      }),
    ]));
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("private customer prompt");
    expect(serialized).not.toContain("must-not-be-logged");
  });
});
