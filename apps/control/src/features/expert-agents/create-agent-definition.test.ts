import type { ExpertAgentContractDraft } from "@tali/contracts";
import { describe, expect, it } from "vitest";
import {
  createInitialAgentDefinition,
  slugifyExpertAgentName,
} from "./create-agent-definition";

const generatedDraft: ExpertAgentContractDraft = {
  name: "Model-selected name",
  purpose: "A model-selected purpose",
  targetUsers: ["Release managers"],
  capabilities: ["Compare approved release evidence"],
  outOfScope: ["Deploying releases"],
  delegationGuidance: ["Delegate release risk analysis"],
  expectedInputs: ["Release identifier"],
  expectedOutputs: ["Risk report"],
  executionMode: "WORKFLOW",
  policy: {
    preset: "CONTROLLED",
    groundingPolicy: "REQUIRED",
    outputMode: "STRUCTURED",
    actionPolicy: "APPROVAL",
  },
};

describe("initial Agent definition", () => {
  it("keeps developer-owned identity and build method while using generated product detail", () => {
    const definition = createInitialAgentDefinition({
      draft: generatedDraft,
      executionMode: "AGENTIC",
      name: "Release Risk Analyst",
      purpose: "Explain release risk from approved evidence.",
    });

    expect(definition.product.name).toBe("Release Risk Analyst");
    expect(definition.product.purpose).toBe(
      "Explain release risk from approved evidence.",
    );
    expect(definition.product.targetUsers).toEqual(["Release managers"]);
    expect(definition.product.capabilities).toEqual([
      "Compare approved release evidence",
    ]);
    expect(definition.execution.mode).toBe("AGENTIC");
    expect(definition.policy.preset).toBe("FLEXIBLE");
  });

  it("creates a safe Workflow scaffold when no Project model draft is available", () => {
    const definition = createInitialAgentDefinition({
      executionMode: "WORKFLOW",
      name: "Approval Flow",
      purpose: "Route a reviewed request through explicit approval steps.",
    });

    expect(definition.product.targetUsers).toEqual(["Project users"]);
    expect(definition.product.capabilities).toEqual([
      "Route a reviewed request through explicit approval steps.",
    ]);
    expect(definition.execution.mode).toBe("WORKFLOW");
    if (definition.execution.mode !== "WORKFLOW") throw new Error("Expected Workflow");
    expect(definition.execution.nodes.map((node) => node.id)).toEqual([
      "receive-request",
      "end-design",
    ]);
    expect(definition.policy.actionPolicy).toBe("APPROVAL");
  });

  it("derives a stable service slug from the explicit Agent name", () => {
    expect(slugifyExpertAgentName("Release Risk Analyst")).toBe(
      "release-risk-analyst",
    );
  });
});
