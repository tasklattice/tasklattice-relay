import type {
  AccessPolicy,
  AssignDepartmentInferenceResourceInput,
  AccessPolicyVersion,
  Instance as Agent,
  AgentInstanceDetail,
  AgentInstanceLogSessionResponse,
  CreateInstanceLogSessionInput,
  InstanceInteractionAccess,
  InstanceRuntimeLogView,
  InstanceCreationAccepted,
  InstanceLifecycleOperation,
  AgentGardenEntry,
  AgentGardenSnapshot,
  A2aAgentInstance,
  ProjectAgentRuntimeInstance,
  CreateVectorDatabaseDefinitionInput,
  CreateVectorFolderInput,
  DepartmentInferenceAvailability,
  DepartmentInferenceResourceAssignmentView,
  CreateAccessPolicyInput,
  CreateInstanceInput,
  CostQueryParams,
  ModelCostActivityResponse,
  ModelCostBreakdownResponse,
  ModelCostDataQualityResponse,
  ModelCostGranularity,
  ModelCostInsightsResponse,
  ModelCostRankingResponse,
  ModelCostSortDirection,
  ModelCostSummaryResponse,
  ModelCostTrendGranularity,
  ModelCostTrendResponse,
  CreateMcpServerDefinitionInput,
  CreateModelDeploymentInput,
  CreateProviderConnectionInput,
  CreateSandboxPolicyInput,
  CreateSkillDefinitionInput,
  ResourceCatalog,
  ResourceKind,
  VectorDatabaseDefinition,
  VectorDatabaseOverview,
  VectorDatabaseSearchInput,
  VectorDatabaseSearchResult,
  VectorDocumentChunks,
  VectorDocumentDetail,
  VectorDocument,
  VectorFolder,
  VectorDeletionImpact,
  VectorIngestionJob,
  InferenceGateway,
  InstanceDeletionAcceptedView,
  ModelRouting,
  ModelRoutingAuditEvent,
  ModelRoutingConsumer,
  CreateModelRoutingInput,
  UpdateModelRoutingInput,
  McpServerDefinition,
  ModelDeployment,
  ModelRemovalImpact,
  MemoryActivityPage,
  MemoryBindingPage,
  MemoryBindingView,
  MemoryConversation,
  MemoryConversationDeleteResult,
  MemoryConversationRedactResult,
  MemoryCreateInput,
  MemoryDeleteResult,
  MemoryExperience,
  MemoryExperienceUpdateInput,
  MemoryExportGrantView,
  MemoryFact,
  MemoryFactUpdateInput,
  MemoryInsight,
  MemoryItem,
  MemoryItemStatus,
  MemoryOutboxPage,
  MemoryOverviewView,
  MemoryPage,
  MemoryReextractResult,
  MemoryResourceDetailView,
  MemoryResourceView,
  MemoryRuntimeType,
  MemorySettingsView,
  MemoryStatus,
  OnboardAgentInput,
  ProviderAccount,
  ProviderConnectionCreationResult,
  ProviderConnectionDraft,
  ProviderDiscoveryResult,
  PlatformAuditLogListResponse,
  PlatformAuditLogQuery,
  ProjectOverviewRange,
  ProjectOverviewResponse,
  RuntimeStatus,
  RuntimeInventoryResponse,
  SandboxPolicy,
  SandboxPolicyCatalog,
  SandboxAuditEvent,
  TerminalSessionResponse,
  TerminalTarget,
  TraceDetail,
  TraceListResponse,
  SkillDefinition,
  UpdateVectorDatabaseDefinitionInput,
  UpdateVectorDocumentInput,
  UpdateVectorFolderInput,
  UpdateAccessPolicyInput,
  UpdateMcpServerDefinitionInput,
  UpdateSkillDefinitionInput,
  UpsertVectorChunksInput,
} from "@tali/contracts";
import { projectIdFromPathname } from "./project-storage";
import type {
  AgentTestRun,
  AgentVersion,
  ExpertAgentContractDraft,
  ExpertAgentContractDraftResult,
  ExpertAgentDraftTryResult,
  ExpertAgentDetail,
  ExpertAgentAvailableResource,
  ExpertAgentListItem,
  ExpertAgentResourceRevision,
  ExpertAgentDefinitionInput,
} from "@/features/expert-agents/expert-agent-types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function projectScopedPath(path: string, projectId: string | null): string {
  if (!projectId) return path;
  const url = new URL(path, "http://tali.local");
  const suffix = url.pathname
    .replace(/^\/api\/v1\/projects\/[^/]+\/?/, "")
    .replace(/^\/api\/v1\/?/, "");
  return `/api/v1/projects/${encodeURIComponent(projectId)}/${suffix}${url.search}${url.hash}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const projectId =
    typeof window === "undefined"
      ? null
      : projectIdFromPathname(window.location.pathname);
  const response = await fetch(projectScopedPath(path, projectId), {
    ...init,
    headers: {
      ...(typeof FormData !== "undefined" && init?.body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  const payload = response.status === 204
    ? undefined
    : (await response.json()) as T | { detail?: unknown };
  if (response.status === 401 && typeof window !== "undefined") {
    window.location.assign("/login");
  }
  if (!response.ok)
    throw new ApiError(
      payload && "detail" in (payload as object) && typeof (payload as { detail?: unknown }).detail === "string"
        ? (payload as { detail: string }).detail
        : `Request failed (${response.status})`,
      response.status,
    );
  return payload as T;
}

async function requestBinary(
  path: string,
  fallbackFileName: string,
): Promise<{ blob: Blob; fileName: string }> {
  const projectId =
    typeof window === "undefined"
      ? null
      : projectIdFromPathname(window.location.pathname);
  const response = await fetch(projectScopedPath(path, projectId));
  if (response.status === 401 && typeof window !== "undefined") {
    window.location.assign("/login");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new ApiError(
      typeof payload?.detail === "string"
        ? payload.detail
        : `Download failed (${response.status})`,
      response.status,
    );
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName =
    disposition.match(/filename="([^"]+)"/i)?.[1]
    ?? fallbackFileName;
  return { blob: await response.blob(), fileName };
}

function costSearch(params: CostQueryParams, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    start_time: params.startTime,
    end_time: params.endTime,
    timezone: params.timezone,
    filters: JSON.stringify(params.filters),
    ...extra,
  });
}

function auditLogSearch(params: PlatformAuditLogQuery): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(name, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

function memorySearch(params: Record<string, string | number | readonly string[] | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) search.append(name, item);
    } else if (value !== undefined && value !== null && value !== "") {
      search.set(name, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

function browserIdempotencyKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export const api = {
  listRuntimeInventory: () =>
    request<RuntimeInventoryResponse>("/api/v1/runtime-inventory"),
  listExpertAgents: async () =>
    (await request<{ data: ExpertAgentListItem[] }>("/api/v1/agents")).data,
  getExpertAgent: (agentId: string) =>
    request<ExpertAgentDetail>(`/api/v1/agents/${encodeURIComponent(agentId)}`),
  draftExpertAgentContract: (intention: string) =>
    request<ExpertAgentContractDraftResult>("/api/v1/agents/contract-drafts", {
      method: "POST",
      body: JSON.stringify({ intention }),
    }),
  tryExpertAgentDraft: (input: {
    contract: ExpertAgentContractDraft;
    message: string;
  }) => request<ExpertAgentDraftTryResult>("/api/v1/agents/draft-tries", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  createExpertAgent: (input: {
    slug: string;
    executionMode: "AGENTIC" | "WORKFLOW";
    definition: ExpertAgentDefinitionInput;
  }) => request<{ id: string; revision: number }>("/api/v1/agents", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  updateExpertAgent: (agentId: string, input: ExpertAgentDefinitionInput) =>
    request<{ id: string; revision: number; updatedAt: string }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  deleteExpertAgent: (agentId: string) =>
    request<{ id: string; deleted: true }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}`,
      { method: "DELETE" },
    ),
  testExpertAgent: (agentId: string) =>
    request<AgentTestRun>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/test-runs`,
      { method: "POST", body: "{}" },
    ),
  publishExpertAgent: (agentId: string, input: {
    expectedRevision: number;
    publicationNotes?: string | null;
  }) => request<AgentVersion>(`/api/v1/agents/${encodeURIComponent(agentId)}/publications`, {
      method: "POST",
      body: JSON.stringify(input),
  }),
  getExpertAgentResourceRevisions: async (agentId: string) =>
    (await request<{ data: ExpertAgentResourceRevision[] }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/resource-revisions`,
    )).data,
  listExpertAgentAvailableResources: async (agentId: string) =>
    (await request<{ data: ExpertAgentAvailableResource[] }>(
      `/api/v1/agents/${encodeURIComponent(agentId)}/available-resources`,
    )).data,
  getProjectOverview: (range: ProjectOverviewRange, timezone: string) =>
    request<ProjectOverviewResponse>(
      `/api/v1/overview?${new URLSearchParams({ range, timezone })}`,
    ),
  listTraces: () => request<TraceListResponse>("/api/v1/traces"),
  getTrace: (traceId: string) =>
    request<TraceDetail>(`/api/v1/traces/${encodeURIComponent(traceId)}`),
  listAuditLogs: (params: PlatformAuditLogQuery = {}) =>
    request<PlatformAuditLogListResponse>(
      `/api/v1/audit-logs${auditLogSearch(params)}`,
    ),
  exportAuditLogs: (
    params: Omit<PlatformAuditLogQuery, "cursor" | "limit"> = {},
  ) =>
    requestBinary(
      `/api/v1/audit-logs/export${auditLogSearch(params)}`,
      "audit-logs.csv",
    ),
  listAccessPolicies: async () =>
    (await request<{ data: AccessPolicy[] }>("/api/v1/access-policies")).data,
  getAccessPolicy: (id: string) =>
    request<AccessPolicy>(`/api/v1/access-policies/${encodeURIComponent(id)}`),
  createAccessPolicy: (input: CreateAccessPolicyInput) =>
    request<AccessPolicy>("/api/v1/access-policies", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAccessPolicy: (id: string, input: UpdateAccessPolicyInput) =>
    request<AccessPolicy>(`/api/v1/access-policies/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteAccessPolicy: (id: string) =>
    request<void>(`/api/v1/access-policies/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  listAccessPolicyVersions: async (id: string) =>
    (await request<{ data: AccessPolicyVersion[] }>(
      `/api/v1/access-policies/${encodeURIComponent(id)}/versions`,
    )).data,
  listInferenceGateways: async () =>
    (await request<{ data: InferenceGateway[] }>("/api/v1/inference-gateways")).data,
  listModelRoutings: async () =>
    (await request<{ data: ModelRouting[] }>("/api/v1/model-routings")).data,
  getModelRouting: (id: string) =>
    request<ModelRouting>(`/api/v1/model-routings/${encodeURIComponent(id)}`),
  createModelRouting: (input: CreateModelRoutingInput) =>
    request<ModelRouting>("/api/v1/model-routings", { method: "POST", body: JSON.stringify(input) }),
  updateModelRouting: (id: string, input: UpdateModelRoutingInput) =>
    request<ModelRouting>(`/api/v1/model-routings/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
  refreshModelRouting: (id: string) =>
    request<ModelRouting>(`/api/v1/model-routings/${encodeURIComponent(id)}/refresh`, { method: "POST", body: "{}" }),
  deleteModelRouting: (id: string) =>
    request<{ message: string }>(`/api/v1/model-routings/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listModelRoutingConsumers: async (id: string) =>
    (await request<{ data: ModelRoutingConsumer[] }>(`/api/v1/model-routings/${encodeURIComponent(id)}/consumers`)).data,
  listModelRoutingAudit: async (id: string) =>
    (await request<{ data: ModelRoutingAuditEvent[] }>(`/api/v1/model-routings/${encodeURIComponent(id)}/audit`)).data,
  getResourceCatalog: () => request<ResourceCatalog>("/api/v1/catalog"),
  getAgentGarden: () =>
    request<AgentGardenSnapshot>("/api/v1/agent-garden"),
  onboardGardenAgent: (input: OnboardAgentInput) =>
    request<AgentGardenEntry>("/api/v1/agent-garden/onboard", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  discoverGardenAgent: (id: string) =>
    request<AgentGardenEntry>(
      `/api/v1/agent-garden/agents/${encodeURIComponent(id)}/discover`,
      {
        method: "POST",
        body: "{}",
      },
    ),
  instantiateGardenAgent: (id: string, versionId?: string) =>
    request<A2aAgentInstance | ProjectAgentRuntimeInstance>(
      `/api/v1/agent-garden/agents/${encodeURIComponent(id)}/instances`,
      { method: "POST", body: JSON.stringify({ versionId }) },
    ),
  removeGardenInstance: (id: string) =>
    request<{ message: string }>(
      `/api/v1/agent-garden/instances/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  removeGardenAgent: (id: string) =>
    request<{ message: string }>(
      `/api/v1/agent-garden/agents/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  createSkill: (input: CreateSkillDefinitionInput) =>
    request<SkillDefinition>("/api/v1/catalog/skills", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateSkill: (id: string, input: UpdateSkillDefinitionInput) =>
    request<SkillDefinition>(`/api/v1/catalog/skills/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  verifySkillArtifact: (id: string) =>
    request<SkillDefinition>(
      `/api/v1/catalog/skills/${encodeURIComponent(id)}/verify`,
      {
        method: "POST",
        body: "{}",
      },
    ),
  downloadSkillArtifact: (id: string) =>
    requestBinary(
      `/api/v1/catalog/skills/${encodeURIComponent(id)}/archive`,
      `${id}.tar.gz`,
    ),
  createMcpServer: (input: CreateMcpServerDefinitionInput) =>
    request<McpServerDefinition>("/api/v1/catalog/mcp-servers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateMcpServer: (id: string, input: UpdateMcpServerDefinitionInput) =>
    request<McpServerDefinition>(`/api/v1/catalog/mcp-servers/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  discoverMcpServer: (id: string) =>
    request<McpServerDefinition>(`/api/v1/catalog/mcp-servers/${encodeURIComponent(id)}/discover`, {
      method: "POST",
      body: "{}",
    }),
  createVectorDatabase: (input: CreateVectorDatabaseDefinitionInput) =>
    request<VectorDatabaseDefinition>("/api/v1/catalog/vector-databases", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateVectorDatabase: (id: string, input: UpdateVectorDatabaseDefinitionInput) =>
    request<VectorDatabaseDefinition>(`/api/v1/catalog/vector-databases/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  getVectorDatabase: (id: string) =>
    request<VectorDatabaseOverview>(`/api/v1/catalog/vector-databases/${encodeURIComponent(id)}`),
  upsertVectorChunks: (id: string, input: UpsertVectorChunksInput) =>
    request<{ upserted: number }>(
      `/api/v1/catalog/vector-databases/${encodeURIComponent(id)}/chunks`,
      { method: "PUT", body: JSON.stringify(input) },
    ),
  queueVectorDocument: (id: string, file: File, folderId: string | null) => {
    const body = new FormData();
    body.set("file", file);
    body.set("folderId", folderId ?? "");
    return request<{ document: VectorDocument; job: VectorIngestionJob }>(
      `/api/v1/catalog/vector-databases/${encodeURIComponent(id)}/documents`,
      { method: "POST", body },
    );
  },
  getVectorDocument: (id: string, documentId: string) =>
    request<VectorDocumentDetail>(
      `/api/v1/catalog/vector-databases/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
    ),
  getVectorDocumentChunks: (id: string, documentId: string) =>
    request<VectorDocumentChunks>(
      `/api/v1/catalog/vector-databases/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/chunks`,
    ),
  deleteVectorDocument: (id: string, documentId: string) =>
    request<{ message: string }>(
      `/api/v1/catalog/vector-databases/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
      { method: "DELETE" },
    ),
  updateVectorDocument: (id: string, documentId: string, input: UpdateVectorDocumentInput) =>
    request<VectorDocument>(
      `/api/v1/catalog/vector-databases/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  createVectorFolder: (id: string, input: CreateVectorFolderInput) =>
    request<VectorFolder>(
      `/api/v1/catalog/vector-databases/${encodeURIComponent(id)}/folders`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  updateVectorFolder: (id: string, folderId: string, input: UpdateVectorFolderInput) =>
    request<VectorFolder>(
      `/api/v1/catalog/vector-databases/${encodeURIComponent(id)}/folders/${encodeURIComponent(folderId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  deleteVectorFolder: (id: string, folderId: string) =>
    request<VectorDeletionImpact>(
      `/api/v1/catalog/vector-databases/${encodeURIComponent(id)}/folders/${encodeURIComponent(folderId)}`,
      { method: "DELETE" },
    ),
  searchVectorDatabase: (id: string, input: VectorDatabaseSearchInput) =>
    request<VectorDatabaseSearchResult>(
      `/api/v1/catalog/vector-databases/${encodeURIComponent(id)}/search`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  deleteVectorChunk: (id: string, chunkId: string) =>
    request<{ message: string }>(
      `/api/v1/catalog/vector-databases/${encodeURIComponent(id)}/chunks/${encodeURIComponent(chunkId)}`,
      { method: "DELETE" },
    ),
  deleteResource: (kind: ResourceKind, id: string) =>
    request<{ message: string }>(`/api/v1/catalog/${kind}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  listProviderAccounts: async () =>
    (await request<{ data: ProviderAccount[] }>("/api/v1/providers")).data,
  discoverProviderModels: (input: ProviderConnectionDraft) =>
    request<ProviderDiscoveryResult>("/api/v1/providers/discover", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  discoverProviderAccountModels: (id: string) =>
    request<ProviderDiscoveryResult>(
      `/api/v1/providers/${encodeURIComponent(id)}/discover`,
      {
        method: "POST",
        body: "{}",
      },
    ),
  registerProviderAccount: (input: CreateProviderConnectionInput) =>
    request<ProviderConnectionCreationResult>("/api/v1/providers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  revalidateProviderAccount: (id: string) =>
    request<ProviderAccount>(`/api/v1/providers/${id}/validate`, {
      method: "POST",
      body: "{}",
    }),
  deleteProviderAccount: (id: string) =>
    request<{ message: string }>(`/api/v1/providers/${id}`, {
      method: "DELETE",
    }),
  listModelDeployments: async () =>
    (await request<{ data: ModelDeployment[] }>("/api/v1/models")).data,
  registerModelDeployment: (input: CreateModelDeploymentInput) =>
    request<ModelDeployment>("/api/v1/models", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteModelDeployment: (id: string) =>
    request<{ message: string }>(`/api/v1/models/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  getModelRemovalImpact: (id: string) =>
    request<ModelRemovalImpact>(
      `/api/v1/models/${encodeURIComponent(id)}/removal-impact`,
    ),
  listInheritableModels: () =>
    request<Pick<DepartmentInferenceAvailability, "departmentId" | "departmentName" | "models">>(
      "/api/v1/models/inheritable",
    ),
  inheritDepartmentModel: (id: string) =>
    request<ModelDeployment>(`/api/v1/models/${encodeURIComponent(id)}/inherit`, {
      method: "POST",
      body: "{}",
    }),
  removeDepartmentModelInheritance: (id: string) =>
    request<{ message: string }>(`/api/v1/models/${encodeURIComponent(id)}/inherit`, {
      method: "DELETE",
    }),
  listInheritableRoutings: () =>
    request<Pick<DepartmentInferenceAvailability, "departmentId" | "departmentName" | "routings">>(
      "/api/v1/model-routings/inheritable",
    ),
  inheritDepartmentRouting: (id: string) =>
    request<ModelRouting>(`/api/v1/model-routings/${encodeURIComponent(id)}/inherit`, {
      method: "POST",
      body: "{}",
    }),
  removeDepartmentRoutingInheritance: (id: string) =>
    request<{ message: string }>(`/api/v1/model-routings/${encodeURIComponent(id)}/inherit`, {
      method: "DELETE",
    }),
  getCostSummary: (params: CostQueryParams) =>
    request<ModelCostSummaryResponse>(`/api/v1/costs/summary?${costSearch(params)}`),
  getCostActivity: (params: CostQueryParams, granularity: ModelCostGranularity = "daily") =>
    request<ModelCostActivityResponse>(`/api/v1/costs/activity?${costSearch(params, {
      group_by: params.groupBy,
      granularity,
    })}`),
  getCostInsights: (params: CostQueryParams) =>
    request<ModelCostInsightsResponse>(`/api/v1/costs/insights?${costSearch(params)}`),
  getCostRanking: (params: CostQueryParams, limit = 5) =>
    request<ModelCostRankingResponse>(`/api/v1/costs/ranking?${costSearch(params, {
      group_by: params.groupBy,
      limit: String(limit),
    })}`),
  getCostTrend: (
    params: CostQueryParams,
    granularity: ModelCostTrendGranularity = "day",
    topN = 5,
  ) =>
    request<ModelCostTrendResponse>(`/api/v1/costs/trend?${costSearch(params, {
      group_by: params.groupBy,
      granularity,
      top_n: String(topN),
    })}`),
  getCostBreakdown: (
    params: CostQueryParams,
    controls: {
      page?: number;
      pageSize?: number;
      sort?: string;
      direction?: ModelCostSortDirection;
      search?: string;
    } = {},
  ) =>
    request<ModelCostBreakdownResponse>(`/api/v1/costs/breakdown?${costSearch(params, {
      group_by: params.groupBy,
      page: String(controls.page ?? 1),
      page_size: String(controls.pageSize ?? 200),
      sort: controls.sort ?? "spend_usd",
      direction: controls.direction ?? "desc",
      search: controls.search ?? "",
    })}`),
  getCostDataQuality: (params: CostQueryParams) =>
    request<ModelCostDataQualityResponse>(`/api/v1/costs/data-quality?${costSearch(params)}`),
  listRuntimePolicies: async (): Promise<SandboxPolicyCatalog> => {
    const response = await request<{ defaultPolicyId: string; templatePolicyYaml: string; data: SandboxPolicy[] }>("/api/v1/runtime-policies");
    return {
      defaultPolicyId: response.defaultPolicyId,
      templatePolicyYaml: response.templatePolicyYaml,
      policies: response.data,
    };
  },
  createRuntimePolicy: (input: CreateSandboxPolicyInput) =>
    request<SandboxPolicy>("/api/v1/runtime-policies", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateRuntimePolicy: (id: string, input: CreateSandboxPolicyInput) =>
    request<SandboxPolicy>(`/api/v1/runtime-policies/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteRuntimePolicy: (id: string) =>
    request<{ message: string }>(`/api/v1/runtime-policies/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  listMemories: (params: {
    cursor?: string;
    limit?: number;
    query?: string;
    statuses?: readonly MemoryStatus[];
  } = {}) => request<MemoryPage<MemoryResourceView>>(
    `/api/v1/memories${memorySearch({
      cursor: params.cursor,
      limit: params.limit,
      query: params.query,
      status: params.statuses,
    })}`,
  ),
  createMemory: (input: MemoryCreateInput) =>
    request<MemoryResourceDetailView>("/api/v1/memories", {
      method: "POST",
      headers: { "idempotency-key": browserIdempotencyKey("create-memory") },
      body: JSON.stringify(input),
    }),
  getMemory: (memoryId: string) =>
    request<MemoryResourceDetailView>(`/api/v1/memories/${encodeURIComponent(memoryId)}`),
  renameMemory: (memoryId: string, displayName: string) =>
    request<MemoryResourceDetailView>(`/api/v1/memories/${encodeURIComponent(memoryId)}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
    }),
  deleteMemory: (memoryId: string, confirmation: string) =>
    request<MemoryDeleteResult>(`/api/v1/memories/${encodeURIComponent(memoryId)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation }),
    }),
  getMemoryOverview: (memoryId: string) =>
    request<MemoryOverviewView>(`/api/v1/memories/${encodeURIComponent(memoryId)}/overview`),
  getMemorySettings: (memoryId: string) =>
    request<MemorySettingsView>(`/api/v1/memories/${encodeURIComponent(memoryId)}/settings`),
  listMemoryActivity: (memoryId: string) =>
    request<MemoryActivityPage>(`/api/v1/memories/${encodeURIComponent(memoryId)}/activity`),
  listMemoryBindings: (memoryId: string) =>
    request<MemoryBindingPage>(`/api/v1/memories/${encodeURIComponent(memoryId)}/bindings`),
  bindMemory: (memoryId: string, input: { instanceId: string; runtimeType: MemoryRuntimeType }) =>
    request<MemoryBindingView>(`/api/v1/memories/${encodeURIComponent(memoryId)}/bindings`, {
      method: "POST",
      headers: { "idempotency-key": browserIdempotencyKey("bind-memory") },
      body: JSON.stringify(input),
    }),
  unbindMemory: (memoryId: string, bindingId: string) =>
    request<MemoryResourceDetailView>(`/api/v1/memories/${encodeURIComponent(memoryId)}/bindings/${encodeURIComponent(bindingId)}`, {
      method: "DELETE",
    }),
  listMemoryConversations: (memoryId: string, params: {
    cursor?: string;
    from?: string;
    limit?: number;
    query?: string;
    to?: string;
  } = {}) => request<MemoryPage<MemoryConversation>>(
    `/api/v1/memories/${encodeURIComponent(memoryId)}/conversations${memorySearch(params)}`,
  ),
  getMemoryConversation: (memoryId: string, conversationId: string) =>
    request<MemoryConversation>(`/api/v1/memories/${encodeURIComponent(memoryId)}/conversations/${encodeURIComponent(conversationId)}`),
  deleteMemoryConversation: (memoryId: string, conversationId: string) =>
    request<MemoryConversationDeleteResult>(`/api/v1/memories/${encodeURIComponent(memoryId)}/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
      body: JSON.stringify({ idempotencyKey: browserIdempotencyKey("delete-conversation") }),
    }),
  reextractMemoryConversation: (memoryId: string, conversationId: string) =>
    request<MemoryReextractResult>(`/api/v1/memories/${encodeURIComponent(memoryId)}/conversations/${encodeURIComponent(conversationId)}/reextract`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: browserIdempotencyKey("reextract-conversation") }),
    }),
  redactMemoryConversation: (
    memoryId: string,
    conversationId: string,
    messageIds: string[],
    replacement = "[Redacted]",
  ) => request<MemoryConversationRedactResult>(
    `/api/v1/memories/${encodeURIComponent(memoryId)}/conversations/${encodeURIComponent(conversationId)}/redact`,
    {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: browserIdempotencyKey("redact-conversation"),
        messageIds,
        replacement,
      }),
    },
  ),
  listMemoryFacts: (memoryId: string, params: {
    cursor?: string;
    limit?: number;
    query?: string;
    status?: MemoryItemStatus;
  } = {}) => request<MemoryPage<MemoryFact>>(
    `/api/v1/memories/${encodeURIComponent(memoryId)}/facts${memorySearch(params)}`,
  ),
  updateMemoryFact: (memoryId: string, itemId: string, input: MemoryFactUpdateInput) =>
    request<MemoryFact>(`/api/v1/memories/${encodeURIComponent(memoryId)}/facts/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  listMemoryExperiences: (memoryId: string, params: {
    cursor?: string;
    limit?: number;
    query?: string;
    status?: MemoryItemStatus;
  } = {}) => request<MemoryPage<MemoryExperience>>(
    `/api/v1/memories/${encodeURIComponent(memoryId)}/experiences${memorySearch(params)}`,
  ),
  updateMemoryExperience: (memoryId: string, itemId: string, input: MemoryExperienceUpdateInput) =>
    request<MemoryExperience>(`/api/v1/memories/${encodeURIComponent(memoryId)}/experiences/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  listMemoryInsights: (memoryId: string, params: {
    cursor?: string;
    limit?: number;
    query?: string;
    status?: MemoryItemStatus;
  } = {}) => request<MemoryPage<MemoryInsight>>(
    `/api/v1/memories/${encodeURIComponent(memoryId)}/insights${memorySearch(params)}`,
  ),
  getMemoryItem: (memoryId: string, itemId: string) =>
    request<MemoryItem>(`/api/v1/memories/${encodeURIComponent(memoryId)}/items/${encodeURIComponent(itemId)}`),
  setMemoryItemStatus: (memoryId: string, itemId: string, action: "invalidate" | "restore") =>
    request<MemoryItem>(`/api/v1/memories/${encodeURIComponent(memoryId)}/items/${encodeURIComponent(itemId)}/${action}`, {
      method: "POST",
      body: "{}",
    }),
  listMemoryOutbox: (memoryId: string, params: { cursor?: string; limit?: number; statuses?: readonly string[] } = {}) =>
    request<MemoryOutboxPage>(`/api/v1/memories/${encodeURIComponent(memoryId)}/outbox${memorySearch({
      cursor: params.cursor,
      limit: params.limit,
      status: params.statuses,
    })}`),
  replayMemoryOutbox: (memoryId: string, outboxId: string) =>
    request<void>(`/api/v1/memories/${encodeURIComponent(memoryId)}/outbox/${encodeURIComponent(outboxId)}/replay`, {
      method: "POST",
      body: "{}",
    }),
  retryMemory: (memoryId: string) =>
    request<MemoryResourceDetailView>(`/api/v1/memories/${encodeURIComponent(memoryId)}/retry`, {
      method: "POST",
      body: "{}",
    }),
  authorizeMemoryExport: (memoryId: string) =>
    request<MemoryExportGrantView>(`/api/v1/memories/${encodeURIComponent(memoryId)}/exports`, {
      method: "POST",
      body: JSON.stringify({ format: "json" }),
    }),
  downloadMemoryExport: (downloadUrl: string, fallbackFileName: string) =>
    requestBinary(downloadUrl, fallbackFileName),
  listInstances: async () =>
    (await request<{ data: Agent[] }>("/api/v1/instances")).data,
  getInstance: (id: string) =>
    request<AgentInstanceDetail>(`/api/v1/instances/${id}`),
  getInstanceInteraction: (id: string) =>
    request<InstanceInteractionAccess>(
      `/api/v1/instances/${encodeURIComponent(id)}/interaction`,
    ),
  getInstanceLogs: (id: string) =>
    request<InstanceRuntimeLogView>(
      `/api/v1/instances/${encodeURIComponent(id)}/logs`,
    ),
  getInstanceAudit: async (id: string) =>
    (
      await request<{ data: SandboxAuditEvent[] }>(
        `/api/v1/instances/${id}/audit`,
      )
    ).data,
  getRuntimeStatus: () => request<RuntimeStatus>("/api/v1/runtime"),
  getTerminalTargets: async (id: string) =>
    (
      await request<{ data: TerminalTarget[] }>(
        `/api/v1/instances/${id}/terminal-targets`,
      )
    ).data,
  createInstance: (input: CreateInstanceInput) =>
    request<InstanceCreationAccepted>("/api/v1/instances", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getInstanceLifecycleOperation: (instanceId: string, operationId: string) =>
    request<InstanceLifecycleOperation>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/operations/${encodeURIComponent(operationId)}`,
    ),
  deleteInstance: (id: string) =>
    request<InstanceDeletionAcceptedView>(`/api/v1/instances/${id}`, { method: "DELETE" }),
  updateAgentAccessPolicies: (id: string, accessPolicyIds: string[]) =>
    request<Agent>(`/api/v1/instances/${encodeURIComponent(id)}/access-policies`, {
      method: "PUT",
      body: JSON.stringify({ accessPolicyIds }),
    }),
  createTerminalSession: (id: string, targetId: string) =>
    request<TerminalSessionResponse>(
      `/api/v1/instances/${id}/terminal-sessions`,
      { method: "POST", body: JSON.stringify({ targetId }) },
    ),
  createInstanceLogSession: (
    id: string,
    input: CreateInstanceLogSessionInput,
  ) =>
    request<AgentInstanceLogSessionResponse>(
      `/api/v1/instances/${encodeURIComponent(id)}/log-sessions`,
      { method: "POST", body: JSON.stringify(input) },
    ),
};

export function departmentInferenceApi(departmentId: string) {
  const base = `/api/v1/departments/${encodeURIComponent(departmentId)}`;
  return {
    listInferenceGateways: async () =>
      (await request<{ data: InferenceGateway[] }>(`${base}/inference-gateways`)).data,
    listModelRoutings: async () =>
      (await request<{ data: ModelRouting[] }>(`${base}/model-routings`)).data,
    getModelRouting: (id: string) =>
      request<ModelRouting>(`${base}/model-routings/${encodeURIComponent(id)}`),
    createModelRouting: (input: CreateModelRoutingInput) =>
      request<ModelRouting>(`${base}/model-routings`, { method: "POST", body: JSON.stringify(input) }),
    updateModelRouting: (id: string, input: UpdateModelRoutingInput) =>
      request<ModelRouting>(`${base}/model-routings/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
    refreshModelRouting: (id: string) =>
      request<ModelRouting>(`${base}/model-routings/${encodeURIComponent(id)}/refresh`, { method: "POST", body: "{}" }),
    deleteModelRouting: (id: string) =>
      request<{ message: string }>(`${base}/model-routings/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listModelRoutingConsumers: async (id: string) =>
      (await request<{ data: ModelRoutingConsumer[] }>(`${base}/model-routings/${encodeURIComponent(id)}/consumers`)).data,
    listModelRoutingAudit: async (id: string) =>
      (await request<{ data: ModelRoutingAuditEvent[] }>(`${base}/model-routings/${encodeURIComponent(id)}/audit`)).data,
    listProviderAccounts: async () =>
      (await request<{ data: ProviderAccount[] }>(`${base}/providers`)).data,
    discoverProviderModels: (input: ProviderConnectionDraft) =>
      request<ProviderDiscoveryResult>(`${base}/providers/discover`, { method: "POST", body: JSON.stringify(input) }),
    discoverProviderAccountModels: (id: string) =>
      request<ProviderDiscoveryResult>(`${base}/providers/${encodeURIComponent(id)}/discover`, { method: "POST", body: "{}" }),
    registerProviderAccount: (input: CreateProviderConnectionInput) =>
      request<ProviderConnectionCreationResult>(`${base}/providers`, { method: "POST", body: JSON.stringify(input) }),
    revalidateProviderAccount: (id: string) =>
      request<ProviderAccount>(`${base}/providers/${encodeURIComponent(id)}/validate`, { method: "POST", body: "{}" }),
    deleteProviderAccount: (id: string) =>
      request<{ message: string }>(`${base}/providers/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listModelDeployments: async () =>
      (await request<{ data: ModelDeployment[] }>(`${base}/models`)).data,
    registerModelDeployment: (input: CreateModelDeploymentInput) =>
      request<ModelDeployment>(`${base}/models`, { method: "POST", body: JSON.stringify(input) }),
    deleteModelDeployment: (id: string) =>
      request<{ message: string }>(`${base}/models/${encodeURIComponent(id)}`, { method: "DELETE" }),
    getModelRemovalImpact: (id: string) =>
      request<ModelRemovalImpact>(
        `${base}/models/${encodeURIComponent(id)}/removal-impact`,
      ),
    listModelAssignments: (id: string) =>
      request<DepartmentInferenceResourceAssignmentView>(
        `${base}/models/${encodeURIComponent(id)}/assignments`,
      ),
    assignModel: (id: string, input: AssignDepartmentInferenceResourceInput) =>
      request<DepartmentInferenceResourceAssignmentView>(
        `${base}/models/${encodeURIComponent(id)}/assignments`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    removeModelAssignment: (id: string, projectId: string) =>
      request<{ message: string }>(
        `${base}/models/${encodeURIComponent(id)}/assignments/${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      ),
    listRoutingAssignments: (id: string) =>
      request<DepartmentInferenceResourceAssignmentView>(
        `${base}/model-routings/${encodeURIComponent(id)}/assignments`,
      ),
    assignRouting: (id: string, input: AssignDepartmentInferenceResourceInput) =>
      request<DepartmentInferenceResourceAssignmentView>(
        `${base}/model-routings/${encodeURIComponent(id)}/assignments`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    removeRoutingAssignment: (id: string, projectId: string) =>
      request<{ message: string }>(
        `${base}/model-routings/${encodeURIComponent(id)}/assignments/${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      ),
  };
}
