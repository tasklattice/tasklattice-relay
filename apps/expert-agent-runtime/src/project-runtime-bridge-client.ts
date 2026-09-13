import type { ExpertAgentRuntimeEnvelope } from "@tali/contracts";
import { z } from "zod";
import type {
  ExpertAgentResourceClient,
  KnowledgeSearchInput,
  KnowledgeSearchItem,
  McpToolCallInput,
  ModelCompletionInput,
  ExpertAgentRunTelemetryEvent,
  ExpertAgentTelemetryClient,
} from "./runtime-types.js";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const knowledgeSearchItemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  text: z.string(),
  uri: z.string().nullable(),
  score: z.number(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

export class ProjectRuntimeBridgeResourceClient
implements ExpertAgentResourceClient, ExpertAgentTelemetryClient {
  constructor(private readonly input: {
    baseUrl: string;
    token: string;
    envelope: ExpertAgentRuntimeEnvelope;
    timeoutMs?: number;
  }) {}

  callMcpTool(input: McpToolCallInput): Promise<unknown> {
    return this.request("/v1/expert-agent-runtime/resources/mcp/call", input);
  }

  async searchKnowledge(input: KnowledgeSearchInput): Promise<KnowledgeSearchItem[]> {
    const result = await this.request(
      "/v1/expert-agent-runtime/resources/knowledge/search",
      input,
    );
    return z.array(knowledgeSearchItemSchema).parse(result);
  }

  completeModel(input: ModelCompletionInput): Promise<unknown> {
    return this.request(
      "/v1/expert-agent-runtime/resources/models/complete",
      input,
    );
  }

  async recordRun(event: ExpertAgentRunTelemetryEvent): Promise<void> {
    await this.request("/v1/expert-agent-runtime/runs/events", event);
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(
      `${this.input.baseUrl.replace(/\/$/, "")}${path}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.input.token}`,
          "content-type": "application/json",
          "x-tali-expert-agent-id": this.input.envelope.snapshot.agentId,
          "x-tali-expert-agent-version-id": this.input.envelope.versionId,
          "x-tali-expert-agent-content-digest": this.input.envelope.contentDigest,
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(this.input.timeoutMs ?? 120_000),
      },
    );
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("Project Runtime Bridge response exceeded 4 MiB.");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("Project Runtime Bridge response exceeded 4 MiB.");
    }
    if (!response.ok) {
      throw new Error(`Project Runtime Bridge returned HTTP ${response.status}.`);
    }
    const payload = JSON.parse(text) as { result?: unknown };
    return payload.result;
  }
}
