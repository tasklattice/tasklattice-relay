import type { McpServerDefinition, ModelDeployment } from "@tali/contracts";
import { describe, expect, it, vi } from "vitest";
import { ExpertAgentContractDraftService } from "./expert-agent-contract-draft-service";

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

const generatedDraft = {
  name: "Repository activity analyst",
  purpose: "Summarize bounded repository activity from authoritative tool evidence.",
  targetUsers: ["Engineering leads"],
  capabilities: ["Count commits in a requested time window", "Summarize verified commit metadata"],
  outOfScope: ["Writing to a source repository"],
  delegationGuidance: ["Delegate when a user asks for repository activity analysis"],
  expectedInputs: ["Repository identifier", "Start and end timestamps", "Optional branch or author filters"],
  expectedOutputs: ["Grounded activity summary", "Source commit references"],
  executionMode: "AGENTIC" as const,
  policy: {
    preset: "FLEXIBLE" as const,
    groundingPolicy: "TOOL_GROUNDED" as const,
    outputMode: "STRUCTURED" as const,
    actionPolicy: "ALLOWLIST" as const,
  },
};

describe("ExpertAgentContractDraftService", () => {
  it("returns a manual-fallback state without issuing a key when the Project has no chat Model", async () => {
    const issueProjectKey = vi.fn();
    const complete = vi.fn();
    const subject = new ExpertAgentContractDraftService({
      inventory: async () => ({ models: [], routings: [] }),
      issueProjectKey,
      complete,
    });

    await expect(subject.draft({
      actorId: "developer-1",
      projectId: "project-1",
      intention: "Build a repository activity Agent for engineering leads.",
    })).resolves.toMatchObject({
      status: "UNAVAILABLE",
      reasonCode: "PROJECT_MODEL_REQUIRED",
      manualFallbackAllowed: true,
    });
    expect(issueProjectKey).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("uses the Project-selected Model and validates its structured Contract", async () => {
    const complete = vi.fn(async () => generatedDraft);
    const subject = new ExpertAgentContractDraftService({
      inventory: async () => ({ models: [chatModel()], routings: [] }),
      issueProjectKey: async () => ({ baseUrl: "http://litellm:4000", secret: "project-key" }),
      complete,
    });

    await expect(subject.draft({
      actorId: "developer-1",
      projectId: "project-1",
      intention: "Build a repository activity Agent for engineering leads.",
    })).resolves.toEqual({
      status: "GENERATED",
      draft: generatedDraft,
      suggestions: { knowledge: [], tools: [], experts: [] },
      source: { kind: "MODEL", id: "chat-default" },
    });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      model: "tali/project/chat-default",
      secret: "project-key",
    }));
  });

  it("rejects a generated Contract that omits product boundaries", async () => {
    const subject = new ExpertAgentContractDraftService({
      inventory: async () => ({ models: [chatModel()], routings: [] }),
      issueProjectKey: async () => ({ baseUrl: "http://litellm:4000", secret: "project-key" }),
      complete: async () => ({ ...generatedDraft, outOfScope: undefined }),
    });

    await expect(subject.draft({
      actorId: "developer-1",
      projectId: "project-1",
      intention: "Build a repository activity Agent for engineering leads.",
    })).rejects.toThrow();
  });

  it("suggests only real Project resources whose catalog metadata matches the Contract", async () => {
    const githubMcp = {
      id: "github-mcp",
      name: "GitHub",
      status: "HEALTHY",
      tools: [{
        name: "list_repository_commits",
        title: "List repository commits",
        description: "Read commits for a repository and date range",
      }],
    } as McpServerDefinition;
    const subject = new ExpertAgentContractDraftService({
      inventory: async () => ({
        models: [chatModel()],
        routings: [],
        mcpServers: [githubMcp],
      }),
      issueProjectKey: async () => ({ baseUrl: "http://litellm:4000", secret: "project-key" }),
      complete: async () => generatedDraft,
    });

    await expect(subject.draft({
      actorId: "developer-1",
      projectId: "project-1",
      intention: "Summarize GitHub repository commits for engineering leads.",
    })).resolves.toMatchObject({
      status: "GENERATED",
      suggestions: {
        tools: [{ kind: "TOOL", id: "github-mcp", name: "GitHub", ready: true }],
      },
    });
  });
});
