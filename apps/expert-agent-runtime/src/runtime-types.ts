import type {
  AnswerArtifact,
  ExpertAgentVersionSnapshot,
  ExpertAgentExecutionMode,
  ExpertAgentRuntimeEnvelope,
} from "@tali/contracts";

export interface ExpertAgentExecutionRequest {
  messageId: string;
  contextId: string;
  text: string;
  metadata: Record<string, unknown>;
}

export type ExpertAgentExecutionOutcome =
  | "COMPLETED"
  | "NEED_MORE_INFORMATION"
  | "UNKNOWN"
  | "ESCALATED"
  | "REJECTED"
  | "FAILED";

export interface ExpertAgentCitation {
  sourceId: string;
  title: string;
  uri: string | null;
  excerpt: string | null;
  revision: string | null;
}

export interface ExpertAgentTraceEvent {
  step: string;
  status: "STARTED" | "COMPLETED" | "FAILED" | "SKIPPED";
  summary: string;
  occurredAt: string;
  attributes: Record<string, boolean | number | string | null>;
}

export interface ExpertAgentExecutionResult {
  outcome: ExpertAgentExecutionOutcome;
  text: string;
  data: Record<string, unknown>;
  citations: ExpertAgentCitation[];
  trace: ExpertAgentTraceEvent[];
  answer?: AnswerArtifact;
}

export interface McpToolCallInput {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface KnowledgeSearchInput {
  vectorDatabaseId: string;
  query: string;
  limit: number;
}

export interface KnowledgeSearchItem {
  id: string;
  title: string;
  text: string;
  uri: string | null;
  score: number;
  metadata: Record<string, unknown>;
}

export interface ModelCompletionInput {
  modelRoutingId: string;
  system: string;
  user: string;
  responseJsonSchema: Record<string, unknown>;
  temperature: number;
}

export interface ExpertAgentResourceClient {
  callMcpTool(input: McpToolCallInput): Promise<unknown>;
  searchKnowledge(input: KnowledgeSearchInput): Promise<KnowledgeSearchItem[]>;
  completeModel(input: ModelCompletionInput): Promise<unknown>;
}

export interface ExpertAgentRunTelemetryEvent {
  event: "started" | "finished";
  runId: string;
  occurredAt: string;
  durationMs?: number;
  status?: "SUCCEEDED" | "FAILED";
  errorCategory?: string;
  traceId?: string;
  outcome?: ExpertAgentExecutionOutcome;
  trace?: ExpertAgentTraceEvent[];
  citations?: ExpertAgentCitation[];
}

export interface ExpertAgentTelemetryClient {
  recordRun(event: ExpertAgentRunTelemetryEvent): Promise<void>;
}

export interface ExpertAgentEngine {
  readonly mode: ExpertAgentExecutionMode;
  supports(snapshot: ExpertAgentVersionSnapshot): boolean;
  execute(input: {
    envelope: ExpertAgentRuntimeEnvelope;
    request: ExpertAgentExecutionRequest;
    resources: BoundExpertAgentResources;
  }): Promise<ExpertAgentExecutionResult>;
}

export class BoundExpertAgentResources {
  constructor(
    private readonly snapshot: ExpertAgentVersionSnapshot,
    private readonly client: ExpertAgentResourceClient,
  ) {}

  async callMcpTool(input: McpToolCallInput): Promise<unknown> {
    this.requireBinding("MCP_SERVER", input.serverId, ["READ", "INVOKE"]);
    return this.client.callMcpTool(input);
  }

  async searchKnowledge(input: KnowledgeSearchInput): Promise<KnowledgeSearchItem[]> {
    this.requireBinding(
      "KNOWLEDGE_VECTOR_DATABASE",
      input.vectorDatabaseId,
      ["READ"],
    );
    return this.client.searchKnowledge(input);
  }

  async completeModel(input: ModelCompletionInput): Promise<unknown> {
    this.requireBinding("MODEL_ROUTING", input.modelRoutingId, ["INVOKE"]);
    return this.client.completeModel(input);
  }

  private requireBinding(
    kind: ExpertAgentVersionSnapshot["resources"][number]["kind"],
    resourceId: string,
    allowedAccess: Array<ExpertAgentVersionSnapshot["resources"][number]["access"]>,
  ): void {
    const binding = this.snapshot.resources.find((resource) =>
      resource.kind === kind && resource.resourceId === resourceId
    );
    if (!binding || !allowedAccess.includes(binding.access)) {
      throw new Error(
        `Version is not permitted to use ${kind}:${resourceId}.`,
      );
    }
  }
}
