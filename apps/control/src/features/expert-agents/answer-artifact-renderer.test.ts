import { describe, expect, it } from "vitest";
import { findAnswerArtifact } from "./answer-artifact-renderer";

describe("findAnswerArtifact", () => {
  it("finds the structured answer inside a nested A2A data part", () => {
    const answer = {
      kind: "ANSWER_DOCUMENT",
      id: "answer-1",
      revision: 0,
      status: "ANSWER",
      state: {},
      stateProvenance: {},
      blocks: [{
        id: "summary",
        type: "SUMMARY",
        value: "Grounded response",
        revision: 0,
        contentHash: `sha256:${"a".repeat(64)}`,
        provenance: [],
        dependsOn: [],
        metadata: {},
      }],
      metadata: {},
    };
    expect(findAnswerArtifact({
      jsonrpc: "2.0",
      result: { parts: [{ data: { answer } }] },
    })).toEqual(answer);
  });

  it("returns null for an ordinary text-only response", () => {
    expect(findAnswerArtifact({ result: { text: "hello" } })).toBeNull();
  });
});
