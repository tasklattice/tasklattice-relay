import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import type { ProjectRuntimeExpertAgentIdentity } from "./project-runtime-bridge-token";

const code = z.string().trim().min(1).max(80).regex(/^[A-Z][A-Z0-9_]*$/);
export const expertAgentRunTelemetrySchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("started"),
    runId: z.string().trim().min(1).max(240),
    occurredAt: z.string().datetime({ offset: true }),
    traceId: z.string().trim().min(1).max(128).optional(),
  }).strict(),
  z.object({
    event: z.literal("finished"),
    runId: z.string().trim().min(1).max(240),
    occurredAt: z.string().datetime({ offset: true }),
    durationMs: z.number().int().min(0).max(7 * 24 * 60 * 60 * 1_000),
    status: z.enum(["SUCCEEDED", "FAILED"]),
    errorCategory: code.optional(),
    traceId: z.string().trim().min(1).max(128).optional(),
    outcome: z.enum([
      "COMPLETED",
      "NEED_MORE_INFORMATION",
      "UNKNOWN",
      "ESCALATED",
      "REJECTED",
      "FAILED",
    ]).optional(),
    trace: z.array(z.object({
      step: z.string().trim().min(1).max(240),
      status: z.enum(["STARTED", "COMPLETED", "FAILED", "SKIPPED"]),
      summary: z.string().max(4_000),
      occurredAt: z.string().datetime({ offset: true }),
      attributes: z.record(z.string(), z.union([
        z.boolean(), z.number(), z.string(), z.null(),
      ])),
    }).strict()).max(2_000).optional(),
    citations: z.array(z.object({
      sourceId: z.string().max(500),
      title: z.string().max(1_000),
      uri: z.string().nullable(),
      excerpt: z.string().nullable(),
      // Optional during a rolling Control/Runtime upgrade; newly built Runtime
      // images always emit it, and support acceptance requires a non-empty value.
      revision: z.string().max(500).nullable().optional(),
    }).strict()).max(500).optional(),
  }).strict(),
]);

export class ExpertAgentRunTelemetryService {
  constructor(
    private readonly identity: ProjectRuntimeExpertAgentIdentity,
    private readonly db: PrismaClient = prisma(),
  ) {}

  async ingest(raw: unknown): Promise<void> {
    const event = expertAgentRunTelemetrySchema.parse(raw);
    const id = createHash("sha256")
      .update([
        this.identity.agentId,
        this.identity.versionId,
        event.runId,
      ].join("\0"))
      .digest("hex");
    const traceId = id.slice(0, 32);
    const version = await this.db.expertAgentVersionRecord.findFirst({
      where: {
        projectId: this.identity.projectId,
        id: this.identity.versionId,
        agentId: this.identity.agentId,
        contentDigest: this.identity.contentDigest,
      },
    });
    if (!version) throw new Error("Expert Agent telemetry Version was not found.");
    const snapshot = version.snapshot as {
      execution?: { engine?: { version?: unknown } };
    };
    const engineVersion = typeof snapshot.execution?.engine?.version === "string"
      ? snapshot.execution.engine.version
      : "unknown";
    const occurredAt = new Date(event.occurredAt);
    await this.db.$transaction(async (transaction) => {
      const current = await transaction.projectRunRecord.findUnique({
        where: {
          projectId_id: { projectId: this.identity.projectId, id },
        },
      });
      if (event.event === "started") {
        if (current) return;
        await transaction.projectRunRecord.create({
          data: {
            projectId: this.identity.projectId,
            id,
            instanceId: this.identity.agentId,
            agentPlatform: "expert-agent",
            source: "expert-agent",
            externalRunId: event.runId,
            triggerType: "API",
            status: "RUNNING",
            traceId,
            startedAt: occurredAt,
            expertAgentId: this.identity.agentId,
            expertAgentVersionId: this.identity.versionId,
            expertEngineVersion: engineVersion,
          },
        });
        return;
      }
      if (current && current.status !== "RUNNING") return;
      const startedAt = current?.startedAt
        ?? new Date(occurredAt.getTime() - event.durationMs);
      const terminal = {
        status: event.status,
        endedAt: occurredAt,
        durationMs: event.durationMs,
        traceId,
        expertTrace: {
          outcome: event.outcome ?? event.status,
          trace: event.trace ?? [],
          citations: event.citations ?? [],
        } as Prisma.InputJsonValue,
        ...(event.errorCategory ? {
          errorCategory: event.errorCategory,
          terminalReason: event.errorCategory,
        } : {}),
      };
      if (current) {
        await transaction.projectRunRecord.update({
          where: {
            projectId_id: { projectId: this.identity.projectId, id },
          },
          data: terminal,
        });
      } else {
        await transaction.projectRunRecord.create({
          data: {
            projectId: this.identity.projectId,
            id,
            instanceId: this.identity.agentId,
            agentPlatform: "expert-agent",
            source: "expert-agent",
            externalRunId: event.runId,
            triggerType: "API",
            startedAt,
            expertAgentId: this.identity.agentId,
            expertAgentVersionId: this.identity.versionId,
            expertEngineVersion: engineVersion,
            ...terminal,
          },
        });
      }
    });
  }
}
