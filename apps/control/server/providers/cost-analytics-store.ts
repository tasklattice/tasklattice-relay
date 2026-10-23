import type { CostGroupBy } from "@tali/contracts";
import type { PrismaClient } from "../generated/prisma/client";
import type { Prisma } from "../generated/prisma/client";

export interface CostAttributionMapping {
  workId?: string;
  workName?: string;
  taskId?: string;
  taskName?: string;
  workRunId?: string;

  id: string;
  projectId: string;
  instanceId: string;
  instanceName: string;
  liteLLMVirtualKeyId?: string;
  hashedToken?: string;
  virtualKeyAlias: string;
  liteLLMUserId?: string;
  liteLLMTeamId?: string;
  providerAccountId?: string;
  validFrom: string;
  validTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelEndpointCostMapping {
  id: string;
  modelEndpointId: string;
  modelEndpointName: string;
  liteLLMModelName?: string;
  liteLLMModelGroup?: string;
  liteLLMModelId?: string;
  provider: string;
  providerAccountId: string;
  providerAccountName: string;
  validFrom: string;
  validTo?: string;
  createdAt: string;
  updatedAt: string;
}

export type CostStatus = "known" | "unknown";

export interface ModelUsageFact {
  workId?: string;
  workName?: string;
  taskId?: string;
  taskName?: string;
  workRunId?: string;

  eventId: string;
  requestId: string;
  requestStartTime: string;
  firstTokenTime?: string;
  responseEndTime?: string;
  usageDate: string;
  usageHour: number;
  projectId: string;
  instanceId?: string;
  instanceName?: string;
  modelEndpointId?: string;
  modelEndpointName?: string;
  providerAccountId?: string;
  providerAccountName?: string;
  virtualKeyId?: string;
  virtualKeyAlias?: string;
  liteLLMUserId?: string;
  liteLLMTeamId?: string;
  organizationId?: string;
  endUserId?: string;
  runId?: string;
  traceId?: string;
  requestedModel: string;
  resolvedModel: string;
  modelGroup: string;
  provider: string;
  callType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningTokens: number;
  promptCostUsd?: number;
  completionCostUsd?: number;
  totalCostUsd?: number;
  providerReportedCostUsd?: number;
  liteLLMCalculatedCostUsd?: number;
  costStatus: CostStatus;
  costSource: string;
  priceVersion: string;
  requestCount: 1;
  successCount: 0 | 1;
  failureCount: 0 | 1;
  latencyMs?: number;
  timeToFirstTokenMs?: number;
  httpStatusCode?: number;
  errorType?: string;
  retryCount: number;
  cacheHit: boolean;
  fallbackUsed: boolean;
  status: string;
  tags: string[];
  metadata: Record<string, unknown>;
  sourceRecordHash: string;
  correctionOfEventId?: string;
  createdAt: string;
}

export interface ModelUsageDailyRow {
  usageDate: string;
  timezone: string;
  projectId: string;
  groupType: CostGroupBy;
  groupId: string;
  groupName: string;
  spendUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  activeObjectCount: number;
  firstRequestAt: string;
  lastRequestAt: string;
}

export interface CostSyncCheckpoint {
  source: string;
  cursor?: string;
  lastSuccessfulEndTime?: string;
  lastSyncAt?: string;
  syncLagSeconds?: number;
  processedRecords: number;
  failedRecords: number;
  duplicateRecords: number;
  lateArrivingRecords: number;
  sourceSpendUsd: number;
}

type FactQuery = {
  startTime: string;
  endTime: string;
  projectId: string;
};

function iso(value: Date): string {
  return value.toISOString();
}

function defined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

export class CostAnalyticsStore {
  constructor(
    private readonly db: PrismaClient,
    readonly projectId: string,
  ) {}

  async saveAttribution(mapping: CostAttributionMapping): Promise<void> {
    await this.db.costAttributionMappingRecord.upsert({
      where: { projectId_id: { projectId: this.projectId, id: mapping.id } },
      create: defined({
        projectId: this.projectId,
        id: mapping.id,
        workId: mapping.workId,
        workName: mapping.workName,
        taskId: mapping.taskId,
        taskName: mapping.taskName,
        workRunId: mapping.workRunId,
        instanceId: mapping.instanceId,
        instanceName: mapping.instanceName,
        liteLLMVirtualKeyId: mapping.liteLLMVirtualKeyId,
        hashedToken: mapping.hashedToken,
        virtualKeyAlias: mapping.virtualKeyAlias,
        liteLLMUserId: mapping.liteLLMUserId,
        liteLLMTeamId: mapping.liteLLMTeamId,
        providerAccountId: mapping.providerAccountId,
        validFrom: mapping.validFrom,
        validTo: mapping.validTo,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt,
      }) as unknown as Prisma.CostAttributionMappingRecordUncheckedCreateInput,
      update: {
        instanceName: mapping.instanceName,
        validTo: mapping.validTo ?? null,
        updatedAt: mapping.updatedAt,
      },
    });
  }

  async saveModelEndpointMapping(mapping: ModelEndpointCostMapping): Promise<void> {
    await this.db.modelEndpointMappingRecord.upsert({
      where: { projectId_id: { projectId: this.projectId, id: mapping.id } },
      create: defined({
        projectId: this.projectId,
        id: mapping.id,
        modelEndpointId: mapping.modelEndpointId,
        modelEndpointName: mapping.modelEndpointName,
        liteLLMModelName: mapping.liteLLMModelName,
        liteLLMModelGroup: mapping.liteLLMModelGroup,
        liteLLMModelId: mapping.liteLLMModelId,
        provider: mapping.provider,
        providerAccountId: mapping.providerAccountId,
        providerAccountName: mapping.providerAccountName,
        validFrom: mapping.validFrom,
        validTo: mapping.validTo,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt,
      }) as unknown as Prisma.ModelEndpointMappingRecordUncheckedCreateInput,
      update: {
        modelEndpointName: mapping.modelEndpointName,
        liteLLMModelName: mapping.liteLLMModelName ?? null,
        liteLLMModelGroup: mapping.liteLLMModelGroup ?? null,
        liteLLMModelId: mapping.liteLLMModelId ?? null,
        providerAccountName: mapping.providerAccountName,
        validTo: mapping.validTo ?? null,
        updatedAt: mapping.updatedAt,
      },
    });
  }

  async findAttribution(input: {
    virtualKeyId?: string;
    hashedToken?: string;
    userId?: string;
    teamId?: string;
    at: string;
  }): Promise<CostAttributionMapping | undefined> {
    const at = new Date(input.at);
    const candidates = [
      input.virtualKeyId ? { liteLLMVirtualKeyId: input.virtualKeyId } : undefined,
      input.hashedToken ? { hashedToken: input.hashedToken } : undefined,
      input.userId ? { liteLLMUserId: input.userId } : undefined,
      // A Team identifies a Project, never one of its concurrently active instances.
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!candidates.length) return undefined;
    const rows = await this.db.costAttributionMappingRecord.findMany({
      where: {
        projectId: this.projectId,
        ...(!input.virtualKeyId && !input.hashedToken ? { workRunId: null } : {}),
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gt: at } }],
        ...(input.teamId ? { liteLLMTeamId: input.teamId } : {}),
        AND: [{ OR: candidates }],
      },
      orderBy: { validFrom: "desc" },
      take: 2,
    });
    // Ambiguous identities are a data-quality issue, never permission to guess.
    if (rows.length !== 1) return undefined;
    const row = rows[0]!;
    return {
      id: row.id,
      projectId: row.projectId,
      ...(row.workId ? { workId: row.workId } : {}),
      ...(row.workName ? { workName: row.workName } : {}),
      ...(row.taskId ? { taskId: row.taskId } : {}),
      ...(row.taskName ? { taskName: row.taskName } : {}),
      ...(row.workRunId ? { workRunId: row.workRunId } : {}),

      instanceId: row.instanceId,
      instanceName: row.instanceName,
      ...(row.liteLLMVirtualKeyId ? { liteLLMVirtualKeyId: row.liteLLMVirtualKeyId } : {}),
      ...(row.hashedToken ? { hashedToken: row.hashedToken } : {}),
      virtualKeyAlias: row.virtualKeyAlias,
      ...(row.liteLLMUserId ? { liteLLMUserId: row.liteLLMUserId } : {}),
      ...(row.liteLLMTeamId ? { liteLLMTeamId: row.liteLLMTeamId } : {}),
      ...(row.providerAccountId ? { providerAccountId: row.providerAccountId } : {}),
      validFrom: iso(row.validFrom),
      ...(row.validTo ? { validTo: iso(row.validTo) } : {}),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  async findModelEndpoint(input: {
    modelName?: string;
    modelGroup?: string;
    modelId?: string;
    at: string;
  }): Promise<ModelEndpointCostMapping | undefined> {
    const candidates = [
      input.modelName ? { liteLLMModelName: input.modelName } : undefined,
      input.modelGroup ? { liteLLMModelGroup: input.modelGroup } : undefined,
      input.modelId ? { liteLLMModelId: input.modelId } : undefined,
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!candidates.length) return undefined;
    const at = new Date(input.at);
    const row = await this.db.modelEndpointMappingRecord.findFirst({
      where: {
        projectId: this.projectId,
        validFrom: { lte: at },
        OR: candidates,
        AND: [{ OR: [{ validTo: null }, { validTo: { gt: at } }] }],
      },
      orderBy: { validFrom: "desc" },
    });
    if (!row) return undefined;
    return {
      id: row.id,
      modelEndpointId: row.modelEndpointId,
      modelEndpointName: row.modelEndpointName,
      ...(row.liteLLMModelName ? { liteLLMModelName: row.liteLLMModelName } : {}),
      ...(row.liteLLMModelGroup ? { liteLLMModelGroup: row.liteLLMModelGroup } : {}),
      ...(row.liteLLMModelId ? { liteLLMModelId: row.liteLLMModelId } : {}),
      provider: row.provider,
      providerAccountId: row.providerAccountId,
      providerAccountName: row.providerAccountName,
      validFrom: iso(row.validFrom),
      ...(row.validTo ? { validTo: iso(row.validTo) } : {}),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  async insertFact(fact: ModelUsageFact): Promise<boolean> {
    if (fact.projectId !== this.projectId) {
      throw new Error(
        `Refusing to store usage for Project ${fact.projectId} in Project ${this.projectId}.`,
      );
    }
    try {
      await this.db.modelUsageFactRecord.create({
        data: defined({
          projectId: fact.projectId,
          eventId: fact.eventId,
          requestId: fact.requestId,
          requestStartTime: fact.requestStartTime,
          firstTokenTime: fact.firstTokenTime,
          responseEndTime: fact.responseEndTime,
          usageDate: new Date(`${fact.usageDate}T00:00:00.000Z`),
          usageHour: fact.usageHour,
          workId: fact.workId,
          workName: fact.workName,
          taskId: fact.taskId,
          taskName: fact.taskName,
          workRunId: fact.workRunId,
          instanceId: fact.instanceId,
          instanceName: fact.instanceName,
          modelEndpointId: fact.modelEndpointId,
          modelEndpointName: fact.modelEndpointName,
          providerAccountId: fact.providerAccountId,
          providerAccountName: fact.providerAccountName,
          virtualKeyId: fact.virtualKeyId,
          virtualKeyAlias: fact.virtualKeyAlias,
          liteLLMUserId: fact.liteLLMUserId,
          liteLLMTeamId: fact.liteLLMTeamId,
          organizationId: fact.organizationId,
          endUserId: fact.endUserId,
          runId: fact.runId,
          traceId: fact.traceId,
          requestedModel: fact.requestedModel,
          resolvedModel: fact.resolvedModel,
          modelGroup: fact.modelGroup,
          provider: fact.provider,
          callType: fact.callType,
          promptTokens: fact.promptTokens,
          completionTokens: fact.completionTokens,
          totalTokens: fact.totalTokens,
          cachedInputTokens: fact.cachedInputTokens,
          cacheCreationInputTokens: fact.cacheCreationInputTokens,
          reasoningTokens: fact.reasoningTokens,
          promptCostUsd: fact.promptCostUsd,
          completionCostUsd: fact.completionCostUsd,
          totalCostUsd: fact.totalCostUsd,
          providerReportedCostUsd: fact.providerReportedCostUsd,
          liteLLMCalculatedCostUsd: fact.liteLLMCalculatedCostUsd,
          costStatus: fact.costStatus,
          costSource: fact.costSource,
          priceVersion: fact.priceVersion,
          successCount: fact.successCount,
          failureCount: fact.failureCount,
          latencyMs: fact.latencyMs,
          timeToFirstTokenMs: fact.timeToFirstTokenMs,
          httpStatusCode: fact.httpStatusCode,
          errorType: fact.errorType,
          retryCount: fact.retryCount,
          cacheHit: fact.cacheHit,
          fallbackUsed: fact.fallbackUsed,
          status: fact.status,
          tags: fact.tags,
          metadata: fact.metadata as Prisma.InputJsonValue,
          sourceRecordHash: fact.sourceRecordHash,
          correctionOfEventId: fact.correctionOfEventId,
          createdAt: fact.createdAt,
        }) as unknown as Prisma.ModelUsageFactRecordUncheckedCreateInput,
      });
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        // A rolling upgrade or a delayed ledger can leave an existing request
        // without Work dimensions. Enrich only from the exact persisted key
        // mapping; never replace money, tokens, request identity or known scope.
        if (fact.workId && fact.workRunId && fact.virtualKeyId && fact.instanceId) {
          const enriched = await this.db.modelUsageFactRecord.updateMany({
            where: {
              projectId: this.projectId, requestId: fact.requestId,
              virtualKeyId: fact.virtualKeyId, workId: null, workRunId: null, taskId: null,
              OR: [{ instanceId: null }, { instanceId: fact.instanceId }],
            },
            data: {
              workId: fact.workId, workName: fact.workName ?? null,
              taskId: fact.taskId ?? null, taskName: fact.taskName ?? null,
              workRunId: fact.workRunId,
              instanceId: fact.instanceId, instanceName: fact.instanceName ?? null,
            },
          });
          if (enriched.count) await this.recordObservation({
            observationId: `work-attribution:${fact.requestId}:${fact.workRunId}`,
            requestId: fact.requestId, observedAt: new Date().toISOString(),
            reason: "work_attribution_enriched",
            payload: {workId: fact.workId, taskId: fact.taskId ?? null, workRunId: fact.workRunId, instanceId: fact.instanceId},
          });
        }
        return false;
      }
      throw error;
    }
  }

  async recordObservation(input: {
    observationId: string;
    requestId: string;
    observedAt: string;
    reason: string;
    payload: unknown;
  }): Promise<void> {
    await this.db.modelUsageFactObservation.upsert({
      where: {
        projectId_eventId: {
          projectId: this.projectId,
          eventId: input.observationId,
        },
      },
      create: {
        projectId: this.projectId,
        eventId: input.observationId,
        requestId: input.requestId,
        observedAt: input.observedAt,
        reason: input.reason,
        sourceRecordHash: input.observationId,
        payload: input.payload as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  async listFacts(query: FactQuery): Promise<ModelUsageFact[]> {
    const rows = await this.db.modelUsageFactRecord.findMany({
      where: {
        projectId: this.projectId,
        requestStartTime: { gte: new Date(query.startTime), lte: new Date(query.endTime) },
      },
      orderBy: [{ requestStartTime: "asc" }, { eventId: "asc" }],
    });
    return rows.map((row) => ({
      eventId: row.eventId,
      requestId: row.requestId,
      requestStartTime: iso(row.requestStartTime),
      ...(row.firstTokenTime ? { firstTokenTime: iso(row.firstTokenTime) } : {}),
      ...(row.responseEndTime ? { responseEndTime: iso(row.responseEndTime) } : {}),
      usageDate: iso(row.usageDate).slice(0, 10),
      usageHour: row.usageHour,
      projectId: row.projectId,
      ...(row.workId ? { workId: row.workId } : {}),
      ...(row.workName ? { workName: row.workName } : {}),
      ...(row.taskId ? { taskId: row.taskId } : {}),
      ...(row.taskName ? { taskName: row.taskName } : {}),
      ...(row.workRunId ? { workRunId: row.workRunId } : {}),

      ...(row.instanceId ? { instanceId: row.instanceId } : {}),
      ...(row.instanceName ? { instanceName: row.instanceName } : {}),
      ...(row.modelEndpointId ? { modelEndpointId: row.modelEndpointId } : {}),
      ...(row.modelEndpointName ? { modelEndpointName: row.modelEndpointName } : {}),
      ...(row.providerAccountId ? { providerAccountId: row.providerAccountId } : {}),
      ...(row.providerAccountName ? { providerAccountName: row.providerAccountName } : {}),
      ...(row.virtualKeyId ? { virtualKeyId: row.virtualKeyId } : {}),
      ...(row.virtualKeyAlias ? { virtualKeyAlias: row.virtualKeyAlias } : {}),
      ...(row.liteLLMUserId ? { liteLLMUserId: row.liteLLMUserId } : {}),
      ...(row.liteLLMTeamId ? { liteLLMTeamId: row.liteLLMTeamId } : {}),
      ...(row.organizationId ? { organizationId: row.organizationId } : {}),
      ...(row.endUserId ? { endUserId: row.endUserId } : {}),
      ...(row.runId ? { runId: row.runId } : {}),
      ...(row.traceId ? { traceId: row.traceId } : {}),
      requestedModel: row.requestedModel,
      resolvedModel: row.resolvedModel,
      modelGroup: row.modelGroup,
      provider: row.provider,
      callType: row.callType,
      promptTokens: Number(row.promptTokens),
      completionTokens: Number(row.completionTokens),
      totalTokens: Number(row.totalTokens),
      cachedInputTokens: Number(row.cachedInputTokens),
      cacheCreationInputTokens: Number(row.cacheCreationInputTokens),
      reasoningTokens: Number(row.reasoningTokens),
      ...(row.promptCostUsd !== null ? { promptCostUsd: Number(row.promptCostUsd) } : {}),
      ...(row.completionCostUsd !== null ? { completionCostUsd: Number(row.completionCostUsd) } : {}),
      ...(row.totalCostUsd !== null ? { totalCostUsd: Number(row.totalCostUsd) } : {}),
      ...(row.providerReportedCostUsd !== null ? { providerReportedCostUsd: Number(row.providerReportedCostUsd) } : {}),
      ...(row.liteLLMCalculatedCostUsd !== null ? { liteLLMCalculatedCostUsd: Number(row.liteLLMCalculatedCostUsd) } : {}),
      costStatus: row.costStatus === "known" ? "known" : "unknown",
      costSource: row.costSource,
      priceVersion: row.priceVersion,
      requestCount: 1,
      successCount: row.successCount ? 1 : 0,
      failureCount: row.failureCount ? 1 : 0,
      ...(row.latencyMs !== null ? { latencyMs: row.latencyMs } : {}),
      ...(row.timeToFirstTokenMs !== null ? { timeToFirstTokenMs: row.timeToFirstTokenMs } : {}),
      ...(row.httpStatusCode !== null ? { httpStatusCode: row.httpStatusCode } : {}),
      ...(row.errorType ? { errorType: row.errorType } : {}),
      retryCount: row.retryCount,
      cacheHit: row.cacheHit,
      fallbackUsed: row.fallbackUsed,
      status: row.status,
      tags: row.tags as string[],
      metadata: row.metadata as Record<string, unknown>,
      sourceRecordHash: row.sourceRecordHash,
      ...(row.correctionOfEventId ? { correctionOfEventId: row.correctionOfEventId } : {}),
      createdAt: iso(row.createdAt),
    }));
  }

  async replaceDailyRows(input: {
    projectId: string;
    timezone: string;
    from: string;
    to: string;
    rows: ModelUsageDailyRow[];
  }): Promise<void> {
    await this.db.$transaction(async (transaction) => {
      await transaction.modelUsageDailyRecord.deleteMany({
        where: {
          projectId: this.projectId,
          timezone: input.timezone,
          usageDate: {
            gte: new Date(`${input.from}T00:00:00.000Z`),
            lte: new Date(`${input.to}T00:00:00.000Z`),
          },
        },
      });
      if (input.rows.length) {
        await transaction.modelUsageDailyRecord.createMany({
          data: input.rows.map((row) => ({
            projectId: this.projectId,
            usageDate: new Date(`${row.usageDate}T00:00:00.000Z`),
            timezone: row.timezone,
            groupType: row.groupType,
            groupId: row.groupId,
            groupName: row.groupName,
            spendUsd: row.spendUsd,
            promptTokens: row.promptTokens,
            completionTokens: row.completionTokens,
            totalTokens: row.totalTokens,
            requests: row.requests,
            successfulRequests: row.successfulRequests,
            failedRequests: row.failedRequests,
            activeObjectCount: row.activeObjectCount,
            firstRequestAt: row.firstRequestAt,
            lastRequestAt: row.lastRequestAt,
          })),
        });
      }
    });
  }

  async listDailyRows(input: {
    projectId: string;
    timezone: string;
    from: string;
    to: string;
    groupType: CostGroupBy;
  }): Promise<ModelUsageDailyRow[]> {
    const rows = await this.db.modelUsageDailyRecord.findMany({
      where: {
        projectId: this.projectId,
        timezone: input.timezone,
        groupType: input.groupType,
        usageDate: {
          gte: new Date(`${input.from}T00:00:00.000Z`),
          lte: new Date(`${input.to}T00:00:00.000Z`),
        },
      },
      orderBy: [{ usageDate: "asc" }, { spendUsd: "desc" }],
    });
    return rows.map((row) => ({
      usageDate: iso(row.usageDate).slice(0, 10),
      timezone: row.timezone,
      projectId: row.projectId,

      groupType: row.groupType as CostGroupBy,
      groupId: row.groupId,
      groupName: row.groupName,
      spendUsd: Number(row.spendUsd),
      promptTokens: Number(row.promptTokens),
      completionTokens: Number(row.completionTokens),
      totalTokens: Number(row.totalTokens),
      requests: Number(row.requests),
      successfulRequests: Number(row.successfulRequests),
      failedRequests: Number(row.failedRequests),
      activeObjectCount: row.activeObjectCount,
      firstRequestAt: iso(row.firstRequestAt),
      lastRequestAt: iso(row.lastRequestAt),
    }));
  }

  async checkpoint(source = "litellm"): Promise<CostSyncCheckpoint> {
    const row = await this.db.costSyncCheckpointRecord.findUnique({
      where: { projectId_source: { projectId: this.projectId, source } },
    });
    return {
      source,
      ...(row?.cursor ? { cursor: row.cursor } : {}),
      ...(row?.lastSuccessfulEndTime ? { lastSuccessfulEndTime: iso(row.lastSuccessfulEndTime) } : {}),
      ...(row?.lastSyncAt ? { lastSyncAt: iso(row.lastSyncAt) } : {}),
      ...(row?.syncLagSeconds !== null && row?.syncLagSeconds !== undefined ? { syncLagSeconds: row.syncLagSeconds } : {}),
      processedRecords: Number(row?.processedRecords ?? 0),
      failedRecords: Number(row?.failedRecords ?? 0),
      duplicateRecords: Number(row?.duplicateRecords ?? 0),
      lateArrivingRecords: Number(row?.lateArrivingRecords ?? 0),
      sourceSpendUsd: Number(row?.sourceSpendUsd ?? 0),
    };
  }

  async saveCheckpoint(checkpoint: CostSyncCheckpoint): Promise<void> {
    const data = defined({
      cursor: checkpoint.cursor,
      lastSuccessfulEndTime: checkpoint.lastSuccessfulEndTime,
      lastSyncAt: checkpoint.lastSyncAt,
      syncLagSeconds: checkpoint.syncLagSeconds,
      processedRecords: checkpoint.processedRecords,
      failedRecords: checkpoint.failedRecords,
      duplicateRecords: checkpoint.duplicateRecords,
      lateArrivingRecords: checkpoint.lateArrivingRecords,
      sourceSpendUsd: checkpoint.sourceSpendUsd,
    }) as Prisma.CostSyncCheckpointRecordUncheckedUpdateInput;
    await this.db.costSyncCheckpointRecord.upsert({
      where: { projectId_source: { projectId: this.projectId, source: checkpoint.source } },
      create: { projectId: this.projectId, source: checkpoint.source, ...data } as Prisma.CostSyncCheckpointRecordUncheckedCreateInput,
      update: data,
    });
  }

  async countDuplicateRequests(): Promise<number> {
    const rows = await this.db.modelUsageFactObservation.findMany({
      where: { projectId: this.projectId, reason: "duplicate_request_id" },
      distinct: ["requestId"],
      select: { requestId: true },
    });
    return rows.length;
  }
}
