import { z } from "zod";
import { agentPlatformIds } from "./agent-platforms.js";

export const projectRunStatuses = [
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
  "BLOCKED",
] as const;

export const projectRunTriggerTypes = [
  "USER",
  "SCHEDULED",
  "DELEGATION",
  "API",
  "UNKNOWN",
] as const;

export const projectRunSources = agentPlatformIds;

const telemetryCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_]*$/, "Telemetry codes must use uppercase letters, digits, and underscores.");

export const runTelemetryEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("started"),
    runId: z.string().trim().min(1).max(240),
    occurredAt: z.string().datetime(),
    triggerType: z.enum(projectRunTriggerTypes).default("UNKNOWN"),
    traceId: z.string().trim().min(1).max(128).optional(),
  }).strict(),
  z.object({
    event: z.literal("finished"),
    runId: z.string().trim().min(1).max(240),
    occurredAt: z.string().datetime(),
    status: z.enum(["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED", "BLOCKED"]),
    durationMs: z.number().int().min(0).max(7 * 24 * 60 * 60 * 1_000).optional(),
    terminalReason: telemetryCodeSchema.optional(),
    errorCategory: telemetryCodeSchema.optional(),
    traceId: z.string().trim().min(1).max(128).optional(),
  }).strict(),
]);

export type ProjectRunStatus = (typeof projectRunStatuses)[number];
export type ProjectRunTriggerType = (typeof projectRunTriggerTypes)[number];
export type ProjectRunSource = (typeof projectRunSources)[number];
export type RunTelemetryEvent = z.infer<typeof runTelemetryEventSchema>;

export interface ProjectRun {
  id: string;
  projectId: string;
  instanceId: string;
  agentPlatform: ProjectRunSource;
  source: ProjectRunSource;
  externalRunId: string;
  triggerType: ProjectRunTriggerType;
  status: ProjectRunStatus;
  traceId?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  terminalReason?: string;
  errorCategory?: string;
  createdAt: string;
  updatedAt: string;
}

export const projectOverviewRanges = ["24h", "7d", "30d"] as const;
export type ProjectOverviewRange = (typeof projectOverviewRanges)[number];

export interface ProjectOverviewUsagePoint {
  bucket: string;
  runs: number;
  tokens: number;
  costUsd: number;
}

export interface ProjectOverviewAttentionItem {
  code: string;
  source:
    | "runtime"
    | "budget"
    | "quota"
    | "provider"
    | "telemetry"
    | "approval"
    | "memory"
    | "policy"
    | "runs";
  severity: "warning" | "critical";
  title: string;
  impact: {
    kind: string;
    id?: string;
    label: string;
  };
  owner: string;
  openedAt: string;
  reason: string;
  nextStep: {
    label: string;
    href: string;
  };
}

export interface ProjectOverviewResponse {
  projectId: string;
  range: ProjectOverviewRange;
  timezone: string;
  generatedAt: string;
  freshness: {
    costLastSyncedAt: string | null;
    costSyncLagSeconds: number | null;
    runtimeObservedAt: string | null;
  };
  kpis: {
    runs: number;
    runsChangePercent: number | null;
    successRate: number | null;
    successRateChangePoints: number | null;
    readyInstances: number;
    totalInstances: number;
    spendUsd: number;
    spendChangePercent: number | null;
  };
  usage: ProjectOverviewUsagePoint[];
  budget: {
    configured: boolean;
    duration: "1d" | "7d" | "30d" | null;
    limitUsd: number | null;
    usedUsd: number;
    usedPercent: number | null;
    remainingUsd: number | null;
    forecastUsd: number | null;
    periodStartedAt: string | null;
    resetsAt: string | null;
  };
  runtime: {
    available: boolean;
    ready: number;
    provisioning: number;
    failed: number;
    destroying: number;
    total: number;
  };
  workload: Array<{
    runtimeType: ProjectRunSource;
    runs: number;
    percentage: number;
  }>;
  modelAssignment: {
    totalAgents: number;
    segments: Array<{
      key: string;
      label: string;
      kind: "model" | "auto" | "unavailable";
      agents: number;
      percentage: number;
    }>;
  };
  agentActivity: Array<{
    agentId: string;
    agentName: string;
    runs: number;
    activeUsers: number | null;
    successRate: number | null;
    costUsd: number;
  }>;
  attention: ProjectOverviewAttentionItem[];
  resources: {
    runtimeCount: number;
    publishedSkillCount: number;
    memoryEnabledInstanceCount: number;
    activePolicyCount: number;
  };
}
