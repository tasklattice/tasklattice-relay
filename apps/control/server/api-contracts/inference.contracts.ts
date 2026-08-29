import {
  createModelDeploymentSchema,
  assignDepartmentInferenceResourceSchema,
  createModelRoutingSchema,
  createProviderConnectionSchema,
  createSandboxPolicySchema,
  discoverProviderModelsSchema,
  sandboxPolicyInputSchema,
  updateModelRoutingSchema,
  updateProjectQuotaSchema,
  updateSandboxPolicySchema,
} from "@tali/contracts";
import { z } from "zod";
import { defineContracts } from "./contract";
import { departmentRoute, projectRoute, response } from "./helpers";
import {
  costQuerySchemas,
  departmentModelParamsSchema,
  departmentModelAssignmentParamsSchema,
  departmentProviderParamsSchema,
  departmentRoutingParamsSchema,
  departmentRoutingAssignmentParamsSchema,
  domainCollectionSchema,
  modelParamsSchema,
  openObjectSchema,
  projectParamsSchema,
  providerParamsSchema,
  routingParamsSchema,
  runtimePolicyParamsSchema,
} from "./schemas";

const providerCollectionSchema = z.looseObject({
  data: domainCollectionSchema,
}).meta({ id: "ProviderCollection" });
const runtimePolicySchema = sandboxPolicyInputSchema.and(z.looseObject({ id: z.string() }))
  .meta({ id: "RuntimePolicy" });
const modelDeploymentSchema = createModelDeploymentSchema.and(z.looseObject({ id: z.string().uuid() }))
  .meta({ id: "ModelDeployment" });
const modelRoutingSchema = z.looseObject({ id: z.string().uuid(), name: z.string() })
  .meta({ id: "ModelRouting" });

export const inferenceContracts = defineContracts([
  projectRoute({
    method: "get", path: "/providers", operationId: "listProviderAccounts",
    summary: "List provider accounts", tags: ["Providers"],
    responses: { 200: response("Provider account collection", providerCollectionSchema) },
  }),
  projectRoute({
    method: "post", path: "/providers", operationId: "createProviderAccount",
    summary: "Create a provider account", tags: ["Providers"],
    request: { body: createProviderConnectionSchema },
    responses: { 201: response("Created provider account", openObjectSchema) },
  }),
  projectRoute({
    method: "post", path: "/providers/discover", operationId: "discoverProviderModels",
    summary: "Discover provider models before registration", tags: ["Providers"],
    request: { body: discoverProviderModelsSchema },
    responses: { 200: response("Provider model discovery", openObjectSchema) },
  }),
  projectRoute({
    method: "post", path: "/providers/{providerId}/validate", operationId: "validateProviderAccount",
    summary: "Validate a provider account", tags: ["Providers"],
    request: { params: providerParamsSchema },
    responses: { 200: response("Validated provider account", openObjectSchema) },
  }),
  projectRoute({
    method: "post", path: "/providers/{providerId}/discover", operationId: "discoverProviderAccountModels",
    summary: "Discover models for a registered provider account", tags: ["Providers"],
    request: { params: providerParamsSchema },
    responses: { 200: response("Provider model discovery", openObjectSchema) },
  }),
  projectRoute({
    method: "delete", path: "/providers/{providerId}", operationId: "deleteProviderAccount",
    summary: "Delete a provider account", tags: ["Providers"],
    request: { params: providerParamsSchema },
    responses: { 200: response("Deleted provider account", openObjectSchema) },
  }),
  projectRoute({
    method: "get", path: "/models", operationId: "listModelDeployments",
    summary: "List model deployments", tags: ["Models"],
    responses: { 200: response("Model deployment list", z.object({ data: z.array(modelDeploymentSchema) })) },
  }),
  projectRoute({
    method: "post", path: "/models", operationId: "createModelDeployment",
    summary: "Create a model deployment", tags: ["Models"],
    request: { body: createModelDeploymentSchema },
    responses: { 201: response("Created model deployment", modelDeploymentSchema) },
  }),
  projectRoute({
    method: "delete", path: "/models/{modelId}", operationId: "deleteModelDeployment",
    summary: "Delete a model deployment", tags: ["Models"],
    request: { params: modelParamsSchema },
    responses: { 200: response("Deleted model deployment", openObjectSchema) },
  }),
  projectRoute({
    method: "get", path: "/models/{modelId}/removal-impact", operationId: "getModelRemovalImpact",
    summary: "Preview model removal dependencies", tags: ["Models"],
    request: { params: modelParamsSchema },
    responses: { 200: response("Model removal impact", openObjectSchema) },
  }),
  projectRoute({
    method: "get", path: "/models/inheritable", operationId: "listInheritableDepartmentModels",
    summary: "List Department models available to inherit", tags: ["Models"],
    responses: { 200: response("Department model inheritance catalog", openObjectSchema) },
  }),
  projectRoute({
    method: "post", path: "/models/{modelId}/inherit", operationId: "inheritDepartmentModel",
    summary: "Inherit a Department model", tags: ["Models"], request: { params: modelParamsSchema },
    responses: { 201: response("Inherited Department model", modelDeploymentSchema) },
  }),
  projectRoute({
    method: "delete", path: "/models/{modelId}/inherit", operationId: "removeDepartmentModelInheritance",
    summary: "Remove Department model inheritance", tags: ["Models"], request: { params: modelParamsSchema },
    responses: { 200: response("Removed Department model inheritance", openObjectSchema) },
  }),
  projectRoute({
    method: "get", path: "/inference-gateways", operationId: "listInferenceGateways",
    summary: "List inference gateways", tags: ["Inference gateways"],
    responses: { 200: response("Inference gateway list", z.object({ data: domainCollectionSchema })) },
  }),
  projectRoute({
    method: "get", path: "/model-routings", operationId: "listModelRoutings",
    summary: "List model routings", tags: ["Model routing"],
    responses: { 200: response("Model routing list", z.object({ data: z.array(modelRoutingSchema) })) },
  }),
  projectRoute({
    method: "post", path: "/model-routings", operationId: "createModelRouting",
    summary: "Create a model routing", tags: ["Model routing"],
    request: { body: createModelRoutingSchema },
    responses: { 201: response("Created model routing", modelRoutingSchema) },
  }),
  projectRoute({
    method: "get", path: "/model-routings/{routingId}", operationId: "getModelRouting",
    summary: "Read a model routing", tags: ["Model routing"], request: { params: routingParamsSchema },
    responses: { 200: response("Model routing", modelRoutingSchema) },
  }),
  projectRoute({
    method: "put", path: "/model-routings/{routingId}", operationId: "updateModelRouting",
    summary: "Update a model routing", tags: ["Model routing"],
    request: { params: routingParamsSchema, body: updateModelRoutingSchema },
    responses: { 200: response("Updated model routing", modelRoutingSchema) },
  }),
  projectRoute({
    method: "delete", path: "/model-routings/{routingId}", operationId: "deleteModelRouting",
    summary: "Delete a model routing", tags: ["Model routing"], request: { params: routingParamsSchema },
    responses: { 200: response("Deleted model routing", openObjectSchema) },
  }),
  projectRoute({
    method: "post", path: "/model-routings/{routingId}/refresh", operationId: "refreshModelRouting",
    summary: "Refresh a model routing", tags: ["Model routing"], request: { params: routingParamsSchema },
    responses: { 200: response("Refreshed model routing", modelRoutingSchema) },
  }),
  projectRoute({
    method: "get", path: "/model-routings/{routingId}/consumers", operationId: "listModelRoutingConsumers",
    summary: "List model routing consumers", tags: ["Model routing"], request: { params: routingParamsSchema },
    responses: { 200: response("Model routing consumer list", z.object({ data: domainCollectionSchema })) },
  }),
  projectRoute({
    method: "get", path: "/model-routings/{routingId}/audit", operationId: "listModelRoutingAuditEvents",
    summary: "List model routing audit events", tags: ["Model routing"], request: { params: routingParamsSchema },
    responses: { 200: response("Model routing audit events", z.object({ data: domainCollectionSchema })) },
  }),
  projectRoute({
    method: "get", path: "/model-routings/inheritable", operationId: "listInheritableDepartmentRoutings",
    summary: "List Department routing available to inherit", tags: ["Model routing"],
    responses: { 200: response("Department routing inheritance catalog", openObjectSchema) },
  }),
  projectRoute({
    method: "post", path: "/model-routings/{routingId}/inherit", operationId: "inheritDepartmentRouting",
    summary: "Inherit Department routing", tags: ["Model routing"], request: { params: routingParamsSchema },
    responses: { 201: response("Inherited Department routing", modelRoutingSchema) },
  }),
  projectRoute({
    method: "delete", path: "/model-routings/{routingId}/inherit", operationId: "removeDepartmentRoutingInheritance",
    summary: "Remove Department routing inheritance", tags: ["Model routing"], request: { params: routingParamsSchema },
    responses: { 200: response("Removed Department routing inheritance", openObjectSchema) },
  }),
  departmentRoute({
    method: "get", path: "/providers", operationId: "listDepartmentProviderAccounts",
    summary: "List Department provider accounts", tags: ["Providers"],
    responses: { 200: response("Department provider account collection", providerCollectionSchema) },
  }),
  departmentRoute({
    method: "post", path: "/providers", operationId: "createDepartmentProviderAccount",
    summary: "Create a Department provider account", tags: ["Providers"], request: { body: createProviderConnectionSchema },
    responses: { 201: response("Created Department provider account", openObjectSchema) },
  }),
  departmentRoute({
    method: "post", path: "/providers/discover", operationId: "discoverDepartmentProviderModels",
    summary: "Discover Department provider models", tags: ["Providers"], request: { body: discoverProviderModelsSchema },
    responses: { 200: response("Department provider model discovery", openObjectSchema) },
  }),
  departmentRoute({
    method: "post", path: "/providers/{providerId}/validate", operationId: "validateDepartmentProviderAccount",
    summary: "Validate a Department provider account", tags: ["Providers"], request: { params: departmentProviderParamsSchema },
    responses: { 200: response("Validated Department provider account", openObjectSchema) },
  }),
  departmentRoute({
    method: "post", path: "/providers/{providerId}/discover", operationId: "discoverDepartmentProviderAccountModels",
    summary: "Discover models for a Department provider account", tags: ["Providers"], request: { params: departmentProviderParamsSchema },
    responses: { 200: response("Department provider model discovery", openObjectSchema) },
  }),
  departmentRoute({
    method: "delete", path: "/providers/{providerId}", operationId: "deleteDepartmentProviderAccount",
    summary: "Delete a Department provider account", tags: ["Providers"], request: { params: departmentProviderParamsSchema },
    responses: { 200: response("Deleted Department provider account", openObjectSchema) },
  }),
  departmentRoute({
    method: "get", path: "/models", operationId: "listDepartmentModelDeployments",
    summary: "List Department model deployments", tags: ["Models"],
    responses: { 200: response("Department model deployment list", z.object({ data: z.array(modelDeploymentSchema) })) },
  }),
  departmentRoute({
    method: "post", path: "/models", operationId: "createDepartmentModelDeployment",
    summary: "Create a Department model deployment", tags: ["Models"], request: { body: createModelDeploymentSchema },
    responses: { 201: response("Created Department model deployment", modelDeploymentSchema) },
  }),
  departmentRoute({
    method: "delete", path: "/models/{modelId}", operationId: "deleteDepartmentModelDeployment",
    summary: "Delete a Department model deployment", tags: ["Models"], request: { params: departmentModelParamsSchema },
    responses: { 200: response("Deleted Department model deployment", openObjectSchema) },
  }),
  departmentRoute({
    method: "get", path: "/models/{modelId}/removal-impact", operationId: "getDepartmentModelRemovalImpact",
    summary: "Preview Department model removal dependencies", tags: ["Models"],
    request: { params: departmentModelParamsSchema },
    responses: { 200: response("Department model removal impact", openObjectSchema) },
  }),
  departmentRoute({
    method: "get", path: "/models/{modelId}/assignments", operationId: "listDepartmentModelAssignments",
    summary: "List Project assignments for a Department model", tags: ["Models"],
    request: { params: departmentModelParamsSchema },
    responses: { 200: response("Department model assignment state", openObjectSchema) },
  }),
  departmentRoute({
    method: "post", path: "/models/{modelId}/assignments", operationId: "assignDepartmentModel",
    summary: "Assign a Department model to Projects", tags: ["Models"],
    request: { params: departmentModelParamsSchema, body: assignDepartmentInferenceResourceSchema },
    responses: { 200: response("Updated Department model assignments", openObjectSchema) },
  }),
  departmentRoute({
    method: "delete", path: "/models/{modelId}/assignments/{projectId}", operationId: "removeDepartmentModelAssignment",
    summary: "Remove a Department model assignment from a Project", tags: ["Models"],
    request: { params: departmentModelAssignmentParamsSchema },
    responses: { 200: response("Removed Department model assignment", openObjectSchema) },
  }),
  departmentRoute({
    method: "get", path: "/inference-gateways", operationId: "listDepartmentInferenceGateways",
    summary: "List Department inference gateways", tags: ["Inference gateways"],
    responses: { 200: response("Department inference gateway list", z.object({ data: domainCollectionSchema })) },
  }),
  departmentRoute({
    method: "get", path: "/model-routings", operationId: "listDepartmentModelRoutings",
    summary: "List Department model routings", tags: ["Model routing"],
    responses: { 200: response("Department model routing list", z.object({ data: z.array(modelRoutingSchema) })) },
  }),
  departmentRoute({
    method: "post", path: "/model-routings", operationId: "createDepartmentModelRouting",
    summary: "Create Department model routing", tags: ["Model routing"], request: { body: createModelRoutingSchema },
    responses: { 201: response("Created Department model routing", modelRoutingSchema) },
  }),
  departmentRoute({
    method: "get", path: "/model-routings/{routingId}", operationId: "getDepartmentModelRouting",
    summary: "Read Department model routing", tags: ["Model routing"], request: { params: departmentRoutingParamsSchema },
    responses: { 200: response("Department model routing", modelRoutingSchema) },
  }),
  departmentRoute({
    method: "put", path: "/model-routings/{routingId}", operationId: "updateDepartmentModelRouting",
    summary: "Update Department model routing", tags: ["Model routing"], request: { params: departmentRoutingParamsSchema, body: updateModelRoutingSchema },
    responses: { 200: response("Updated Department model routing", modelRoutingSchema) },
  }),
  departmentRoute({
    method: "delete", path: "/model-routings/{routingId}", operationId: "deleteDepartmentModelRouting",
    summary: "Delete Department model routing", tags: ["Model routing"], request: { params: departmentRoutingParamsSchema },
    responses: { 200: response("Deleted Department model routing", openObjectSchema) },
  }),
  departmentRoute({
    method: "get", path: "/model-routings/{routingId}/assignments", operationId: "listDepartmentRoutingAssignments",
    summary: "List Project assignments for Department routing", tags: ["Model routing"],
    request: { params: departmentRoutingParamsSchema },
    responses: { 200: response("Department routing assignment state", openObjectSchema) },
  }),
  departmentRoute({
    method: "post", path: "/model-routings/{routingId}/assignments", operationId: "assignDepartmentRouting",
    summary: "Assign Department routing to Projects", tags: ["Model routing"],
    request: { params: departmentRoutingParamsSchema, body: assignDepartmentInferenceResourceSchema },
    responses: { 200: response("Updated Department routing assignments", openObjectSchema) },
  }),
  departmentRoute({
    method: "delete", path: "/model-routings/{routingId}/assignments/{projectId}", operationId: "removeDepartmentRoutingAssignment",
    summary: "Remove a Department routing assignment from a Project", tags: ["Model routing"],
    request: { params: departmentRoutingAssignmentParamsSchema },
    responses: { 200: response("Removed Department routing assignment", openObjectSchema) },
  }),
  departmentRoute({
    method: "post", path: "/model-routings/{routingId}/refresh", operationId: "refreshDepartmentModelRouting",
    summary: "Refresh Department model routing", tags: ["Model routing"], request: { params: departmentRoutingParamsSchema },
    responses: { 200: response("Refreshed Department model routing", modelRoutingSchema) },
  }),
  departmentRoute({
    method: "get", path: "/model-routings/{routingId}/consumers", operationId: "listDepartmentModelRoutingConsumers",
    summary: "List Department model routing consumers", tags: ["Model routing"], request: { params: departmentRoutingParamsSchema },
    responses: { 200: response("Department model routing consumer list", z.object({ data: domainCollectionSchema })) },
  }),
  departmentRoute({
    method: "get", path: "/model-routings/{routingId}/audit", operationId: "listDepartmentModelRoutingAuditEvents",
    summary: "List Department model routing audit events", tags: ["Model routing"], request: { params: departmentRoutingParamsSchema },
    responses: { 200: response("Department model routing audit events", z.object({ data: domainCollectionSchema })) },
  }),
  projectRoute({
    method: "get", path: "/quota", operationId: "getProjectQuota", summary: "Read Project quota",
    tags: ["Quota"], responses: { 200: response("Project quota", openObjectSchema) },
  }),
  projectRoute({
    method: "put", path: "/quota", operationId: "updateProjectQuota", summary: "Update Project quota",
    tags: ["Quota"], request: { body: updateProjectQuotaSchema },
    responses: { 200: response("Updated Project quota", openObjectSchema) },
  }),
  ...(["summary", "activity", "insights", "ranking", "trend", "breakdown", "data-quality"] as const)
    .map((name) => projectRoute({
      method: "get",
      path: `/costs/${name}`,
      operationId: `getCost${name.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join("")}`,
      summary: `Read cost ${name.replace("-", " ")}`,
      tags: ["Costs"],
      request: { params: projectParamsSchema, query: costQuerySchemas[name] },
      responses: { 200: response(`Cost ${name.replace("-", " ")}`, openObjectSchema) },
    })),
  projectRoute({
    method: "get", path: "/runtime-policies", operationId: "listRuntimePolicies",
    summary: "List runtime policies", tags: ["Runtime policies"],
    responses: { 200: response("Runtime policy catalog", z.looseObject({
      defaultPolicyId: z.string(),
      templatePolicyYaml: z.string(),
      data: z.array(runtimePolicySchema),
    })) },
  }),
  projectRoute({
    method: "post", path: "/runtime-policies", operationId: "createRuntimePolicy",
    summary: "Create a runtime policy", tags: ["Runtime policies"], request: { body: createSandboxPolicySchema },
    responses: { 201: response("Created runtime policy", runtimePolicySchema) },
  }),
  projectRoute({
    method: "put", path: "/runtime-policies/{policyId}", operationId: "updateRuntimePolicy",
    summary: "Update a runtime policy", tags: ["Runtime policies"],
    request: { params: runtimePolicyParamsSchema, body: updateSandboxPolicySchema },
    responses: { 200: response("Updated runtime policy", runtimePolicySchema) },
  }),
  projectRoute({
    method: "delete", path: "/runtime-policies/{policyId}", operationId: "deleteRuntimePolicy",
    summary: "Delete a runtime policy", tags: ["Runtime policies"], request: { params: runtimePolicyParamsSchema },
    responses: { 200: response("Deleted runtime policy", openObjectSchema) },
  }),
  projectRoute({
    method: "get", path: "/runtime", operationId: "getRuntimeStatus", summary: "Read runtime status",
    tags: ["Runtime"], responses: { 200: response("Runtime status", openObjectSchema) },
  }),
]);
