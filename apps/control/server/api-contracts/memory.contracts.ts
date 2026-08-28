import {
  memoryActivityPageSchema,
  memoryBindingCreateInputSchema,
  memoryBindingViewSchema,
  memoryBindingPageSchema,
  memoryConversationActionInputSchema,
  memoryConversationDeleteResultSchema,
  memoryConversationPageSchema,
  memoryConversationSchema,
  memoryCreateInputSchema,
  memoryDeleteInputSchema,
  memoryDeleteResultSchema,
  memoryExperiencePageSchema,
  memoryExperienceSchema,
  memoryExperienceUpdateInputSchema,
  memoryExportGrantSchema,
  memoryExportRequestInputSchema,
  memoryFactPageSchema,
  memoryFactSchema,
  memoryFactUpdateInputSchema,
  memoryInsightPageSchema,
  memoryItemSchema,
  memoryOutboxPageSchema,
  memoryOverviewSchema,
  memoryRenameInputSchema,
  memoryReextractResultSchema,
  memoryResourceDetailSchema,
  memoryResourcePageSchema,
  memorySettingsSchema,
  memoryStatuses,
} from "@tali/contracts";
import { z } from "zod";
import { defineContracts } from "./contract";
import { projectRoute, response } from "./helpers";
import {
  memoryConversationParamsSchema,
  memoryBindingParamsSchema,
  memoryExportParamsSchema,
  memoryItemParamsSchema,
  memoryOutboxParamsSchema,
  memoryParamsSchema,
} from "./schemas";

const resourceQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  query: z.string().optional(),
  status: z.union([z.enum(memoryStatuses), z.array(z.enum(memoryStatuses))]).optional(),
});

const itemQuery = z.object({
  cursor: z.string().optional(),
  from: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  query: z.string().optional(),
  source_document_id: z.string().optional(),
  status: z.enum(["active", "invalidated"]).optional(),
  to: z.iso.datetime().optional(),
});

const outboxQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.union([
    z.enum(["pending", "processing", "retry", "delivered", "dead_letter"]),
    z.array(z.enum(["pending", "processing", "retry", "delivered", "dead_letter"])),
  ]).optional(),
});

const reextractParams = memoryConversationParamsSchema;
const noContent = response("Operation accepted");

export const memoryContracts = defineContracts([
  projectRoute({
    method: "get", path: "/memories", operationId: "listMemories",
    summary: "List Durable Memory resources", tags: ["Memory"],
    request: { query: resourceQuery },
    responses: { 200: response("Durable Memory page", memoryResourcePageSchema) },
  }),
  projectRoute({
    method: "post", path: "/memories", operationId: "createMemory",
    summary: "Create a Durable Memory", tags: ["Memory"],
    request: { body: memoryCreateInputSchema },
    responses: { 201: response("Created Durable Memory", memoryResourceDetailSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}", operationId: "getMemory",
    summary: "Read a Durable Memory", tags: ["Memory"],
    request: { params: memoryParamsSchema },
    responses: { 200: response("Durable Memory", memoryResourceDetailSchema) },
  }),
  projectRoute({
    method: "patch", path: "/memories/{memoryId}", operationId: "renameMemory",
    summary: "Rename a Durable Memory", tags: ["Memory"],
    request: { params: memoryParamsSchema, body: memoryRenameInputSchema },
    responses: { 200: response("Renamed Durable Memory", memoryResourceDetailSchema) },
  }),
  projectRoute({
    method: "delete", path: "/memories/{memoryId}", operationId: "deleteMemory",
    summary: "Delete a detached Durable Memory after confirmation", tags: ["Memory"],
    request: { params: memoryParamsSchema, body: memoryDeleteInputSchema },
    responses: { 200: response("Verified Memory deletion", memoryDeleteResultSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/overview", operationId: "getMemoryOverview",
    summary: "Read Memory counts and recent activity", tags: ["Memory"],
    request: { params: memoryParamsSchema },
    responses: { 200: response("Memory overview", memoryOverviewSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/activity", operationId: "listMemoryActivity",
    summary: "List Memory governance activity", tags: ["Memory"],
    request: { params: memoryParamsSchema },
    responses: { 200: response("Memory activity", memoryActivityPageSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/settings", operationId: "getMemorySettings",
    summary: "Read Memory retention and Provider health settings", tags: ["Memory"],
    request: { params: memoryParamsSchema },
    responses: { 200: response("Memory settings", memorySettingsSchema) },
  }),
  projectRoute({
    method: "post", path: "/memories/{memoryId}/retry", operationId: "retryMemoryProvisioning",
    summary: "Retry a provisioning or degraded Memory", tags: ["Memory"],
    request: { params: memoryParamsSchema },
    responses: { 200: response("Recovered Durable Memory", memoryResourceDetailSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/bindings", operationId: "listMemoryBindings",
    summary: "List Memory runtime binding history", tags: ["Memory"],
    request: { params: memoryParamsSchema },
    responses: { 200: response("Memory binding history", memoryBindingPageSchema) },
  }),
  projectRoute({
    method: "post", path: "/memories/{memoryId}/bindings", operationId: "bindMemory",
    summary: "Bind a detached Memory to an Agent Instance", tags: ["Memory"],
    request: { params: memoryParamsSchema, body: memoryBindingCreateInputSchema },
    responses: { 201: response("Active Memory binding", memoryBindingViewSchema) },
  }),
  projectRoute({
    method: "delete", path: "/memories/{memoryId}/bindings/{bindingId}", operationId: "unbindMemory",
    summary: "Detach a Memory while preserving its content", tags: ["Memory"],
    request: { params: memoryBindingParamsSchema },
    responses: { 200: response("Detached Durable Memory", memoryResourceDetailSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/conversations", operationId: "listMemoryConversations",
    summary: "List retained Conversations", tags: ["Memory"],
    request: { params: memoryParamsSchema, query: itemQuery },
    responses: { 200: response("Conversation page", memoryConversationPageSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/conversations/{conversationId}", operationId: "getMemoryConversation",
    summary: "Read a retained Conversation and evidence", tags: ["Memory"],
    request: { params: memoryConversationParamsSchema },
    responses: { 200: response("Retained Conversation", memoryConversationSchema) },
  }),
  projectRoute({
    method: "delete", path: "/memories/{memoryId}/conversations/{conversationId}", operationId: "deleteMemoryConversation",
    summary: "Delete a Conversation and invalidate orphaned derivations", tags: ["Memory"],
    request: { params: memoryConversationParamsSchema, body: memoryConversationActionInputSchema },
    responses: { 200: response("Conversation deletion impact", memoryConversationDeleteResultSchema) },
  }),
  projectRoute({
    method: "post", path: "/memories/{memoryId}/conversations/{conversationId}/reextract", operationId: "reextractMemoryConversation",
    summary: "Re-extract a retained Conversation", tags: ["Memory"],
    request: { params: reextractParams, body: memoryConversationActionInputSchema },
    responses: { 202: response("Re-extraction accepted", memoryReextractResultSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/facts", operationId: "listMemoryFacts",
    summary: "List Memory Facts", tags: ["Memory"],
    request: { params: memoryParamsSchema, query: itemQuery },
    responses: { 200: response("Fact page", memoryFactPageSchema) },
  }),
  projectRoute({
    method: "patch", path: "/memories/{memoryId}/facts/{itemId}", operationId: "updateMemoryFact",
    summary: "Revise a Memory Fact with optimistic concurrency", tags: ["Memory"],
    request: { params: memoryItemParamsSchema, body: memoryFactUpdateInputSchema },
    responses: { 200: response("Revised Fact", memoryFactSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/experiences", operationId: "listMemoryExperiences",
    summary: "List structured Memory Experiences", tags: ["Memory"],
    request: { params: memoryParamsSchema, query: itemQuery },
    responses: { 200: response("Experience page", memoryExperiencePageSchema) },
  }),
  projectRoute({
    method: "patch", path: "/memories/{memoryId}/experiences/{itemId}", operationId: "updateMemoryExperience",
    summary: "Revise a structured Experience with optimistic concurrency", tags: ["Memory"],
    request: { params: memoryItemParamsSchema, body: memoryExperienceUpdateInputSchema },
    responses: { 200: response("Revised Experience", memoryExperienceSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/insights", operationId: "listMemoryInsights",
    summary: "List learned Memory Insights", tags: ["Memory"],
    request: { params: memoryParamsSchema, query: itemQuery },
    responses: { 200: response("Insight page", memoryInsightPageSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/items/{itemId}", operationId: "getMemoryItem",
    summary: "Read a Memory item and its evidence", tags: ["Memory"],
    request: { params: memoryItemParamsSchema },
    responses: { 200: response("Memory item", memoryItemSchema) },
  }),
  projectRoute({
    method: "post", path: "/memories/{memoryId}/items/{itemId}/invalidate", operationId: "invalidateMemoryItem",
    summary: "Invalidate a Fact, Experience, or learned Insight", tags: ["Memory"],
    request: { params: memoryItemParamsSchema },
    responses: { 200: response("Invalidated Memory item", memoryItemSchema) },
  }),
  projectRoute({
    method: "post", path: "/memories/{memoryId}/items/{itemId}/restore", operationId: "restoreMemoryItem",
    summary: "Restore an invalidated Memory item", tags: ["Memory"],
    request: { params: memoryItemParamsSchema },
    responses: { 200: response("Restored Memory item", memoryItemSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/outbox", operationId: "listMemoryOutbox",
    summary: "List Memory retain delivery state", tags: ["Memory"],
    request: { params: memoryParamsSchema, query: outboxQuery },
    responses: { 200: response("Memory outbox page", memoryOutboxPageSchema) },
  }),
  projectRoute({
    method: "post", path: "/memories/{memoryId}/outbox/{outboxId}/replay", operationId: "replayMemoryOutbox",
    summary: "Replay a failed Memory retain event", tags: ["Memory"],
    request: { params: memoryOutboxParamsSchema },
    responses: { 204: noContent },
  }),
  projectRoute({
    method: "post", path: "/memories/{memoryId}/exports", operationId: "authorizeMemoryExport",
    summary: "Authorize a short-lived Memory export download", tags: ["Memory"],
    request: { params: memoryParamsSchema, body: memoryExportRequestInputSchema },
    responses: { 201: response("Memory export authorization", memoryExportGrantSchema) },
  }),
  projectRoute({
    method: "get", path: "/memories/{memoryId}/exports/{token}", operationId: "downloadMemoryExport",
    summary: "Download an authorized Memory export", tags: ["Memory"],
    request: { params: memoryExportParamsSchema },
    responses: {
      200: response(
        "Sanitized Memory export",
        z.string().meta({ contentEncoding: "binary" }),
        "application/json",
      ),
    },
  }),
]);
