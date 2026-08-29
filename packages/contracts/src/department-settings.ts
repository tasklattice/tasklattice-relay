import { z } from "zod";

export const departmentSettingsSections = [
  "general",
  "projects",
  "people",
  "providers",
  "models",
  "routing",
  "quota",
] as const;

export const departmentRoutingModes = [
  "PROJECT_MANAGED",
  "SINGLE",
  "FAILOVER",
] as const;

const optionalModelReference = z.string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^\S+$/, "Model references cannot contain whitespace.")
  .nullable();

const optionalQuotaInteger = z.number().int().min(0).max(1_000_000_000).nullable();
const optionalMoney = z.number().min(0).max(1_000_000_000).nullable();

export const updateDepartmentSettingsSchema = z.object({
  models: z.object({
    defaultChatModel: optionalModelReference,
    defaultEmbeddingModel: optionalModelReference,
  }).strict(),
  routing: z.object({
    mode: z.enum(departmentRoutingModes),
    fallbackModel: optionalModelReference,
  }).strict(),
  quota: z.object({
    softBudgetUsd: optionalMoney,
    hardBudgetUsd: optionalMoney,
    softMaxInstances: optionalQuotaInteger,
    hardMaxInstances: optionalQuotaInteger,
    softMaxMcpIntegrations: optionalQuotaInteger,
    hardMaxMcpIntegrations: optionalQuotaInteger,
    softMaxKnowledgeBaseIntegrations: optionalQuotaInteger,
    hardMaxKnowledgeBaseIntegrations: optionalQuotaInteger,
  }).strict(),
  projectDefaults: z.object({
    hardBudgetUsd: optionalMoney,
    budgetDuration: z.enum(["1d", "7d", "30d"]).nullable(),
    tpmLimit: optionalQuotaInteger,
    maxInstances: optionalQuotaInteger,
    maxMcpIntegrations: optionalQuotaInteger,
    maxKnowledgeBaseIntegrations: optionalQuotaInteger,
  }).strict(),
}).strict().superRefine((value, context) => {
  const boundedPairs = [
    ["softBudgetUsd", "hardBudgetUsd"],
    ["softMaxInstances", "hardMaxInstances"],
    ["softMaxMcpIntegrations", "hardMaxMcpIntegrations"],
    ["softMaxKnowledgeBaseIntegrations", "hardMaxKnowledgeBaseIntegrations"],
  ] as const;
  for (const [softField, hardField] of boundedPairs) {
    const soft = value.quota[softField];
    const hard = value.quota[hardField];
    if (soft !== null && hard !== null && soft > hard) {
      context.addIssue({
        code: "custom",
        path: ["quota", softField],
        message: "A soft quota cannot exceed its hard quota.",
      });
    }
  }
  if (
    value.projectDefaults.hardBudgetUsd !== null
    && value.projectDefaults.budgetDuration === null
  ) {
    context.addIssue({
      code: "custom",
      path: ["projectDefaults", "budgetDuration"],
      message: "Select a reset period for the default Project budget.",
    });
  }
  if (value.routing.mode !== "PROJECT_MANAGED" && !value.models.defaultChatModel) {
    context.addIssue({
      code: "custom",
      path: ["models", "defaultChatModel"],
      message: "Select a default chat model before enabling inherited routing.",
    });
  }
  if (value.routing.mode === "FAILOVER" && !value.routing.fallbackModel) {
    context.addIssue({
      code: "custom",
      path: ["routing", "fallbackModel"],
      message: "Failover routing requires a fallback model reference.",
    });
  }
  if (
    value.routing.fallbackModel
    && value.routing.fallbackModel === value.models.defaultChatModel
  ) {
    context.addIssue({
      code: "custom",
      path: ["routing", "fallbackModel"],
      message: "The fallback model must differ from the default chat model.",
    });
  }
  const defaultsWithinDepartment = [
    ["hardBudgetUsd", "hardBudgetUsd"],
    ["maxInstances", "hardMaxInstances"],
    ["maxMcpIntegrations", "hardMaxMcpIntegrations"],
    ["maxKnowledgeBaseIntegrations", "hardMaxKnowledgeBaseIntegrations"],
  ] as const;
  for (const [defaultField, hardField] of defaultsWithinDepartment) {
    const projectDefault = value.projectDefaults[defaultField];
    const departmentHard = value.quota[hardField];
    if (
      projectDefault !== null
      && departmentHard !== null
      && projectDefault > departmentHard
    ) {
      context.addIssue({
        code: "custom",
        path: ["projectDefaults", defaultField],
        message: "A new Project default cannot exceed the Department hard quota.",
      });
    }
  }
});

export type DepartmentSettingsSection = (typeof departmentSettingsSections)[number];
export type DepartmentRoutingMode = (typeof departmentRoutingModes)[number];
export type UpdateDepartmentSettingsInput = z.infer<typeof updateDepartmentSettingsSchema>;

export interface DepartmentSettingsView extends UpdateDepartmentSettingsInput {
  departmentId: string;
  revision: number;
  usage: {
    allocatedBudgetUsd: number;
    allocatedInstances: number;
    allocatedMcpIntegrations: number;
    allocatedKnowledgeBaseIntegrations: number;
    actualInstances: number;
    actualMcpIntegrations: number;
    actualKnowledgeBaseIntegrations: number;
    projectCount: number;
    unboundedProjectCounts: {
      budget: number;
      instances: number;
      mcpIntegrations: number;
      knowledgeBaseIntegrations: number;
    };
  };
}

export interface InheritedDepartmentDefaults {
  departmentId: string;
  departmentSettingsRevision: number;
  models: UpdateDepartmentSettingsInput["models"];
  routing: UpdateDepartmentSettingsInput["routing"];
}
