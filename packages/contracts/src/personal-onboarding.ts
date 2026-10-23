import { z } from "zod";

export const personalConnectSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  provider: z.enum(["openai", "deepseek", "openrouter", "nvidia-nim", "custom-openai-compatible"]),
  endpoint: z.string().url().max(2000),
  apiKey: z.string().trim().min(1).max(8192),
  modelId: z.string().trim().min(1).max(160),
  budgetUsd: z.number().positive().max(100),
}).strict();
export const personalPrepareSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export const personalSetupStateSchema = z.object({
  providerAccountId: z.string().optional(),
  modelDeploymentId: z.string().optional(),
  modelId: z.string().optional(),
  provider: z.string().optional(),
  endpoint: z.string().optional(),
  budgetUsd: z.number().optional(),
  routingId: z.string().optional(),
  coordinatorAgentId: z.string().optional(),
  expertAgentId: z.string().optional(),
  coordinatorInstanceId: z.string().optional(),
  expertInstanceId: z.string().optional(),
}).strict();
export type PersonalSetupState = z.infer<typeof personalSetupStateSchema>;
export interface PersonalOnboardingStatus {
  eligible: boolean;
  revision: number;
  status: "EMPTY" | "CONNECTING" | "CONNECTED" | "PREPARING" | "READY" | "ERROR";
  busy: boolean;
  interrupted: boolean;
  error: string | null;
  state: PersonalSetupState;
}
