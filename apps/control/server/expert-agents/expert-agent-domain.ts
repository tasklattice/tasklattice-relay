import { createHash } from "node:crypto";
import {
  expertAgentDefinitionSchema,
  expertAgentTestEvidenceSchema,
  expertAgentVersionSnapshotSchema,
  type ExpertAgentDefinition,
  type ExpertAgentTestEvidence,
  type ExpertAgentVersionSnapshot,
} from "@tali/contracts";

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ExpertAgentPublishReadiness {
  ready: boolean;
  reason: "READY" | "NOT_TESTED" | "TESTS_FAILED" | "TESTS_OUTDATED";
  testRunId: string | null;
}

function toCanonicalJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Agent content cannot contain a non-finite number.");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(toCanonicalJsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, toCanonicalJsonValue(item)]),
    );
  }
  throw new TypeError(`Agent content contains unsupported ${typeof value}.`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function buildExpertAgentVersionSnapshot(input: {
  agentId: string;
  definition: ExpertAgentDefinition;
}): ExpertAgentVersionSnapshot {
  const definition = expertAgentDefinitionSchema.parse(input.definition);
  return expertAgentVersionSnapshotSchema.parse({
    schemaVersion: "agent-version/v1",
    agentId: input.agentId,
    ...definition,
  });
}

export function expertAgentContentDigest(
  snapshot: ExpertAgentVersionSnapshot,
): string {
  return sha256(expertAgentVersionSnapshotSchema.parse(snapshot));
}

export function assessExpertAgentPublishReadiness(input: {
  contentDigest: string;
  latestPublishTest: {
    id: string;
    contentDigest: string;
    status: string;
    evidence: unknown;
  } | null;
}): ExpertAgentPublishReadiness {
  const test = input.latestPublishTest;
  if (!test) return { ready: false, reason: "NOT_TESTED", testRunId: null };
  if (test.contentDigest !== input.contentDigest) {
    return { ready: false, reason: "TESTS_OUTDATED", testRunId: test.id };
  }
  const evidence = expertAgentTestEvidenceSchema.safeParse(test.evidence);
  if (
    test.status !== "PASSED"
    || !evidence.success
    || evidence.data.mode !== "RELEASE"
    || evidence.data.status !== "PASSED"
    || evidence.data.agentDigest !== input.contentDigest
  ) {
    return { ready: false, reason: "TESTS_FAILED", testRunId: test.id };
  }
  return { ready: true, reason: "READY", testRunId: test.id };
}

export function terminalTestEvidence(
  evidence: ExpertAgentTestEvidence,
): ExpertAgentTestEvidence {
  const parsed = expertAgentTestEvidenceSchema.parse(evidence);
  if (!parsed.finishedAt || !["PASSED", "FAILED", "CANCELLED"].includes(parsed.status)) {
    throw new TypeError("A recorded Agent test must have a terminal status and finish time.");
  }
  return parsed;
}
