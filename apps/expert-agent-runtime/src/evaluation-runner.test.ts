import type { ExpertAgentAcceptanceCase, ExpertAgentEvaluationSuite } from "@tali/contracts";
import { describe, expect, it } from "vitest";
import {
  evaluateExpertAgentCase,
  runExpertAgentEvaluationSuite,
  type ExpertAgentEvaluationObservation,
} from "./evaluation-runner.js";

const observation: ExpertAgentEvaluationObservation = {
  status: "ANSWER",
  output: { answer: "Grounded" },
  visitedNodeIds: ["retrieve", "verify-claims", "verify-citations", "response"],
  citationSourceIds: ["policy-v3"],
  changedBlockIds: ["departureDate", "benefits"],
  unchangedBlockIds: ["summary", "handover"],
  toolCalls: [],
  delegatedExpertAgentIds: [],
  claims: ["benefits follow policy v3"],
  sourceIds: ["policy-v3"],
  traceId: "trace-1",
};

const controlledCase: ExpertAgentAcceptanceCase = {
  id: "partial-update",
  title: "Partial departure date update",
  kind: "EDGE_CASE",
  given: "An existing structured answer",
  when: "The user corrects the departure date",
  then: ["Only dependent blocks change"],
  required: true,
  request: { text: "My departure date is October 12, 2026." },
  assertions: [
    { type: "STATUS", expected: "ANSWER" },
    { type: "EXECUTION_PATH", requiredNodeIds: ["verify-claims", "verify-citations"], forbiddenNodeIds: [] },
    { type: "CITATIONS", required: true, allowedSourceIds: ["policy-v3"] },
    { type: "BLOCK_STABILITY", changedBlockIds: ["departureDate", "benefits"], unchangedBlockIds: ["summary", "handover"] },
    { type: "SOURCE_COVERAGE", requiredSourceIds: ["policy-v3"] },
  ],
};

describe("Expert Agent Evaluation Suite runner", () => {
  it("evaluates structural Controlled assertions without exact text equality", () => {
    const result = evaluateExpertAgentCase({ testCase: controlledCase, observation });
    expect(result.passed).toBe(true);
    expect(result.traceId).toBe("trace-1");
  });

  it("does not fake semantic quality when no configured evaluator produced a score", () => {
    const testCase: ExpertAgentAcceptanceCase = {
      ...controlledCase,
      id: "semantic-summary",
      assertions: [{ type: "SEMANTIC_QUALITY", rubric: "Covers important changes", minimumScore: 0.8 }],
    };
    expect(evaluateExpertAgentCase({ testCase, observation })).toMatchObject({
      passed: false,
      assertions: [{ passed: false, message: expect.stringContaining("did not invent a score") }],
    });
  });

  it("runs every case in a named required Suite", async () => {
    const suite: ExpertAgentEvaluationSuite = {
      id: "controlled-regression",
      name: "Controlled regression",
      description: "Required structural gates",
      required: true,
      caseIds: [controlledCase.id],
    };
    await expect(runExpertAgentEvaluationSuite({
      suite,
      cases: [controlledCase],
      execute: async () => observation,
    })).resolves.toMatchObject({ passed: true, requiredPassRate: 1, cases: [{ caseId: "partial-update", passed: true }] });
  });

  it("fails explicitly when the Version engine could not execute", () => {
    expect(evaluateExpertAgentCase({
      testCase: controlledCase,
      observation: { ...observation, executionError: "Knowledge revision drifted." },
    })).toEqual(expect.objectContaining({
      passed: false,
      assertions: expect.arrayContaining([
        expect.objectContaining({ type: "EXECUTION", passed: false, message: expect.stringContaining("revision drifted") }),
      ]),
    }));
  });
});
