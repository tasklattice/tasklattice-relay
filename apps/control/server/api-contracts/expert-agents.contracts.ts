import {
  expertAgentContractDraftResultSchema,
  expertAgentDefinitionInputSchema,
  expertAgentDraftTryInputSchema,
  expertAgentDraftTryResultSchema,
  expertAgentExecutionModes,
  expertAgentVersionViewSchema,
} from "@tali/contracts";
import { z } from "zod";
import {
  expertAgentKnowledgeSearchSchema,
  expertAgentMcpCallSchema,
  expertAgentModelCompletionSchema,
} from "../runtime-bridge/expert-agent-runtime-resource-service";
import { expertAgentRunTelemetrySchema } from "../runtime-bridge/expert-agent-run-telemetry-service";
import { defineContracts } from "./contract";
import { projectRoute, response, route } from "./helpers";
import { openObjectSchema, projectParamsSchema } from "./schemas";

const uuid = z.string().uuid();
const expertAgentParamsSchema = projectParamsSchema.extend({ agentId: uuid });
const expertAgentRuntimeParamsSchema = z.object({ agentId: uuid, versionId: uuid });

const createExpertAgentSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(120),
  executionMode: z.enum(expertAgentExecutionModes),
  definition: expertAgentDefinitionInputSchema,
}).strict().meta({ id: "CreateAgentInput" });

const publishAgentSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  publicationNotes: z.string().trim().max(8_000).nullable().default(null),
}).strict().meta({ id: "PublishAgentInput" });

const createExpertAgentContractDraftSchema = z.object({
  intention: z.string().trim().min(20).max(12_000),
}).strict().meta({ id: "CreateAgentContractDraftInput" });

const runtimeResultSchema = z.object({ result: z.unknown() })
  .meta({ id: "AgentRuntimeResult" });

export const expertAgentContracts = defineContracts([
  projectRoute({
    method: "get", path: "/agents", operationId: "listDevelopedAgents",
    summary: "List Agents available to the current developer", tags: ["Agent Developer"],
    responses: { 200: response("Agent list", z.object({ data: z.array(openObjectSchema) })) },
  }),
  projectRoute({
    method: "post", path: "/agents", operationId: "createDevelopedAgent",
    summary: "Create a directly editable Agent", tags: ["Agent Developer"],
    request: { body: createExpertAgentSchema },
    responses: { 201: response("Created Agent", openObjectSchema) },
  }),
  projectRoute({
    method: "post", path: "/agents/contract-drafts", operationId: "draftAgentContract",
    summary: "Draft an Agent definition from a product intention", tags: ["Agent Developer"],
    request: { body: createExpertAgentContractDraftSchema },
    responses: { 200: response("Generated definition or manual fallback", expertAgentContractDraftResultSchema) },
  }),
  projectRoute({
    method: "post", path: "/agents/draft-tries", operationId: "tryAgentDraft",
    summary: "Try an Agent definition without persisting it", tags: ["Agent Developer"],
    request: { body: expertAgentDraftTryInputSchema },
    responses: { 200: response("Draft preview result", expertAgentDraftTryResultSchema) },
  }),
  projectRoute({
    method: "get", path: "/agents/{agentId}", operationId: "getDevelopedAgent",
    summary: "Read an Agent and its current delivery state", tags: ["Agent Developer"],
    request: { params: expertAgentParamsSchema },
    responses: { 200: response("Agent detail", openObjectSchema) },
  }),
  projectRoute({
    method: "patch", path: "/agents/{agentId}", operationId: "updateDevelopedAgent",
    summary: "Update the Agent directly", tags: ["Agent Developer"],
    description: "Every edit changes the Agent digest. Tests apply only to the exact digest they evaluated.",
    request: { params: expertAgentParamsSchema, body: expertAgentDefinitionInputSchema },
    responses: { 200: response("Updated Agent", openObjectSchema) },
  }),
  projectRoute({
    method: "delete", path: "/agents/{agentId}", operationId: "deleteDevelopedAgent",
    summary: "Delete an Agent and its development assets", tags: ["Agent Developer"],
    description: "Removes the Agent definition, Tests, published Versions, and Artifacts. Deletion is blocked while runtime Instances or delegation dependencies reference the Agent.",
    request: { params: expertAgentParamsSchema },
    responses: { 200: response("Deleted Agent", z.object({ id: uuid, deleted: z.literal(true) })) },
  }),
  projectRoute({
    method: "post", path: "/agents/{agentId}/test-runs", operationId: "testDevelopedAgent",
    summary: "Run the publish test for the current Agent digest", tags: ["Agent Developer"],
    request: { params: expertAgentParamsSchema },
    responses: { 201: response("Recorded Test Run", openObjectSchema) },
  }),
  projectRoute({
    method: "post", path: "/agents/{agentId}/publications", operationId: "publishDevelopedAgent",
    summary: "Publish the tested Agent as an immutable Version", tags: ["Agent Developer"],
    description: "Creates immutable Version artifacts and publishes the Version to Agent Garden. It does not create an Instance.",
    request: { params: expertAgentParamsSchema, body: publishAgentSchema },
    responses: { 201: response("Published Version", expertAgentVersionViewSchema) },
  }),
  projectRoute({
    method: "get", path: "/agents/{agentId}/versions", operationId: "listAgentVersions",
    summary: "List immutable published Versions", tags: ["Agent Developer"],
    request: { params: expertAgentParamsSchema },
    responses: { 200: response("Published Versions", z.object({ data: z.array(openObjectSchema) })) },
  }),
  projectRoute({
    method: "get", path: "/agents/{agentId}/resource-revisions", operationId: "getAgentResourceRevisions",
    summary: "Compare bound and current resource revisions", tags: ["Agent Developer"],
    request: { params: expertAgentParamsSchema },
    responses: { 200: response("Resource revision comparison", z.object({ data: z.array(openObjectSchema) })) },
  }),
  projectRoute({
    method: "get", path: "/agents/{agentId}/available-resources", operationId: "listAgentAvailableResources",
    summary: "List resources that can be bound to the Agent", tags: ["Agent Developer"],
    request: { params: expertAgentParamsSchema },
    responses: { 200: response("Bindable resources", z.object({ data: z.array(openObjectSchema) })) },
  }),
  route({
    auth: "expert-agent-runtime", method: "post",
    path: "/runtime-bridge/agents/{agentId}/versions/{versionId}/resources/mcp/call",
    operationId: "callAgentMcpResource", summary: "Call a Version-pinned MCP resource", tags: ["Agent Runtime"],
    request: { params: expertAgentRuntimeParamsSchema, body: expertAgentMcpCallSchema },
    responses: { 200: response("MCP tool result", runtimeResultSchema) },
  }),
  route({
    auth: "expert-agent-runtime", method: "post",
    path: "/runtime-bridge/agents/{agentId}/versions/{versionId}/resources/knowledge/search",
    operationId: "searchAgentKnowledgeResource", summary: "Search Version-pinned Knowledge", tags: ["Agent Runtime"],
    request: { params: expertAgentRuntimeParamsSchema, body: expertAgentKnowledgeSearchSchema },
    responses: { 200: response("Knowledge search result", runtimeResultSchema) },
  }),
  route({
    auth: "expert-agent-runtime", method: "post",
    path: "/runtime-bridge/agents/{agentId}/versions/{versionId}/resources/models/complete",
    operationId: "completeAgentModelResource", summary: "Complete through a Version-pinned Model Routing", tags: ["Agent Runtime"],
    request: { params: expertAgentRuntimeParamsSchema, body: expertAgentModelCompletionSchema },
    responses: { 200: response("Structured model completion", runtimeResultSchema) },
  }),
  route({
    auth: "expert-agent-runtime", method: "post",
    path: "/runtime-bridge/agents/{agentId}/versions/{versionId}/runs/events",
    operationId: "recordAgentRunEvent", summary: "Record a Version-attributed run event", tags: ["Agent Runtime"],
    request: { params: expertAgentRuntimeParamsSchema, body: expertAgentRunTelemetrySchema },
    responses: { 200: response("Run event recorded", runtimeResultSchema) },
  }),
]);
