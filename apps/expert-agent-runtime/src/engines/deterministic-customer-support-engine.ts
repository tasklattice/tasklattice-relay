import type {
  AnswerDocument,
  AnswerProvenance,
  ExpertAgentVersionSnapshot,
} from "@tali/contracts";
import { z } from "zod";
import { createAnswerBlock } from "../answer-document.js";
import {
  LANGGRAPH_FRAMEWORK,
  LANGGRAPH_VERSION,
  LangGraphPlaybookRuntime,
} from "../langgraph-playbook-runtime.js";
import type { PlaybookOperator } from "../playbook-contract.js";
import type {
  ExpertAgentCitation,
  ExpertAgentEngine,
  ExpertAgentExecutionOutcome,
  ExpertAgentExecutionResult,
  KnowledgeSearchItem,
} from "../runtime-types.js";

const workflowConfigurationSchema = z.object({
  engineType: z.literal("DETERMINISTIC_CUSTOMER_SUPPORT"),
  unknownMessage: z.string().trim().min(1).max(2_000),
  escalationMessage: z.string().trim().min(1).max(2_000),
  developmentStatus: z.enum(["DESIGN", "IMPLEMENTED"]).optional(),
  requiredProjectResources: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
}).strict();

const classifyConfigurationSchema = z.object({
  intents: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    label: z.string().trim().min(1).max(120),
    keywords: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  }).strict()).min(1).max(200),
}).strict();

const retrieveConfigurationSchema = z.object({
  vectorDatabaseId: z.string().trim().min(1).max(240),
  limit: z.number().int().min(1).max(20).default(5),
}).strict();

const decisionConfigurationSchema = z.object({
  minimumScore: z.number().min(0).max(1).default(0.85),
  minimumScoreDelta: z.number().min(0).max(1).default(0.05),
  noEvidenceOutcome: z.enum(["UNKNOWN", "ESCALATED"]).default("UNKNOWN"),
}).strict();

const verifyConfigurationSchema = z.object({
  check: z.enum(["EVIDENCE_GATE", "CLAIMS", "CITATIONS"]).default("EVIDENCE_GATE"),
}).strict();

const endConfigurationSchema = z.object({
  outcome: z.enum([
    "COMPLETED",
    "NEED_MORE_INFORMATION",
    "UNKNOWN",
    "ESCALATED",
    "REJECTED",
  ]),
}).strict();

interface WorkflowState {
  normalizedText: string;
  intent: { id: string; label: string } | null;
  evidence: KnowledgeSearchItem[];
  approvedEvidence: KnowledgeSearchItem[];
  text: string;
  outcome: ExpertAgentExecutionOutcome;
  citations: ExpertAgentCitation[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function approvedEvidence(
  evidence: KnowledgeSearchItem[],
  intentId: string,
  minimumScore: number,
): KnowledgeSearchItem[] {
  return evidence.filter((item) =>
    item.score >= minimumScore
    && item.metadata.approved === true
    && item.metadata.intentId === intentId
    && typeof item.metadata.revision === "string"
    && item.metadata.revision.length > 0
    && item.text.trim().length > 0
  ).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export class DeterministicCustomerSupportEngine implements ExpertAgentEngine {
  readonly mode = "WORKFLOW" as const;

  supports(snapshot: ExpertAgentVersionSnapshot): boolean {
    const framework = snapshot.execution.engine.framework.trim().toLowerCase();
    return snapshot.execution.mode === "WORKFLOW"
      && framework === LANGGRAPH_FRAMEWORK
      && snapshot.execution.engine.version === LANGGRAPH_VERSION
      && snapshot.execution.configuration.engineType
        === "DETERMINISTIC_CUSTOMER_SUPPORT";
  }

  async execute(input: Parameters<ExpertAgentEngine["execute"]>[0]): Promise<ExpertAgentExecutionResult> {
    if (input.envelope.snapshot.execution.mode !== "WORKFLOW") {
      throw new Error("Customer Support Engine requires WORKFLOW execution.");
    }
    const execution = input.envelope.snapshot.execution;
    const configuration = workflowConfigurationSchema.parse(execution.configuration);
    const initialState: WorkflowState = {
      normalizedText: "",
      intent: null,
      evidence: [],
      approvedEvidence: [],
      text: configuration.unknownMessage,
      outcome: "UNKNOWN",
      citations: [],
    };

    const normalizeInput: PlaybookOperator<WorkflowState> = async ({ state }) => {
      state.normalizedText = normalize(input.request.text);
      if (!state.normalizedText) {
        state.outcome = "NEED_MORE_INFORMATION";
        state.text = configuration.unknownMessage;
        return { outcome: "EMPTY", state };
      }
      return { outcome: "NORMALIZED", state };
    };
    const classifyIntent: PlaybookOperator<WorkflowState> = async ({ node, state }) => {
      const classifier = classifyConfigurationSchema.parse(node.configuration);
      const scored = classifier.intents.map((intent) => ({
        intent,
        score: intent.keywords.reduce(
          (score, keyword) => score + (state.normalizedText.includes(normalize(keyword)) ? 1 : 0),
          0,
        ),
      })).filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.intent.id.localeCompare(right.intent.id));
      if (!scored.length) {
        state.outcome = "NEED_MORE_INFORMATION";
        state.text = configuration.unknownMessage;
        return { outcome: "UNCLASSIFIED", state };
      }
      if (scored[1]?.score === scored[0]!.score) {
        state.outcome = "NEED_MORE_INFORMATION";
        state.text = configuration.unknownMessage;
        return { outcome: "AMBIGUOUS", state };
      }
      state.intent = { id: scored[0]!.intent.id, label: scored[0]!.intent.label };
      return { outcome: "CLASSIFIED", state };
    };
    const retrieveEvidence: PlaybookOperator<WorkflowState> = async ({ node, state }) => {
      if (!state.intent) return { outcome: "NO_INTENT", state };
      const retrieval = retrieveConfigurationSchema.parse(node.configuration);
      state.evidence = await input.resources.searchKnowledge({
        vectorDatabaseId: retrieval.vectorDatabaseId,
        query: `${state.intent.label} ${state.normalizedText}`,
        limit: retrieval.limit,
      });
      return {
        outcome: state.evidence.length ? "EVIDENCE_FOUND" : "NO_EVIDENCE",
        state,
        attributes: { evidenceCount: state.evidence.length },
      };
    };
    const decideEvidence: PlaybookOperator<WorkflowState> = async ({ node, state }) => {
      const decision = decisionConfigurationSchema.parse(node.configuration);
      if (!state.intent) {
        state.outcome = "NEED_MORE_INFORMATION";
        state.text = configuration.unknownMessage;
        return { outcome: "UNKNOWN", state };
      }
      state.approvedEvidence = approvedEvidence(state.evidence, state.intent.id, decision.minimumScore);
      if (!state.approvedEvidence.length) {
        state.outcome = decision.noEvidenceOutcome;
        state.text = decision.noEvidenceOutcome === "ESCALATED"
          ? configuration.escalationMessage
          : configuration.unknownMessage;
        return { outcome: decision.noEvidenceOutcome === "ESCALATED" ? "ESCALATE" : "UNKNOWN", state };
      }
      const first = state.approvedEvidence[0]!;
      const second = state.approvedEvidence[1];
      if (second && first.text.trim() !== second.text.trim() && first.score - second.score < decision.minimumScoreDelta) {
        state.outcome = "ESCALATED";
        state.text = configuration.escalationMessage;
        return { outcome: "ESCALATE", state };
      }
      state.outcome = "COMPLETED";
      return {
        outcome: "ANSWER",
        state,
        attributes: { approvedEvidenceCount: state.approvedEvidence.length },
      };
    };
    const renderResponse: PlaybookOperator<WorkflowState> = async ({ state }) => {
      const evidence = state.approvedEvidence[0];
      if (!evidence) throw new Error("Response node requires approved evidence.");
      state.text = evidence.text.trim();
      state.citations = [{
        sourceId: evidence.id,
        title: evidence.title,
        uri: evidence.uri,
        excerpt: evidence.text.trim().slice(0, 500),
        revision: String(evidence.metadata.revision),
      }];
      state.outcome = "COMPLETED";
      return { outcome: "ANSWERED", state, attributes: { citationCount: state.citations.length } };
    };
    const escalate: PlaybookOperator<WorkflowState> = async ({ state }) => {
      state.outcome = "ESCALATED";
      state.text = configuration.escalationMessage;
      return { outcome: "ESCALATED", state };
    };
    const verify: PlaybookOperator<WorkflowState> = async (operatorInput) => {
      const verification = verifyConfigurationSchema.parse(operatorInput.node.configuration);
      if (verification.check === "EVIDENCE_GATE") return decideEvidence(operatorInput);
      const { state } = operatorInput;
      if (verification.check === "CLAIMS") {
        const supported = state.approvedEvidence.some((evidence) =>
          evidence.text.trim() === state.text.trim()
        );
        if (supported) return { outcome: "VERIFIED", state };
        state.outcome = "UNKNOWN";
        state.text = configuration.unknownMessage;
        state.citations = [];
        return { outcome: "UNSUPPORTED", state };
      }
      const evidenceById = new Map(state.approvedEvidence.map((evidence) => [evidence.id, evidence]));
      const valid = state.citations.length > 0 && state.citations.every((citation) => {
        const evidence = evidenceById.get(citation.sourceId);
        return Boolean(
          evidence
          && citation.revision
            === (typeof evidence.metadata.revision === "string" ? evidence.metadata.revision : null),
        );
      });
      if (valid) return { outcome: "CITATIONS_VALID", state };
      state.outcome = "UNKNOWN";
      state.text = configuration.unknownMessage;
      state.citations = [];
      return { outcome: "MISSING_CITATION", state };
    };
    const operators = {
      NORMALIZE_INPUT: normalizeInput,
      TRANSFORM: normalizeInput,
      CLASSIFY_INTENT: classifyIntent,
      REASON: classifyIntent,
      RETRIEVE_EVIDENCE: retrieveEvidence,
      KNOWLEDGE: retrieveEvidence,
      DECISION: decideEvidence,
      VERIFY: verify,
      RENDER_TEMPLATE: renderResponse,
      RESPONSE: renderResponse,
      ESCALATE: escalate,
    };
    const runtime = new LangGraphPlaybookRuntime<WorkflowState>(operators);
    const result = await runtime.execute({ execution, initialState });
    const terminal = execution.nodes.find((node) => node.id === result.terminalNodeId);
    if (!terminal || terminal.type !== "END") throw new Error("Playbook did not reach an END node.");
    const end = endConfigurationSchema.parse(terminal.configuration);
    if (result.state.outcome === "UNKNOWN" || result.state.outcome === "NEED_MORE_INFORMATION") {
      result.state.outcome = end.outcome;
    }
    const answerStatus: AnswerDocument["status"] = result.state.outcome === "COMPLETED"
      ? "ANSWER"
      : result.state.outcome === "ESCALATED"
        ? "ESCALATE"
        : result.state.outcome === "NEED_MORE_INFORMATION"
          ? "CLARIFY"
          : "ABSTAIN";
    const provenance: AnswerProvenance[] = result.state.citations.map((citation) => ({
      kind: "AUTHORITATIVE_KNOWLEDGE",
      sourceId: citation.sourceId,
      sourceRevision: citation.revision,
      evidenceId: citation.sourceId,
      authoritative: true,
      metadata: {},
    }));
    const answer: AnswerDocument = {
      kind: "ANSWER_DOCUMENT",
      id: `expert-answer:${input.request.contextId}`,
      revision: 0,
      status: answerStatus,
      state: {},
      stateProvenance: {},
      blocks: [createAnswerBlock({
        id: "response",
        type: answerStatus === "ANSWER" ? "POLICY" : "CALLOUT",
        value: result.state.text,
        revision: 0,
        provenance,
        dependsOn: [],
        metadata: { outcome: result.state.outcome },
      })],
      metadata: {
        agentId: input.envelope.snapshot.agentId,
        versionNumber: input.envelope.versionNumber,
      },
    };
    return {
      outcome: result.state.outcome,
      text: result.state.text,
      data: {
        intent: result.state.intent,
        evidenceCount: result.state.evidence.length,
        approvedEvidenceIds: result.state.approvedEvidence.map((item) => item.id),
        workflowEndNode: result.terminalNodeId,
      },
      citations: result.state.citations,
      trace: result.trace,
      answer,
    };
  }
}
