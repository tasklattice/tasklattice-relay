import { z } from "zod";

const id = z.string().min(1).max(160);
const text = z.string().trim().min(1).max(8000);
export const workDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: text,
  evidence: z.string().max(4000),
}).strict();
export const workTaskSchema = z
  .object({
    id,
    title: z.string().trim().min(1).max(200),
    status: z.enum([
      "todo",
      "running",
      "decision",
      "done",
      "deferred",
      "cancelled",
    ]),
    reason: z.string().max(2000),
    ownerInstanceId: id.nullable(),
    dependencies: z.array(id).max(40),
    acceptance: text,
    replaces: id.nullable(),
    sourceMessageId: id,
  })
  .strict();
export const workPlanSchema = z
  .object({
    reply: text,
    changes: z.array(workTaskSchema).max(40),
  })
  .strict();
export const workArtifactSchema = z.object({
  id,
  taskId: id.nullable(),
  runId: id,
  sourceMessageId: id,
  instanceId: id,
  taskScopeHash: z.string(),
  title: z.string().max(200),
  content: text,
  version: z.number().int().positive(),
  previousId: id.nullable(),
  status: z.enum(["draft", "verified", "delivered"]),
  evidence: z.string().max(4000),
  verifiedBy: id.nullable(),
});
export const workStateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  goal: text,
  ownerUserId: id,
  memberUserIds: z.array(id).min(1).max(100),
  agents: z
    .array(
      z.object({
        instanceId: id,
        name: z.string(),
        role: z.enum(["coordinator", "expert"]),
        versionId: id,
        capability: z.string(),
      }),
    )
    .max(16),
  tasks: z.array(workTaskSchema).max(200),
  artifacts: z.array(workArtifactSchema).max(200),
  defaultView: z.enum(["chat", "board", "artifacts"]),
  modelCallLimit: z.number().int().min(0).max(1000),
  modelCallsUsed: z.number().int().nonnegative(),
});
export const createWorkSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    goal: text,
    idempotencyKey: z.string().uuid(),
    startPlanning: z.boolean().default(false),
  })
  .strict();
export const workCommandSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    action: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("message"),
          text,
          source: z.enum(["text", "final_transcript"]).default("text"),
        })
        .strict(),
      z
        .object({
          type: z.literal("members"),
          userIds: z.array(id).min(1).max(100),
        })
        .strict(),
      z
        .object({
          type: z.literal("bind"),
          instanceId: id,
          role: z.enum(["coordinator", "expert"]),
        })
        .strict(),
      z
        .object({
          type: z.literal("view"),
          view: z.enum(["chat", "board", "artifacts"]),
        })
        .strict(),
      z.object({ type: z.literal("plan"), sourceMessageId: id }).strict(),
      z.object({ type: z.literal("execute"), taskId: id }).strict(),
      z.object({ type: z.literal("cancel"), runId: id }).strict(),
      z
        .object({
          type: z.literal("resolve_unknown"),
          runId: id,
          evidence: text,
        })
        .strict(),
      z
        .object({ type: z.literal("verify"), artifactId: id, evidence: text })
        .strict(),
      z.object({ type: z.literal("deliver"), artifactId: id }).strict(),
    ]),
  })
  .strict();
export type WorkState = z.infer<typeof workStateSchema>;
export type WorkTask = z.infer<typeof workTaskSchema>;
export type WorkPlan = z.infer<typeof workPlanSchema>;
export type WorkCommand = z.infer<typeof workCommandSchema>;
export interface WorkMessage {
  id: string;
  kind: "human" | "agent";
  userId: string | null;
  instanceId: string | null;
  name: string;
  text: string;
  createdAt: string;
  source: string;
}
export interface WorkEvent {
  sequence: number;
  type: string;
  summary: string;
  createdAt: string;
}
export interface WorkRun {
  id: string;
  taskId: string | null;
  instanceId: string;
  status: string;
  reason: string | null;
  kind: string;
  createdAt: string;
}
export interface WorkSnapshot {
  id: string;
  projectId: string;
  revision: number;
  state: WorkState;
  messages: WorkMessage[];
  events: WorkEvent[];
  runs: WorkRun[];
}

/** Only the trusted server author ID controls message direction. */
export function isOwnWorkMessage(
  message: Pick<WorkMessage, "kind" | "userId">,
  currentUserId: string,
) {
  return message.kind === "human" && message.userId === currentUserId;
}
