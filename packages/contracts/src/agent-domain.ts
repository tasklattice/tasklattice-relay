import { z } from "zod";

/**
 * Product form answers how a person or another system consumes an Agent.
 * It is intentionally independent from the implementation framework and
 * execution strategy.
 */
export const agentProductForms = [
  "INTERACTIVE",
  "SERVICE",
  "HYBRID",
] as const;

/** The Agent's role inside an orchestration topology. */
export const agentCollaborationRoles = [
  "SUPERVISOR",
  "SPECIALIST",
  "HYBRID",
] as const;

/** How a Project-developed Agent executes its contract. */
export const agentExecutionStrategies = ["AGENTIC", "WORKFLOW"] as const;

export const agentA2aDirections = ["CLIENT", "SERVER"] as const;

export const agentRuntimeClassificationSchema = z.object({
  form: z.enum(agentProductForms),
  role: z.enum(agentCollaborationRoles),
  executionStrategy: z.enum(agentExecutionStrategies).nullable(),
  a2a: z.object({
    version: z.literal("1.0"),
    directions: z.array(z.enum(agentA2aDirections)),
    agentCardStatus: z.enum(["VALID", "INVALID", "UNCHECKED"]),
  }).strict(),
}).strict();

export type AgentProductForm = (typeof agentProductForms)[number];
export type AgentCollaborationRole =
  (typeof agentCollaborationRoles)[number];
export type AgentExecutionStrategy =
  (typeof agentExecutionStrategies)[number];
export type AgentA2aDirection = (typeof agentA2aDirections)[number];
export type AgentRuntimeClassification = z.infer<
  typeof agentRuntimeClassificationSchema
>;
