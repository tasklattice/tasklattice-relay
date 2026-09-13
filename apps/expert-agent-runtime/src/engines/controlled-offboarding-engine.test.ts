import type {
  AnswerDocument,
  AnswerPatch,
  ExpertAgentVersionSnapshot,
  ExpertAgentRuntimeEnvelope,
} from "@tali/contracts";
import { describe, expect, it } from "vitest";
import { applyAnswerPatch } from "../answer-document.js";
import { ExpertAgentRuntime } from "../expert-agent-runtime.js";
import { createTestRuntimeEnvelope } from "../test-runtime-envelope.js";
import type {
  ExpertAgentResourceClient,
  KnowledgeSearchInput,
  KnowledgeSearchItem,
  McpToolCallInput,
  ModelCompletionInput,
} from "../runtime-types.js";
import { ControlledOffboardingEngine } from "./controlled-offboarding-engine.js";

const snapshot: ExpertAgentVersionSnapshot = {
  schemaVersion: "agent-version/v1",
  agentId: "controlled-offboarding-expert",
  product: {
    name: "Employee Offboarding Knowledge Expert",
    purpose: "Return grounded offboarding guidance and semantic partial updates.",
    targetUsers: ["Employees", "HR"],
    capabilities: ["Answer offboarding questions", "Patch departure dates"],
    outOfScope: ["Invent HR policy"],
    inputContract: { type: "object", required: ["text"] },
    outputContract: { type: "object", required: ["outcome", "text", "citations", "answer"] },
  },
  policy: {
    preset: "CONTROLLED",
    groundingPolicy: "REQUIRED",
    outputMode: "PATCHABLE",
    actionPolicy: "ALLOWLIST",
  },
  delegations: [],
  acceptance: {
    minimumRequiredPassRate: 1,
    cases: [
      {
        id: "known-policy",
        title: "Known offboarding policy",
        kind: "HAPPY_PATH",
        given: "Approved HR Knowledge covers the answer blocks",
        when: "An employee asks about offboarding",
        then: ["Answer with authoritative citations"],
        required: true,
        request: { text: "What is my offboarding plan? My departure date is October 8, 2026." },
        assertions: [
          { type: "STATUS", expected: "ANSWER" },
          { type: "CITATIONS", required: true },
          { type: "EXECUTION_PATH", requiredNodeIds: ["retrieve", "evidence-gate", "verify"], forbiddenNodeIds: [] },
        ],
      },
      {
        id: "unknown-policy",
        title: "Unknown policy abstains",
        kind: "FAILURE_PATH",
        given: "The question is outside approved Knowledge",
        when: "No relevant evidence is retrieved",
        then: ["Abstain without invented policy"],
        required: true,
        request: { text: "Does the company pay for an unapproved personal trip?" },
        assertions: [{ type: "STATUS", expected: "ABSTAIN" }, { type: "CITATIONS", required: false }],
      },
      {
        id: "missing-evidence",
        title: "Missing evidence abstains",
        kind: "FAILURE_PATH",
        given: "Required answer blocks have no approved evidence",
        when: "The evidence gate evaluates coverage",
        then: ["Abstain or escalate without fabrication"],
        required: true,
        request: { text: "What happens to benefits and handover?" },
        assertions: [{ type: "STATUS", expected: "ABSTAIN" }, { type: "CITATIONS", required: false }],
      },
      {
        id: "conflicting-evidence",
        title: "Conflicting evidence escalates",
        kind: "FAILURE_PATH",
        given: "Two approved revisions conflict",
        when: "The evidence gate compares them",
        then: ["Escalate rather than choose a policy"],
        required: true,
        request: { text: "What happens to my benefits?" },
        assertions: [{ type: "STATUS", expected: "ESCALATE" }, { type: "CITATIONS", required: false }],
      },
      {
        id: "partial-date-update",
        title: "Departure date uses a semantic patch",
        kind: "EDGE_CASE",
        given: "A four-block AnswerDocument already exists",
        when: "The user corrects the departure date",
        then: ["Only departureDate and benefits are replaced"],
        required: true,
        request: { text: "My departure date is October 12, 2026.", metadata: { answerDocument: "SUPPLIED_BY_FIXTURE" } },
        assertions: [
          { type: "STATUS", expected: "ANSWER" },
          { type: "BLOCK_STABILITY", changedBlockIds: ["departureDate", "benefits"], unchangedBlockIds: ["summary", "handover"] },
          { type: "EXECUTION_PATH", requiredNodeIds: ["understand", "patch", "verify"], forbiddenNodeIds: ["retrieve"] },
        ],
      },
      {
        id: "ambiguous-date",
        title: "A missing year requires clarification",
        kind: "EDGE_CASE",
        given: "No year exists in the request or structured state",
        when: "The user supplies October 12",
        then: ["Clarify instead of guessing"],
        required: true,
        request: { text: "My departure date is October 12." },
        assertions: [{ type: "STATUS", expected: "CLARIFY" }, { type: "EXECUTION_PATH", requiredNodeIds: ["clarify", "verify"], forbiddenNodeIds: ["retrieve"] }],
      },
      {
        id: "knowledge-over-memory",
        title: "Authoritative Knowledge wins over Memory",
        kind: "EDGE_CASE",
        given: "Memory contains an older contradictory policy",
        when: "The current approved Knowledge is retrieved",
        then: ["Answer from and cite Knowledge only"],
        required: true,
        request: { text: "What is the handover policy?", metadata: { memory: "Old memory says employees keep all equipment." } },
        assertions: [{ type: "STATUS", expected: "ANSWER" }, { type: "CITATIONS", required: true }],
      },
    ],
    suites: [{
      id: "controlled-publish-regression",
      name: "Controlled publish regression",
      description: "Required grounding, abstention, escalation, patch stability, ambiguity, and Knowledge authority gates.",
      required: true,
      caseIds: [
        "known-policy",
        "unknown-policy",
        "missing-evidence",
        "conflicting-evidence",
        "partial-date-update",
        "ambiguous-date",
        "knowledge-over-memory",
      ],
    }],
  },
  safety: {
    guardrails: [{
      id: "knowledge-only",
      category: "GROUNDING",
      rule: "Release business claims only with approved HR Knowledge.",
      violationBehavior: "UNKNOWN",
      required: true,
    }],
    prohibitedBehaviors: ["Guess a date year", "Use Memory as policy"],
    noEvidenceBehavior: "UNKNOWN",
    allowGeneralModelFallback: false,
  },
  execution: {
    mode: "WORKFLOW",
    engine: { framework: "tasklattice-playbook", version: "1.0.0" },
    entrypoint: "understand",
    configuration: {
      engineType: "CONTROLLED_OFFBOARDING_KNOWLEDGE",
      vectorDatabaseId: "approved-hr-knowledge",
      minimumScore: 0.85,
      unknownMessage: "I cannot verify that from approved HR knowledge.",
      clarifyYearMessage: "Which year should I use for October 12?",
      escalationMessage: "Approved HR sources conflict; please ask HR to resolve them.",
    },
    nodes: [
      { id: "understand", type: "TRANSFORM", configuration: {} },
      { id: "retrieve", type: "KNOWLEDGE", configuration: {} },
      { id: "evidence-gate", type: "DECISION", configuration: {} },
      { id: "answer", type: "RESPONSE", configuration: { responseType: "DOCUMENT" } },
      { id: "patch", type: "RESPONSE", configuration: { responseType: "PATCH" } },
      { id: "clarify", type: "RESPONSE", configuration: { responseType: "CLARIFY" } },
      { id: "abstain", type: "RESPONSE", configuration: { responseType: "ABSTAIN" } },
      { id: "escalate", type: "RESPONSE", configuration: { responseType: "ESCALATE" } },
      { id: "verify", type: "VERIFY", configuration: {} },
      { id: "end-answer", type: "END", configuration: { outcome: "COMPLETED" } },
      { id: "end-clarify", type: "END", configuration: { outcome: "NEED_MORE_INFORMATION" } },
      { id: "end-abstain", type: "END", configuration: { outcome: "UNKNOWN" } },
      { id: "end-escalate", type: "END", configuration: { outcome: "ESCALATED" } },
    ],
    transitions: [
      { from: "understand", outcome: "QUERY_READY", to: "retrieve" },
      { from: "understand", outcome: "STATE_PATCH_READY", to: "patch" },
      { from: "understand", outcome: "DATE_AMBIGUOUS", to: "clarify" },
      { from: "retrieve", outcome: "EVIDENCE_FOUND", to: "evidence-gate" },
      { from: "retrieve", outcome: "NO_EVIDENCE", to: "abstain" },
      { from: "evidence-gate", outcome: "APPROVED", to: "answer" },
      { from: "evidence-gate", outcome: "INSUFFICIENT", to: "abstain" },
      { from: "evidence-gate", outcome: "CONFLICT", to: "escalate" },
      { from: "answer", outcome: "RESPONSE_READY", to: "verify" },
      { from: "patch", outcome: "RESPONSE_READY", to: "verify" },
      { from: "clarify", outcome: "RESPONSE_READY", to: "verify" },
      { from: "abstain", outcome: "RESPONSE_READY", to: "verify" },
      { from: "escalate", outcome: "RESPONSE_READY", to: "verify" },
      { from: "verify", outcome: "VERIFIED_ANSWER", to: "end-answer" },
      { from: "verify", outcome: "VERIFIED_CLARIFY", to: "end-clarify" },
      { from: "verify", outcome: "VERIFIED_ABSTAIN", to: "end-abstain" },
      { from: "verify", outcome: "VERIFIED_ESCALATE", to: "end-escalate" },
      { from: "verify", outcome: "INVALID", to: "end-abstain" },
    ],
    timeoutMs: 30_000,
  },
  resources: [{
    kind: "KNOWLEDGE_VECTOR_DATABASE",
    resourceId: "approved-hr-knowledge",
    revision: "2026-08-30",
    access: "READ",
    required: true,
  }],
};

function knowledge(blockId: "summary" | "benefits" | "handover", text: string, id = `hr-${blockId}-v3`): KnowledgeSearchItem {
  return {
    id,
    title: `${blockId} policy`,
    text,
    uri: `https://hr.example/policy/${blockId}`,
    score: 0.97,
    metadata: { approved: true, revision: "3", answerBlockId: blockId },
  };
}

const approvedKnowledge = [
  knowledge("summary", "Your offboarding plan follows approved HR policy version 3."),
  knowledge("benefits", "Benefits coverage follows the approved departure-date policy."),
  knowledge("handover", "Return assigned equipment through the documented handover process."),
];

class Resources implements ExpertAgentResourceClient {
  constructor(readonly evidence: KnowledgeSearchItem[]) {}
  async callMcpTool(_input: McpToolCallInput): Promise<unknown> { throw new Error("Tools are not allowed."); }
  async searchKnowledge(_input: KnowledgeSearchInput): Promise<KnowledgeSearchItem[]> { return this.evidence; }
  async completeModel(_input: ModelCompletionInput): Promise<unknown> { throw new Error("Models are not allowed."); }
}

function runtime(evidence = approvedKnowledge): ExpertAgentRuntime {
  const envelope: ExpertAgentRuntimeEnvelope = createTestRuntimeEnvelope(
    snapshot,
    "offboarding-version",
  );
  return new ExpertAgentRuntime({
    envelope,
    resources: new Resources(evidence),
    engines: [new ControlledOffboardingEngine()],
  });
}

describe("ControlledOffboardingEngine", () => {
  it("returns four stable grounded blocks for a known policy question", async () => {
    const result = await runtime().execute({
      messageId: "message-1",
      contextId: "offboarding-context",
      text: "What is my offboarding plan? My departure date is October 8, 2026.",
      metadata: {},
    });
    expect(result.outcome).toBe("COMPLETED");
    expect(result.citations).toHaveLength(3);
    expect(result.answer).toMatchObject({
      kind: "ANSWER_DOCUMENT",
      status: "ANSWER",
      state: { "employment.departureDate": "2026-10-08" },
      blocks: [
        { id: "summary" },
        { id: "departureDate" },
        { id: "benefits" },
        { id: "handover" },
      ],
    });
  });

  it("applies a semantic date patch while preserving unrelated block revisions and hashes", async () => {
    const initial = await runtime().execute({
      messageId: "message-1",
      contextId: "offboarding-context",
      text: "My departure date is October 8, 2026.",
      metadata: {},
    });
    const document = initial.answer as AnswerDocument;
    const update = await runtime().execute({
      messageId: "message-2",
      contextId: "offboarding-context",
      text: "My departure date is October 12, 2026.",
      metadata: { answerDocument: document },
    });
    expect(update.answer).toMatchObject({ kind: "ANSWER_PATCH", documentId: document.id });
    const next = applyAnswerPatch(document, update.answer as AnswerPatch);
    expect(next.state["employment.departureDate"]).toBe("2026-10-12");
    expect(next.stateProvenance["employment.departureDate"]).toEqual([
      expect.objectContaining({ kind: "USER_INPUT", authoritative: false }),
    ]);
    for (const id of ["summary", "handover"]) {
      expect(next.blocks.find((block) => block.id === id)).toEqual(
        document.blocks.find((block) => block.id === id),
      );
    }
    expect(next.blocks.find((block) => block.id === "departureDate")?.revision).toBe(1);
    expect(next.blocks.find((block) => block.id === "benefits")?.revision).toBe(1);
  });

  it("asks for clarification instead of inventing a missing year", async () => {
    const result = await runtime().execute({
      messageId: "message-ambiguous",
      contextId: "new-context",
      text: "My departure date is October 12.",
      metadata: {},
    });
    expect(result.outcome).toBe("NEED_MORE_INFORMATION");
    expect(result.text).toContain("Which year");
    expect(result.answer).toMatchObject({ kind: "ANSWER_DOCUMENT", status: "CLARIFY" });
  });

  it("abstains when an unknown policy has no relevant approved Knowledge", async () => {
    const result = await runtime([]).execute({
      messageId: "message-unknown",
      contextId: "context-unknown",
      text: "Does the company pay for an unapproved personal trip?",
      metadata: {},
    });
    expect(result).toMatchObject({ outcome: "UNKNOWN", citations: [], answer: { status: "ABSTAIN" } });
  });

  it("abstains when required business evidence is missing", async () => {
    const result = await runtime([]).execute({
      messageId: "message-missing",
      contextId: "context-missing",
      text: "What happens to my benefits?",
      metadata: {},
    });
    expect(result).toMatchObject({ outcome: "UNKNOWN", citations: [], answer: { status: "ABSTAIN" } });
  });

  it("escalates instead of resolving conflicting approved Knowledge", async () => {
    const result = await runtime([
      ...approvedKnowledge,
      knowledge("benefits", "An older contradictory benefits rule.", "hr-benefits-conflict"),
    ]).execute({
      messageId: "message-conflict",
      contextId: "context-conflict",
      text: "What happens to my benefits?",
      metadata: {},
    });
    expect(result).toMatchObject({ outcome: "ESCALATED", citations: [], answer: { status: "ESCALATE" } });
  });

  it("uses current authoritative Knowledge instead of Memory context", async () => {
    const result = await runtime().execute({
      messageId: "message-memory",
      contextId: "context-memory",
      text: "What is the handover policy?",
      metadata: { memory: "Old memory says employees keep all equipment." },
    });
    expect(result.text).not.toContain("keep all equipment");
    expect(result.answer).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({
          id: "handover",
          value: "Return assigned equipment through the documented handover process.",
          provenance: [expect.objectContaining({ kind: "AUTHORITATIVE_KNOWLEDGE" })],
        }),
      ]),
    });
  });
});
