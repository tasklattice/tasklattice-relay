import { z } from "zod";

export const memoryStatuses = [
  "provisioning",
  "ready",
  "degraded",
  "unbound",
  "deleting",
  "deletion_failed",
  "deleted",
] as const;

export const memoryBindingStatuses = ["pending", "active", "detached"] as const;
export const memoryRuntimeTypes = ["openclaw", "hermes"] as const;
export const memoryItemStatuses = ["active", "invalidated"] as const;

export type MemoryStatus = (typeof memoryStatuses)[number];
export type MemoryBindingStatus = (typeof memoryBindingStatuses)[number];
export type MemoryRuntimeType = (typeof memoryRuntimeTypes)[number];
export type MemoryItemStatus = (typeof memoryItemStatuses)[number];

const isoDateTimeSchema = z.string().datetime();

export const memoryEvidenceSchema = z.object({
  sourceDocumentId: z.string().min(1),
  sourceItemId: z.string().min(1).nullable().default(null),
  excerpt: z.string().nullable().default(null),
  occurredAt: isoDateTimeSchema.nullable().default(null),
}).strict();

export type MemoryEvidence = z.infer<typeof memoryEvidenceSchema>;

export const memoryConversationMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system", "tool"]),
  text: z.string(),
  occurredAt: isoDateTimeSchema,
}).strict();

export const memoryConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  sourceDocumentIds: z.array(z.string().min(1)),
  startedAt: isoDateTimeSchema,
  endedAt: isoDateTimeSchema.nullable().default(null),
  messages: z.array(memoryConversationMessageSchema),
}).strict();

export const memoryFactSchema = z.object({
  kind: z.literal("fact"),
  id: z.string().min(1),
  text: z.string(),
  status: z.enum(memoryItemStatuses),
  evidence: z.array(memoryEvidenceSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

export const memoryExperienceSchema = z.object({
  kind: z.literal("experience"),
  id: z.string().min(1),
  title: z.string(),
  summary: z.string(),
  situation: z.string(),
  goal: z.string(),
  actions: z.array(z.string()),
  outcome: z.string(),
  lessonLearned: z.string(),
  status: z.enum(memoryItemStatuses),
  occurredStart: isoDateTimeSchema.nullable(),
  occurredEnd: isoDateTimeSchema.nullable(),
  hindsightMemoryIds: z.array(z.string().min(1)),
  sourceDocumentIds: z.array(z.string().min(1)),
  evidence: z.array(memoryEvidenceSchema),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

export const memoryInsightSchema = z.object({
  kind: z.literal("insight"),
  id: z.string().min(1),
  text: z.string(),
  status: z.enum(memoryItemStatuses),
  evidence: z.array(memoryEvidenceSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

export const memoryItemSchema = z.discriminatedUnion("kind", [
  memoryFactSchema,
  memoryExperienceSchema,
  memoryInsightSchema,
]);

export const memorySummarySchema = z.object({
  text: z.string(),
  generatedAt: isoDateTimeSchema,
}).strict();

export type MemoryConversationMessage = z.infer<typeof memoryConversationMessageSchema>;
export type MemoryConversation = z.infer<typeof memoryConversationSchema>;
export type MemoryFact = z.infer<typeof memoryFactSchema>;
export type MemoryExperience = z.infer<typeof memoryExperienceSchema>;
export type MemoryInsight = z.infer<typeof memoryInsightSchema>;
export type MemoryItem = z.infer<typeof memoryItemSchema>;
export type MemorySummary = z.infer<typeof memorySummarySchema>;

export interface MemoryPage<T> {
  items: T[];
  nextCursor: string | null;
  totalCount: number;
}

export const memoryCreateInputSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  retentionPolicy: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const memoryRenameInputSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
}).strict();

export const memoryFactUpdateInputSchema = z.object({
  text: z.string().trim().min(1).max(32_000),
  expectedUpdatedAt: isoDateTimeSchema,
}).strict();

export const memoryExperienceUpdateInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(16_000),
  situation: z.string().max(16_000),
  goal: z.string().max(16_000),
  actions: z.array(z.string().trim().min(1).max(4_000)).max(100),
  outcome: z.string().max(16_000),
  lessonLearned: z.string().max(16_000),
  occurredStart: isoDateTimeSchema.nullable(),
  occurredEnd: isoDateTimeSchema.nullable(),
  expectedVersion: z.number().int().positive(),
}).strict().refine(
  (value) => !value.occurredStart || !value.occurredEnd
    || value.occurredStart <= value.occurredEnd,
  { message: "occurredStart must be before or equal to occurredEnd.", path: ["occurredEnd"] },
);

export const memoryConversationActionInputSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(240),
}).strict();

export const memoryExportRequestInputSchema = z.object({
  format: z.literal("json").default("json"),
}).strict();

export const memoryDeleteInputSchema = z.object({
  confirmation: z.string().trim().min(1).max(120),
}).strict();

export const memoryBindingCreateInputSchema = z.object({
  instanceId: z.string().trim().min(1).max(240),
  runtimeType: z.enum(memoryRuntimeTypes),
}).strict();

export type MemoryCreateInput = z.infer<typeof memoryCreateInputSchema>;
export type MemoryRenameInput = z.infer<typeof memoryRenameInputSchema>;
export type MemoryFactUpdateInput = z.infer<typeof memoryFactUpdateInputSchema>;
export type MemoryExperienceUpdateInput = z.infer<
  typeof memoryExperienceUpdateInputSchema
>;

export interface MemoryBindingView {
  id: string;
  instanceId: string;
  runtimeType: MemoryRuntimeType;
  status: MemoryBindingStatus;
  attachedAt: string | null;
  detachedAt: string | null;
}

export interface MemoryContentCounts {
  conversations: number;
  experiences: number;
  facts: number;
  insights: number;
}

export interface MemoryResourceView {
  id: string;
  displayName: string;
  status: MemoryStatus;
  activeBinding: MemoryBindingView | null;
  counts: MemoryContentCounts | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryResourceDetailView extends MemoryResourceView {
  bindingHistory: MemoryBindingView[];
  degradedReason: string | null;
  retentionPolicy: Record<string, unknown>;
}

export interface MemoryProviderSettingsView {
  provider: "Hindsight" | string;
  providerHealth: "healthy" | "degraded" | "unavailable";
  checkedAt: string;
  providerReferenceHint: string | null;
}

export interface MemoryActivityView {
  id: string;
  action: string;
  actorId: string;
  occurredAt: string;
  providerItemId: string;
}

export interface MemoryOutboxView {
  id: string;
  conversationId: string;
  eventType: string;
  status: "pending" | "processing" | "retry" | "delivered" | "dead_letter";
  retryCount: number;
  nextRetryAt: string;
  lastErrorSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryExportGrantView {
  downloadUrl: string;
  expiresAt: string;
}

export const memoryBindingViewSchema = z.object({
  id: z.string().min(1),
  instanceId: z.string().min(1),
  runtimeType: z.enum(memoryRuntimeTypes),
  status: z.enum(memoryBindingStatuses),
  attachedAt: isoDateTimeSchema.nullable(),
  detachedAt: isoDateTimeSchema.nullable(),
}).strict();

export const memoryContentCountsSchema = z.object({
  conversations: z.number().int().nonnegative(),
  experiences: z.number().int().nonnegative(),
  facts: z.number().int().nonnegative(),
  insights: z.number().int().nonnegative(),
}).strict();

export const memoryResourceSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  status: z.enum(memoryStatuses),
  activeBinding: memoryBindingViewSchema.nullable(),
  counts: memoryContentCountsSchema.nullable(),
  lastActivityAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict().meta({ id: "MemoryResource" });

export const memoryResourceDetailSchema = memoryResourceSchema.extend({
  bindingHistory: z.array(memoryBindingViewSchema),
  degradedReason: z.string().nullable(),
  retentionPolicy: z.record(z.string(), z.unknown()),
}).strict().meta({ id: "MemoryResourceDetail" });

export const memoryResourcePageSchema = z.object({
  items: z.array(memoryResourceSchema),
  nextCursor: z.string().nullable(),
  totalCount: z.number().int().nonnegative(),
}).strict().meta({ id: "MemoryResourcePage" });

function memoryPageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    totalCount: z.number().int().nonnegative(),
  }).strict();
}

export const memoryConversationPageSchema = memoryPageSchema(memoryConversationSchema)
  .meta({ id: "MemoryConversationPage" });
export const memoryFactPageSchema = memoryPageSchema(memoryFactSchema)
  .meta({ id: "MemoryFactPage" });
export const memoryExperiencePageSchema = memoryPageSchema(memoryExperienceSchema)
  .meta({ id: "MemoryExperiencePage" });
export const memoryInsightPageSchema = memoryPageSchema(memoryInsightSchema)
  .meta({ id: "MemoryInsightPage" });

export const memoryActivitySchema = z.object({
  id: z.string().min(1),
  action: z.string(),
  actorId: z.string(),
  occurredAt: isoDateTimeSchema,
  providerItemId: z.string(),
}).strict();

export const memoryOverviewSchema = z.object({
  learnedInsights: z.array(memoryInsightSchema),
  memory: memoryResourceDetailSchema,
  recentActivity: z.array(memoryActivitySchema),
}).strict().meta({ id: "MemoryOverview" });

export const memoryProviderSettingsSchema = z.object({
  provider: z.string(),
  providerHealth: z.enum(["healthy", "degraded", "unavailable"]),
  checkedAt: isoDateTimeSchema,
  providerReferenceHint: z.string().nullable(),
}).strict();

export const memorySettingsSchema = z.object({
  memory: memoryResourceDetailSchema,
  provider: memoryProviderSettingsSchema,
}).strict().meta({ id: "MemorySettings" });

export const memoryOutboxSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string(),
  eventType: z.string(),
  status: z.enum(["pending", "processing", "retry", "delivered", "dead_letter"]),
  retryCount: z.number().int().nonnegative(),
  nextRetryAt: isoDateTimeSchema,
  lastErrorSummary: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

export const memoryOutboxPageSchema = memoryPageSchema(memoryOutboxSchema)
  .meta({ id: "MemoryOutboxPage" });

export const memoryExportGrantSchema = z.object({
  downloadUrl: z.string(),
  expiresAt: isoDateTimeSchema,
}).strict().meta({ id: "MemoryExportGrant" });

export const memoryBindingPageSchema = z.object({
  items: z.array(memoryBindingViewSchema),
}).strict().meta({ id: "MemoryBindingHistory" });

export const memoryActivityPageSchema = z.object({
  items: z.array(memoryActivitySchema),
}).strict().meta({ id: "MemoryActivityPage" });

export const memoryDeleteResultSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("deleted"),
}).strict().meta({ id: "MemoryDeleteResult" });

export const memoryConversationDeleteResultSchema = z.object({
  deleted: z.boolean(),
  invalidatedDerivedItems: z.number().int().nonnegative(),
}).strict().meta({ id: "MemoryConversationDeleteResult" });

export const memoryReextractResultSchema = z.object({
  acceptedAt: isoDateTimeSchema,
  operationId: z.string(),
}).strict().meta({ id: "MemoryReextractResult" });
