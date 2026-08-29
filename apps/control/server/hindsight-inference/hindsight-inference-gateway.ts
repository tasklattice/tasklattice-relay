import { randomUUID } from "node:crypto";
import type { ModelDeployment, ModelRouting } from "@tali/contracts";
import { prisma } from "../db/prisma";
import { LiteLLMClient } from "../providers/litellm-client";
import { ProjectStore } from "../projects/project-store";
import { ProjectQuotaService } from "../quotas/project-quota-service";
import type { HindsightInferenceKind } from "../hindsight-router/hindsight-bootstrap-router";

export interface HindsightInferenceRequest {
  bankId: string;
  body: Record<string, unknown>;
  kind: HindsightInferenceKind;
}

interface ProjectTarget {
  aliases?: Record<string, string>;
  model: string;
  routerSettings?: {
    num_retries?: number;
    fallbacks?: Array<Record<string, string[]>>;
  };
  sourceId: string;
  sourceKind: "MODEL" | "ROUTING";
}

interface ProjectKey {
  baseUrl: string;
  expiresAt: number;
  secret: string;
}

interface HindsightInferenceGatewayDependencies {
  fetch: typeof fetch;
  inventory(projectId: string): Promise<{
    models: ModelDeployment[];
    routings: ModelRouting[];
  }>;
  issueProjectKey(projectId: string, target: ProjectTarget): Promise<{
    baseUrl: string;
    secret: string;
  }>;
  now(): number;
  resolveProjectId(bankId: string): Promise<string | undefined>;
}

export class HindsightProjectInferenceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HindsightProjectInferenceError";
  }
}

function validatedModels(models: ModelDeployment[], modelType: ModelDeployment["modelType"]): ModelDeployment[] {
  return models.filter((model) => model.modelType === modelType && model.status === "VALIDATED");
}

function defaultModel(
  candidates: ModelDeployment[],
  slot: "CHAT" | "EMBEDDING",
): ModelDeployment | undefined {
  const defaults = candidates.filter((model) => model.origin?.projectDefault?.slot === slot);
  if (defaults.length > 1) {
    throw new HindsightProjectInferenceError(
      `Project has multiple default ${slot.toLowerCase()} Models.`,
      "ambiguous_project_model",
      409,
    );
  }
  return defaults[0];
}

export function resolveHindsightEmbeddingTarget(models: ModelDeployment[]): ProjectTarget {
  const candidates = validatedModels(models, "text-embedding");
  const selected = defaultModel(candidates, "EMBEDDING") ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!selected) {
    throw new HindsightProjectInferenceError(
      candidates.length
        ? "Project has multiple validated embedding Models but no default embedding Model."
        : "Project Durable Memory requires a validated embedding Model.",
      candidates.length ? "ambiguous_project_model" : "embedding_model_required",
      409,
    );
  }
  return { model: selected.litellmModelName, sourceId: selected.id, sourceKind: "MODEL" };
}

export function resolveHindsightChatTarget(
  models: ModelDeployment[],
  routings: ModelRouting[],
): ProjectTarget {
  const defaultRoutings = routings.filter((routing) => routing.isDefault && routing.status === "READY");
  if (defaultRoutings.length > 1) {
    throw new HindsightProjectInferenceError(
      "Project has multiple READY default Routing configurations.",
      "ambiguous_project_routing",
      409,
    );
  }
  const routing = defaultRoutings[0];
  if (routing) {
    if (routing.routingPolicy.mode !== "SINGLE") {
      return { model: routing.publicModelAlias, sourceId: routing.id, sourceKind: "ROUTING" };
    }
    const deploymentIds = [
      routing.routingPolicy.modelDeploymentId,
      ...routing.routingPolicy.fallbackModelDeploymentIds,
    ];
    const deployments = deploymentIds.map((id) => models.find((model) => model.id === id));
    const unavailableIndex = deployments.findIndex((deployment) => !deployment || deployment.status !== "VALIDATED");
    if (unavailableIndex >= 0) {
      throw new HindsightProjectInferenceError(
        `Project default Routing ${unavailableIndex === 0 ? "primary" : `fallback ${unavailableIndex}`} Model is unavailable.`,
        "project_routing_model_unavailable",
        409,
      );
    }
    const primary = deployments[0]!;
    const fallbackModels = deployments.slice(1).map((deployment) => deployment!.litellmModelName);
    return {
      aliases: { [routing.publicModelAlias]: primary.litellmModelName },
      model: routing.publicModelAlias,
      routerSettings: {
        num_retries: routing.routingPolicy.retries,
        ...(fallbackModels.length
          ? { fallbacks: [{ [primary.litellmModelName]: fallbackModels }] }
          : {}),
      },
      sourceId: routing.id,
      sourceKind: "ROUTING",
    };
  }
  const candidates = validatedModels(models, "llm");
  const selected = defaultModel(candidates, "CHAT") ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!selected) {
    throw new HindsightProjectInferenceError(
      candidates.length
        ? "Project has multiple validated chat Models but no default Routing or chat Model."
        : "Project Hindsight extraction requires a READY default Routing or validated chat Model.",
      candidates.length ? "ambiguous_project_model" : "chat_model_required",
      409,
    );
  }
  return { model: selected.litellmModelName, sourceId: selected.id, sourceKind: "MODEL" };
}

function embeddingDimension(responseBody: unknown): number | undefined {
  if (!responseBody || typeof responseBody !== "object") return undefined;
  const data = (responseBody as { data?: unknown }).data;
  if (!Array.isArray(data) || !data.length) return undefined;
  const embedding = (data[0] as { embedding?: unknown } | undefined)?.embedding;
  if (Array.isArray(embedding)) return embedding.length;
  if (typeof embedding !== "string" || !embedding.length) return undefined;
  const bytes = Buffer.from(embedding, "base64");
  return bytes.length > 0 && bytes.length % Float32Array.BYTES_PER_ELEMENT === 0
    ? bytes.length / Float32Array.BYTES_PER_ELEMENT
    : undefined;
}

export function hindsightProjectKeyAlias(projectId: string, target: ProjectTarget): string {
  const source = `${target.sourceKind.toLowerCase()}-${target.sourceId}`;
  return `tali-hindsight-${projectId.slice(0, 64)}-${source.slice(0, 96)}-${randomUUID()}`;
}

function defaultDependencies(): HindsightInferenceGatewayDependencies {
  const litellm = new LiteLLMClient();
  return {
    fetch,
    now: Date.now,
    async resolveProjectId(bankId) {
      return (await prisma().memoryRecord.findFirst({
        where: { provider: "hindsight", providerRef: bankId, deletedAt: null },
        select: { projectId: true },
      }))?.projectId;
    },
    async inventory(projectId) {
      const store = new ProjectStore(projectId);
      const [models, routings] = await Promise.all([
        store.listModelDeployments(),
        store.listModelRoutings(),
      ]);
      return { models, routings };
    },
    async issueProjectKey(projectId, target) {
      const store = new ProjectStore(projectId);
      const quotas = new ProjectQuotaService(store, litellm);
      await quotas.sync();
      const { key } = await quotas.createInstanceKey({
        alias: hindsightProjectKeyAlias(projectId, target),
        duration: "1h",
        models: [target.model],
        ...(target.aliases ? { aliases: target.aliases } : {}),
        ...(target.routerSettings ? { routerSettings: target.routerSettings } : {}),
        metadata: {
          managed_by: "tali",
          tali_feature: "hindsight",
          tali_project_id: projectId,
          tali_source_id: target.sourceId,
          tali_source_kind: target.sourceKind,
        },
        objectPermissions: { mcpServers: [] },
      });
      return { baseUrl: await litellm.connectionBaseUrl(), secret: key.secret };
    },
  };
}

export class HindsightInferenceGateway {
  private readonly keys = new Map<string, Promise<ProjectKey>>();

  constructor(
    private readonly embeddingDimensions: number,
    private readonly dependencies: HindsightInferenceGatewayDependencies = defaultDependencies(),
  ) {}

  async infer(input: HindsightInferenceRequest): Promise<Response> {
    const projectId = await this.dependencies.resolveProjectId(input.bankId);
    if (!projectId) {
      throw new HindsightProjectInferenceError(
        "Hindsight Bank is not bound to an active Project Memory.",
        "hindsight_bank_not_found",
        404,
      );
    }
    if (input.kind === "rerank") {
      throw new HindsightProjectInferenceError(
        "Remote Hindsight reranking is disabled; the shared service uses RRF.",
        "remote_reranker_disabled",
        409,
      );
    }
    const { models, routings } = await this.dependencies.inventory(projectId);
    const target = input.kind === "embeddings"
      ? resolveHindsightEmbeddingTarget(models)
      : resolveHindsightChatTarget(models, routings);
    const projectKey = await this.projectKey(projectId, target);
    const upstream = await this.dependencies.fetch(
      `${projectKey.baseUrl.replace(/\/+$/, "")}/${input.kind === "chat" ? "chat/completions" : "embeddings"}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${projectKey.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...input.body, model: target.model, user: input.bankId }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    const responseText = await upstream.text();
    if (input.kind === "embeddings" && upstream.ok) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        parsed = undefined;
      }
      const actualDimensions = embeddingDimension(parsed);
      if (actualDimensions !== this.embeddingDimensions) {
        throw new HindsightProjectInferenceError(
          `Project embedding Model returned ${actualDimensions ?? "an invalid"} dimensions; Hindsight requires ${this.embeddingDimensions}.`,
          "embedding_dimension_mismatch",
          409,
        );
      }
    }
    return new Response(responseText, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  }

  private async projectKey(projectId: string, target: ProjectTarget): Promise<ProjectKey> {
    const cacheKey = `${projectId}:${target.sourceKind}:${target.sourceId}:${target.model}:${JSON.stringify({
      aliases: target.aliases,
      routerSettings: target.routerSettings,
    })}`;
    const cached = this.keys.get(cacheKey);
    if (cached) {
      const key = await cached;
      if (key.expiresAt > this.dependencies.now()) return key;
      this.keys.delete(cacheKey);
    }
    const pending = this.dependencies.issueProjectKey(projectId, target).then((key) => ({
      ...key,
      expiresAt: this.dependencies.now() + 50 * 60 * 1_000,
    }));
    this.keys.set(cacheKey, pending);
    try {
      return await pending;
    } catch (error) {
      this.keys.delete(cacheKey);
      throw error;
    }
  }
}
