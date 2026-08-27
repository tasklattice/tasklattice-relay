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
}
