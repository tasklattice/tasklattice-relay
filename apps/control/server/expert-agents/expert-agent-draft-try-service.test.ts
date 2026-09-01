import type { ExpertAgentDraftTryInput, ModelDeployment } from "@tali/contracts";
import { describe, expect, it, vi } from "vitest";
import { ExpertAgentDraftTryService } from "./expert-agent-draft-try-service";

function chatModel(): ModelDeployment {
  return {
    id: "chat-default",
    modelId: "provider-chat",
    displayName: "Project Chat",
    modelType: "llm",
    litellmModelName: "tali/project/chat-default",
    status: "VALIDATED",
    origin: {
      scope: "DEPARTMENT",
      scopeId: "department-1",
      inherited: true,
      editable: false,
      projectDefault: { slot: "CHAT", managedBy: "DEPARTMENT" },
    },
  } as ModelDeployment;
}

function input(groundingPolicy: "OPTIONAL" | "REQUIRED" | "TOOL_GROUNDED"): ExpertAgentDraftTryInput {
  return {
    message: "Summarize repository changes from last week.",
    contract: {
      name: "Repository analyst",
      purpose: "Summarize repository activity.",
      targetUsers: ["Engineering leads"],
      capabilities: ["Summarize activity"],
      outOfScope: ["Write to repositories"],
      delegationGuidance: ["Delegate repository activity questions"],
      expectedInputs: ["Repository and date range"],
      expectedOutputs: ["Repository activity summary"],
      executionMode: "AGENTIC",
      policy: {
        preset: "FLEXIBLE",
        groundingPolicy,
        outputMode: "STRUCTURED",
        actionPolicy: "ALLOWLIST",
      },
    },
  };
}

describe("ExpertAgentDraftTryService", () => {
  it("abstains without a model call when grounding requires unattached evidence", async () => {
    const complete = vi.fn();
    const inventory = vi.fn();
    const issueProjectKey = vi.fn();
    const subject = new ExpertAgentDraftTryService({ complete, inventory, issueProjectKey });

    await expect(subject.run({
      actorId: "developer-1",
      projectId: "project-1",
      value: input("TOOL_GROUNDED"),
    })).resolves.toMatchObject({
      status: "COMPLETED",
      outcome: "ABSTAIN",
      source: "POLICY_SIMULATION",
      persisted: false,
    });
    expect(inventory).not.toHaveBeenCalled();
    expect(issueProjectKey).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns an explicit unavailable state when optional preview has no Project model", async () => {
    const subject = new ExpertAgentDraftTryService({
      inventory: async () => ({ models: [], routings: [] }),
      issueProjectKey: vi.fn(),
      complete: vi.fn(),
    });

    await expect(subject.run({
      actorId: "developer-1",
      projectId: "project-1",
      value: input("OPTIONAL"),
    })).resolves.toMatchObject({
      status: "UNAVAILABLE",
      reasonCode: "PROJECT_MODEL_REQUIRED",
      persisted: false,
    });
  });

  it("uses the Project model for an optional-grounding non-persistent preview", async () => {
    const complete = vi.fn(async () => ({
      outcome: "CLARIFY" as const,
      answer: "Which repository and date range should I use?",
    }));
    const subject = new ExpertAgentDraftTryService({
      inventory: async () => ({ models: [chatModel()], routings: [] }),
      issueProjectKey: async () => ({ baseUrl: "http://litellm:4000", secret: "project-key" }),
      complete,
    });

    await expect(subject.run({
      actorId: "developer-1",
      projectId: "project-1",
      value: input("OPTIONAL"),
    })).resolves.toMatchObject({
      status: "COMPLETED",
      outcome: "CLARIFY",
      source: "PROJECT_MODEL",
      persisted: false,
    });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      model: "tali/project/chat-default",
      secret: "project-key",
    }));
  });
});
