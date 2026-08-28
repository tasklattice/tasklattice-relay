import {
  agentGardenEntrySchema,
  agentGardenSnapshotSchema,
  a2aAgentInstanceSchema,
  createVectorDatabaseDefinitionSchema,
  createVectorFolderSchema,
  createMcpServerDefinitionSchema,
  createSkillDefinitionSchema,
  mcpServerDefinitionSchema,
  onboardAgentSchema,
  skillDefinitionSchema,
  updateVectorDatabaseDefinitionSchema,
  updateVectorDocumentSchema,
  updateVectorFolderSchema,
  updateMcpServerDefinitionSchema,
  updateSkillDefinitionSchema,
  upsertVectorChunksSchema,
  vectorDatabaseDefinitionSchema,
  vectorDatabaseOverviewSchema,
  vectorDatabaseSearchInputSchema,
  vectorDatabaseSearchResultSchema,
  vectorChunkMutationResultSchema,
  vectorDocumentChunksSchema,
  vectorDocumentDetailSchema,
  vectorDocumentSchema,
  vectorFolderSchema,
  vectorDeletionImpactSchema,
  vectorIngestionJobSchema,
} from "@tali/contracts";
import { z } from "zod";
import { defineContracts } from "./contract";
import { projectRoute, response, route } from "./helpers";
import {
  catalogCollectionParamsSchema,
  catalogNamedResourceParamsSchema,
  catalogResourceParamsSchema,
  demoAgentParamsSchema,
  demoAgentMessageInputSchema,
  domainObjectSchema,
  gardenAgentParamsSchema,
  vectorChunkParamsSchema,
  messageSchema,
  runtimeBridgeAgentParamsSchema,
  runtimeBridgeCoordinatorParamsSchema,
  runtimeBridgeVectorDatabaseParamsSchema,
  vectorDocumentParamsSchema,
  vectorFolderParamsSchema,
} from "./schemas";

const catalogSchema = z.object({
  skills: z.array(skillDefinitionSchema),
  mcpServers: z.array(mcpServerDefinitionSchema),
  vectorDatabases: z.array(vectorDatabaseDefinitionSchema),
}).loose().meta({ id: "ResourceCatalog" });

const createCatalogInputSchema = z.union([
  createSkillDefinitionSchema,
  createMcpServerDefinitionSchema,
  createVectorDatabaseDefinitionSchema,
]);
const updateCatalogInputSchema = z.union([
  updateSkillDefinitionSchema,
  updateMcpServerDefinitionSchema,
  updateVectorDatabaseDefinitionSchema,
]);
const catalogResourceSchema = z.union([
  skillDefinitionSchema,
  mcpServerDefinitionSchema,
  vectorDatabaseDefinitionSchema,
]);
const vectorDocumentUploadSchema = z.object({
  file: z.string().meta({ contentEncoding: "binary" }),
  folderId: z.string().uuid().nullable().optional(),
  directoryPath: z.string().startsWith("/").optional(),
}).strict().meta({ id: "VectorDocumentUploadForm" });
const queuedVectorDocumentSchema = z.object({
  document: vectorDocumentSchema,
  job: vectorIngestionJobSchema,
}).strict().meta({ id: "QueuedVectorDocument" });
const runtimeMemoryRecallInputSchema = z.object({
  query: z.string().trim().min(1).max(16_000),
  maxItems: z.number().int().min(1).max(12).default(6),
}).strict().meta({ id: "RuntimeMemoryRecallInput" });
const runtimeMemoryRecallResponseSchema = z.object({
  context: z.string().nullable(),
  degraded: z.boolean(),
  itemCount: z.number().int().nonnegative(),
}).strict().meta({ id: "RuntimeMemoryRecallResponse" });
const runtimeMemoryRetainInputSchema = z.object({
  conversationId: z.string().trim().min(1).max(240),
  sessionId: z.string().trim().min(1).max(240).optional(),
  user: z.string().max(64_000),
  assistant: z.string().max(64_000),
  occurredAt: z.iso.datetime().optional(),
  toolSummaries: z.array(z.string().max(8_000)).max(64).default([]),
}).strict().meta({ id: "RuntimeMemoryRetainInput" });
const runtimeMemoryRetainResponseSchema = z.object({
  accepted: z.literal(true),
  conversationId: z.string(),
}).strict().meta({ id: "RuntimeMemoryRetainResponse" });

export const catalogContracts = defineContracts([
  projectRoute({
    method: "get", path: "/catalog", operationId: "getResourceCatalog",
    summary: "Read the Project resource catalog", tags: ["Resource catalog"],
    responses: { 200: response("Resource catalog", catalogSchema) },
  }),
  projectRoute({
    method: "post", path: "/catalog/{kind}", operationId: "createCatalogResource",
    summary: "Create a catalog resource", tags: ["Resource catalog"],
    request: { params: catalogCollectionParamsSchema, body: createCatalogInputSchema },
    responses: { 201: response("Created catalog resource", catalogResourceSchema) },
  }),
  projectRoute({
    method: "put", path: "/catalog/{kind}/{id}", operationId: "updateCatalogResource",
    summary: "Update a catalog resource", tags: ["Resource catalog"],
    request: { params: catalogResourceParamsSchema, body: updateCatalogInputSchema },
    responses: { 200: response("Updated catalog resource", catalogResourceSchema) },
  }),
  projectRoute({
    method: "delete", path: "/catalog/{kind}/{id}", operationId: "deleteCatalogResource",
    summary: "Delete a catalog resource", tags: ["Resource catalog"],
    request: { params: catalogResourceParamsSchema },
    responses: { 200: response("Deleted catalog resource", messageSchema) },
  }),
  projectRoute({
    method: "put", path: "/catalog/vector-databases/{id}/chunks", operationId: "upsertVectorChunks",
    summary: "Embed and upsert built-in PostgreSQL vector chunks", tags: ["Vector Databases"],
    request: { params: catalogNamedResourceParamsSchema, body: upsertVectorChunksSchema },
    responses: { 200: response("Upserted vector chunks", vectorChunkMutationResultSchema) },
  }),
  projectRoute({
    method: "get", path: "/catalog/vector-databases/{id}", operationId: "getVectorDatabaseOverview",
    summary: "Read a Vector Database, its documents, and ingestion activity", tags: ["Vector Databases"],
    request: { params: catalogNamedResourceParamsSchema },
    responses: { 200: response("Vector Database overview", vectorDatabaseOverviewSchema) },
  }),
  projectRoute({
    method: "post", path: "/catalog/vector-databases/{id}/documents", operationId: "queueVectorDocument",
    summary: "Queue a document for Docling parsing and vector indexing", tags: ["Vector Databases"],
    request: {
      params: catalogNamedResourceParamsSchema,
      body: vectorDocumentUploadSchema,
      contentType: "multipart/form-data",
    },
    responses: { 202: response("Queued Vector Document", queuedVectorDocumentSchema) },
  }),
  projectRoute({
    method: "post", path: "/catalog/vector-databases/{id}/folders", operationId: "createVectorFolder",
    summary: "Create a logical folder in a Vector Database", tags: ["Vector Databases"],
    request: { params: catalogNamedResourceParamsSchema, body: createVectorFolderSchema },
    responses: { 201: response("Created Vector Folder", vectorFolderSchema) },
  }),
  projectRoute({
    method: "patch", path: "/catalog/vector-databases/{id}/folders/{folderId}", operationId: "updateVectorFolder",
    summary: "Rename or move a logical Vector Database folder", tags: ["Vector Databases"],
    request: { params: vectorFolderParamsSchema, body: updateVectorFolderSchema },
    responses: { 200: response("Updated Vector Folder", vectorFolderSchema) },
  }),
  projectRoute({
    method: "delete", path: "/catalog/vector-databases/{id}/folders/{folderId}", operationId: "deleteVectorFolder",
    summary: "Recursively delete a Vector Database folder", tags: ["Vector Databases"],
    request: { params: vectorFolderParamsSchema },
    responses: { 200: response("Deleted Vector Folder impact", vectorDeletionImpactSchema) },
  }),
  projectRoute({
    method: "get", path: "/catalog/vector-databases/{id}/documents/{documentId}", operationId: "getVectorDocument",
    summary: "Read a Vector Document and a lightweight indexed-text preview", tags: ["Vector Databases"],
    request: { params: vectorDocumentParamsSchema },
    responses: { 200: response("Vector Document", vectorDocumentDetailSchema) },
  }),
  projectRoute({
    method: "get", path: "/catalog/vector-databases/{id}/documents/{documentId}/chunks", operationId: "getVectorDocumentChunks",
    summary: "Read the active chunks for a Vector Document", tags: ["Vector Databases"],
    request: { params: vectorDocumentParamsSchema },
    responses: { 200: response("Vector Document chunks", vectorDocumentChunksSchema) },
  }),
  projectRoute({
    method: "patch", path: "/catalog/vector-databases/{id}/documents/{documentId}", operationId: "updateVectorDocument",
    summary: "Update a Vector Database file and propagate metadata without re-embedding", tags: ["Vector Databases"],
    request: { params: vectorDocumentParamsSchema, body: updateVectorDocumentSchema },
    responses: { 200: response("Updated Vector Document", vectorDocumentSchema) },
  }),
  projectRoute({
    method: "delete", path: "/catalog/vector-databases/{id}/documents/{documentId}", operationId: "deleteVectorDocument",
    summary: "Delete a Vector Document and its chunks", tags: ["Vector Databases"],
    request: { params: vectorDocumentParamsSchema },
    responses: { 200: response("Deleted Vector Document", messageSchema) },
  }),
  projectRoute({
    method: "post", path: "/catalog/vector-databases/{id}/search", operationId: "searchVectorDatabase",
    summary: "Test Vector Database recall", tags: ["Vector Databases"],
    request: { params: catalogNamedResourceParamsSchema, body: vectorDatabaseSearchInputSchema },
    responses: { 200: response("Vector Database search results", vectorDatabaseSearchResultSchema) },
  }),
  projectRoute({
    method: "delete", path: "/catalog/vector-databases/{id}/chunks/{chunkId}", operationId: "deleteVectorChunk",
    summary: "Delete a built-in PostgreSQL vector chunk", tags: ["Vector Databases"],
    request: { params: vectorChunkParamsSchema },
    responses: { 200: response("Deleted vector chunk", messageSchema) },
  }),
  projectRoute({
    method: "post", path: "/catalog/mcp-servers/{id}/discover", operationId: "discoverMcpServerTools",
    summary: "Discover MCP server tools", tags: ["Resource catalog"],
    request: { params: catalogNamedResourceParamsSchema },
    responses: { 200: response("Discovered MCP server", mcpServerDefinitionSchema) },
  }),
  projectRoute({
    method: "post", path: "/catalog/skills/{id}/verify", operationId: "verifySkillArtifact",
    summary: "Verify a Skill artifact", tags: ["Resource catalog"],
    request: { params: catalogNamedResourceParamsSchema },
    responses: { 200: response("Verified Skill", skillDefinitionSchema) },
  }),
  projectRoute({
    method: "get", path: "/catalog/skills/{id}/archive", operationId: "downloadSkillArtifact",
    summary: "Download a Skill artifact", tags: ["Resource catalog"],
    request: { params: catalogNamedResourceParamsSchema },
    responses: { 200: response("Skill archive", z.string().meta({ contentEncoding: "binary" }), "application/gzip") },
  }),
  projectRoute({
    method: "get", path: "/agent-garden", operationId: "getAgentGarden",
    summary: "Read the Project Agent Garden", tags: ["Agent Garden"],
    responses: { 200: response("Agent Garden snapshot", agentGardenSnapshotSchema) },
  }),
  projectRoute({
    method: "post", path: "/agent-garden/onboard", operationId: "onboardGardenAgent",
    summary: "Onboard an A2A Agent into the Project Agent Garden",
    description: "Deploy an A2A-compatible container image or register an existing Agent through its A2A 1.0 Agent Card. The implementation framework is not part of the onboarding contract.",
    tags: ["Agent Garden"],
    request: { body: onboardAgentSchema },
    responses: { 201: response("Onboarded Agent", agentGardenEntrySchema) },
  }),
  projectRoute({
    method: "delete", path: "/agent-garden/agents/{id}", operationId: "removeGardenAgent",
    summary: "Remove an Agent Garden entry", tags: ["Agent Garden"],
    request: { params: gardenAgentParamsSchema },
    responses: { 200: response("Removed Agent", messageSchema) },
  }),
  projectRoute({
    method: "post", path: "/agent-garden/agents/{id}/discover", operationId: "discoverGardenAgent",
    summary: "Refresh an Agent Garden entry", tags: ["Agent Garden"],
    request: { params: gardenAgentParamsSchema },
    responses: { 200: response("Discovered Agent", agentGardenEntrySchema) },
  }),
  projectRoute({
    method: "post", path: "/agent-garden/agents/{id}/instances", operationId: "instantiateGardenAgent",
    summary: "Create a callable A2A Instance from a validated Agent Card", tags: ["Agent Garden"],
    request: { params: gardenAgentParamsSchema },
    responses: { 201: response("Created A2A Instance", a2aAgentInstanceSchema) },
  }),
  projectRoute({
    method: "delete", path: "/agent-garden/instances/{id}", operationId: "removeGardenInstance",
    summary: "Remove an external A2A Instance from the Project registry", tags: ["Agent Garden"],
    request: { params: gardenAgentParamsSchema },
    responses: { 200: response("Removed A2A Instance", messageSchema) },
  }),
  route({
    auth: "public", method: "get", path: "/demo-agents/{id}/agent-card",
    operationId: "getDemoAgentCard", summary: "Read a demo Agent Card", tags: ["Demo Agents"],
    request: { params: demoAgentParamsSchema },
    responses: { 200: response("Demo Agent Card", domainObjectSchema) },
  }),
  route({
    auth: "public", method: "post", path: "/demo-agents/{id}",
    operationId: "sendDemoAgentMessage", summary: "Send a message to a demo Agent", tags: ["Demo Agents"],
    request: { params: demoAgentParamsSchema, body: demoAgentMessageInputSchema },
    responses: { 200: response("Demo Agent response", domainObjectSchema) },
  }),
  route({
    auth: "runtime-bridge", method: "get",
    path: "/runtime-bridge/coordinators/{coordinatorInstanceId}/agents",
    operationId: "listRuntimeBridgeAgents",
    summary: "List discoverable Project A2A Instances for a Coordinator",
    tags: ["Runtime Bridge"],
    request: { params: runtimeBridgeCoordinatorParamsSchema },
    responses: { 200: response("Project A2A peer directory", domainObjectSchema) },
  }),
  route({
    auth: "runtime-bridge", method: "get",
    path: "/runtime-bridge/coordinators/{coordinatorInstanceId}/agents/{agentId}/agent-card",
    operationId: "getRuntimeBridgeAgentCard",
    summary: "Read an Instance Agent Card through the Project Runtime Bridge",
    tags: ["Runtime Bridge"],
    request: { params: runtimeBridgeAgentParamsSchema },
    responses: { 200: response("Proxied A2A Agent Card", domainObjectSchema) },
  }),
  route({
    auth: "runtime-bridge", method: "post",
    path: "/runtime-bridge/coordinators/{coordinatorInstanceId}/agents/{agentId}",
    operationId: "sendRuntimeBridgeAgentMessage",
    summary: "Send an A2A message through the Project Runtime Bridge",
    tags: ["Runtime Bridge"],
    request: { params: runtimeBridgeAgentParamsSchema, body: domainObjectSchema },
    responses: { 200: response("Proxied A2A response", domainObjectSchema) },
  }),
  route({
    auth: "runtime-bridge", method: "get",
    path: "/runtime-bridge/coordinators/{coordinatorInstanceId}/vector-databases",
    operationId: "listRuntimeBridgeVectorDatabases",
    summary: "List the current Project Vector Databases for a Hermes Coordinator",
    tags: ["Runtime Bridge"],
    request: { params: runtimeBridgeCoordinatorParamsSchema },
    responses: { 200: response("Project Vector Database directory", domainObjectSchema) },
  }),
  route({
    auth: "runtime-bridge", method: "post",
    path: "/runtime-bridge/coordinators/{coordinatorInstanceId}/vector-databases/{databaseId}/search",
    operationId: "searchRuntimeBridgeVectorDatabase",
    summary: "Search a Project Vector Database for a Hermes Coordinator",
    tags: ["Runtime Bridge"],
    request: {
      params: runtimeBridgeVectorDatabaseParamsSchema,
      body: vectorDatabaseSearchInputSchema,
    },
    responses: { 200: response("Project Vector Database search results", domainObjectSchema) },
  }),
  route({
    auth: "runtime-bridge", method: "post",
    path: "/runtime-bridge/coordinators/{coordinatorInstanceId}/memory/recall",
    operationId: "recallRuntimeMemory",
    summary: "Recall the Coordinator's fixed Durable Memory",
    tags: ["Runtime Bridge"],
    request: {
      params: runtimeBridgeCoordinatorParamsSchema,
      body: runtimeMemoryRecallInputSchema,
    },
    responses: { 200: response("Fail-open Memory context", runtimeMemoryRecallResponseSchema) },
  }),
  route({
    auth: "runtime-bridge", method: "post",
    path: "/runtime-bridge/coordinators/{coordinatorInstanceId}/memory/retain",
    operationId: "retainRuntimeMemory",
    summary: "Queue a turn into the Coordinator's fixed Durable Memory",
    tags: ["Runtime Bridge"],
    request: {
      params: runtimeBridgeCoordinatorParamsSchema,
      body: runtimeMemoryRetainInputSchema,
    },
    responses: { 202: response("Memory retain accepted", runtimeMemoryRetainResponseSchema) },
  }),
]);
