import type {
  ExpertAgentVersionSnapshot,
  ExpertAgentRuntimeEnvelope,
} from "@tali/contracts";
import { describe, expect, it } from "vitest";
import { ExpertAgentRuntime } from "../expert-agent-runtime.js";
import { createTestRuntimeEnvelope } from "../test-runtime-envelope.js";
import type {
  ExpertAgentResourceClient,
  KnowledgeSearchInput,
  McpToolCallInput,
  ModelCompletionInput,
} from "../runtime-types.js";
import {
  currentWeekWindow,
  GitHubWeeklyCommitEngine,
} from "./github-weekly-commit-engine.js";

const snapshot: ExpertAgentVersionSnapshot = {
  schemaVersion: "agent-version/v1",
  agentId: "6bf695e2-55c9-49d3-a54d-e5818eea6318",
  product: {
    name: "GitHub Activity Summary",
    purpose: "Summarize grounded GitHub activity for a caller-selected repository and time range.",
    targetUsers: ["Engineering leads"],
    capabilities: ["Repository activity summary", "Weekly grouping", "Branch and author filters"],
    outOfScope: ["Write to GitHub"],
    inputContract: { type: "object" },
    outputContract: { type: "object" },
  },
  policy: {
    preset: "FLEXIBLE",
    groundingPolicy: "TOOL_GROUNDED",
    outputMode: "STRUCTURED",
    actionPolicy: "ALLOWLIST",
  },
  delegations: [],
  acceptance: {
    cases: [
      {
        id: "grounded-range-summary",
        title: "Summarize a requested repository range",
        kind: "HAPPY_PATH",
        given: "GitHub returns normalized commit facts",
        when: "The caller supplies repository and time filters",
        then: ["All factual references come from retrieved commit SHAs"],
        required: true,
        request: {
          text: "Summarize this activity",
          repository: "tasklattice/tasklattice-relay",
          since: "2026-08-24T00:00:00.000Z",
          until: "2026-08-30T23:59:59.999Z",
          grouping: "WEEK",
        },
        assertions: [
          { type: "STATUS", expected: "ANSWER" },
          { type: "TOOL_INVOCATION", toolName: "list_commits", minimumCalls: 1 },
          { type: "CITATIONS", required: true },
          { type: "SOURCE_COVERAGE", requiredSourceIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
          { type: "OUTPUT_SCHEMA", schema: { type: "object", required: ["outcome", "text", "citations"] } },
          { type: "SEMANTIC_QUALITY", rubric: "Covers the important retrieved changes without adding unsupported GitHub facts.", minimumScore: 0.8 },
        ],
      },
      {
        id: "invalid-model-fallback",
        title: "Invalid model references use deterministic facts",
        kind: "FAILURE_PATH",
        given: "The model cites a SHA outside retrieved facts",
        when: "Grounding validation rejects generation",
        then: ["The response retains only deterministic retrieved facts"],
        required: true,
        request: { text: "Summarize this week" },
        assertions: [{ type: "STATUS", expected: "ANSWER" }, { type: "CITATIONS", required: true }],
      },
      {
        id: "verified-empty-range",
        title: "A verified empty range reports zero activity",
        kind: "EDGE_CASE",
        given: "GitHub returns no commits for the range",
        when: "The Agent executes",
        then: ["It reports zero without inventing a commit or PR"],
        required: true,
        request: { text: "Summarize an empty range" },
        assertions: [{ type: "STATUS", expected: "ANSWER" }, { type: "CITATIONS", required: false }],
      },
    ],
    minimumRequiredPassRate: 1,
    suites: [{
      id: "github-publish-regression",
      name: "GitHub publish regression",
      description: "Required tool grounding, deterministic fallback, empty-result, and semantic coverage gates.",
      required: true,
      caseIds: ["grounded-range-summary", "invalid-model-fallback", "verified-empty-range"],
    }],
  },
  safety: {
    guardrails: [{
      id: "read-only",
      category: "TOOL_USE",
      rule: "Only call list_commits.",
      violationBehavior: "REJECT",
      required: true,
    }],
    prohibitedBehaviors: ["Invent commits"],
    noEvidenceBehavior: "UNKNOWN",
    allowGeneralModelFallback: false,
  },
  execution: {
    mode: "AGENTIC",
    engine: { framework: "TASKLATTICE_AGENTIC", version: "1.0.0" },
    modelRoutingId: "project-default",
    instruction: "Summarize normalized commit facts.",
    configuration: {
      engineType: "GITHUB_WEEKLY_COMMIT_SUMMARIZER",
      owner: "tasklattice",
      repo: "tasklattice-relay",
      branch: null,
      timeZone: "Asia/Shanghai",
      githubMcpServerId: "github-official",
      locale: "zh-CN",
    },
    maxSteps: 12,
    timeoutMs: 120_000,
  },
  resources: [{
    kind: "MCP_SERVER",
    resourceId: "github-official",
    revision: "2026-08-30",
    access: "READ",
    required: true,
  }, {
    kind: "MODEL_ROUTING",
    resourceId: "project-default",
    revision: "2026-08-30",
    access: "INVOKE",
    required: true,
  }],
};

class FakeResources implements ExpertAgentResourceClient {
  readonly calls: McpToolCallInput[] = [];
  constructor(private readonly modelResult: unknown) {}

  async callMcpTool(input: McpToolCallInput): Promise<unknown> {
    this.calls.push(input);
    return {
      content: [{
        type: "text",
        text: JSON.stringify([{
          sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          html_url: "https://github.com/tasklattice/tasklattice-relay/commit/aaaaaaaa",
          author: { login: "guohao", type: "User" },
          commit: {
            message: "feat: add immutable Agent versions\n\nDetails",
            author: { name: "Guo Hao", date: "2026-08-29T03:00:00Z" },
          },
          parents: [{ sha: "parent" }],
        }, {
          sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          html_url: "https://github.com/tasklattice/tasklattice-relay/commit/bbbbbbbb",
          author: { login: "dependabot[bot]", type: "Bot" },
          commit: {
            message: "chore: update dependency",
            author: { name: "dependabot[bot]", date: "2026-08-28T03:00:00Z" },
          },
          parents: [{ sha: "parent" }],
        }, {
          sha: "cccccccccccccccccccccccccccccccccccccccc",
          html_url: "https://github.com/tasklattice/tasklattice-relay/commit/cccccccc",
          author: { login: "guohao", type: "User" },
          commit: {
            message: "Merge pull request #42",
            author: { name: "Guo Hao", date: "2026-08-27T03:00:00Z" },
          },
          parents: [{ sha: "one" }, { sha: "two" }],
        }]),
      }],
    };
  }

  async searchKnowledge(_input: KnowledgeSearchInput) {
    return [];
  }

  async completeModel(_input: ModelCompletionInput): Promise<unknown> {
    return this.modelResult;
  }
}

class EmptyResources extends FakeResources {
  override async callMcpTool(input: McpToolCallInput): Promise<unknown> {
    this.calls.push(input);
    return { content: [{ type: "text", text: "[]" }] };
  }
}

class FailedMcpResources extends FakeResources {
  override async callMcpTool(input: McpToolCallInput): Promise<unknown> {
    this.calls.push(input);
    return {
      content: [{ type: "text", text: "GitHub list commits returned HTTP 403." }],
      isError: true,
    };
  }
}

function runtime(
  resources: ExpertAgentResourceClient,
  runtimeVersion: ExpertAgentVersionSnapshot = snapshot,
): ExpertAgentRuntime {
  const envelope: ExpertAgentRuntimeEnvelope = createTestRuntimeEnvelope(
    runtimeVersion,
    "db4d8a86-1ca2-483d-94cd-7b83e0984374",
  );
  return new ExpertAgentRuntime({
    envelope,
    resources,
    engines: [
      new GitHubWeeklyCommitEngine(() => new Date("2026-08-30T04:00:00.000Z")),
    ],
  });
}

describe("GitHubWeeklyCommitEngine", () => {
  it("calculates Monday 00:00 in the configured Project timezone", () => {
    const window = currentWeekWindow(
      new Date("2026-08-30T04:00:00.000Z"),
      "Asia/Shanghai",
    );
    expect(window.since.toISOString()).toBe("2026-08-23T16:00:00.000Z");
    expect(window.until.toISOString()).toBe("2026-08-30T04:00:00.000Z");
  });

  it("surfaces MCP tool failures instead of parsing their text as commit JSON", async () => {
    const resources = new FailedMcpResources({});

    await expect(runtime(resources).execute({
      messageId: "message-mcp-error",
      contextId: "context-mcp-error",
      text: "Summarize this week.",
      metadata: { period: "WEEK" },
    })).rejects.toThrow("GitHub list commits returned HTTP 403.");
  });

  it("uses real MCP facts for counts and validates model SHA references", async () => {
    const resources = new FakeResources({
      headline: "交付生命周期成为本周主线",
      themes: [{
        title: "Agent 交付",
        summary: "增加不可变版本对象。",
        commitShas: ["aaaaaaa"],
      }],
      risks: [{
        title: "依赖更新",
        summary: "需要确认升级后的兼容性。",
        evidenceShas: ["bbbbbbb"],
      }],
    });
    const result = await runtime(resources).execute({
      messageId: "message-1",
      contextId: "context-1",
      text: "总结本周提交",
      metadata: {},
    });

    expect(resources.calls).toHaveLength(1);
    expect(resources.calls[0]).toMatchObject({
      serverId: "github-official",
      toolName: "list_commits",
      arguments: {
        owner: "tasklattice",
        repo: "tasklattice-relay",
        since: "2026-08-23T16:00:00.000Z",
        until: "2026-08-30T04:00:00.000Z",
        page: 1,
        perPage: 100,
      },
    });
    expect(result.data).toMatchObject({
      commitCount: 3,
      mergeCount: 1,
      botCount: 1,
    });
    expect(result.text).toContain("提交总数：3；合并提交：1；Bot 提交：1");
    expect(result.text).toContain("证据：aaaaaaa");
    expect(result.citations).toHaveLength(3);
  });

  it("falls back to deterministic facts when the model invents a SHA", async () => {
    const resources = new FakeResources({
      headline: "Unsupported claim",
      themes: [{
        title: "Invented",
        summary: "Not grounded",
        commitShas: ["ddddddd"],
      }],
      risks: [],
    });
    const result = await runtime(resources).execute({
      messageId: "message-2",
      contextId: "context-2",
      text: "总结本周提交",
      metadata: {},
    });

    expect(result.outcome).toBe("COMPLETED");
    expect(result.text).not.toContain("Unsupported claim");
    expect(result.text).toContain("aaaaaaa feat: add immutable Agent versions");
    expect(result.trace).toContainEqual(expect.objectContaining({
      step: "summary.grounded_model",
      status: "FAILED",
    }));
  });

  it("treats a verified empty GitHub result as grounded without inventing citations", async () => {
    const result = await runtime(new EmptyResources({ headline: "Unused", themes: [], risks: [] })).execute({
      messageId: "message-empty",
      contextId: "context-empty",
      text: "Summarize this week.",
      metadata: {},
    });
    expect(result).toMatchObject({
      outcome: "COMPLETED",
      citations: [],
      data: { grounding: { verified: true, emptyResult: true }, commitCount: 0 },
    });
    expect(result.text).toContain("尚无提交");
  });

  it("accepts a GitHub ID and computes the current DAY window", async () => {
    const resources = new FakeResources({ headline: "Daily", themes: [], risks: [] });
    const result = await runtime(resources).execute({
      messageId: "message-daily",
      contextId: "context-daily",
      text: "Summarize today's commits for guohao.",
      metadata: { githubId: "guohao", period: "DAY" },
    });
    expect(resources.calls[0]).toMatchObject({
      arguments: {
        author: "guohao",
        since: "2026-08-29T16:00:00.000Z",
        until: "2026-08-30T04:00:00.000Z",
      },
    });
    expect(result.data).toMatchObject({ githubId: "guohao", period: "DAY", commitCount: 0 });
  });

  it("accepts an allowlisted repository, arbitrary range, branch, author, and grouping", async () => {
    if (snapshot.execution.mode !== "AGENTIC") throw new Error("Expected Agentic fixture.");
    const configurableVersion: ExpertAgentVersionSnapshot = {
      ...snapshot,
      execution: {
        ...snapshot.execution,
        configuration: {
          ...snapshot.execution.configuration,
          allowedRepositories: ["tasklattice/another-repo"],
        },
      },
    };
    const resources = new FakeResources({ headline: "Range", themes: [], risks: [] });
    const result = await runtime(resources, configurableVersion).execute({
      messageId: "message-range",
      contextId: "context-range",
      text: "Summarize the selected activity.",
      metadata: {
        github: {
          repository: "tasklattice/another-repo",
          since: "2026-08-27T00:00:00.000Z",
          until: "2026-08-30T00:00:00.000Z",
          branch: "release/1.x",
          author: "guohao",
          grouping: "AUTHOR",
        },
      },
    });
    expect(resources.calls[0]).toMatchObject({
      arguments: {
        owner: "tasklattice",
        repo: "another-repo",
        sha: "release/1.x",
        since: "2026-08-27T00:00:00.000Z",
        until: "2026-08-30T00:00:00.000Z",
      },
    });
    expect(result.data).toMatchObject({
      repository: "tasklattice/another-repo",
      branch: "release/1.x",
      author: "guohao",
      grouping: "AUTHOR",
      commitCount: 2,
    });
    expect(result.text).toContain("### guohao");
    expect(result.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: expect.stringMatching(/^a+$/), revision: expect.stringMatching(/^a+$/) }),
    ]));
  });
});
