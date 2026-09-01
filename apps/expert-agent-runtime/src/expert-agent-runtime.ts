import {
  expertAgentRuntimeEnvelopeSchema,
  type ExpertAgentRuntimeEnvelope,
} from "@tali/contracts";
import { runtimeVersionDigest } from "./snapshot-integrity.js";
import {
  BoundExpertAgentResources,
  type ExpertAgentEngine,
  type ExpertAgentExecutionRequest,
  type ExpertAgentExecutionResult,
  type ExpertAgentResourceClient,
  type ExpertAgentTelemetryClient,
} from "./runtime-types.js";

export type ExpertAgentRuntimeLogRecord = Record<
  string,
  boolean | number | string | null
>;

export type ExpertAgentRuntimeLogger = (
  record: ExpertAgentRuntimeLogRecord,
) => void;

const traceLogAttributeKeys = new Set([
  "approvalRequired",
  "approvalStatus",
  "approvedEvidenceCount",
  "attempt",
  "category",
  "citationCount",
  "errorType",
  "evidenceCount",
  "framework",
  "frameworkVersion",
  "nodeType",
  "outcome",
  "policy",
  "priority",
  "timeoutMs",
]);

function traceLogAttributes(
  attributes: ExpertAgentExecutionResult["trace"][number]["attributes"],
): ExpertAgentRuntimeLogRecord {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => traceLogAttributeKeys.has(key)),
  );
}

function requiresGrounding(envelope: ExpertAgentRuntimeEnvelope): boolean {
  const snapshot = envelope.snapshot;
  return snapshot.policy.groundingPolicy === "REQUIRED"
    || snapshot.policy.groundingPolicy === "TOOL_GROUNDED";
}

function groundingPolicy(envelope: ExpertAgentRuntimeEnvelope): string {
  return envelope.snapshot.policy.groundingPolicy;
}

export function enforceGrounding(
  envelope: ExpertAgentRuntimeEnvelope,
  result: ExpertAgentExecutionResult,
): ExpertAgentExecutionResult {
  if (
    result.outcome !== "COMPLETED"
    || !requiresGrounding(envelope)
    || result.citations.length > 0
    || (
      result.data.grounding
      && typeof result.data.grounding === "object"
      && !Array.isArray(result.data.grounding)
      && (result.data.grounding as Record<string, unknown>).verified === true
    )
  ) return result;
  const { answer: _unsupportedAnswer, ...safeResult } = result;
  return {
    ...safeResult,
    outcome: "UNKNOWN",
    text: "Relay withheld the answer because the required authoritative evidence could not be verified.",
    data: {
      ...result.data,
      grounding: {
        released: false,
        reason: "REQUIRED_EVIDENCE_MISSING",
      },
    },
    citations: [],
    trace: [...result.trace, {
      step: "relay.grounding-gate",
      status: "FAILED",
      summary: "Required evidence was missing; unsupported output was not released.",
      occurredAt: new Date().toISOString(),
      attributes: { policy: groundingPolicy(envelope) },
    }],
  };
}

export class ExpertAgentRuntime {
  readonly envelope: ExpertAgentRuntimeEnvelope;

  constructor(input: {
    envelope: ExpertAgentRuntimeEnvelope;
    engines: ExpertAgentEngine[];
    resources: ExpertAgentResourceClient;
    telemetry?: ExpertAgentTelemetryClient;
    logger?: ExpertAgentRuntimeLogger;
  }) {
    this.envelope = expertAgentRuntimeEnvelopeSchema.parse(input.envelope);
    if (runtimeVersionDigest(this.envelope.snapshot) !== this.envelope.contentDigest) {
      throw new Error("Expert Agent runtime refused a Version with an invalid digest.");
    }
    const matching = input.engines.filter((engine) =>
      engine.mode === this.envelope.snapshot.execution.mode
      && engine.supports(this.envelope.snapshot)
    );
    if (matching.length !== 1) {
      throw new Error(
        `Expected one execution engine for ${this.envelope.snapshot.execution.mode}; found ${matching.length}.`,
      );
    }
    this.engine = matching[0]!;
    this.resources = new BoundExpertAgentResources(
      this.envelope.snapshot,
      input.resources,
    );
    this.telemetry = input.telemetry;
    this.logger = input.logger;
  }

  private readonly engine: ExpertAgentEngine;
  private readonly resources: BoundExpertAgentResources;
  private readonly telemetry: ExpertAgentTelemetryClient | undefined;
  private readonly logger: ExpertAgentRuntimeLogger | undefined;

  private log(record: ExpertAgentRuntimeLogRecord): void {
    try {
      this.logger?.({
        component: "expert-agent-runtime",
        agentId: this.envelope.snapshot.agentId,
        versionId: this.envelope.versionId,
        versionNumber: this.envelope.versionNumber,
        framework: this.envelope.snapshot.execution.engine.framework,
        frameworkVersion: this.envelope.snapshot.execution.engine.version,
        ...record,
      });
    } catch {
      // Observability must never change Agent execution semantics.
    }
  }

  async execute(request: ExpertAgentExecutionRequest): Promise<ExpertAgentExecutionResult> {
    const startedAt = new Date();
    this.log({
      timestamp: startedAt.toISOString(),
      level: "info",
      event: "expert_agent.run.started",
      runId: request.messageId,
      traceId: request.contextId,
      executionMode: this.envelope.snapshot.execution.mode,
      promptLength: request.text.length,
    });
    await this.telemetry?.recordRun({
      event: "started",
      runId: request.messageId,
      occurredAt: startedAt.toISOString(),
      traceId: request.contextId,
    }).catch(() => undefined);
    try {
      const engineResult = await this.engine.execute({
        envelope: this.envelope,
        request,
        resources: this.resources,
      });
      const result = enforceGrounding(this.envelope, engineResult);
      for (const traceEvent of result.trace) {
        this.log({
          timestamp: traceEvent.occurredAt,
          level: traceEvent.status === "FAILED" ? "error" : "info",
          event: "expert_agent.trace",
          runId: request.messageId,
          traceId: request.contextId,
          step: traceEvent.step,
          status: traceEvent.status,
          ...traceLogAttributes(traceEvent.attributes),
        });
      }
      this.log({
        timestamp: new Date().toISOString(),
        level: result.outcome === "FAILED" ? "error" : "info",
        event: "expert_agent.run.finished",
        runId: request.messageId,
        traceId: request.contextId,
        status: result.outcome === "FAILED" ? "FAILED" : "SUCCEEDED",
        outcome: result.outcome,
        durationMs: Date.now() - startedAt.getTime(),
        traceEventCount: result.trace.length,
        citationCount: result.citations.length,
      });
      await this.telemetry?.recordRun({
        event: "finished",
        runId: request.messageId,
        occurredAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        status: result.outcome === "FAILED" ? "FAILED" : "SUCCEEDED",
        ...(result.outcome === "FAILED" ? { errorCategory: "ENGINE_FAILED" } : {}),
        traceId: request.contextId,
        outcome: result.outcome,
        trace: result.trace,
        citations: result.citations,
      }).catch(() => undefined);
      return result;
    } catch (error) {
      this.log({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "expert_agent.run.failed",
        runId: request.messageId,
        traceId: request.contextId,
        status: "FAILED",
        durationMs: Date.now() - startedAt.getTime(),
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      await this.telemetry?.recordRun({
        event: "finished",
        runId: request.messageId,
        occurredAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        status: "FAILED",
        errorCategory: "ENGINE_EXCEPTION",
        traceId: request.contextId,
      }).catch(() => undefined);
      throw error;
    }
  }
}
