import type { ExpertAgentDefinition } from "@tali/contracts";
import { expertAgentWorkflowExecutionSpecSchema } from "@tali/contracts";
import { describe, expect, it } from "vitest";
import {
  assessExpertAgentPublishReadiness,
  buildExpertAgentVersionSnapshot,
  canonicalJson,
  expertAgentContentDigest,
} from "./expert-agent-domain";

const definition: ExpertAgentDefinition = {
  delegations: [],
  product: {
    name: "GitHub Weekly Commit Summarizer",
    purpose: "Count and summarize the current week's commits.",
    targetUsers: ["Engineering leads"],
    capabilities: ["Read commits", "Produce grounded summaries"],
    outOfScope: ["Write to GitHub"],
    inputContract: { type: "object" },
    outputContract: { type: "object" },
  },
  policy: {
    preset: "CONTROLLED",
    groundingPolicy: "REQUIRED",
    outputMode: "STRUCTURED",
    actionPolicy: "ALLOWLIST",
  },
  acceptance: {
    cases: [{
      id: "counts-real-commits",
      title: "Counts commits from GitHub",
      kind: "HAPPY_PATH",
      given: "A repository with commits in the current week",
      when: "The Agent is invoked",
      then: ["The count equals the normalized GitHub result"],
      required: true,
    }],
    minimumRequiredPassRate: 1,
  },
  safety: {
    guardrails: [{
      id: "read-only-github",
      category: "TOOL_USE",
      rule: "Only invoke read-only GitHub tools.",
      violationBehavior: "REJECT",
      required: true,
    }],
    prohibitedBehaviors: ["Invent a commit SHA"],
    noEvidenceBehavior: "UNKNOWN",
    allowGeneralModelFallback: false,
  },
  execution: {
    mode: "AGENTIC",
    engine: { framework: "GOOGLE_ADK", version: "2.0" },
    modelRoutingId: "project-default",
    instruction: "Summarize only normalized commit facts.",
    configuration: {},
    maxSteps: 12,
    timeoutMs: 120_000,
  },
  resources: [{
    kind: "MCP_SERVER",
    resourceId: "github-official",
    revision: "2026-08-30",
    access: "READ",
    required: true,
  }],
};

function snapshot() {
  return buildExpertAgentVersionSnapshot({
    agentId: "6bf695e2-55c9-49d3-a54d-e5818eea6318",
    definition,
  });
}

describe("Agent delivery domain", () => {
  it("canonicalizes object keys before hashing", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}',
    );
  });

  it("changes the content digest when a pinned engine changes", () => {
    const first = snapshot();
    const second = {
      ...first,
      execution: {
        ...first.execution,
        engine: { ...first.execution.engine, version: "2.1" },
      },
    };
    expect(expertAgentContentDigest(first)).not.toBe(expertAgentContentDigest(second));
  });

  it("rejects publish evidence from an older Agent digest", () => {
    expect(assessExpertAgentPublishReadiness({
      contentDigest: `sha256:${"a".repeat(64)}`,
      latestPublishTest: {
        id: "test-1",
        contentDigest: `sha256:${"b".repeat(64)}`,
        status: "PASSED",
        evidence: {},
      },
    })).toEqual({ ready: false, reason: "TESTS_OUTDATED", testRunId: "test-1" });
  });

  it("accepts one passed Publish Test for the exact Agent digest", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(assessExpertAgentPublishReadiness({
      contentDigest: digest,
      latestPublishTest: {
        id: "test-1",
        contentDigest: digest,
        status: "PASSED",
        evidence: {
          agentDigest: digest,
          mode: "RELEASE",
          status: "PASSED",
          summary: "All release checks passed.",
          assertions: [],
          artifacts: [],
          startedAt: "2026-08-31T00:00:00.000Z",
          finishedAt: "2026-08-31T00:01:00.000Z",
        },
      },
    })).toEqual({ ready: true, reason: "READY", testRunId: "test-1" });
  });

  it("rejects cyclic Playbooks and requires deterministic outcome edges", () => {
    const base = {
      mode: "WORKFLOW" as const,
      engine: { framework: "tasklattice-playbook", version: "1.0.0" },
      entrypoint: "reason",
      configuration: {},
      nodes: [
        { id: "reason", type: "REASON" as const, configuration: {} },
        { id: "verify", type: "VERIFY" as const, configuration: {} },
        { id: "done", type: "END" as const, configuration: {} },
      ],
      timeoutMs: 30_000,
    };
    expect(expertAgentWorkflowExecutionSpecSchema.safeParse({
      ...base,
      transitions: [
        { from: "reason", outcome: "NEXT", to: "verify" },
        { from: "verify", outcome: "RETRY", to: "reason" },
        { from: "verify", outcome: "DONE", to: "done" },
      ],
    }).success).toBe(false);
  });
});
