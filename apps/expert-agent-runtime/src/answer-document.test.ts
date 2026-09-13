import type { AnswerDocument, AnswerProvenance } from "@tali/contracts";
import { describe, expect, it } from "vitest";
import {
  answerStateValueHash,
  applyAnswerPatch,
  createAnswerBlock,
} from "./answer-document.js";

const policyProvenance: AnswerProvenance = {
  kind: "AUTHORITATIVE_KNOWLEDGE",
  sourceId: "hr-offboarding-policy",
  sourceRevision: "2026-08-01",
  evidenceId: "evidence-benefits-1",
  authoritative: true,
  metadata: {},
};

const userProvenance: AnswerProvenance = {
  kind: "USER_INPUT",
  sourceId: "message-date-update",
  sourceRevision: null,
  evidenceId: null,
  authoritative: false,
  metadata: {},
};

function document(): AnswerDocument {
  return {
    kind: "ANSWER_DOCUMENT",
    id: "offboarding-answer",
    revision: 3,
    status: "ANSWER",
    state: { "employment.departureDate": "2026-10-08" },
    stateProvenance: { "employment.departureDate": [userProvenance] },
    blocks: [
      createAnswerBlock({ id: "summary", type: "SUMMARY", value: "Offboarding plan", revision: 0, provenance: [], dependsOn: [], metadata: {} }),
      createAnswerBlock({ id: "departureDate", type: "FIELD", value: "October 8, 2026", revision: 1, provenance: [userProvenance], dependsOn: ["employment.departureDate"], metadata: {} }),
      createAnswerBlock({ id: "benefits", type: "POLICY", value: "Benefits end under the approved HR policy.", revision: 2, provenance: [policyProvenance], dependsOn: ["employment.departureDate"], metadata: {} }),
      createAnswerBlock({ id: "handover", type: "HANDOVER", value: "Return assigned equipment.", revision: 0, provenance: [policyProvenance], dependsOn: ["employment.assets"], metadata: {} }),
    ],
    metadata: {},
  };
}

describe("AnswerPatch", () => {
  it("updates semantic state and only recomputes dependent blocks", () => {
    const initial = document();
    const next = applyAnswerPatch(initial, {
      kind: "ANSWER_PATCH",
      documentId: initial.id,
      baseRevision: initial.revision,
      operations: [
        {
          op: "SET_STATE",
          path: "employment.departureDate",
          value: "2026-10-12",
          expectedValueHash: answerStateValueHash("2026-10-08"),
          provenance: [userProvenance],
        },
        {
          op: "REPLACE_BLOCK",
          expectedBlockRevision: 1,
          block: createAnswerBlock({ id: "departureDate", type: "FIELD", value: "October 12, 2026", revision: 2, provenance: [userProvenance], dependsOn: ["employment.departureDate"], metadata: { updated: true } }),
        },
        {
          op: "REPLACE_BLOCK",
          expectedBlockRevision: 2,
          block: createAnswerBlock({ id: "benefits", type: "POLICY", value: "Benefits end under the approved HR policy.", revision: 3, provenance: [policyProvenance], dependsOn: ["employment.departureDate"], metadata: { recomputed: true } }),
        },
      ],
      metadata: {},
    });

    expect(next.revision).toBe(4);
    expect(next.state["employment.departureDate"]).toBe("2026-10-12");
    expect(next.stateProvenance["employment.departureDate"]).toEqual([userProvenance]);
    const oldSummary = initial.blocks.find((block) => block.id === "summary")!;
    const newSummary = next.blocks.find((block) => block.id === "summary")!;
    const oldHandover = initial.blocks.find((block) => block.id === "handover")!;
    const newHandover = next.blocks.find((block) => block.id === "handover")!;
    expect(newSummary).toEqual(oldSummary);
    expect(newHandover).toEqual(oldHandover);
    expect(newSummary.revision).toBe(oldSummary.revision);
    expect(newSummary.contentHash).toBe(oldSummary.contentHash);
    expect(newHandover.revision).toBe(oldHandover.revision);
    expect(newHandover.contentHash).toBe(oldHandover.contentHash);
  });

  it("rejects patches that omit or rewrite blocks outside the dependency set", () => {
    const initial = document();
    expect(() => applyAnswerPatch(initial, {
      kind: "ANSWER_PATCH",
      documentId: initial.id,
      baseRevision: initial.revision,
      operations: [{
        op: "SET_STATE",
        path: "employment.departureDate",
        value: "2026-10-12",
        provenance: [userProvenance],
      }],
      metadata: {},
    })).toThrow("must recompute every affected block");
  });
});
