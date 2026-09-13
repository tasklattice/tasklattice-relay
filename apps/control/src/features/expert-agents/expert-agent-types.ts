import type {
  ExpertAgentContractDraft,
  ExpertAgentContractDraftResult,
  ExpertAgentDefinitionInput,
  ExpertAgentDraftTryResult,
  ExpertAgentExecutionMode,
  ExpertAgentRelation,
  ExpertAgentTestEvidence,
  ExpertAgentTryResult,
  ExpertAgentVersionManifest,
  ExpertAgentVersionSnapshot,
} from "@tali/contracts";

export type AgentLifecycleState =
  | "NEEDS_TESTING"
  | "TESTS_FAILED"
  | "READY_TO_PUBLISH"
  | "PUBLISHED";

export interface AgentTestRun {
  id: string;
  agentRevision: number;
  contentDigest: string;
  mode: "QUICK" | "RELEASE";
  attempt: number;
  status: "RUNNING" | "PASSED" | "FAILED" | "CANCELLED";
  evidence: ExpertAgentTestEvidence;
  failureReason: string | null;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
}

export interface AgentVersion {
  id: string;
  agentId: string;
  versionNumber: number;
  label: string;
  sourceRevision: number;
  contentDigest: string;
  snapshot: ExpertAgentVersionSnapshot;
  manifest: ExpertAgentVersionManifest;
  manifestDigest: string;
  artifactSetDigest: string;
  publicationNotes: string | null;
  gardenStatus: "PUBLISHED" | "WITHDRAWN";
  publishedBy: string;
  publishedAt: string;
  artifacts: Array<{
    id: string;
    kind: string;
    mediaType: string;
    digest: string;
    uri: string;
    sizeBytes: number | null;
    metadata: unknown;
  }>;
}

export interface ExpertAgentListItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  executionMode: ExpertAgentExecutionMode;
  relation: ExpertAgentRelation;
  revision: number;
  contentDigest: string;
  lifecycleState: AgentLifecycleState;
  latestVersion: Pick<AgentVersion, "id" | "versionNumber" | "publishedAt"> & { label: string } | null;
  latestTest: AgentTestRun | null;
  versionCount: number;
  instanceCount: number;
  updatedAt: string;
}

export interface ExpertAgentDetail {
  id: string;
  slug: string;
  name: string;
  description: string;
  executionMode: ExpertAgentExecutionMode;
  relation: ExpertAgentRelation;
  revision: number;
  contentDigest: string;
  definition: ExpertAgentDefinitionInput;
  lifecycleState: AgentLifecycleState;
  publishReadiness: {
    ready: boolean;
    reason: "READY" | "NOT_TESTED" | "TESTS_FAILED" | "TESTS_OUTDATED";
  };
  latestVersion: AgentVersion | null;
  versions: AgentVersion[];
  testRuns: AgentTestRun[];
  instanceCount: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpertAgentResourceRevision {
  kind: string;
  resourceId: string;
  revision: string;
  access: "READ" | "INVOKE" | "READ_WRITE";
  required: boolean;
  currentRevision: string | null;
  available: boolean;
  drifted: boolean;
  error?: string;
}

export interface ExpertAgentAvailableResource {
  kind: "MCP_SERVER" | "MODEL_ROUTING" | "KNOWLEDGE_VECTOR_DATABASE";
  resourceId: string;
  name: string;
  status: string;
  ready: boolean;
  revision: string | null;
  detail: string;
}

export type {
  ExpertAgentContractDraft,
  ExpertAgentContractDraftResult,
  ExpertAgentDefinitionInput,
  ExpertAgentDraftTryResult,
  ExpertAgentTestEvidence,
  ExpertAgentTryResult,
};
