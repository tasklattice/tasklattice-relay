import type {
  TraceAttributeValue,
  TraceDetail,
  TraceSpan,
  TraceSpanType,
  TraceSummary,
} from "@tali/contracts";
import { prisma } from "../db/prisma";
import type { PrismaClient, ProjectRunRecord } from "../generated/prisma/client";
import type { TraceRepository } from "./trace-repository";

interface StoredTraceEvent {
  step: string;
  status: "STARTED" | "COMPLETED" | "FAILED" | "SKIPPED";
  summary: string;
  occurredAt: string;
  attributes: Record<string, boolean | number | string | null>;
}

interface StoredExpertTrace {
  outcome?: string;
  trace?: StoredTraceEvent[];
  citations?: unknown[];
  candidateId?: string;
  candidateDigest?: string;
  evaluationSuiteId?: string;
  evaluationCaseId?: string;
}

function storedTrace(value: unknown): StoredExpertTrace {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as StoredExpertTrace;
}

function traceType(step: string): TraceSpanType {
  if (/model|summary|generation/i.test(step)) return "generation";
  if (/mcp|github/i.test(step)) return "mcp";
  if (/retrieve|knowledge/i.test(step)) return "retriever";
  if (/guard|decision|safety/i.test(step)) return "guardrail";
  return "tool";
}

function status(run: ProjectRunRecord): TraceSummary["status"] {
  if (run.status === "RUNNING") return "running";
  return run.status === "SUCCEEDED" ? "ok" : "error";
}

function playbookSpans(input: {
  events: StoredTraceEvent[];
  rootId: string;
  run: ProjectRunRecord;
  agentName: string;
}): TraceSpan[] {
  const attempts = new Map<string, {
    order: number;
    started?: StoredTraceEvent;
    terminal?: StoredTraceEvent;
  }>();
  input.events.forEach((event, index) => {
    const attempt = typeof event.attributes.attempt === "number"
      ? event.attributes.attempt
      : null;
    const key = attempt === null ? `${event.step}:event:${index}` : `${event.step}:attempt:${attempt}`;
    const current = attempts.get(key) ?? { order: index };
    if (event.status === "STARTED") current.started = event;
    else current.terminal = event;
    attempts.set(key, current);
  });
  return [...attempts.values()]
    .sort((left, right) => left.order - right.order)
    .map((attempt, index): TraceSpan => {
      const event = attempt.terminal ?? attempt.started!;
      const startedAt = attempt.started ? Date.parse(attempt.started.occurredAt) : Date.parse(event.occurredAt);
      const terminalAt = attempt.terminal ? Date.parse(attempt.terminal.occurredAt) : startedAt;
      const attributes = {
        ...(attempt.started?.attributes ?? {}),
        ...(attempt.terminal?.attributes ?? {}),
      };
      return {
        spanId: `step-${input.run.id.slice(0, 16)}-${index + 1}`,
        parentSpanId: input.rootId,
        name: event.step,
        type: traceType(event.step),
        serviceName: "tali-expert-agent-runtime",
        agentName: input.agentName,
        startOffsetMs: Math.max(0, startedAt - input.run.startedAt.getTime()),
        durationMs: Math.max(0, terminalAt - startedAt),
        status: !attempt.terminal
          ? "running"
          : attempt.terminal.status === "FAILED"
            ? "error"
            : "ok",
        input: {
          attempt: attributes.attempt ?? 1,
          nodeType: attributes.nodeType ?? "unknown",
          timeoutMs: attributes.timeoutMs ?? null,
        },
        output: {
          summary: attempt.terminal?.summary ?? attempt.started?.summary ?? "",
          outcome: attributes.outcome ?? null,
          evidenceCount: attributes.evidenceCount ?? null,
          citationCount: attributes.citationCount ?? null,
          errorType: attributes.errorType ?? null,
        },
        attributes: Object.fromEntries(Object.entries(attributes).map(
          ([key, value]) => [key, value as TraceAttributeValue],
        )),
      };
    });
}

export class ExpertAgentTraceRepository implements TraceRepository {
  constructor(
    private readonly projectId: string,
    private readonly actorId: string,
    private readonly db: PrismaClient = prisma(),
    private readonly relationScoped = true,
  ) {}

  async list(): Promise<TraceSummary[]> {
    const agents = await this.accessibleAgents();
    if (!agents.size) return [];
    const runs = await this.db.projectRunRecord.findMany({
      where: {
        projectId: this.projectId,
        expertAgentId: { in: [...agents.keys()] },
        traceId: { not: null },
      },
      orderBy: { startedAt: "desc" },
      take: 500,
    });
    return runs.map((run) => this.summary(run, agents.get(run.expertAgentId!)!));
  }

  async getById(traceId: string): Promise<TraceDetail | undefined> {
    const agents = await this.accessibleAgents();
    if (!agents.size) return undefined;
    const run = await this.db.projectRunRecord.findFirst({
      where: {
        projectId: this.projectId,
        traceId,
        expertAgentId: { in: [...agents.keys()] },
      },
    });
    if (!run?.expertAgentId) return undefined;
    const agent = agents.get(run.expertAgentId);
    if (!agent) return undefined;
    const payload = storedTrace(run.expertTrace);
    const events = payload.trace ?? [];
    const rootId = `root-${run.id.slice(0, 24)}`;
    const root: TraceSpan = {
      spanId: rootId,
      name: payload.evaluationCaseId
        ? `${agent.name} evaluation · ${payload.evaluationCaseId}`
        : `${agent.name} ${run.expertAgentVersionId ?? "run"}`,
      type: agent.executionMode === "WORKFLOW" ? "workflow" : "agent",
      serviceName: "tali-expert-agent-runtime",
      agentName: agent.name,
      startOffsetMs: 0,
      durationMs: run.durationMs ?? 0,
      status: status(run),
      input: {
        triggerType: run.triggerType,
        ...(payload.evaluationSuiteId ? { evaluationSuiteId: payload.evaluationSuiteId } : {}),
        ...(payload.evaluationCaseId ? { evaluationCaseId: payload.evaluationCaseId } : {}),
      },
      output: {
        outcome: payload.outcome ?? run.status,
        citations: payload.citations?.length ?? 0,
      },
      attributes: {
        "gen_ai.agent.id": run.expertAgentId,
        "tali.agent.version_id": run.expertAgentVersionId ?? "unknown",
        "tali.agent.engine_version": run.expertEngineVersion ?? "unknown",
        ...(payload.candidateId ? { "tali.agent.candidate_id": payload.candidateId } : {}),
        ...(payload.candidateDigest ? { "tali.agent.candidate_digest": payload.candidateDigest } : {}),
      },
    };
    const spans = playbookSpans({ events, rootId, run, agentName: agent.name });
    return {
      ...this.summary(run, agent),
      source: "otel",
      spans: [root, ...spans],
    };
  }

  private async accessibleAgents(): Promise<Map<string, {
    name: string;
    executionMode: "AGENTIC" | "WORKFLOW";
  }>> {
    if (!this.relationScoped) {
      const agents = await this.db.expertAgentRecord.findMany({
        where: { projectId: this.projectId, deletedAt: null },
        select: { id: true, name: true, executionMode: true },
      });
      return new Map(agents.map(({ id, ...agent }) => [id, agent]));
    }
    const relations = await this.db.expertAgentMemberRecord.findMany({
      where: {
        projectId: this.projectId,
        userId: this.actorId,
        relation: { in: ["OWNER", "MAINTAINER"] },
        agent: { deletedAt: null },
      },
      include: { agent: { select: { name: true, executionMode: true } } },
    });
    return new Map(relations.map((relation) => [relation.agentId, relation.agent]));
  }

  private summary(
    run: ProjectRunRecord,
    agent: { name: string },
  ): TraceSummary {
    const payload = storedTrace(run.expertTrace);
    return {
      traceId: run.traceId!,
      flowId: run.externalRunId,
      title: payload.evaluationCaseId
        ? `${agent.name} · ${payload.evaluationCaseId}`
        : `${agent.name} run`,
      rootAgentName: agent.name,
      startTime: run.startedAt.toISOString(),
      durationMs: run.durationMs ?? 0,
      status: status(run),
      spanCount: 1 + (payload.trace?.length ?? 0),
      agentCount: 1,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      coveragePercent: payload.trace?.length ? 100 : 20,
      scores: [],
    };
  }
}
