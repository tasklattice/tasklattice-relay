import {
  expertAgentRuntimeEnvelopeSchema,
  type ExpertAgentRuntimeEnvelope,
  type ExpertAgentVersionSnapshot,
} from "@tali/contracts";
import { runtimeVersionDigest } from "./snapshot-integrity.js";

const artifactDigest = `sha256:${"0".repeat(64)}`;

export function createTestRuntimeEnvelope(
  snapshot: ExpertAgentVersionSnapshot,
  versionId: string,
  versionNumber = 1,
): ExpertAgentRuntimeEnvelope {
  const contentDigest = runtimeVersionDigest(snapshot);
  const artifactKind = snapshot.execution.mode === "WORKFLOW" ? "PLAYBOOK" : "PROMPT";
  return expertAgentRuntimeEnvelopeSchema.parse({
    versionId,
    versionNumber,
    contentDigest,
    snapshot,
    manifest: {
      schemaVersion: "agent-version-manifest/v1",
      agentId: snapshot.agentId,
      versionId,
      versionNumber,
      contentDigest,
      executionMode: snapshot.execution.mode,
      artifacts: [{
        kind: artifactKind,
        mediaType: snapshot.execution.mode === "WORKFLOW"
          ? "application/vnd.tasklattice.playbook+json"
          : "application/vnd.tasklattice.prompt+json",
        digest: artifactDigest,
        uri: `agent-version://${snapshot.agentId}/v${versionNumber}/${artifactKind.toLowerCase()}`,
        sizeBytes: null,
        metadata: {},
      }],
      requirements: snapshot.resources,
      evidence: {
        testRunId: "test-run-1",
        testedDigest: contentDigest,
        passedAt: "2026-08-30T00:00:00.000Z",
      },
      createdAt: "2026-08-30T00:00:00.000Z",
    },
  });
}
