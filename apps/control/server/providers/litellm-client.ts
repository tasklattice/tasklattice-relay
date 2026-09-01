import { createHash } from "node:crypto";
import type {
  ComplianceDomain,
  McpToolDefinition,
  ModelRoutingCapabilities,
  ModelType,
  ProviderKind,
  ProviderModelSelection,
} from "@tali/contracts";
import { complianceDomains } from "@tali/contracts";
import { z } from "zod";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";

interface LiteLLMVirtualKeyResponse {
  key: string;
  token?: string;
}

export interface LiteLLMVirtualKey {
  secret: string;
  tokenId: string;
}

export interface LiteLLMSpendLog {
  api_key?: string;
  api_key_id?: string;
  hashed_token?: string;
  virtual_key_alias?: string;
  end_user?: string;
  end_user_id?: string;
  user?: string;
  user_id?: string;
  team_id?: string;
  organization_id?: string;
  request_tags?: string[];
  metadata?: Record<string, unknown>;
  requested_model?: string;
  resolved_model?: string;
  model?: string;
  model_group?: string;
  model_id?: string;
  deployment_id?: string;
  provider?: string;
  api_base?: string;
  call_type?: string;
  spend?: number;
  prompt_cost?: number;
  completion_cost?: number;
  provider_reported_cost?: number;
  litellm_calculated_cost?: number;
  currency?: string;
  cost_source?: string;
  price_version?: string;
  startTime?: string;
  start_time?: string;
  request_start_time?: string;
  first_token_time?: string;
  end_time?: string;
  response_end_time?: string;
  latency_ms?: number;
  time_to_first_token_ms?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cached_input_tokens?: number;
  cache_creation_input_tokens?: number;
  reasoning_tokens?: number;
  request_id?: string;
  status?: string;
  http_status_code?: number;
  error_type?: string;
  retry_count?: number;
  cache_hit?: boolean;
  fallback_used?: boolean;
}

export interface LiteLLMModelRoutingInspection {
  exists: boolean;
  version?: string;
  modelCount: number;
  complianceDomains: ComplianceDomain[];
  complianceUnknown: boolean;
  capabilities: ModelRoutingCapabilities;
  configurationHash: string;
  unsupportedReason?: string;
}

interface LiteLLMModelRoutingRouteBase {
  alias: string;
  modelRoutingId: string;
  complianceDomain: ComplianceDomain;
  defaultModel: string;
  fallbackModels: string[];
  retries: number;
  requestAudit: boolean;
}

export type LiteLLMModelRoutingRouteInput =
  | LiteLLMModelRoutingRouteBase & {
      strategy: "SINGLE";
    }
  | LiteLLMModelRoutingRouteBase & {
      strategy: "COMPLEXITY";
      tiers: {
        SIMPLE: string;
        MEDIUM: string;
        COMPLEX: string;
        REASONING: string;
      };
    }
  | LiteLLMModelRoutingRouteBase & {
      strategy: "SEMANTIC";
      embeddingModel: string;
      routes: Array<{
        intent: string;
        description: string;
        model: string;
        utterances: string[];
        scoreThreshold: number;
      }>;
    };

export interface LiteLLMModelRoutingIdentity {
  alias: string;
  modelAlias: string;
  modelRoutingId: string;
  complianceDomain: ComplianceDomain;
}

export interface LiteLLMModelRoutingKeyInput extends LiteLLMModelRoutingIdentity {
  agentId: string;
  teamId: string;
}

export interface LiteLLMProjectQuotaInput {
  maxBudget?: number;
  budgetDuration?: string;
  tpmLimit?: number;
}

export interface LiteLLMObjectPermissions {
  mcpServers: string[];
  mcpAccessGroups?: string[];
  mcpToolPermissions?: Record<string, string[]>;
  vectorStores?: string[];
}

export interface LiteLLMInstanceServiceAccountInput {
  alias: string;
  duration?: string;
  teamId: string;
  models: string[];
  aliases?: Record<string, string>;
  routerSettings?: {
    num_retries?: number;
    fallbacks?: Array<Record<string, string[]>>;
  };
  metadata: Record<string, string>;
  objectPermissions: LiteLLMObjectPermissions;
}

export interface LiteLLMMcpServerInput {
  serverId: string;
  serverName: string;
  alias: string;
  description: string;
  transport: "http" | "sse" | "stdio";
  authType?: "none" | "bearer_token" | "api_key" | "basic" | "authorization" | "oauth2" | "aws_sigv4";
  credential?: string;
  url?: string;
  specPath?: string;
  sourceUrl?: string;
  accessGroups: string[];
  allowedTools: string[];
  extraHeaders: string[];
  staticHeaders: Record<string, string>;
  command?: string;
  args: string[];
  environment: Record<string, string>;
  authorizationUrl?: string;
  tokenUrl?: string;
  registrationUrl?: string;
  oauth2Flow?: "client_credentials" | "authorization_code";
  availableOnPublicInternet: boolean;
}

export interface LiteLLMVectorStoreInput {
  vectorStoreId: string;
  provider: "openai" | "azure" | "bedrock" | "vertex_ai" | "pg_vector";
  name: string;
  description: string;
  metadata: Record<string, string | number | boolean>;
  litellmParams: Record<string, unknown>;
}

export interface LiteLLMStructuredCompletionInput {
  model: string;
  system: string;
  user: string;
  responseJsonSchema: Record<string, unknown>;
  temperature: number;
  maxTokens?: number;
}

export interface LiteLLMAdminClient {
  readonly baseUrl: string;
  connectionBaseUrl?(): Promise<string>;
  registerModel(input: {
    accountId: string;
    providerKind: ProviderKind;
    model: ProviderModelSelection;
    litellmParams: Record<string, unknown>;
    complianceDomain: ComplianceDomain;
    endpointRegion: string;
  }): Promise<string>;
  deleteModel(modelName: string): Promise<void>;
  probeModel(modelName: string, modelType: ModelType): Promise<void>;
  createInstanceKey(input: { agentId: string; alias: string; modelName: string }): Promise<LiteLLMVirtualKey>;
  blockKey(tokenId: string): Promise<void>;
  revokeKey(tokenId: string): Promise<void>;
  listSpendLogs(from: string, to: string, teamId?: string): Promise<LiteLLMSpendLog[]>;
  inspectModelRouting?(modelAlias: string): Promise<LiteLLMModelRoutingInspection>;
  reconcileModelRoutingRoute?(input: LiteLLMModelRoutingRouteInput): Promise<void>;
  deleteModelRoutingRoute?(alias: string, modelRoutingId: string): Promise<void>;
  createModelRoutingTeam?(input: LiteLLMModelRoutingIdentity): Promise<string>;
  deleteModelRoutingTeam?(teamId: string): Promise<void>;
  createModelRoutingKey?(input: LiteLLMModelRoutingKeyInput): Promise<LiteLLMVirtualKey>;
  ensureProjectTeam?(alias: string, metadata: Record<string, string>): Promise<string>;
  updateProjectTeam?(teamId: string, input: LiteLLMProjectQuotaInput): Promise<void>;
  updateProjectObjectPermissions?(teamId: string, input: LiteLLMObjectPermissions): Promise<void>;
  addProjectTeamMember?(teamId: string, member: { userId: string; email: string; role: "admin" | "user" }): Promise<void>;
  removeProjectTeamMember?(teamId: string, userId: string): Promise<void>;
  deleteProjectTeam?(teamId: string): Promise<void>;
  createInstanceServiceAccountKey?(input: LiteLLMInstanceServiceAccountInput): Promise<LiteLLMVirtualKey>;
  updateInstanceObjectPermissions?(tokenId: string, input: LiteLLMObjectPermissions): Promise<void>;
  registerMcpServer?(input: LiteLLMMcpServerInput): Promise<void>;
  updateMcpServer?(input: LiteLLMMcpServerInput): Promise<void>;
  deleteMcpServer?(serverId: string): Promise<void>;
  discoverMcpTools?(serverId: string): Promise<McpToolDefinition[]>;
  callMcpTool?(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  registerVectorStore?(input: LiteLLMVectorStoreInput): Promise<void>;
  updateVectorStore?(input: LiteLLMVectorStoreInput): Promise<void>;
  deleteVectorStore?(vectorStoreId: string): Promise<void>;
  searchVectorStore?(vectorStoreId: string, input: unknown): Promise<unknown>;
  createEmbeddings?(
    model: string,
    input: string[],
    inputType?: "query" | "passage",
  ): Promise<number[][]>;
  completeStructuredModel?(
    input: LiteLLMStructuredCompletionInput,
  ): Promise<unknown>;
  testConnection?(): Promise<{ ok: boolean; version?: string }>;
}

export class LiteLLMClient implements LiteLLMAdminClient {
  readonly baseUrl: string;

  constructor(
    private readonly baseUrlOverride?: string,
    private readonly masterKeyOverride?: string,
    private readonly requestTimeoutMs = 20_000,
  ) {
    this.baseUrl = (baseUrlOverride ?? "").replace(/\/+$/, "");
  }

  private async connection(): Promise<{ baseUrl: string; masterKey: string }> {
    const runtime = this.baseUrlOverride !== undefined && this.masterKeyOverride !== undefined
      ? undefined
      : await loadPlatformRuntimeConfiguration();
    const baseUrl = (this.baseUrlOverride ?? runtime?.litellm.url ?? "").replace(/\/+$/, "");
    const masterKey = this.masterKeyOverride ?? runtime?.litellm.masterKey ?? "";
    if (!baseUrl || !masterKey) {
      throw new Error(
        "LiteLLM is not configured. Validate and save Runtime Connections in Platform Setting.",
      );
    }
    return { baseUrl, masterKey };
  }

  async connectionBaseUrl(): Promise<string> {
    return (await this.connection()).baseUrl;
  }

  async searchVectorStore(vectorStoreId: string, input: unknown): Promise<unknown> {
    return this.request(
      `/v1/vector_stores/${encodeURIComponent(vectorStoreId)}/search`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  async callMcpTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request("/mcp-rest/tools/call", {
      method: "POST",
      body: JSON.stringify({
        server_id: serverId,
        name: toolName,
        arguments: args,
      }),
    });
  }

  async completeStructuredModel(
    input: LiteLLMStructuredCompletionInput,
  ): Promise<unknown> {
    const response = await this.request<{
      choices?: Array<{ message?: { content?: unknown } }>;
    }>("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        temperature: input.temperature,
        max_tokens: input.maxTokens ?? 2_000,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "expert_agent_response",
            strict: true,
            schema: input.responseJsonSchema,
          },
        },
      }),
    });
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("LiteLLM returned an empty structured completion.");
    }
    try {
      return JSON.parse(content);
    } catch {
      throw new Error("LiteLLM returned invalid JSON for a structured completion.");
    }
  }

  async registerModel(input: {
    accountId: string;
    providerKind: ProviderKind;
    model: ProviderModelSelection;
    litellmParams: Record<string, unknown>;
    complianceDomain: ComplianceDomain;
    endpointRegion: string;
  }): Promise<string> {
    this.assertConfigured();
    const modelName = `tali/${input.accountId.slice(0, 8)}/${input.model.modelId}`;
    await this.request("/model/new", {
      method: "POST",
      body: JSON.stringify({
        model_name: modelName,
        litellm_params: {
          ...input.litellmParams,
          ...(input.model.inputFeePerMillionTokens !== undefined
            ? { input_cost_per_token: input.model.inputFeePerMillionTokens / 1_000_000 }
            : {}),
          ...(input.model.outputFeePerMillionTokens !== undefined
            ? { output_cost_per_token: input.model.outputFeePerMillionTokens / 1_000_000 }
            : {}),
        },
        model_info: {
          taliProviderAccountId: input.accountId,
          providerKind: input.providerKind,
          compliance_domain: input.complianceDomain,
          endpoint_region: input.endpointRegion,
          cross_border_transfer: false,
          model_type: input.model.modelType,
          capabilities: input.model.capabilities ?? [],
          input_modalities: input.model.inputModalities ?? [],
          output_modalities: input.model.outputModalities ?? [],
        },
      }),
    });
    return modelName;
  }

  async deleteModel(modelName: string): Promise<void> {
    this.assertConfigured();
    const response = await this.request<{
      data?: Array<{ model_name?: string; model_info?: { id?: string } }>;
    }>("/model/info");
    const modelId = response.data?.find(
      (model) => model.model_name === modelName,
    )?.model_info?.id;
    if (!modelId) return;
    await this.request("/model/delete", {
      method: "POST",
      body: JSON.stringify({ id: modelId }),
    });
  }

  async createEmbeddings(
    model: string,
    input: string[],
    inputType: "query" | "passage" = "passage",
  ): Promise<number[][]> {
    if (!input.length) return [];
    const response = await this.request<{
      data?: Array<{ index?: number; embedding?: unknown }>;
    }>("/embeddings", {
      method: "POST",
      body: JSON.stringify({
        model,
        input,
        input_type: inputType,
        encoding_format: "float",
      }),
    });
    const data = response.data ?? [];
    const ordered = [...data].sort((left, right) =>
      (left.index ?? 0) - (right.index ?? 0)
    );
    return ordered.map((item) =>
      z.array(z.number()).parse(item.embedding)
    );
  }

  async reconcileModelRoutingRoute(input: LiteLLMModelRoutingRouteInput): Promise<void> {
    this.assertConfigured();
    const response = await this.request<{
      data?: Array<{
        model_name?: string;
        litellm_params?: Record<string, unknown>;
        model_info?: Record<string, unknown>;
      }>;
    }>("/model/info");
    const matches = (response.data ?? []).filter((model) => model.model_name === input.alias);
    if (matches.length > 1)
      throw new Error(`LiteLLM exposes multiple deployments for managed router alias ${input.alias}.`);
    const existing = matches[0];
    if (existing) assertManagedModelRoutingRoute(existing.model_info, input.modelRoutingId, input.alias);
    if (input.strategy === "SINGLE") {
      if (existing) {
        const modelId = existing.model_info?.id;
        if (typeof modelId !== "string" || !modelId)
          throw new Error(`LiteLLM did not report an identifier for managed router alias ${input.alias}.`);
        await this.request("/model/delete", {
          method: "POST",
          body: JSON.stringify({ id: modelId }),
        });
      }
      await this.deleteFallback(input.alias);
      return;
    }
    const litellmParams = input.strategy === "COMPLEXITY"
      ? {
          model: "auto_router/complexity_router",
          complexity_router_config: {
            tiers: input.tiers,
            default_model: input.defaultModel,
          },
          complexity_router_default_model: input.defaultModel,
          num_retries: input.retries,
        }
      : {
          model: `auto_router/${input.alias}`,
          auto_router_config: JSON.stringify({
            routes: input.routes.map((route) => ({
              // LiteLLM's semantic router uses the route name as the target
              // model group. The human intent remains in metadata.
              name: route.model,
              description: route.description,
              utterances: route.utterances,
              score_threshold: route.scoreThreshold,
              metadata: { tali_intent: route.intent },
            })),
          }),
          auto_router_default_model: input.defaultModel,
          auto_router_embedding_model: input.embeddingModel,
          num_retries: input.retries,
        };
    const body = {
      model_name: input.alias,
      litellm_params: litellmParams,
      model_info: {
        ...(existing?.model_info ?? {}),
        managed_by: "tali",
        tali_resource: "model_routing_route",
        model_routing_id: input.modelRoutingId,
        routing_strategy: input.strategy,
        compliance_domain: input.complianceDomain,
        request_audit: input.requestAudit,
      },
    };
    if (existing) {
      const modelId = existing.model_info?.id;
      if (typeof modelId !== "string" || !modelId)
        throw new Error(`LiteLLM did not report an identifier for managed router alias ${input.alias}.`);
      await this.request(`/model/${encodeURIComponent(modelId)}/update`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    } else {
      await this.request("/model/new", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }
    await this.reconcileFallback(input.alias, input.fallbackModels);
  }

  async deleteModelRoutingRoute(alias: string, modelRoutingId: string): Promise<void> {
    this.assertConfigured();
    const response = await this.request<{
      data?: Array<{ model_name?: string; model_info?: Record<string, unknown> }>;
    }>("/model/info");
    const matches = (response.data ?? []).filter((model) => model.model_name === alias);
    if (!matches.length) {
      await this.deleteFallback(alias);
      return;
    }
    if (matches.length > 1)
      throw new Error(`LiteLLM exposes multiple deployments for managed router alias ${alias}.`);
    const existing = matches[0]!;
    assertManagedModelRoutingRoute(existing.model_info, modelRoutingId, alias);
    const modelId = existing.model_info?.id;
    if (typeof modelId !== "string" || !modelId)
      throw new Error(`LiteLLM did not report an identifier for managed router alias ${alias}.`);
    await this.deleteFallback(alias);
    await this.request("/model/delete", {
      method: "POST",
      body: JSON.stringify({ id: modelId }),
    });
  }

  async probeModel(modelName: string, modelType: ModelType): Promise<void> {
    this.assertConfigured();
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.sendModelProbe(modelName, modelType);
        return;
      } catch (error) {
        const retryDelay = MODEL_PROPAGATION_RETRY_DELAYS_MS[attempt];
        if (
          retryDelay === undefined
          || !isPendingModelPropagation(error, modelName)
        ) {
          throw error;
        }
        await delay(retryDelay);
      }
    }
  }

  async createInstanceKey(input: {
    agentId: string;
    alias: string;
    modelName: string;
  }): Promise<LiteLLMVirtualKey> {
    this.assertConfigured();
    const response = await this.request<LiteLLMVirtualKeyResponse>("/key/service-account/generate", {
      method: "POST",
      body: JSON.stringify({
        key_alias: input.alias,
        user_id: input.agentId,
        models: [input.modelName],
      }),
    });
    if (!response.key) throw new Error("LiteLLM did not return a virtual key.");
    return { secret: response.key, tokenId: response.token ?? response.key };
  }

  async createModelRoutingTeam(input: LiteLLMModelRoutingIdentity): Promise<string> {
    this.assertConfigured();
    const response = await this.request<{ team_id?: string; id?: string }>("/team/new", {
      method: "POST",
      body: JSON.stringify({
        team_alias: input.alias,
        models: [input.modelAlias],
        metadata: {
          managed_by: "tali",
          model_routing_id: input.modelRoutingId,
          model_routing_alias: input.modelAlias,
          compliance_domain: input.complianceDomain,
        },
      }),
    });
    const id = response.team_id ?? response.id;
    if (!id) throw new Error("LiteLLM did not return a Team identifier.");
    return id;
  }

  async deleteModelRoutingTeam(teamId: string): Promise<void> {
    this.assertConfigured();
    await this.request("/team/delete", {
      method: "POST",
      body: JSON.stringify({ team_ids: [teamId] }),
    });
  }

  async createModelRoutingKey(input: LiteLLMModelRoutingKeyInput): Promise<LiteLLMVirtualKey> {
    this.assertConfigured();
    const response = await this.request<LiteLLMVirtualKeyResponse>("/key/generate", {
      method: "POST",
      body: JSON.stringify({
        key_alias: input.alias,
        user_id: input.agentId,
        team_id: input.teamId,
        models: [input.modelAlias],
        metadata: {
          managed_by: "tali",
          model_routing_id: input.modelRoutingId,
          agent_id: input.agentId,
          compliance_domain: input.complianceDomain,
        },
      }),
    });
    if (!response.key) throw new Error("LiteLLM did not return a virtual key.");
    return { secret: response.key, tokenId: response.token ?? response.key };
  }

  async ensureProjectTeam(alias: string, metadata: Record<string, string>): Promise<string> {
    this.assertConfigured();
    const existing = await this.request<Array<{ team_id?: string; team_alias?: string }> | { data?: Array<{ team_id?: string; team_alias?: string }> }>("/team/list");
    const teams = Array.isArray(existing) ? existing : existing.data ?? [];
    const found = teams.find((team) => team.team_alias === alias)?.team_id;
    if (found) return found;
    const created = await this.request<{ team_id?: string; id?: string }>("/team/new", {
      method: "POST",
      body: JSON.stringify({ team_alias: alias, metadata }),
    });
    const id = created.team_id ?? created.id;
    if (!id) throw new Error("LiteLLM did not return a Team identifier.");
    return id;
  }

  async updateProjectTeam(teamId: string, input: LiteLLMProjectQuotaInput): Promise<void> {
    this.assertConfigured();
    await this.request("/team/update", {
      method: "POST",
      body: JSON.stringify({
        team_id: teamId,
        max_budget: input.maxBudget ?? null,
        budget_duration: input.budgetDuration ?? null,
        tpm_limit: input.tpmLimit ?? null,
      }),
    });
  }

  async updateProjectObjectPermissions(teamId: string, input: LiteLLMObjectPermissions): Promise<void> {
    this.assertConfigured();
    await this.request("/team/update", {
      method: "POST",
      body: JSON.stringify({
        team_id: teamId,
        object_permission: liteLLMObjectPermission(input),
      }),
    });
  }

  async addProjectTeamMember(
    teamId: string,
    member: { userId: string; email: string; role: "admin" | "user" },
  ): Promise<void> {
    this.assertConfigured();
    await this.request("/team/member_add", {
      method: "POST",
      body: JSON.stringify({
        team_id: teamId,
        member: {
          user_id: member.userId,
          user_email: member.email,
          role: member.role,
        },
      }),
    });
  }

  async removeProjectTeamMember(teamId: string, userId: string): Promise<void> {
    this.assertConfigured();
    await this.request("/team/member_delete", {
      method: "POST",
      body: JSON.stringify({ team_id: teamId, user_id: userId }),
    });
  }

  async deleteProjectTeam(teamId: string): Promise<void> {
    return this.deleteModelRoutingTeam(teamId);
  }

  async createInstanceServiceAccountKey(input: LiteLLMInstanceServiceAccountInput): Promise<LiteLLMVirtualKey> {
    this.assertConfigured();
    const response = await this.request<LiteLLMVirtualKeyResponse>("/key/service-account/generate", {
      method: "POST",
      body: JSON.stringify({
        key_alias: input.alias,
        ...(input.duration ? { duration: input.duration } : {}),
        team_id: input.teamId,
        models: input.models,
        aliases: input.aliases ?? {},
        ...(input.routerSettings ? { router_settings: input.routerSettings } : {}),
        metadata: input.metadata,
        object_permission: liteLLMObjectPermission(input.objectPermissions),
      }),
    });
    if (!response.key) throw new Error("LiteLLM did not return an Instance Service Account Key.");
    return { secret: response.key, tokenId: response.token ?? response.key };
  }

  async updateInstanceObjectPermissions(
    tokenId: string,
    input: LiteLLMObjectPermissions,
  ): Promise<void> {
    this.assertConfigured();
    await this.request("/key/update", {
      method: "POST",
      body: JSON.stringify({
        key: tokenId,
        object_permission: liteLLMObjectPermission(input),
      }),
    });
  }

  async registerMcpServer(input: LiteLLMMcpServerInput): Promise<void> {
    this.assertConfigured();
    await this.request("/v1/mcp/server", {
      method: "POST",
      body: JSON.stringify(liteLLMMcpServerBody(input)),
    });
  }

  async updateMcpServer(input: LiteLLMMcpServerInput): Promise<void> {
    this.assertConfigured();
    await this.request("/v1/mcp/server", {
      method: "PUT",
      body: JSON.stringify(liteLLMMcpServerBody(input)),
    });
  }

  async deleteMcpServer(serverId: string): Promise<void> {
    this.assertConfigured();
    await this.request(`/v1/mcp/server/${encodeURIComponent(serverId)}`, {
      method: "DELETE",
    });
  }

  async registerVectorStore(input: LiteLLMVectorStoreInput): Promise<void> {
    this.assertConfigured();
    await this.request("/vector_store/new", {
      method: "POST",
      body: JSON.stringify(liteLLMVectorStoreBody(input)),
    });
  }

  async updateVectorStore(input: LiteLLMVectorStoreInput): Promise<void> {
    this.assertConfigured();
    await this.request("/vector_store/update", {
      method: "POST",
      body: JSON.stringify(liteLLMVectorStoreBody(input)),
    });
  }

  async deleteVectorStore(vectorStoreId: string): Promise<void> {
    this.assertConfigured();
    await this.request("/vector_store/delete", {
      method: "POST",
      body: JSON.stringify({ vector_store_id: vectorStoreId }),
    });
  }

  async discoverMcpTools(serverId: string): Promise<McpToolDefinition[]> {
    this.assertConfigured();
    const response = await this.request<
      { tools?: unknown[]; error?: string | null; message?: string }
      | unknown[]
    >(`/mcp-rest/tools/list?server_id=${encodeURIComponent(serverId)}`);
    const values = Array.isArray(response) ? response : response.tools ?? [];
    const discoveredAt = new Date().toISOString();
    return values.flatMap((value) => {
      const tool = record(value);
      if (!tool || typeof tool.name !== "string") return [];
      const annotations = record(tool.annotations);
      const normalizedAnnotations = annotations ? {
        ...(typeof annotations.title === "string" ? { title: annotations.title } : {}),
        ...(typeof annotations.readOnlyHint === "boolean" ? { readOnlyHint: annotations.readOnlyHint } : {}),
        ...(typeof annotations.destructiveHint === "boolean" ? { destructiveHint: annotations.destructiveHint } : {}),
        ...(typeof annotations.idempotentHint === "boolean" ? { idempotentHint: annotations.idempotentHint } : {}),
        ...(typeof annotations.openWorldHint === "boolean" ? { openWorldHint: annotations.openWorldHint } : {}),
      } : undefined;
      return [{
        name: tool.name,
        ...(typeof tool.title === "string" ? { title: tool.title } : {}),
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        inputSchema: record(tool.inputSchema) ?? record(tool.input_schema) ?? {},
        ...(record(tool.outputSchema) ?? record(tool.output_schema)
          ? { outputSchema: (record(tool.outputSchema) ?? record(tool.output_schema))! }
          : {}),
        ...(normalizedAnnotations && Object.keys(normalizedAnnotations).length
          ? { annotations: normalizedAnnotations }
          : {}),
        discoveredAt,
      }];
    });
  }

  async testConnection(): Promise<{ ok: boolean; version?: string }> {
    this.assertConfigured();
    const response = await this.request<Record<string, unknown>>("/health/liveliness");
    const version = response.version ?? response.litellm_version;
    return { ok: true, ...(typeof version === "string" ? { version } : {}) };
  }

  async inspectModelRouting(modelAlias: string): Promise<LiteLLMModelRoutingInspection> {
    this.assertConfigured();
    const [models, health, configuredFallbacks] = await Promise.all([
      this.request<{ data?: Array<{
        model_name?: string;
        litellm_params?: Record<string, unknown>;
        model_info?: Record<string, unknown>;
      }> }>("/model/info"),
      this.request<Record<string, unknown>>("/health/liveliness").catch((): Record<string, unknown> => ({})),
      this.readFallback(modelAlias),
    ]);
    const allModels = models.data ?? [];
    const matching = allModels.filter((item) => item.model_name === modelAlias);
    const versionValue = health.version ?? health.litellm_version;
    const version = typeof versionValue === "string" ? versionValue : undefined;
    const targetModelNames = new Set<string>();
    let automaticRouting = false;
    let routerType: ModelRoutingCapabilities["routerType"] = "UNKNOWN";
    let complexityTierCount: number | undefined;
    let semanticRouteCount: number | undefined;
    let sessionAffinity: ModelRoutingCapabilities["sessionAffinity"] = "UNKNOWN";
    let adaptiveRouting: ModelRoutingCapabilities["adaptiveRouting"] = "UNKNOWN";
    let generalFallback: ModelRoutingCapabilities["generalFallback"] = "UNKNOWN";
    let contextWindowFallback: ModelRoutingCapabilities["contextWindowFallback"] = "UNKNOWN";
    let contentPolicyFallback: ModelRoutingCapabilities["contentPolicyFallback"] = "UNKNOWN";
    let retries: ModelRoutingCapabilities["retries"] = "UNKNOWN";
    let requestAudit: ModelRoutingCapabilities["requestAudit"] = "UNKNOWN";
    for (const item of matching) {
      const info = item.model_info ?? {};
      const params = item.litellm_params ?? {};
      const backingModel = params.model;
      const isAutoRouter = typeof backingModel === "string" && backingModel.startsWith("auto_router/");
      automaticRouting ||= isAutoRouter;
      if (isAutoRouter)
        routerType = backingModel === "auto_router/complexity_router"
          ? "COMPLEXITY_ROUTER"
          : params.auto_router_config
            ? "SEMANTIC_ROUTER"
            : "OTHER";
      const complexityConfig = record(params.complexity_router_config);
      const tiers = record(complexityConfig?.tiers);
      if (tiers) {
        complexityTierCount = Object.keys(tiers).length;
        collectStrings(Object.values(tiers), targetModelNames);
      }
      if (typeof params.complexity_router_default_model === "string")
        targetModelNames.add(params.complexity_router_default_model);
      const semanticConfig = parseJsonRecord(params.auto_router_config);
      const semanticRoutes = Array.isArray(semanticConfig?.routes)
        ? semanticConfig.routes
        : [];
      if (semanticRoutes.length) {
        semanticRouteCount = semanticRoutes.length;
        for (const route of semanticRoutes) {
          const routeRecord = record(route);
          if (typeof routeRecord?.name === "string")
            targetModelNames.add(routeRecord.name);
        }
      }
      if (typeof params.auto_router_default_model === "string")
        targetModelNames.add(params.auto_router_default_model);
      if (typeof params.auto_router_embedding_model === "string")
        targetModelNames.add(params.auto_router_embedding_model);
      const fallbacks = info.fallbacks ?? params.fallbacks ?? info.fallback_group;
      const contextFallbacks = info.context_window_fallbacks ?? params.context_window_fallbacks;
      const policyFallbacks = info.content_policy_fallbacks ?? params.content_policy_fallbacks;
      if (fallbacks !== undefined) {
        generalFallback = hasValues(fallbacks) ? "ENABLED" : "DISABLED";
        collectStrings(fallbacks, targetModelNames);
      }
      if (contextFallbacks !== undefined) {
        contextWindowFallback = hasValues(contextFallbacks) ? "ENABLED" : "DISABLED";
        collectStrings(contextFallbacks, targetModelNames);
      }
      if (policyFallbacks !== undefined) {
        contentPolicyFallback = hasValues(policyFallbacks) ? "ENABLED" : "DISABLED";
        collectStrings(policyFallbacks, targetModelNames);
      }
      const retryValue = params.num_retries ?? info.num_retries;
      if (typeof retryValue === "number") retries = retryValue > 0 ? "ENABLED" : "DISABLED";
      if (info.request_audit ?? info.logging_callback ?? params.success_callback) requestAudit = "ENABLED";
    }
    if (configuredFallbacks) {
      generalFallback = configuredFallbacks.length ? "ENABLED" : "DISABLED";
      collectStrings(configuredFallbacks, targetModelNames);
    }
    const effectiveModels = targetModelNames.size
      ? allModels.filter((item) => item.model_name && targetModelNames.has(item.model_name))
      : matching;
    const domains = new Set<ComplianceDomain>();
    const resolvedTargetNames = new Set(effectiveModels.map((item) => item.model_name).filter((name): name is string => Boolean(name)));
    let complianceUnknown = effectiveModels.length === 0
      || (targetModelNames.size > 0 && resolvedTargetNames.size !== targetModelNames.size);
    for (const item of effectiveModels) {
      const info = item.model_info ?? {};
      const domain = info.compliance_domain ?? info.complianceDomain;
      if (
        typeof domain === "string"
        && (complianceDomains as readonly string[]).includes(domain)
      ) {
        domains.add(domain as ComplianceDomain);
      }
      else complianceUnknown = true;
    }
    const autoRouterUnsupported = routerType === "COMPLEXITY_ROUTER"
      && Boolean(version)
      && !versionAtLeast(version!, 1, 86, 2);
    const failover = generalFallback === "ENABLED"
      || contextWindowFallback === "ENABLED"
      || contentPolicyFallback === "ENABLED"
      || matching.length > 1
      ? "ENABLED"
      : "UNKNOWN";
    return {
      exists: matching.length > 0,
      ...(version ? { version } : {}),
      modelCount: effectiveModels.length || matching.length,
      complianceDomains: [...domains],
      complianceUnknown,
      capabilities: {
        automaticRouting: matching.length ? (automaticRouting ? "ENABLED" : "DISABLED") : "UNKNOWN",
        routerType,
        ...(complexityTierCount !== undefined ? { complexityTierCount } : {}),
        ...(semanticRouteCount !== undefined ? { semanticRouteCount } : {}),
        sessionAffinity,
        adaptiveRouting,
        failover,
        generalFallback,
        contextWindowFallback,
        contentPolicyFallback,
        retries,
        requestAudit,
      },
      configurationHash: stableConfigurationHash({ matching, effectiveModels }),
      ...(autoRouterUnsupported ? { unsupportedReason: `LiteLLM ${version} does not support the managed Complexity Router; version 1.86.2 or newer is required.` } : {}),
    };
  }

  async revokeKey(tokenId: string): Promise<void> {
    this.assertConfigured();
    try {
      await this.request("/key/delete", {
        method: "POST",
        body: JSON.stringify({ keys: [tokenId] }),
      });
    } catch (error) {
      // Lifecycle jobs are delivered at least once. A missing key means a
      // previous attempt already completed this external side effect.
      if (error instanceof LiteLLMRequestError && error.status === 404) return;
      throw error;
    }
  }

  async blockKey(tokenId: string): Promise<void> {
    this.assertConfigured();
    try {
      await this.request("/key/block", {
        method: "POST",
        body: JSON.stringify({ key: tokenId }),
      });
    } catch (error) {
      // Lifecycle jobs are delivered at least once. Older deployments may
      // already have hard-deleted the key, which is also non-callable and
      // must not leave the cleanup job retrying forever.
      if (error instanceof LiteLLMRequestError && error.status === 404) return;
      throw error;
    }
  }

  async listSpendLogs(from: string, to: string, teamId?: string): Promise<LiteLLMSpendLog[]> {
    this.assertConfigured();
    const logs: LiteLLMSpendLog[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const query = new URLSearchParams({
        start_date: `${from} 00:00:00`,
        // The v2 endpoint uses an inclusive timestamp boundary. Query through
        // the following midnight so every record on the requested end day is
        // included; replay is harmless because facts are idempotent.
        end_date: `${nextUtcDate(to)} 00:00:00`,
        page: String(page),
        page_size: "100",
        sort_by: "startTime",
        sort_order: "asc",
      });
      if (teamId) query.set("team_id", teamId);
      const response = await this.request<{
        data?: LiteLLMSpendLog[];
        total_pages?: number;
      }>(`/spend/logs/v2?${query}`);
      logs.push(...(response.data ?? []));
      totalPages = Math.max(1, response.total_pages ?? 1);
      page += 1;
    } while (page <= totalPages);
    return logs;
  }

  private assertConfigured(): void {
    if (this.masterKeyOverride === "")
      throw new Error("LiteLLM is not configured. Validate and save Runtime Connections in Platform Setting.");
  }

  private async reconcileFallback(modelAlias: string, fallbackModels: string[]): Promise<void> {
    if (!fallbackModels.length) {
      await this.deleteFallback(modelAlias);
      return;
    }
    await this.request("/fallback", {
      method: "POST",
      body: JSON.stringify({
        model: modelAlias,
        fallback_models: [...new Set(fallbackModels)],
        fallback_type: "general",
      }),
    });
  }

  private async readFallback(modelAlias: string): Promise<string[] | undefined> {
    try {
      const response = await this.request<{ fallback_models?: unknown[] }>(
        `/fallback/${encodeURIComponent(modelAlias)}?fallback_type=general`,
      );
      return Array.isArray(response.fallback_models)
        ? response.fallback_models.filter((value): value is string => typeof value === "string")
        : undefined;
    } catch (error) {
      if (error instanceof LiteLLMRequestError && error.status === 404) return undefined;
      throw error;
    }
  }

  private async deleteFallback(modelAlias: string): Promise<void> {
    try {
      await this.request(
        `/fallback/${encodeURIComponent(modelAlias)}?fallback_type=general`,
        { method: "DELETE" },
      );
    } catch (error) {
      if (error instanceof LiteLLMRequestError && error.status === 404) return;
      throw error;
    }
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const { baseUrl, masterKey } = await this.connection();
    const formData = typeof FormData !== "undefined" && init.body instanceof FormData;
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${masterKey}`,
        ...(!formData ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const body = await response.text();
    if (!response.ok) {
      const detail = formatLiteLLMErrorDetail(body, masterKey);
      throw new LiteLLMRequestError(
        response.status,
        `LiteLLM returned ${response.status}${detail ? `: ${detail}` : "."}`,
        detail,
      );
    }
    return (body ? JSON.parse(body) : undefined) as T;
  }

  private async sendModelProbe(
    modelName: string,
    modelType: ModelType,
  ): Promise<void> {
    if (modelType === "llm") {
      await this.request("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: "user", content: "Reply with OK." }],
          max_tokens: 1,
        }),
      });
      return;
    }
    if (modelType === "text-embedding") {
      await this.request("/embeddings", {
        method: "POST",
        body: JSON.stringify({
          model: modelName,
          input: "TaskLattice Relay validation",
          input_type: "passage",
          encoding_format: "float",
        }),
      });
      return;
    }
    const form = new FormData();
    form.set("model", modelName);
    form.set("file", new Blob([silentWav()], { type: "audio/wav" }), "validation.wav");
    await this.request("/audio/transcriptions", { method: "POST", body: form });
  }
}

function liteLLMObjectPermission(input: LiteLLMObjectPermissions): Record<string, unknown> {
  return {
    mcp_servers: [...new Set(input.mcpServers)],
    mcp_access_groups: [...new Set(input.mcpAccessGroups ?? [])],
    mcp_tool_permissions: input.mcpToolPermissions ?? {},
    vector_stores: [...new Set(input.vectorStores ?? [])],
  };
}

function liteLLMMcpServerBody(input: LiteLLMMcpServerInput): Record<string, unknown> {
  return {
    server_id: input.serverId,
    server_name: input.serverName,
    alias: input.alias,
    description: input.description,
    transport: input.transport,
    auth_type: input.authType ?? "none",
    ...(input.credential ? { credentials: { auth_value: input.credential } } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.specPath ? { spec_path: input.specPath } : {}),
    ...(input.sourceUrl ? { source_url: input.sourceUrl } : {}),
    mcp_access_groups: [...new Set(input.accessGroups)],
    allowed_tools: input.allowedTools.length ? [...new Set(input.allowedTools)] : null,
    extra_headers: [...new Set(input.extraHeaders)],
    static_headers: input.staticHeaders,
    ...(input.command ? { command: input.command } : {}),
    args: input.args,
    env: input.environment,
    ...(input.authorizationUrl ? { authorization_url: input.authorizationUrl } : {}),
    ...(input.tokenUrl ? { token_url: input.tokenUrl } : {}),
    ...(input.registrationUrl ? { registration_url: input.registrationUrl } : {}),
    ...(input.oauth2Flow ? { oauth2_flow: input.oauth2Flow } : {}),
    allow_all_keys: false,
    available_on_public_internet: input.availableOnPublicInternet,
    delegate_auth_to_upstream: false,
    is_byok: false,
  };
}

function liteLLMVectorStoreBody(input: LiteLLMVectorStoreInput): Record<string, unknown> {
  return {
    vector_store_id: input.vectorStoreId,
    custom_llm_provider: input.provider,
    vector_store_name: input.name,
    vector_store_description: input.description,
    vector_store_metadata: input.metadata,
    litellm_params: input.litellmParams,
  };
}

function redactSecrets(value: string, masterKey: string): string {
  return value
    .replaceAll(masterKey, masterKey ? "[REDACTED]" : "")
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, "[REDACTED]");
}

class LiteLLMRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = "LiteLLMRequestError";
  }
}

const MODEL_PROPAGATION_RETRY_DELAYS_MS = [
  250,
  500,
  1_000,
  2_000,
  4_000,
  8_000,
  8_000,
  8_000,
  8_000,
] as const;

function isPendingModelPropagation(error: unknown, modelName: string): boolean {
  return error instanceof LiteLLMRequestError
    && error.status === 400
    && error.detail.includes(`Invalid model name passed in model=${modelName}`)
    && error.detail.includes("/v1/models");
}

function formatLiteLLMErrorDetail(body: string, masterKey: string): string {
  if (!body) return "";
  const redacted = redactSecrets(body, masterKey);
  try {
    const parsed = JSON.parse(redacted) as {
      error?: { message?: unknown };
      message?: unknown;
      detail?: unknown;
    };
    const detail = parsed.error?.message ?? parsed.message ?? parsed.detail;
    if (typeof detail === "string" && detail.trim()) return detail.slice(0, 2_000);
  } catch {
    // Non-JSON LiteLLM responses are still useful after credential redaction.
  }
  return redacted.slice(0, 2_000);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertManagedModelRoutingRoute(
  modelInfo: Record<string, unknown> | undefined,
  modelRoutingId: string,
  alias: string,
): void {
  if (
    modelInfo?.managed_by !== "tali"
    || modelInfo.tali_resource !== "model_routing_route"
    || modelInfo.model_routing_id !== modelRoutingId
  ) {
    throw new Error(
      `LiteLLM alias ${alias} already exists and is not owned by this TaskLattice Relay Routing.`,
    );
  }
}

function versionAtLeast(version: string, major: number, minor: number, patch = 0): boolean {
  const match = version.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const currentMajor = Number(match[1]);
  const currentMinor = Number(match[2]);
  const currentPatch = Number(match[3] ?? 0);
  return currentMajor > major
    || (
      currentMajor === major
      && (
        currentMinor > minor
        || (currentMinor === minor && currentPatch >= patch)
      )
    );
}

function nextUtcDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`Invalid LiteLLM spend log date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error(`Invalid LiteLLM spend log date: ${value}`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function collectStrings(value: unknown, target: Set<string>): void {
  if (typeof value === "string") {
    target.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, target));
    return;
  }
  if (value && typeof value === "object")
    Object.values(value).forEach((item) => collectStrings(item, target));
}

function hasValues(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function stableConfigurationHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(sanitizeForHash(value))).digest("hex")}`;
}

function sanitizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForHash);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["api_key", "authorization", "password", "secret", "secret_access_key", "access_key_id"].includes(key.toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sanitizeForHash(nested)]),
  );
}

function silentWav(): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + 1_600);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) =>
    [...value].forEach((character, index) =>
      view.setUint8(offset + index, character.charCodeAt(0)),
    );
  write(0, "RIFF");
  view.setUint32(4, 36 + 1_600, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  write(36, "data");
  view.setUint32(40, 1_600, true);
  return buffer;
}
