import type { ExpertAgentContractDraft } from "@tali/contracts";
import { describe, expect, it } from "vitest";
import {
  createInitialAgentDefinition,
  isInitialAgentDefinitionReady,
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
    if (definition.execution.mode !== "AGENTIC") throw new Error("Expected Adaptive Agent");
    expect(definition.execution.instruction).toBe(
      "Reason and respond using the request context and resources bound to this Agent.",
    );
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

  it.each(["AGENTIC", "WORKFLOW"] as const)(
    "preserves the %s execution mode used to select the development editor",
    (executionMode) => {
      const definition = createInitialAgentDefinition({
        executionMode,
        name: "Editor routing check",
        purpose: "Verify that the selected execution method reaches its matching editor.",
      });

      expect(definition.execution.mode).toBe(executionMode);
    },
  );

  it("requires both a name and a meaningful intent before development can start", () => {
    expect(isInitialAgentDefinitionReady({
      name: "",
      purpose: "Summarize approved engineering activity without inventing evidence.",
    })).toBe(false);
    expect(isInitialAgentDefinitionReady({
      name: "Activity summary",
      purpose: "Too short",
    })).toBe(false);
    expect(isInitialAgentDefinitionReady({
      name: "Activity summary",
      purpose: "Summarize approved engineering activity without inventing evidence.",
    })).toBe(true);
  });
});
