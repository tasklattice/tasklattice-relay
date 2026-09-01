import { InstanceService } from "./instances/instance-service";
import { AgentInstanceDetailService } from "./instances/agent-instance-detail-service";
import { AgentGardenService } from "./agent-garden/agent-garden-service";
import { AgentGardenStore } from "./agent-garden/agent-garden-store";
import { AccessPolicyService } from "./access-policies/access-policy-service";
import { AccessPolicyStore } from "./access-policies/access-policy-store";
import { ResourceCatalogService } from "./catalog/resource-catalog-service";
import { ModelRoutingService } from "./model-routings/model-routing-service";
import {
  BuiltInRuntimePolicyCatalogSource,
  RuntimePolicyService,
} from "./runtime-policies/runtime-policy-service";
import { ProjectStore } from "./projects/project-store";
import { CostService } from "./providers/cost-service";
import { LiteLLMClient } from "./providers/litellm-client";
import { ProviderService } from "./providers/provider-service";
import { ProjectService, type ProjectRole } from "./projects/project-service";
import { projectRoleFromBuiltinRole } from "./projects/project-access";
import { ProjectQuotaService } from "./quotas/project-quota-service";
import { AuditLogService } from "./audit-logs/audit-log-service";
import { ProjectOverviewService } from "./overview/project-overview-service";
import type {
  ProjectCapability,
  ResourceRelation,
} from "@tali/contracts";
import {
  ProjectAdmissionService,
  type AdmissionResult,
} from "./authorization/admission-control";
import {
  appendAdmissionEvidence,
  isProjectAdmissionComplete,
} from "./authorization/authorization-context";
import { requireDepartmentAdministrator } from "./departments/department-access";
import { MemoryRepository } from "./memories/memory-repository";
import { MemoryService } from "./memories/memory-service";
import { RuntimeInventoryService } from "./runtime-inventory/runtime-inventory-service";

interface ProjectServices {
  store: ProjectStore;
  instances: InstanceService;
  agentInstanceDetails: AgentInstanceDetailService;
  agentGarden: AgentGardenService;
  accessPolicies: AccessPolicyService;
  cost: CostService;
  catalog: ResourceCatalogService;
  modelRoutings: ModelRoutingService;
  runtimePolicies: RuntimePolicyService;
  provider: ProviderService;
  quotas: ProjectQuotaService;
  auditLogs: AuditLogService;
  overview: ProjectOverviewService;
  memories: MemoryService;
  runtimeInventory: RuntimeInventoryService;
}

const litellm = new LiteLLMClient();
const projectService = new ProjectService();
const projectAdmissionService = new ProjectAdmissionService();
const services = new Map<string, ProjectServices>();

function createServices(projectId: string): ProjectServices {
  const store = new ProjectStore(projectId);
  const runtimePolicies = new RuntimePolicyService(
    store,
    new BuiltInRuntimePolicyCatalogSource(),
  );
  const modelRoutings = new ModelRoutingService(store, litellm);
  const quotas = new ProjectQuotaService(store, litellm);
  const catalog = new ResourceCatalogService(store, quotas, litellm);
  const accessPolicies = new AccessPolicyService(
    new AccessPolicyStore(projectId, store.database()),
    store,
    litellm,
  );
  const memories = new MemoryService(
    new MemoryRepository(projectId, store.database()),
  );
  const instances = new InstanceService(
    store,
    undefined,
    litellm,
    runtimePolicies,
    catalog,
    modelRoutings,
    quotas,
    accessPolicies,
    undefined,
    memories,
  );
  const agentGarden = new AgentGardenService(
    new AgentGardenStore(projectId, store.database()),
    store,
  );
  return {
    store,
    auditLogs: new AuditLogService(projectId, store.database()),
    instances,
    agentInstanceDetails: new AgentInstanceDetailService(
      instances,
      new AgentGardenStore(projectId, store.database()),
    ),
    overview: new ProjectOverviewService(store, instances),
    memories,
    agentGarden,
    runtimeInventory: new RuntimeInventoryService(
      projectId,
      store.database(),
      instances,
      agentGarden,
    ),
    accessPolicies,
    provider: new ProviderService(store, litellm),
    cost: new CostService(store, litellm),
    runtimePolicies,
    catalog,
    modelRoutings,
    quotas,
  };
}

async function forRequest(request?: Request): Promise<ProjectServices> {
  const projectId = request
    ? (await projectService.resolve(request)).projectId
    : "individual";
  return forProject(projectId);
}

function forProject(projectId: string): ProjectServices {
  let scoped = services.get(projectId);
  if (!scoped) {
    scoped = createServices(projectId);
    services.set(projectId, scoped);
  }
  return scoped;
}

export async function requireProjectRole(
  request: Request,
  roles: ProjectRole[],
): Promise<void> {
  if (isProjectAdmissionComplete(request)) return;
  const context = await projectService.resolve(request);
  if (!roles.includes(context.activeRole)) {
    throw new Error("You do not have permission to perform this project action.");
  }
}

export interface ProjectCapabilityOptions {
  relation?: ResourceRelation;
  resourceId?: string;
  resourceType: string;
}

export async function requireProjectCapability(
  request: Request,
  capability: ProjectCapability,
  options: ProjectCapabilityOptions,
): Promise<AdmissionResult> {
  const { auth, userId } = await projectService.authenticate(request);
  const match = new URL(request.url).pathname.match(
    /^\/api\/v1\/projects\/([^/]+)(?:\/|$)/,
  );
  const projectId = match ? decodeURIComponent(match[1]!) : "";
  const preferredRole = auth.accessContext?.level === "project"
    && auth.accessContext.resourceId === projectId
    ? projectRoleFromBuiltinRole(auth.accessContext.roleId)
    : auth.sessionId
      ? null
      : undefined;
  return projectAdmissionService.authorize(
    request,
    userId,
    capability,
    {
      ...options,
    },
    preferredRole,
  );
}

/**
 * Project creation is authorized by the target Department, not by whichever
 * Project is selected and not by a platform-level system role.
 */
export async function requireProjectCreateCapability(
  request: Request,
  departmentId: string,
): Promise<void> {
  const { auth, userId } = await projectService.authenticate(request);
  await requireDepartmentAdministrator(auth, departmentId, undefined, {
    capability: "CAP_DEPARTMENT_PROJECT_CREATE",
    requireActiveDepartment: true,
  });
  appendAdmissionEvidence(request, {
    actorId: userId,
    capability: "CAP_PROJECT_CREATE",
    decision: "ALLOW",
    projectId: `department:${departmentId}`,
    reason: "The Department Administrator provisioned a Project in this Department.",
    relation: "PROJECT_ANY",
    resourceType: "Project",
  });
}

export async function getInstanceService(request?: Request): Promise<InstanceService> {
  return (await forRequest(request)).instances;
}

export async function getAgentInstanceDetailService(
  request?: Request,
): Promise<AgentInstanceDetailService> {
  return (await forRequest(request)).agentInstanceDetails;
}

export function getAgentInstanceDetailServiceForProject(
  projectId: string,
): AgentInstanceDetailService {
  return forProject(projectId).agentInstanceDetails;
}

export function getInstanceServiceForProject(projectId: string): InstanceService {
  return forProject(projectId).instances;
}

export async function getAgentGardenService(
  request?: Request,
): Promise<AgentGardenService> {
  return (await forRequest(request)).agentGarden;
}

export async function getRuntimeInventoryService(
  request?: Request,
): Promise<RuntimeInventoryService> {
  return (await forRequest(request)).runtimeInventory;
}

export async function getProviderService(request?: Request): Promise<ProviderService> {
  return (await forRequest(request)).provider;
}

export async function getProjectStore(request?: Request): Promise<ProjectStore> {
  return (await forRequest(request)).store;
}

export async function getCostService(request?: Request): Promise<CostService> {
  return (await forRequest(request)).cost;
}

export async function getRuntimePolicyService(request?: Request): Promise<RuntimePolicyService> {
  return (await forRequest(request)).runtimePolicies;
}

export async function getResourceCatalogService(request?: Request): Promise<ResourceCatalogService> {
  return (await forRequest(request)).catalog;
}

export async function getModelRoutingService(request?: Request): Promise<ModelRoutingService> {
  return (await forRequest(request)).modelRoutings;
}

export async function getProjectQuotaService(request?: Request): Promise<ProjectQuotaService> {
  return (await forRequest(request)).quotas;
}

export async function getAccessPolicyService(request?: Request): Promise<AccessPolicyService> {
  return (await forRequest(request)).accessPolicies;
}

export async function getAuditLogService(request?: Request): Promise<AuditLogService> {
  return (await forRequest(request)).auditLogs;
}

export async function getMemoryService(request?: Request): Promise<MemoryService> {
  return (await forRequest(request)).memories;
}

export async function getProjectOverviewService(request?: Request): Promise<ProjectOverviewService> {
  return (await forRequest(request)).overview;
}
