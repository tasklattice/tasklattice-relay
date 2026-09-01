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
  KnowledgeSearchItem,
  McpToolCallInput,
  ModelCompletionInput,
} from "../runtime-types.js";
import { DeterministicCustomerSupportEngine } from "./deterministic-customer-support-engine.js";

const nodes: Extract<
  ExpertAgentVersionSnapshot["execution"],
  { mode: "WORKFLOW" }
>["nodes"] = [{
  id: "normalize",
  type: "NORMALIZE_INPUT",
  configuration: {},
}, {
  id: "classify",
  type: "CLASSIFY_INTENT",
  configuration: {
    intents: [{
      id: "reset-password",
      label: "重置密码",
      keywords: ["重置密码", "忘记密码", "password reset"],
    }, {
      id: "agent-version",
      label: "Agent 版本",
      keywords: ["agent版本", "版本回滚"],
    }],
  },
}, {
  id: "retrieve",
  type: "RETRIEVE_EVIDENCE",
  configuration: { vectorDatabaseId: "relay-support-kb", limit: 5 },
}, {
  id: "decide",
  type: "DECISION",
  configuration: {
    minimumScore: 0.85,
    minimumScoreDelta: 0.05,
    noEvidenceOutcome: "UNKNOWN",
  },
}, {
  id: "render",
  type: "RENDER_TEMPLATE",
  configuration: {},
}, {
  id: "verify-claims",
  type: "VERIFY",
  configuration: { check: "CLAIMS" },
}, {
  id: "verify-citations",
  type: "VERIFY",
  configuration: { check: "CITATIONS" },
}, {
  id: "escalate",
  type: "ESCALATE",
  configuration: {},
}, {
  id: "end-answered",
  type: "END",
  configuration: { outcome: "COMPLETED" },
}, {
  id: "end-more-information",
  type: "END",
  configuration: { outcome: "NEED_MORE_INFORMATION" },
}, {
  id: "end-unknown",
  type: "END",
  configuration: { outcome: "UNKNOWN" },
}, {
  id: "end-escalated",
  type: "END",
  configuration: { outcome: "ESCALATED" },
}];

const transitions: Extract<
  ExpertAgentVersionSnapshot["execution"],
  { mode: "WORKFLOW" }
>["transitions"] = [
  { from: "normalize", outcome: "NORMALIZED", to: "classify" },
  { from: "normalize", outcome: "EMPTY", to: "end-more-information" },
  { from: "classify", outcome: "CLASSIFIED", to: "retrieve" },
  { from: "classify", outcome: "UNCLASSIFIED", to: "end-more-information" },
  { from: "classify", outcome: "AMBIGUOUS", to: "end-more-information" },
  { from: "retrieve", outcome: "EVIDENCE_FOUND", to: "decide" },
  { from: "retrieve", outcome: "NO_EVIDENCE", to: "decide" },
  { from: "retrieve", outcome: "NO_INTENT", to: "end-more-information" },
  { from: "decide", outcome: "ANSWER", to: "render" },
  { from: "decide", outcome: "UNKNOWN", to: "end-unknown" },
  { from: "decide", outcome: "ESCALATE", to: "escalate" },
  { from: "render", outcome: "ANSWERED", to: "verify-claims" },
  { from: "verify-claims", outcome: "VERIFIED", to: "verify-citations" },
  { from: "verify-claims", outcome: "UNSUPPORTED", to: "end-unknown" },
  { from: "verify-citations", outcome: "CITATIONS_VALID", to: "end-answered" },
  { from: "verify-citations", outcome: "MISSING_CITATION", to: "end-unknown" },
  { from: "escalate", outcome: "ESCALATED", to: "end-escalated" },
];

const snapshot: ExpertAgentVersionSnapshot = {
  schemaVersion: "agent-version/v1",
  agentId: "9706b6fd-3fdf-435f-9920-a61881b08779",
  product: {
    name: "TaskLattice 客服机器人",
    purpose: "只使用批准知识回答 TaskLattice Relay 产品问题。",
    targetUsers: ["TaskLattice 用户"],
    capabilities: ["回答产品支持问题"],
    outOfScope: ["一般知识问答", "猜测产品行为"],
    inputContract: { type: "object" },
    outputContract: { type: "object" },
  },
  policy: {
    preset: "CONTROLLED",
    groundingPolicy: "REQUIRED",
    outputMode: "STRUCTURED",
    actionPolicy: "APPROVAL",
  },
  delegations: [],
  acceptance: {
    cases: [{
      id: "approved-answer-only",
      title: "Only approved answers",
      kind: "HAPPY_PATH",
      given: "Approved evidence exists",
      when: "A known question is asked",
      then: ["Output exactly matches approved evidence"],
      required: true,
    }],
    minimumRequiredPassRate: 1,
  },
  safety: {
    guardrails: [{
      id: "approved-evidence",
      category: "GROUNDING",
      rule: "Only render approved canonical evidence.",
      violationBehavior: "UNKNOWN",
      required: true,
    }],
    prohibitedBehaviors: ["Generate unsupported product facts"],
    noEvidenceBehavior: "UNKNOWN",
    allowGeneralModelFallback: false,
  },
  execution: {
    mode: "WORKFLOW",
    engine: { framework: "langgraph", version: "1.4.13" },
    entrypoint: "normalize",
    configuration: {
      engineType: "DETERMINISTIC_CUSTOMER_SUPPORT",
      unknownMessage: "我目前没有足够的已批准资料回答这个问题。请补充问题细节或联系支持人员。",
      escalationMessage: "现有资料存在冲突，我已将问题转交人工支持，暂不提供可能错误的答案。",
    },
    nodes,
    transitions,
    timeoutMs: 30_000,
  },
  resources: [{
    kind: "KNOWLEDGE_VECTOR_DATABASE",
    resourceId: "relay-support-kb",
    revision: "2026-08-30",
    access: "READ",
    required: true,
  }],
};

class FakeResources implements ExpertAgentResourceClient {
  readonly searches: KnowledgeSearchInput[] = [];
  constructor(private readonly evidence: KnowledgeSearchItem[]) {}

  async callMcpTool(_input: McpToolCallInput): Promise<unknown> {
    throw new Error("MCP is forbidden for this Workflow.");
  }

  async searchKnowledge(input: KnowledgeSearchInput): Promise<KnowledgeSearchItem[]> {
    this.searches.push(input);
    return this.evidence;
  }

  async completeModel(_input: ModelCompletionInput): Promise<unknown> {
    throw new Error("Model generation is forbidden for this Workflow.");
  }
}

function runtime(resources: FakeResources): ExpertAgentRuntime {
  const envelope: ExpertAgentRuntimeEnvelope = createTestRuntimeEnvelope(
    snapshot,
    "9ad95354-03cc-4553-93e2-018a435f2825",
  );
  return new ExpertAgentRuntime({
    envelope,
    resources,
    engines: [new DeterministicCustomerSupportEngine()],
  });
}

function evidence(input: Partial<KnowledgeSearchItem> = {}): KnowledgeSearchItem {
  return {
    id: "kb-password-reset-v3",
    title: "密码重置操作规范",
    text: "请在登录页选择“忘记密码”，通过已验证邮箱完成重置。平台支持人员不会索取您的现有密码。",
    uri: "https://docs.tasklattice.ai/account/reset-password",
    score: 0.96,
    metadata: {
      approved: true,
      intentId: "reset-password",
      revision: "3",
    },
    ...input,
  };
}

describe("DeterministicCustomerSupportEngine", () => {
  it("accepts only the exact LangGraph engine contract", () => {
    const engine = new DeterministicCustomerSupportEngine();
    expect(engine.supports(snapshot)).toBe(true);
    expect(engine.supports({
      ...snapshot,
      execution: {
        ...snapshot.execution,
        engine: { framework: "tasklattice-flow", version: "release-0" },
      },
    })).toBe(false);
    expect(engine.supports({
      ...snapshot,
      execution: {
        ...snapshot.execution,
        engine: { framework: "langgraph", version: "9.0.0" },
      },
    })).toBe(false);
    expect(engine.supports({
      ...snapshot,
      execution: {
        ...snapshot.execution,
        engine: { framework: "google-adk", version: "1.0.0" },
      },
    })).toBe(false);
  });

  it("renders the approved canonical answer exactly and includes its citation", async () => {
    const approved = evidence();
    const resources = new FakeResources([approved]);
    const result = await runtime(resources).execute({
      messageId: "message-1",
      contextId: "context-1",
      text: "我忘记密码了，应该怎么重置密码？",
      metadata: {},
    });

    expect(result.outcome).toBe("COMPLETED");
    expect(result.text).toBe(approved.text);
    expect(result.citations).toEqual([expect.objectContaining({
      sourceId: approved.id,
      uri: approved.uri,
      revision: "3",
    })]);
    expect(result.answer).toMatchObject({
      kind: "ANSWER_DOCUMENT",
      status: "ANSWER",
      blocks: [expect.objectContaining({
        id: "response",
        provenance: [expect.objectContaining({
          kind: "AUTHORITATIVE_KNOWLEDGE",
          authoritative: true,
        })],
      })],
    });
    expect(resources.searches[0]).toMatchObject({
      vectorDatabaseId: "relay-support-kb",
      limit: 5,
    });
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: "verify-claims", status: "COMPLETED", attributes: expect.objectContaining({ framework: "langgraph", frameworkVersion: "1.4.13", outcome: "VERIFIED" }) }),
      expect.objectContaining({ step: "verify-citations", status: "COMPLETED", attributes: expect.objectContaining({ framework: "langgraph", frameworkVersion: "1.4.13", outcome: "CITATIONS_VALID" }) }),
    ]));
  });

  it("ignores unapproved or low-confidence text and returns UNKNOWN", async () => {
    const resources = new FakeResources([
      evidence({ metadata: { approved: false, intentId: "reset-password", revision: "4" } }),
      evidence({ id: "low-score", score: 0.5 }),
    ]);
    const result = await runtime(resources).execute({
      messageId: "message-2",
      contextId: "context-2",
      text: "如何重置密码？",
      metadata: {},
    });

    expect(result.outcome).toBe("UNKNOWN");
    expect(result.text).toContain("没有足够的已批准资料");
    expect(result.citations).toEqual([]);
  });

  it("escalates instead of choosing between conflicting approved answers", async () => {
    const resources = new FakeResources([
      evidence({ id: "answer-a", score: 0.94 }),
      evidence({
        id: "answer-b",
        score: 0.92,
        text: "请直接联系管理员重置密码。",
      }),
    ]);
    const result = await runtime(resources).execute({
      messageId: "message-3",
      contextId: "context-3",
      text: "忘记密码怎么办？",
      metadata: {},
    });

    expect(result.outcome).toBe("ESCALATED");
    expect(result.text).toContain("资料存在冲突");
    expect(result.citations).toEqual([]);
  });

  it("asks for more information when no configured intent matches", async () => {
    const resources = new FakeResources([]);
    const result = await runtime(resources).execute({
      messageId: "message-4",
      contextId: "context-4",
      text: "今天天气怎么样？",
      metadata: {},
    });

    expect(result.outcome).toBe("NEED_MORE_INFORMATION");
    expect(resources.searches).toHaveLength(0);
  });
});
