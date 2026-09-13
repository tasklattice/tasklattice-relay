import type {
  AnswerArtifact,
  AnswerDocument,
  AnswerPatch,
  AnswerProvenance,
  ExpertAgentVersionSnapshot,
} from "@tali/contracts";
import { answerArtifactSchema, answerDocumentSchema } from "@tali/contracts";
import { z } from "zod";
import {
  answerStateValueHash,
  applyAnswerPatch,
  createAnswerBlock,
} from "../answer-document.js";
import { RelayPlaybookRuntime, type PlaybookOperator } from "../playbook-runtime.js";
import type {
  ExpertAgentCitation,
  ExpertAgentEngine,
  ExpertAgentExecutionOutcome,
  ExpertAgentExecutionResult,
  KnowledgeSearchItem,
} from "../runtime-types.js";

const configurationSchema = z.object({
  engineType: z.literal("CONTROLLED_OFFBOARDING_KNOWLEDGE"),
  vectorDatabaseId: z.string().trim().min(1).max(240),
  minimumScore: z.number().min(0).max(1).default(0.85),
  unknownMessage: z.string().trim().min(1).max(2_000),
  clarifyYearMessage: z.string().trim().min(1).max(2_000),
  escalationMessage: z.string().trim().min(1).max(2_000),
  developmentStatus: z.enum(["DESIGN", "IMPLEMENTED"]).optional(),
  requiredProjectResources: z.array(z.string()).optional(),
}).strict();

const responseConfigurationSchema = z.object({
  responseType: z.enum(["DOCUMENT", "PATCH", "CLARIFY", "ABSTAIN", "ESCALATE"]),
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

const requiredKnowledgeBlocks = ["summary", "benefits", "handover"] as const;
type KnowledgeBlockId = (typeof requiredKnowledgeBlocks)[number];

interface OffboardingState {
  existingDocument: AnswerDocument | null;
  departureDate: string | null;
  dateAmbiguous: boolean;
  evidence: KnowledgeSearchItem[];
  approved: Partial<Record<KnowledgeBlockId, KnowledgeSearchItem>>;
  artifact: AnswerArtifact | null;
  outcome: ExpertAgentExecutionOutcome;
  text: string;
  citations: ExpertAgentCitation[];
}

const months: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function validIsoDate(year: number, month: number, day: number): string | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year
    || value.getUTCMonth() !== month - 1
    || value.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDepartureDate(text: string, existing: AnswerDocument | null): {
  value: string | null;
  ambiguous: boolean;
} {
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return {
    value: validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3])),
    ambiguous: false,
  };
  const named = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i);
  if (!named) return { value: null, ambiguous: false };
  const month = months[named[1]!.toLocaleLowerCase()]!;
  const day = Number(named[2]);
  const explicitYear = named[3] ? Number(named[3]) : null;
  const existingDate = existing?.state["employment.departureDate"];
  const existingYear = typeof existingDate === "string"
    ? existingDate.match(/^(20\d{2})-/)?.[1]
    : undefined;
  const year = explicitYear ?? (existingYear ? Number(existingYear) : null);
  if (year === null) return { value: null, ambiguous: true };
  return { value: validIsoDate(year, month, day), ambiguous: false };
}

function existingDocument(metadata: Record<string, unknown>): AnswerDocument | null {
  const snapshots = [metadata.answerDocument, metadata.answer];
  for (const snapshot of snapshots) {
    const parsed = answerDocumentSchema.safeParse(snapshot);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function approvedEvidence(
  evidence: KnowledgeSearchItem[],
  minimumScore: number,
): { approved: Partial<Record<KnowledgeBlockId, KnowledgeSearchItem>>; conflict: boolean } {
  const groups = new Map<KnowledgeBlockId, KnowledgeSearchItem[]>();
  evidence.forEach((item) => {
    const blockId = item.metadata.answerBlockId;
    if (
      item.score < minimumScore
      || item.metadata.approved !== true
      || typeof item.metadata.revision !== "string"
      || !requiredKnowledgeBlocks.includes(blockId as KnowledgeBlockId)
    ) return;
    const id = blockId as KnowledgeBlockId;
    groups.set(id, [...(groups.get(id) ?? []), item]);
  });
  let conflict = false;
  const approved: Partial<Record<KnowledgeBlockId, KnowledgeSearchItem>> = {};
  requiredKnowledgeBlocks.forEach((id) => {
    const items = (groups.get(id) ?? []).sort((left, right) =>
      right.score - left.score || left.id.localeCompare(right.id)
    );
    if (items.length > 1 && items.some((item) => item.text.trim() !== items[0]!.text.trim())) {
      conflict = true;
      return;
    }
    if (items[0]) approved[id] = items[0];
  });
  return { approved, conflict };
}

function knowledgeProvenance(item: KnowledgeSearchItem): AnswerProvenance {
  return {
    kind: "AUTHORITATIVE_KNOWLEDGE",
    sourceId: item.id,
    sourceRevision: String(item.metadata.revision),
    evidenceId: item.id,
    authoritative: true,
    metadata: {
      title: item.title,
      ...(item.uri ? { uri: item.uri } : {}),
    },
  };
}

function userProvenance(messageId: string): AnswerProvenance {
  return {
    kind: "USER_INPUT",
    sourceId: messageId,
    sourceRevision: null,
    evidenceId: null,
    authoritative: false,
    metadata: {},
  };
}

function citation(item: KnowledgeSearchItem): ExpertAgentCitation {
  return {
    sourceId: item.id,
    title: item.title,
    uri: item.uri,
    excerpt: item.text.slice(0, 500),
    revision: String(item.metadata.revision),
  };
}

function safeDocument(input: {
  id: string;
  status: AnswerDocument["status"];
  text: string;
}): AnswerDocument {
  return {
    kind: "ANSWER_DOCUMENT",
    id: input.id,
    revision: 0,
    status: input.status,
    state: {},
    stateProvenance: {},
    blocks: [createAnswerBlock({
      id: "response",
      type: "CALLOUT",
      value: input.text,
      revision: 0,
      provenance: [],
      dependsOn: [],
      metadata: {},
    })],
    metadata: {},
  };
}

export class ControlledOffboardingEngine implements ExpertAgentEngine {
  readonly mode = "WORKFLOW" as const;

  supports(snapshot: ExpertAgentVersionSnapshot): boolean {
    return snapshot.execution.mode === "WORKFLOW"
      && snapshot.execution.configuration.engineType === "CONTROLLED_OFFBOARDING_KNOWLEDGE";
  }

  async execute(input: Parameters<ExpertAgentEngine["execute"]>[0]): Promise<ExpertAgentExecutionResult> {
    if (input.envelope.snapshot.execution.mode !== "WORKFLOW") {
      throw new Error("Controlled Offboarding requires WORKFLOW execution.");
    }
    const execution = input.envelope.snapshot.execution;
    const configuration = configurationSchema.parse(execution.configuration);
    const initialState: OffboardingState = {
      existingDocument: null,
      departureDate: null,
      dateAmbiguous: false,
      evidence: [],
      approved: {},
      artifact: null,
      outcome: "UNKNOWN",
      text: configuration.unknownMessage,
      citations: [],
    };

    const transform: PlaybookOperator<OffboardingState> = async ({ state }) => {
      state.existingDocument = existingDocument(input.request.metadata);
      const parsedDate = parseDepartureDate(input.request.text, state.existingDocument);
      state.departureDate = parsedDate.value;
      state.dateAmbiguous = parsedDate.ambiguous;
      if (parsedDate.ambiguous) return { outcome: "DATE_AMBIGUOUS", state };
      if (state.existingDocument && parsedDate.value) return { outcome: "STATE_PATCH_READY", state };
      return { outcome: "QUERY_READY", state };
    };
    const knowledge: PlaybookOperator<OffboardingState> = async ({ state }) => {
      state.evidence = await input.resources.searchKnowledge({
        vectorDatabaseId: configuration.vectorDatabaseId,
        query: input.request.text,
        limit: 20,
      });
      return {
        outcome: state.evidence.length ? "EVIDENCE_FOUND" : "NO_EVIDENCE",
        state,
        attributes: { evidenceCount: state.evidence.length },
      };
    };
    const decision: PlaybookOperator<OffboardingState> = async ({ state }) => {
      const result = approvedEvidence(state.evidence, configuration.minimumScore);
      state.approved = result.approved;
      if (result.conflict) return { outcome: "CONFLICT", state };
      if (!requiredKnowledgeBlocks.every((id) => state.approved[id])) {
        return { outcome: "INSUFFICIENT", state };
      }
      return {
        outcome: "APPROVED",
        state,
        attributes: { approvedBlockCount: Object.keys(state.approved).length },
      };
    };
    const response: PlaybookOperator<OffboardingState> = async ({ node, state }) => {
      const responseConfiguration = responseConfigurationSchema.parse(node.configuration);
      const documentId = state.existingDocument?.id ?? `offboarding:${input.request.contextId}`;
      if (responseConfiguration.responseType === "CLARIFY") {
        state.outcome = "NEED_MORE_INFORMATION";
        state.text = configuration.clarifyYearMessage;
        state.artifact = safeDocument({ id: documentId, status: "CLARIFY", text: state.text });
        return { outcome: "RESPONSE_READY", state };
      }
      if (responseConfiguration.responseType === "ABSTAIN") {
        state.outcome = "UNKNOWN";
        state.text = configuration.unknownMessage;
        state.artifact = safeDocument({ id: documentId, status: "ABSTAIN", text: state.text });
        return { outcome: "RESPONSE_READY", state };
      }
      if (responseConfiguration.responseType === "ESCALATE") {
        state.outcome = "ESCALATED";
        state.text = configuration.escalationMessage;
        state.artifact = safeDocument({ id: documentId, status: "ESCALATE", text: state.text });
        return { outcome: "RESPONSE_READY", state };
      }
      if (responseConfiguration.responseType === "DOCUMENT") {
        const summary = state.approved.summary!;
        const benefits = state.approved.benefits!;
        const handover = state.approved.handover!;
        const departureProvenance = state.departureDate ? [userProvenance(input.request.messageId)] : [];
        state.artifact = {
          kind: "ANSWER_DOCUMENT",
          id: documentId,
          revision: 0,
          status: "ANSWER",
          state: state.departureDate ? { "employment.departureDate": state.departureDate } : {},
          stateProvenance: state.departureDate ? { "employment.departureDate": departureProvenance } : {},
          blocks: [
            createAnswerBlock({ id: "summary", type: "SUMMARY", value: summary.text.trim(), revision: 0, provenance: [knowledgeProvenance(summary)], dependsOn: [], metadata: {} }),
            createAnswerBlock({ id: "departureDate", type: "FIELD", value: state.departureDate ?? "Not provided", revision: 0, provenance: departureProvenance, dependsOn: ["employment.departureDate"], metadata: {} }),
            createAnswerBlock({ id: "benefits", type: "POLICY", value: benefits.text.trim(), revision: 0, provenance: [knowledgeProvenance(benefits)], dependsOn: ["employment.departureDate"], metadata: {} }),
            createAnswerBlock({ id: "handover", type: "HANDOVER", value: handover.text.trim(), revision: 0, provenance: [knowledgeProvenance(handover)], dependsOn: ["employment.assets"], metadata: {} }),
          ],
          metadata: {},
        } satisfies AnswerDocument;
        state.outcome = "COMPLETED";
        state.text = summary.text.trim();
        state.citations = requiredKnowledgeBlocks.map((id) => citation(state.approved[id]!));
        return { outcome: "RESPONSE_READY", state };
      }
      if (!state.existingDocument || !state.departureDate) {
        throw new Error("AnswerPatch requires an existing document and a resolved departure date.");
      }
      const currentDate = state.existingDocument.state["employment.departureDate"];
      const provenance = userProvenance(input.request.messageId);
      const operations: AnswerPatch["operations"] = [{
        op: "SET_STATE",
        path: "employment.departureDate",
        value: state.departureDate,
        expectedValueHash: answerStateValueHash(currentDate),
        provenance: [provenance],
      }];
      state.existingDocument.blocks.forEach((block) => {
        if (!block.dependsOn.includes("employment.departureDate")) return;
        operations.push({
          op: "REPLACE_BLOCK",
          expectedBlockRevision: block.revision,
          block: createAnswerBlock({
            ...block,
            value: block.id === "departureDate" ? state.departureDate! : block.value,
            revision: block.revision + 1,
            provenance: block.id === "departureDate" ? [provenance] : block.provenance,
            metadata: { ...block.metadata, updated: block.id === "departureDate", recomputed: true },
          }),
        });
      });
      const patch: AnswerPatch = {
        kind: "ANSWER_PATCH",
        documentId: state.existingDocument.id,
        baseRevision: state.existingDocument.revision,
        operations,
        metadata: {},
      };
      applyAnswerPatch(state.existingDocument, patch);
      state.artifact = patch;
      state.outcome = "COMPLETED";
      state.text = `Departure date updated to ${state.departureDate}.`;
      state.citations = state.existingDocument.blocks.flatMap((block) =>
        block.provenance.flatMap((source) => source.kind === "AUTHORITATIVE_KNOWLEDGE"
          ? [{ sourceId: source.sourceId, title: source.sourceId, uri: typeof source.metadata.uri === "string" ? source.metadata.uri : null, excerpt: null, revision: source.sourceRevision }]
          : [])
      );
      return { outcome: "RESPONSE_READY", state };
    };
    const verify: PlaybookOperator<OffboardingState> = async ({ state }) => {
      const parsed = answerArtifactSchema.safeParse(state.artifact);
      if (!parsed.success) return { outcome: "INVALID", state };
      if (parsed.data.kind === "ANSWER_DOCUMENT" && parsed.data.status === "ANSWER") {
        const grounded = parsed.data.blocks
          .filter((block) => block.type === "SUMMARY" || block.type === "POLICY" || block.type === "HANDOVER")
          .every((block) => block.provenance.some((source) =>
            source.kind === "AUTHORITATIVE_KNOWLEDGE" && source.authoritative
          ));
        if (!grounded) return { outcome: "INVALID", state };
      }
      if (parsed.data.kind === "ANSWER_PATCH" && state.existingDocument) {
        applyAnswerPatch(state.existingDocument, parsed.data);
      }
      if (parsed.data.kind === "ANSWER_PATCH" || parsed.data.status === "ANSWER") {
        return { outcome: "VERIFIED_ANSWER", state };
      }
      return { outcome: `VERIFIED_${parsed.data.status}`, state };
    };
    const runtime = new RelayPlaybookRuntime<OffboardingState>({
      TRANSFORM: transform,
      KNOWLEDGE: knowledge,
      DECISION: decision,
      RESPONSE: response,
      VERIFY: verify,
    });
    const result = await runtime.execute({ execution, initialState });
    const terminal = execution.nodes.find((node) => node.id === result.terminalNodeId);
    if (!terminal || terminal.type !== "END") throw new Error("Offboarding Playbook did not reach END.");
    const end = endConfigurationSchema.parse(terminal.configuration);
    if (result.state.outcome === "UNKNOWN") result.state.outcome = end.outcome;
    if (!result.state.artifact) throw new Error("Offboarding Playbook produced no answer artifact.");
    return {
      outcome: result.state.outcome,
      text: result.state.text,
      data: {
        evidenceIds: result.state.evidence.map((item) => item.id),
        answerKind: result.state.artifact.kind,
      },
      citations: result.state.citations,
      trace: result.trace,
      answer: result.state.artifact,
    };
  }
}
