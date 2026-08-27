import { z } from "zod";
import type {
  ExternalRoleId,
  ProjectCapability,
  ProjectMembershipRole,
} from "./authorization.js";
import {
  builtinProjectRoleIds,
  canonicalExternalRoleGroupPath,
  departmentRoleIds,
  externalRoleIds,
  platformRoleIds,
} from "./authorization.js";
import {
  departmentIdSchema,
  departmentNameSchema,
} from "./organization.js";
import {
  agentPlatformIds,
  defaultAgentPlatformId,
  getAgentPlatformDefinition,
  type AgentPlatformId,
} from "./agent-platforms.js";

export * from "./traces.js";
export * from "./authorization.js";
export * from "./agent-platforms.js";
export * from "./project-overview.js";
export * from "./organization.js";
export * from "./department-settings.js";
export * from "./memory.js";

export const instanceStatuses = [
  "PROVISIONING",
  "READY",
  "FAILED",
  "DESTROYING",
] as const;

export const provisioningStages = [
  "QUEUED",
  "PROVIDER",
  "SANDBOX",
  "POD",
  "RUNTIME",
  "ENDPOINT",
  "READY",
] as const;

// Stable Control-to-Runner routing contract. The implementation behind this
// target can be a dedicated 0.0.106 Gateway today or an operator-managed
// workspace on a newer OpenShell release without changing Agent APIs.
export const projectRuntimeNamespaceSchema = z.string().regex(
  /^tp-[a-z2-7]{16}$/,
  "Project Runtime Target must be a Relay-managed Namespace.",
);

export const runnerRuntimeTargetSchema = z.object({
  namespace: projectRuntimeNamespaceSchema,
}).strict();

export type RunnerRuntimeTarget = z.infer<typeof runnerRuntimeTargetSchema>;

export const providerKinds = [
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "qwen",
  "moonshot",
  "zai",
  "minimax",
  "baidu-qianfan",
  "volcengine",
  "nvidia-nim",
  "azure-openai",
  "aws-bedrock",
  "vertex-ai",
  "openrouter",
  "ollama",
  "vllm",
  "huggingface",
  "custom-openai-compatible",
  "custom-anthropic-compatible",
] as const;

export const platformSettingsSections = [
  "departments",
  "people",
  "project-roles",
  "infrastructure",
  "runtime",
  "sandbox",
  "model-providers",
  "security",
  "email",
] as const;

const optionalContainerImageSchema = z.string().trim().min(3).max(500)
  .regex(/^\S+$/, "Container image references cannot contain whitespace.")
  .nullable();

const runtimeImageShape = Object.fromEntries(
  agentPlatformIds.map((id) => [id, optionalContainerImageSchema]),
) as Record<AgentPlatformId, typeof optionalContainerImageSchema>;

const optionalSandboxCpuSchema = z.string().trim().min(1).max(32).regex(
  /^(?:[1-9]\d*m|[1-9]\d*(?:\.\d+)?|0\.\d+)$/,
  "CPU must be a positive Kubernetes quantity such as 500m, 1, or 1.5.",
).nullable();

const optionalSandboxMemorySchema = z.string().trim().min(1).max(32).regex(
  /^[1-9]\d*(?:\.\d+)?(?:Ki|Mi|Gi|Ti|K|M|G|T)?$/,
  "Memory must be a positive Kubernetes quantity such as 512Mi or 2Gi.",
).nullable();

export const updatePlatformSettingsSchema = z.object({
  runtimeImages: z.object(runtimeImageShape).strict(),
  sandbox: z.object({
    cpu: optionalSandboxCpuSchema,
    memory: optionalSandboxMemorySchema,
  }).strict(),
  runtimePolicy: z.object({
    namespaceDeletionTimeoutSeconds: z.number().int().min(10).max(1_800),
  }).strict(),
  enabledProviderKinds: z.array(z.enum(providerKinds)).max(providerKinds.length),
}).strict().superRefine((value, context) => {
  if (new Set(value.enabledProviderKinds).size !== value.enabledProviderKinds.length) {
    context.addIssue({
      code: "custom",
      path: ["enabledProviderKinds"],
      message: "Each enabled Provider can appear only once.",
    });
  }
});

export type UpdatePlatformSettingsInput = z.infer<typeof updatePlatformSettingsSchema>;
export type PlatformSettingsSection = (typeof platformSettingsSections)[number];

export const platformClientSecretUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preserve") }).strict(),
  z.object({ action: z.literal("replace"), value: z.string().min(1).max(4_096) }).strict(),
  z.object({ action: z.literal("clear") }).strict(),
]);

function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const platformSsoSettingsSchema = z.object({
  clientId: z.string().trim().max(500),
  clientSecret: platformClientSecretUpdateSchema,
  displayName: z.string().trim().max(80),
  enabled: z.boolean(),
  groupClaim: z.string().trim().min(1).max(200).regex(
    /^[A-Za-z0-9_.:-]+$/,
    "Group claim may contain letters, numbers, dots, underscores, colons, and hyphens.",
  ).optional(),
  issuer: z.string().trim().max(2_000),
}).strict().superRefine((value, context) => {
  if (!value.enabled) return;
  for (const [field, label] of [
    ["displayName", "Display name"],
    ["clientId", "Client ID"],
  ] as const) {
    if (!value[field]) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${label} is required when SSO is enabled.`,
      });
    }
  }
  if (!isHttpUrl(value.issuer)) {
    context.addIssue({
      code: "custom",
      path: ["issuer"],
      message: "A valid OIDC issuer URL is required when SSO is enabled.",
    });
  }
});

export const validatePlatformSecuritySettingsSchema = z.object({
  localAuthenticationEnabled: z.boolean(),
  sso: platformSsoSettingsSchema,
}).strict();

export const updatePlatformSecuritySettingsSchema =
  validatePlatformSecuritySettingsSchema.extend({
    validationToken: z.string().min(20).max(2_000),
  }).strict();

export type UpdatePlatformSecuritySettingsInput = z.infer<
  typeof updatePlatformSecuritySettingsSchema
>;

export const externalRoleBindingScopes = [
  "PLATFORM",
  "DEPARTMENT",
  "PROJECT",
] as const;

export type ExternalRoleBindingScope =
  (typeof externalRoleBindingScopes)[number];

export const externalRoleBindingInputSchema = z.object({
  id: z.uuid().optional(),
  enabled: z.boolean(),
  group: z.string().trim().min(1).max(1_024).regex(
    /^\/(?:[^/\u0000-\u001F\u007F]+\/)*[^/\u0000-\u001F\u007F]+$/,
    "Use a complete Keycloak Group path beginning with / and without an ending slash.",
  ),
  scope: z.enum(externalRoleBindingScopes),
  departmentId: departmentIdSchema.nullable(),
  projectId: departmentIdSchema.nullable(),
  roleId: z.enum(externalRoleIds),
}).strict().superRefine((value, context) => {
  if (value.scope === "PLATFORM") {
    if (value.departmentId !== null || value.projectId !== null) {
      context.addIssue({
        code: "custom",
        path: ["scope"],
        message: "Platform bindings cannot target a Department or Project.",
      });
    }
    if (!platformRoleIds.includes(value.roleId as (typeof platformRoleIds)[number])) {
      context.addIssue({
        code: "custom",
        path: ["roleId"],
        message: "Select a Platform role for a Platform binding.",
      });
    }
  }
  if (value.scope === "DEPARTMENT") {
    if (!value.departmentId || value.projectId !== null) {
      context.addIssue({
        code: "custom",
        path: ["departmentId"],
        message: "Department bindings require one Department and no Project.",
      });
    }
    if (!departmentRoleIds.includes(value.roleId as (typeof departmentRoleIds)[number])) {
      context.addIssue({
        code: "custom",
        path: ["roleId"],
        message: "Select a Department role for a Department binding.",
      });
    }
  }
  if (value.scope === "PROJECT") {
    if (!value.departmentId || !value.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Project bindings require both a Department and Project.",
      });
    }
    if (!builtinProjectRoleIds.includes(value.roleId as (typeof builtinProjectRoleIds)[number])) {
      context.addIssue({
        code: "custom",
        path: ["roleId"],
        message: "Select a Project role for a Project binding.",
      });
    }
  }
  const canonicalGroup = canonicalExternalRoleGroupPath(value);
  if (canonicalGroup && value.group !== canonicalGroup) {
    context.addIssue({
      code: "custom",
      path: ["group"],
      message: `Use the canonical Keycloak Group path ${canonicalGroup}.`,
    });
  }
});

export const replaceExternalRoleBindingsSchema = z.object({
  bindings: z.array(externalRoleBindingInputSchema).max(500),
}).strict().superRefine((value, context) => {
  const keys = new Set<string>();
  value.bindings.forEach((binding, index) => {
    const key = [
      binding.group,
      binding.scope,
      binding.departmentId ?? "",
      binding.projectId ?? "",
      binding.roleId,
    ].join("\u0000");
    if (keys.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["bindings", index],
        message: "This Group, scope, target, and role binding is duplicated.",
      });
    }
    keys.add(key);
  });
});

export type ExternalRoleBindingInput = z.infer<
  typeof externalRoleBindingInputSchema
>;

export type ReplaceExternalRoleBindingsInput = z.infer<
  typeof replaceExternalRoleBindingsSchema
>;

export const validatePlatformSsoSettingsSchema =
  validatePlatformSecuritySettingsSchema;

export type ValidatePlatformSsoSettingsInput = z.infer<
  typeof validatePlatformSsoSettingsSchema
>;

export interface PlatformSsoValidationView {
  authorizationEndpoint?: string;
  discoveryUrl?: string;
  expiresAt: string;
  issuer?: string;
  jwksUri?: string;
  localCredentialReady: boolean;
  signingKeyCount: number;
  tokenEndpoint?: string;
  validatedAt: string;
  validationToken: string;
}

export interface PlatformSecuritySettingsView {
  canEditOnline: boolean;
  configurationError: string | null;
  localAuthenticationEnabled: boolean;
  sso: {
    callbackUrl: string;
    clientId: string;
    clientSecretConfigured: boolean;
    displayName: string;
    enabled: boolean;
    groupClaim: string;
    issuer: string;
    roleBindings: ExternalRoleBindingView[];
  };
}

export interface ExternalRoleBindingView {
  id: string;
  enabled: boolean;
  group: string;
  scope: ExternalRoleBindingScope;
  departmentId: string | null;
  departmentName: string | null;
  projectId: string | null;
  projectName: string | null;
  roleId: ExternalRoleId;
  lastMatchedAt: string | null;
}

export const updatePlatformEmailSettingsSchema = z.object({
  enabled: z.boolean(),
  fromAddress: z.string().trim().max(320),
  fromName: z.string().trim().min(1).max(120),
  host: z.string().trim().max(500),
  password: platformClientSecretUpdateSchema,
  port: z.number().int().min(1).max(65_535),
  replyTo: z.string().trim().max(320),
  secure: z.boolean(),
  username: z.string().trim().max(500),
}).strict().superRefine((value, context) => {
  if (!value.enabled) return;
  if (!value.host) {
    context.addIssue({
      code: "custom",
      path: ["host"],
      message: "SMTP host is required when email delivery is enabled.",
    });
  }
  if (!z.email().safeParse(value.fromAddress).success) {
    context.addIssue({
      code: "custom",
      path: ["fromAddress"],
      message: "A valid From address is required when email delivery is enabled.",
    });
  }
  if (value.replyTo && !z.email().safeParse(value.replyTo).success) {
    context.addIssue({
      code: "custom",
      path: ["replyTo"],
      message: "Reply-to must be a valid email address.",
    });
  }
});

export type UpdatePlatformEmailSettingsInput = z.infer<
  typeof updatePlatformEmailSettingsSchema
>;

export const validatePlatformEmailSettingsSchema = z.object({
  host: z.string().trim().min(1, "SMTP host is required.").max(500),
  password: platformClientSecretUpdateSchema,
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
  username: z.string().trim().max(500),
}).strict();

export type ValidatePlatformEmailSettingsInput = z.infer<
  typeof validatePlatformEmailSettingsSchema
>;

export interface PlatformEmailValidationView {
  authentication: "authenticated" | "not_required";
  host: string;
  port: number;
  secure: boolean;
  validatedAt: string;
}

export interface PlatformEmailSettingsView {
  configurationError: string | null;
  enabled: boolean;
  fromAddress: string;
  fromName: string;
  host: string;
  passwordConfigured: boolean;
  port: number;
  replyTo: string;
  secure: boolean;
  username: string;
}

const platformInfrastructureSecretSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preserve") }).strict(),
  z.object({ action: z.literal("replace"), value: z.string().min(1).max(4_096) }).strict(),
]);

const platformRuntimeNamespacesSchema = z.object({
  enabled: z.boolean(),
  clusterId: z.string().trim().min(1).max(120),
}).strict();

export const validatePlatformInfrastructureSettingsSchema = z.object({
  controlInternalUrl: z.string().trim().url().refine(isHttpUrl, "Control internal URL must use HTTP or HTTPS."),
  runner: z.object({
    url: z.string().trim().url().refine(isHttpUrl, "Runner URL must use HTTP or HTTPS."),
    token: platformInfrastructureSecretSchema,
  }).strict(),
  litellm: z.object({
    url: z.string().trim().url().refine(isHttpUrl, "LiteLLM URL must use HTTP or HTTPS."),
    masterKey: platformInfrastructureSecretSchema,
  }).strict(),
  runtimeNamespaces: platformRuntimeNamespacesSchema,
}).strict();

export const updatePlatformInfrastructureSettingsSchema =
  validatePlatformInfrastructureSettingsSchema.extend({
    validationToken: z.string().min(20).max(2_000),
  }).strict();

export type ValidatePlatformInfrastructureSettingsInput = z.infer<
  typeof validatePlatformInfrastructureSettingsSchema
>;
export type UpdatePlatformInfrastructureSettingsInput = z.infer<
  typeof updatePlatformInfrastructureSettingsSchema
>;

export interface PlatformInfrastructureSettingsView {
  controlInternalUrl: string;
  runner: {
    url: string;
    tokenConfigured: boolean;
  };
  litellm: {
    url: string;
    masterKeyConfigured: boolean;
  };
  runtimeNamespaces: {
    enabled: boolean;
    clusterId: string;
  };
}

export interface PlatformInfrastructureValidationView {
  control: { ok: true };
  runner: { ok: true; mode: string };
  litellm: { ok: true; version?: string };
  runtimeNamespaces: { ok: true; existingTargetCount: number };
  expiresAt: string;
  validatedAt: string;
  validationToken: string;
}

export const createPlatformDepartmentSchema = z.object({
  administratorUserId: z.string().trim().min(1),
  description: z.string().trim().max(500).nullable(),
  id: departmentIdSchema,
  name: departmentNameSchema,
}).strict();

export type CreatePlatformDepartmentInput = z.infer<
  typeof createPlatformDepartmentSchema
>;

export interface PlatformSettingsView extends UpdatePlatformSettingsInput {
  infrastructure: PlatformInfrastructureSettingsView;
  effectiveRuntimeImages: Record<AgentPlatformId, string>;
  effectiveSandbox: {
    cpu: string;
    memory: string;
  };
  sandboxRuntime: {
    available: boolean;
    provider: "openshell";
    mode?: string;
    gatewayEndpoint?: string;
    workspace?: string;
    serviceBaseUrl?: string;
    kubernetesServiceCidrs?: string[];
    gatewayImage?: string;
    supervisorImage?: string;
    defaultImage?: string;
    defaultImagePullPolicy?: string;
    tlsDisabled?: boolean;
  };
  runtimeStatus: {
    available: boolean;
    mode?: string;
  };
  security: PlatformSecuritySettingsView;
  email: PlatformEmailSettingsView;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface PlatformPersonView {
  departments: Array<{
    id: string;
    name: string;
    role: "administrator" | "member";
    status: "active" | "suspended";
  }>;
  displayName: string;
  email: string;
  id: string;
  projects: Array<{
    activeRole: ProjectMembershipRole;
    departmentId: string;
    departmentName: string;
    id: string;
    name: string;
    roles: ProjectMembershipRole[];
  }>;
  status: "active" | "disabled";
  systemRole: "user" | "platform_administrator";
}

export interface PlatformPeopleView {
  data: PlatformPersonView[];
  filters: {
    departments: Array<{ id: string; name: string }>;
    projects: Array<{
      departmentId: string;
      departmentName: string;
      id: string;
      name: string;
    }>;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface PlatformOrganizationView {
  departments: Array<{
    id: string;
    name: string;
    description: string | null;
    status: "active" | "suspended";
    members: Array<{
      id: string;
      displayName: string;
      email: string;
      role: "administrator" | "member";
      status: "active" | "suspended";
    }>;
    projects: Array<{
      id: string;
      name: string;
      memberCount: number;
    }>;
  }>;
  people: PlatformPersonView[];
}

export const modelTypes = ["llm", "text-embedding", "speech-to-text"] as const;

export const modelCapabilities = [
  "reasoning",
  "vision",
  "ocr",
  "document-understanding",
  "tool-calling",
  "structured-output",
  "code",
  "multilingual",
] as const;
export const modelInputModalities = [
  "text",
  "image",
  "audio",
  "document",
] as const;
export const modelOutputModalities = [
  "text",
  "embedding",
] as const;

export const complianceDomains = [
  "GLOBAL",
  "CN_MAINLAND",
  "EU_EEA",
  "US",
  "UK",
  "APAC_EX_CN",
] as const;
export const complianceDomainCatalog = [
  {
    id: "GLOBAL",
    label: "Global",
    description: "No project-level residency restriction. Provider terms still apply.",
    endpointRegion: "global",
  },
  {
    id: "CN_MAINLAND",
    label: "Mainland China",
    description: "Keep registered endpoints and routing fallbacks in Mainland China.",
    endpointRegion: "cn-mainland",
  },
  {
    id: "EU_EEA",
    label: "EU / EEA",
    description: "Keep registered endpoints and routing fallbacks in the EU or EEA.",
    endpointRegion: "eu-eea",
  },
  {
    id: "US",
    label: "United States",
    description: "Keep registered endpoints and routing fallbacks in the United States.",
    endpointRegion: "us",
  },
  {
    id: "UK",
    label: "United Kingdom",
    description: "Keep registered endpoints and routing fallbacks in the United Kingdom.",
    endpointRegion: "uk",
  },
  {
    id: "APAC_EX_CN",
    label: "APAC (excluding Mainland China)",
    description: "Keep registered endpoints and routing fallbacks in APAC outside Mainland China.",
    endpointRegion: "apac-ex-cn",
  },
] as const satisfies ReadonlyArray<{
  id: (typeof complianceDomains)[number];
  label: string;
  description: string;
  endpointRegion: string;
}>;

/**
 * Provider boundaries describe the endpoint configurations that TaskLattice Relay can
 * guide and validate. They are routing constraints, not legal certifications.
 * GLOBAL is intentionally available to every connector because it imposes no
 * project-level residency restriction.
 */
export const providerComplianceDomains = {
  openai: ["GLOBAL"],
  anthropic: ["GLOBAL"],
  gemini: ["GLOBAL"],
  deepseek: ["GLOBAL"],
  qwen: ["GLOBAL", "CN_MAINLAND", "APAC_EX_CN"],
  moonshot: ["GLOBAL", "CN_MAINLAND"],
  zai: ["GLOBAL"],
  minimax: ["GLOBAL"],
  "baidu-qianfan": ["GLOBAL", "CN_MAINLAND"],
  volcengine: ["GLOBAL", "CN_MAINLAND"],
  "nvidia-nim": ["GLOBAL"],
  "azure-openai": ["GLOBAL"],
  "aws-bedrock": [
    "GLOBAL",
    "EU_EEA",
    "US",
    "UK",
    "APAC_EX_CN",
  ],
  "vertex-ai": ["GLOBAL", "EU_EEA", "US", "UK", "APAC_EX_CN"],
  openrouter: ["GLOBAL"],
  ollama: [
    "GLOBAL",
    "CN_MAINLAND",
    "EU_EEA",
    "US",
    "UK",
    "APAC_EX_CN",
  ],
  vllm: [
    "GLOBAL",
    "CN_MAINLAND",
    "EU_EEA",
    "US",
    "UK",
    "APAC_EX_CN",
  ],
  huggingface: ["GLOBAL"],
  "custom-openai-compatible": [
    "GLOBAL",
    "CN_MAINLAND",
    "EU_EEA",
    "US",
    "UK",
    "APAC_EX_CN",
  ],
  "custom-anthropic-compatible": [
    "GLOBAL",
    "CN_MAINLAND",
    "EU_EEA",
    "US",
    "UK",
    "APAC_EX_CN",
  ],
} as const satisfies Record<
  (typeof providerKinds)[number],
  ReadonlyArray<(typeof complianceDomains)[number]>
>;

export function providerSupportsComplianceDomain(
  provider: (typeof providerKinds)[number],
  domain: (typeof complianceDomains)[number],
): boolean {
  return (
    providerComplianceDomains[provider] as ReadonlyArray<
      (typeof complianceDomains)[number]
    >
  ).includes(domain);
}
export const modelRoutingStatuses = [
  "DRAFT",
  "VALIDATING",
  "READY",
  "DEGRADED",
  "NON_COMPLIANT",
  "SUSPENDED",
  "UNSUPPORTED",
] as const;
export const modelRoutingCapabilityStates = ["ENABLED", "DISABLED", "UNKNOWN"] as const;
export const modelRoutingModes = ["SINGLE", "COMPLEXITY", "SEMANTIC"] as const;

export interface ProviderPresetModel {
  modelId: string;
  displayName: string;
  modelType: (typeof modelTypes)[number];
  capabilities?: Array<(typeof modelCapabilities)[number]> | undefined;
  inputModalities?: Array<(typeof modelInputModalities)[number]> | undefined;
  outputModalities?: Array<(typeof modelOutputModalities)[number]> | undefined;
  inputFeePerMillionTokens?: number | undefined;
  outputFeePerMillionTokens?: number | undefined;
  feePerAudioMinute?: number | undefined;
}

export const providerPresets = [
  {
    id: "openai",
    name: "OpenAI",
    category: "Popular",
    description: "OpenAI language, embedding, and transcription models.",
    endpoint: "https://api.openai.com/v1",
    icon: "/assets/providers/openai.webp",
    modelTypes: ["llm", "text-embedding", "speech-to-text"],
    defaultModels: [
      { modelId: "gpt-5.2", displayName: "GPT-5.2", modelType: "llm" },
      { modelId: "text-embedding-3-large", displayName: "Text Embedding 3 Large", modelType: "text-embedding" },
      { modelId: "gpt-4o-transcribe", displayName: "GPT-4o Transcribe", modelType: "speech-to-text" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    category: "Popular",
    description: "Claude models through Anthropic's native API.",
    endpoint: "https://api.anthropic.com",
    icon: "/assets/providers/anthropic.webp",
    modelTypes: ["llm"],
    defaultModels: [
      { modelId: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5", modelType: "llm" },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    category: "Popular",
    description: "Gemini models through Google AI Studio.",
    endpoint: "https://generativelanguage.googleapis.com",
    icon: "/assets/providers/gemini.webp",
    modelTypes: ["llm", "text-embedding"],
    defaultModels: [
      { modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", modelType: "llm" },
      { modelId: "gemini-embedding-001", displayName: "Gemini Embedding 001", modelType: "text-embedding" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    category: "Popular",
    description: "DeepSeek's OpenAI-compatible language model API.",
    endpoint: "https://api.deepseek.com/v1",
    icon: "/assets/providers/deepseek.webp",
    modelTypes: ["llm"],
    defaultModels: [
      {
        modelId: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        modelType: "llm",
        inputFeePerMillionTokens: 0.14,
        outputFeePerMillionTokens: 0.28,
      },
      {
        modelId: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        modelType: "llm",
        inputFeePerMillionTokens: 0.435,
        outputFeePerMillionTokens: 0.87,
      },
    ],
  },
  {
    id: "qwen",
    name: "Qwen / DashScope",
    category: "Chinese Providers",
    description: "Qwen models through DashScope's regional endpoints.",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    icon: "/assets/providers/qwen.webp",
    modelTypes: ["llm", "text-embedding"],
    defaultModels: [
      { modelId: "qwen-plus", displayName: "Qwen Plus", modelType: "llm" },
      { modelId: "text-embedding-v4", displayName: "Text Embedding V4", modelType: "text-embedding" },
    ],
  },
  {
    id: "moonshot",
    name: "Moonshot / Kimi",
    category: "Chinese Providers",
    description: "Kimi models through Moonshot's China or global endpoint.",
    endpoint: "https://api.moonshot.cn/v1",
    icon: "/assets/providers/kimi.webp",
    modelTypes: ["llm"],
    defaultModels: [
      { modelId: "kimi-k2.5", displayName: "Kimi K2.5", modelType: "llm" },
      { modelId: "moonshot-v1-128k", displayName: "Moonshot V1 128K", modelType: "llm" },
    ],
  },
  {
    id: "zai",
    name: "Zhipu / Z.AI",
    category: "Chinese Providers",
    description: "GLM models through the Z.AI API.",
    endpoint: "https://api.z.ai/api/paas/v4",
    icon: "/assets/providers/zai.webp",
    modelTypes: ["llm"],
    defaultModels: [
      { modelId: "glm-4.5", displayName: "GLM 4.5", modelType: "llm" },
    ],
  },
  {
    id: "minimax",
    name: "MiniMax",
    category: "Chinese Providers",
    description: "MiniMax language models through its native endpoint.",
    endpoint: "https://api.minimax.io/v1",
    icon: "/assets/providers/minimax.webp",
    modelTypes: ["llm"],
    defaultModels: [
      { modelId: "MiniMax-M2.1", displayName: "MiniMax M2.1", modelType: "llm" },
    ],
  },
  {
    id: "baidu-qianfan",
    name: "Baidu Qianfan",
    category: "Chinese Providers",
    description: "ERNIE and partner models through Qianfan's OpenAI-compatible API.",
    endpoint: "https://qianfan.baidubce.com/v2",
    icon: "/assets/providers/baidu.webp",
    modelTypes: ["llm", "text-embedding"],
    defaultModels: [
      { modelId: "ernie-4.5-turbo-128k", displayName: "ERNIE 4.5 Turbo", modelType: "llm" },
    ],
  },
  {
    id: "volcengine",
    name: "ByteDance / Doubao",
    category: "Chinese Providers",
    description: "Doubao deployments hosted by Volcengine Ark.",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3",
    icon: "/assets/providers/volcengine.webp",
    modelTypes: ["llm", "text-embedding"],
    defaultModels: [],
  },
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    category: "Infrastructure",
    description: "NVIDIA-hosted or self-hosted NIM inference endpoints.",
    endpoint: "https://integrate.api.nvidia.com/v1",
    icon: "/assets/providers/nvidia.webp",
    modelTypes: ["llm", "text-embedding"],
    defaultModels: [
      { modelId: "meta/llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct", modelType: "llm" },
      {
        modelId: "nvidia/llama-nemotron-embed-vl-1b-v2",
        displayName: "Llama Nemotron Embed VL 1B v2",
        modelType: "text-embedding",
      },
    ],
  },
  {
    id: "azure-openai",
    name: "Azure OpenAI",
    category: "Infrastructure",
    description: "Azure OpenAI deployments with explicit API versioning.",
    endpoint: null,
    icon: "/assets/providers/azure.webp",
    modelTypes: ["llm", "text-embedding", "speech-to-text"],
    defaultModels: [],
  },
  {
    id: "aws-bedrock",
    name: "AWS Bedrock",
    category: "Infrastructure",
    description: "Foundation models through AWS Bedrock Runtime.",
    endpoint: null,
    icon: "/assets/providers/aws.webp",
    modelTypes: ["llm", "text-embedding"],
    defaultModels: [
      { modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0", displayName: "Claude 3.5 Sonnet", modelType: "llm" },
    ],
  },
  {
    id: "vertex-ai",
    name: "Google Vertex AI",
    category: "Infrastructure",
    description: "Google Cloud-hosted foundation models through Vertex AI.",
    endpoint: null,
    icon: "/assets/providers/vertex.webp",
    modelTypes: ["llm", "text-embedding"],
    defaultModels: [
      { modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", modelType: "llm" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    category: "Infrastructure",
    description: "A unified endpoint for models from multiple providers.",
    endpoint: "https://openrouter.ai/api/v1",
    icon: "/assets/providers/openrouter.webp",
    modelTypes: ["llm"],
    defaultModels: [
      { modelId: "openai/gpt-5", displayName: "GPT-5 via OpenRouter", modelType: "llm" },
    ],
  },
  {
    id: "ollama",
    name: "Ollama",
    category: "Self-Hosted / Custom",
    description: "Models served by an Ollama runtime on your network.",
    endpoint: "http://host.docker.internal:11434",
    icon: "/assets/providers/ollama.webp",
    modelTypes: ["llm", "text-embedding"],
    defaultModels: [
      { modelId: "llama3.2", displayName: "Llama 3.2", modelType: "llm" },
    ],
  },
  {
    id: "vllm",
    name: "vLLM",
    category: "Self-Hosted / Custom",
    description: "An OpenAI-compatible vLLM inference server.",
    endpoint: null,
    icon: "/assets/providers/vllm.webp",
    modelTypes: ["llm", "text-embedding"],
    defaultModels: [],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    category: "Self-Hosted / Custom",
    description: "Serverless providers or a dedicated Hugging Face endpoint.",
    endpoint: null,
    icon: "/assets/providers/huggingface.webp",
    modelTypes: ["llm", "text-embedding"],
    defaultModels: [
      { modelId: "meta-llama/Llama-3.3-70B-Instruct", displayName: "Llama 3.3 70B Instruct", modelType: "llm" },
    ],
  },
  {
    id: "custom-openai-compatible",
    name: "OpenAI-compatible (Custom)",
    category: "Self-Hosted / Custom",
    description: "Any OpenAI-compatible endpoint managed by your organization.",
    endpoint: null,
    icon: "/assets/providers/custom.svg",
    modelTypes: ["llm", "text-embedding", "speech-to-text"],
    defaultModels: [],
  },
  {
    id: "custom-anthropic-compatible",
    name: "Anthropic-compatible (Custom)",
    category: "Self-Hosted / Custom",
    description: "A custom endpoint implementing the Anthropic Messages API.",
    endpoint: null,
    icon: "/assets/providers/custom-anthropic.svg",
    modelTypes: ["llm"],
    defaultModels: [],
  },
] as const satisfies ReadonlyArray<{
  id: (typeof providerKinds)[number];
  name: string;
  category: "Popular" | "Chinese Providers" | "Infrastructure" | "Self-Hosted / Custom";
  description: string;
  endpoint: string | null;
  icon: string;
  modelTypes: ReadonlyArray<(typeof modelTypes)[number]>;
  defaultModels: readonly ProviderPresetModel[];
}>;

const connectionNameSchema = z.string().trim().min(3, "Connection name must contain at least 3 characters.").max(48);
const apiKeySchema = z.string().trim().min(1, "API key is required.").max(8_192);
const endpointSchema = z.string().trim().url("Enter a valid API endpoint URL.");
const optionalText = z.string().trim().max(512).optional();

const keyedDraft = <T extends (typeof providerKinds)[number]>(
  provider: T,
  endpoint: string,
) => z.object({
  provider: z.literal(provider),
  name: connectionNameSchema,
  config: z.object({ endpoint: endpointSchema.default(endpoint) }),
  credentials: z.object({ apiKey: apiKeySchema }),
});

export const providerConnectionDraftSchema = z.discriminatedUnion("provider", [
  keyedDraft("openai", "https://api.openai.com/v1").extend({
    config: z.object({ endpoint: endpointSchema.default("https://api.openai.com/v1"), organization: optionalText }),
  }),
  keyedDraft("anthropic", "https://api.anthropic.com"),
  keyedDraft("gemini", "https://generativelanguage.googleapis.com"),
  keyedDraft("deepseek", "https://api.deepseek.com/v1"),
  z.object({ provider: z.literal("qwen"), name: connectionNameSchema, config: z.object({ region: z.enum(["cn", "international"]), endpoint: endpointSchema }), credentials: z.object({ apiKey: apiKeySchema }) }),
  z.object({ provider: z.literal("moonshot"), name: connectionNameSchema, config: z.object({ region: z.enum(["cn", "global"]), endpoint: endpointSchema }), credentials: z.object({ apiKey: apiKeySchema }) }),
  keyedDraft("zai", "https://api.z.ai/api/paas/v4"),
  keyedDraft("minimax", "https://api.minimax.io/v1"),
  z.object({ provider: z.literal("baidu-qianfan"), name: connectionNameSchema, config: z.object({ endpoint: endpointSchema.default("https://qianfan.baidubce.com/v2"), appId: optionalText }), credentials: z.object({ apiKey: apiKeySchema }) }),
  z.object({ provider: z.literal("volcengine"), name: connectionNameSchema, config: z.object({ endpoint: endpointSchema.default("https://ark.cn-beijing.volces.com/api/v3"), endpointId: z.string().trim().min(1, "Endpoint ID is required.").max(256) }), credentials: z.object({ apiKey: apiKeySchema }) }),
  keyedDraft("nvidia-nim", "https://integrate.api.nvidia.com/v1"),
  z.object({ provider: z.literal("azure-openai"), name: connectionNameSchema, config: z.object({ endpoint: endpointSchema, apiVersion: z.string().trim().min(1, "API version is required.").max(64), deployment: z.string().trim().min(1, "Deployment name is required.").max(256) }), credentials: z.object({ apiKey: apiKeySchema }) }),
  z.object({ provider: z.literal("aws-bedrock"), name: connectionNameSchema, config: z.object({ region: z.string().trim().min(2, "AWS region is required.").max(64), roleArn: optionalText }), credentials: z.object({ accessKeyId: apiKeySchema, secretAccessKey: apiKeySchema, sessionToken: z.string().trim().max(8_192).optional() }) }),
  z.object({ provider: z.literal("vertex-ai"), name: connectionNameSchema, config: z.object({ project: z.string().trim().min(1, "Google Cloud project is required.").max(256), location: z.string().trim().min(1, "Google Cloud location is required.").max(128) }), credentials: z.object({ serviceAccountJson: z.string().trim().min(2, "Service-account JSON is required.").max(64_000) }) }),
  z.object({ provider: z.literal("openrouter"), name: connectionNameSchema, config: z.object({ endpoint: endpointSchema.default("https://openrouter.ai/api/v1"), siteUrl: z.string().trim().url().optional(), appName: optionalText }), credentials: z.object({ apiKey: apiKeySchema }) }),
  z.object({ provider: z.literal("ollama"), name: connectionNameSchema, config: z.object({ endpoint: endpointSchema }), credentials: z.object({}) }),
  z.object({ provider: z.literal("vllm"), name: connectionNameSchema, config: z.object({ endpoint: endpointSchema }), credentials: z.object({ apiKey: z.string().trim().max(8_192).optional() }) }),
  z.object({ provider: z.literal("huggingface"), name: connectionNameSchema, config: z.object({ mode: z.enum(["serverless", "dedicated"]), endpoint: endpointSchema.optional(), inferenceProvider: optionalText }), credentials: z.object({ apiKey: apiKeySchema }) }),
  z.object({ provider: z.literal("custom-openai-compatible"), name: connectionNameSchema, config: z.object({ endpoint: endpointSchema }), credentials: z.object({ apiKey: z.string().trim().max(8_192).optional() }) }),
  z.object({ provider: z.literal("custom-anthropic-compatible"), name: connectionNameSchema, config: z.object({ endpoint: endpointSchema }), credentials: z.object({ apiKey: apiKeySchema }) }),
]);

export const providerModelSelectionSchema = z.object({
  modelId: z.string().trim().min(1).max(256),
  displayName: z.string().trim().min(1).max(160),
  modelType: z.enum(modelTypes),
  capabilities: z.array(z.enum(modelCapabilities)).max(modelCapabilities.length).optional(),
  inputModalities: z.array(z.enum(modelInputModalities)).min(1).max(modelInputModalities.length).optional(),
  outputModalities: z.array(z.enum(modelOutputModalities)).min(1).max(modelOutputModalities.length).optional(),
  inputFeePerMillionTokens: z.number().min(0).max(1_000_000).optional(),
  outputFeePerMillionTokens: z.number().min(0).max(1_000_000).optional(),
  feePerAudioMinute: z.number().min(0).max(1_000_000).optional(),
});

export const discoverProviderModelsSchema = providerConnectionDraftSchema;
export const createProviderConnectionSchema = z.object({
  connection: providerConnectionDraftSchema,
  models: z.array(providerModelSelectionSchema).min(1).max(100),
  complianceDomain: z.enum(complianceDomains),
});

export const agentMemoryCitations = ["auto", "on", "off"] as const;

export const agentMemoryConfigurationSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("native"),
    citations: z.enum(agentMemoryCitations).default("auto"),
  }).strict(),
  z.object({
    mode: z.literal("hybrid"),
    embeddingModelDeploymentId: z.string().uuid(),
    includeSessionTranscripts: z.boolean().default(false),
    citations: z.enum(agentMemoryCitations).default("auto"),
    maxResults: z.number().int().min(1).max(20).default(6),
    minScore: z.number().min(0).max(1).default(0.35),
  }).strict(),
]);

export const defaultNativeAgentMemoryConfiguration =
  agentMemoryConfigurationSchema.parse({ mode: "native" });

export const sandboxPolicyIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens.");

export const sandboxPolicyInputSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(320),
  networkAccess: z.string().trim().min(3).max(160),
  policyYaml: z.string().trim().min(10).max(64_000),
});

export const createSandboxPolicySchema = sandboxPolicyInputSchema;
export const updateSandboxPolicySchema = sandboxPolicyInputSchema;

export const providerResourceStatuses = ["VALIDATED", "DEGRADED", "FAILED"] as const;

export const skillCategories = [
  "Customer Support",
  "Data",
  "Developer Tools",
  "HR",
  "Knowledge",
  "Operations",
  "Research",
] as const;

export const skillTrustLevels = [
  "BUILT_IN",
  "TRUSTED_SOURCE",
  "UNSAFE",
] as const;

export const skillCompatibilityTargets = [
  "hermes",
  "openclaw",
  "claude-code",
  "openai",
] as const;

export const skillDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(500),
  problemStatement: z.string().trim().min(10).max(1_000),
  useCases: z.array(z.string().trim().min(3).max(240)).min(1).max(8),
  usageGuide: z.string().trim().min(10).max(4_000),
  author: z.string().trim().min(1).max(120),
  category: z.enum(skillCategories),
  trustLevel: z.enum(skillTrustLevels),
  compatibleAgents: z.array(z.enum(skillCompatibilityTargets))
    .min(1)
    .max(skillCompatibilityTargets.length)
    .refine((targets) => new Set(targets).size === targets.length, {
      message: "Compatible Agent targets must be unique.",
    }),
  version: z.string().trim().min(1).max(40),
  endpoint: z.string().trim().url(),
  digest: z.string().trim().min(1).max(200),
  owner: z.string().trim().min(1).max(120),
  permissions: z.number().int().min(0).max(1_000),
  status: z.enum(["PUBLISHED", "DRAFT"]),
  updatedAt: z.string().datetime(),
});

export const createSkillDefinitionSchema = skillDefinitionSchema.omit({
  id: true,
  updatedAt: true,
});
export const updateSkillDefinitionSchema = createSkillDefinitionSchema;

export const mcpToolAnnotationsSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
}).strict();

export const mcpToolDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4_000).optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  annotations: mcpToolAnnotationsSchema.optional(),
  discoveredAt: z.string().datetime(),
});

export const mcpTransportSchema = z.enum(["http", "sse", "stdio", "openapi"]);
export const mcpAuthTypeSchema = z.enum([
  "none",
  "bearer_token",
  "api_key",
  "basic",
  "authorization",
  "oauth2",
  "aws_sigv4",
]);

export const mcpSecretReferenceSchema = z.string().trim().min(1).max(500).refine(
  (value) => /^(?:k8s|memory):\/\//.test(value),
  "Credentials must use a supported Secret reference.",
);

const optionalMcpSecretReferenceSchema = z.string().trim().max(500).refine(
  (value) => !value || /^(?:k8s|memory):\/\//.test(value),
  "Credentials must use a supported Secret reference.",
);

export const mcpStaticHeaderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  valueReference: mcpSecretReferenceSchema,
}).strict();

export const mcpEnvironmentVariableSchema = z.object({
  name: z.string().trim().regex(/^[A-Z_][A-Z0-9_]*$/).max(120),
  valueReference: mcpSecretReferenceSchema,
}).strict();

export const mcpOauthConfigurationSchema = z.object({
  flow: z.enum(["client_credentials", "authorization_code"]),
  authorizationUrl: z.string().trim().url().optional(),
  tokenUrl: z.string().trim().url().optional(),
  registrationUrl: z.string().trim().url().optional(),
}).strict();

const mcpServerConnectionFields = {
  templateId: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(3).max(120),
  alias: z.string().trim().regex(/^[a-zA-Z0-9_]+$/, "Alias may contain letters, numbers, and underscores only.").max(120),
  description: z.string().trim().min(10).max(1_000),
  category: z.string().trim().min(2).max(80),
  logoUrl: z.string().trim().url().optional(),
  sourceUrl: z.string().trim().url().optional(),
  transport: mcpTransportSchema,
  endpoint: z.string().trim().url().optional(),
  specPath: z.string().trim().min(1).max(1_000).optional(),
  command: z.string().trim().min(1).max(240).optional(),
  args: z.array(z.string().max(1_000)).max(64).default([]),
  environment: z.array(mcpEnvironmentVariableSchema).max(64).default([]),
  authType: mcpAuthTypeSchema.default("none"),
  authReference: optionalMcpSecretReferenceSchema.default(""),
  oauth: mcpOauthConfigurationSchema.optional(),
  accessGroups: z.array(z.string().trim().min(1).max(120)).max(64).default([]),
  allowedTools: z.array(z.string().trim().min(1).max(200)).max(10_000).default([]),
  extraHeaders: z.array(z.string().trim().min(1).max(120)).max(64).default([]),
  staticHeaders: z.array(mcpStaticHeaderSchema).max(64).default([]),
  internalNetworkOnly: z.boolean().default(false),
};

function validateMcpServerConnection(
  value: Record<string, unknown>,
  context: z.RefinementCtx,
): void {
  if (["http", "sse"].includes(String(value.transport)) && !value.endpoint) {
    context.addIssue({ code: "custom", path: ["endpoint"], message: "Endpoint is required for HTTP and SSE transports." });
  }
  if (value.transport === "openapi" && !value.specPath) {
    context.addIssue({ code: "custom", path: ["specPath"], message: "OpenAPI spec path is required." });
  }
  if (value.transport === "stdio" && (!value.command || !Array.isArray(value.args) || value.args.length === 0)) {
    context.addIssue({ code: "custom", path: ["command"], message: "Command and arguments are required for stdio transport." });
  }
  if (value.authType !== "none" && value.authType !== "oauth2" && !value.authReference) {
    context.addIssue({ code: "custom", path: ["authReference"], message: "A Secret reference is required for this authentication type." });
  }
  if (value.authType === "oauth2" && !value.oauth) {
    context.addIssue({ code: "custom", path: ["oauth"], message: "OAuth configuration is required." });
  }
}

export const mcpServerConnectionSchema = z.object(mcpServerConnectionFields).strict().superRefine(validateMcpServerConnection);

export const mcpServerDefinitionSchema = z.object({
  ...mcpServerConnectionFields,
  id: z.string().trim().min(1).max(160),
  litellmServerId: z.string().trim().min(1).max(240),
  status: z.enum(["HEALTHY", "PERMISSION_REQUIRED", "UNCHECKED", "UNAVAILABLE"]),
  tools: z.array(mcpToolDefinitionSchema).max(10_000),
  lastDiscoveryAttemptAt: z.string().datetime().nullable(),
  lastDiscoveredAt: z.string().datetime().nullable(),
  lastDiscoveryError: z.string().max(4_000).nullable(),
}).strict().superRefine(validateMcpServerConnection);

export const createMcpServerDefinitionSchema = mcpServerConnectionSchema;
export const updateMcpServerDefinitionSchema = createMcpServerDefinitionSchema;

export const accessPolicyStatuses = ["DRAFT", "ACTIVE"] as const;
export const accessPolicyDecisions = ["INHERIT", "ALLOW", "DENY"] as const;
export const DEFAULT_ACCESS_POLICY_ID = "00000000-0000-4000-8000-00000000da12";

export const accessPolicyToolRuleSchema = z.object({
  toolName: z.string().trim().min(1).max(200),
  decision: z.enum(accessPolicyDecisions),
}).strict();

export const accessPolicyServerRuleSchema = z.object({
  mcpServerId: z.string().trim().min(1).max(160),
  defaultDecision: z.enum(["ALLOW", "DENY"]),
  tools: z.array(accessPolicyToolRuleSchema).max(10_000).default([]),
}).strict();

export const createAccessPolicySchema = z.object({
  name: z.string().trim().min(3).max(120),
  status: z.enum(accessPolicyStatuses).default("DRAFT"),
  serverRules: z.array(accessPolicyServerRuleSchema).max(1_000),
}).strict();

export const updateAccessPolicySchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  status: z.enum(accessPolicyStatuses).optional(),
  serverRules: z.array(accessPolicyServerRuleSchema).max(1_000).optional(),
}).strict();

export const mcpServerTemplateSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(1_000),
  category: z.string().trim().min(2).max(80),
  logo: z.string().trim().min(1).max(120),
  sourceUrl: z.string().trim().url(),
  transport: mcpTransportSchema,
  endpointPlaceholder: z.string().trim().max(500).optional(),
  command: z.string().trim().max(240).optional(),
  args: z.array(z.string().max(1_000)).max(64).default([]),
  defaultAuthType: mcpAuthTypeSchema,
}).strict();

const knowledgeSourceDefinitionBaseSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(500),
  vectorStoreId: z.string().trim().min(1).max(240),
  provider: z.enum(["openai", "azure", "bedrock", "vertex_ai", "pg_vector", "postgresql", "elasticsearch"]),
  apiBase: z.string().trim().url().optional(),
  embeddingModelDeploymentId: z.string().uuid().optional(),
  embeddingModel: z.string().trim().min(1).max(240).optional(),
  embeddingDimensions: z.number().int().min(1).max(16_000).optional(),
  semanticField: z.string().trim().min(1).max(240).optional(),
  contentField: z.string().trim().min(1).max(240).optional(),
  credentialReference: optionalMcpSecretReferenceSchema.default(""),
  status: z.enum(["REGISTERED", "UNAVAILABLE"]),
  lastReconciliationError: z.string().max(4_000).nullable(),
  topK: z.number().int().min(1).max(50),
}).strict();

function validateKnowledgeSourceProvider(
  source: {
    provider: "openai" | "azure" | "bedrock" | "vertex_ai" | "pg_vector" | "postgresql" | "elasticsearch";
    apiBase?: string | undefined;
    embeddingModelDeploymentId?: string | undefined;
    embeddingModel?: string | undefined;
    embeddingDimensions?: number | undefined;
    semanticField?: string | undefined;
    contentField?: string | undefined;
    credentialReference: string;
  },
  context: z.RefinementCtx,
): void {
  if (source.provider === "pg_vector") {
    if (!source.apiBase) {
      context.addIssue({
        code: "custom",
        path: ["apiBase"],
        message: "PGVector connector API base is required.",
      });
    }
    if (!source.credentialReference) {
      context.addIssue({
        code: "custom",
        path: ["credentialReference"],
        message: "PGVector connector credential is required.",
      });
    }
  }
  if (source.provider === "postgresql") {
    if (!source.embeddingModelDeploymentId && !source.embeddingModel) {
      context.addIssue({
        code: "custom",
        path: ["embeddingModelDeploymentId"],
        message: "A validated embedding model is required for PostgreSQL vector storage.",
      });
    }
    if (!source.embeddingModelDeploymentId && !source.embeddingDimensions) {
      context.addIssue({
        code: "custom",
        path: ["embeddingDimensions"],
        message: "Embedding dimensions are required for PostgreSQL vector storage.",
      });
    }
  } else if (source.embeddingModelDeploymentId) {
    context.addIssue({
      code: "custom",
      path: ["embeddingModelDeploymentId"],
      message: "Project embedding model selection is available only for built-in PostgreSQL storage.",
    });
  }
  if (source.provider === "elasticsearch") {
    for (const [path, value, message] of [
      ["apiBase", source.apiBase, "Elasticsearch URL is required."],
      ["semanticField", source.semanticField, "Elasticsearch semantic_text field is required."],
      ["contentField", source.contentField, "Elasticsearch content field is required."],
      ["credentialReference", source.credentialReference, "Elasticsearch credential is required."],
    ] as const) {
      if (!value) context.addIssue({ code: "custom", path: [path], message });
    }
  }
}

export const knowledgeSourceDefinitionSchema = knowledgeSourceDefinitionBaseSchema
  .superRefine(validateKnowledgeSourceProvider);

export const createKnowledgeSourceDefinitionSchema = knowledgeSourceDefinitionBaseSchema.omit({
  id: true,
  status: true,
  lastReconciliationError: true,
}).superRefine(validateKnowledgeSourceProvider);
export const updateKnowledgeSourceDefinitionSchema = createKnowledgeSourceDefinitionSchema;

export const knowledgeVectorChunkInputSchema = z.object({
  id: z.string().trim().min(1).max(240),
  content: z.string().trim().min(1).max(50_000),
  filename: z.string().trim().min(1).max(500).optional(),
  attributes: z.record(z.string().trim().min(1).max(240), z.unknown()).default({}),
}).strict();

export const upsertKnowledgeVectorChunksSchema = z.object({
  chunks: z.array(knowledgeVectorChunkInputSchema).min(1).max(128),
}).strict();

export const knowledgeVectorChunkMutationResultSchema = z.object({
  upserted: z.number().int().min(0),
}).strict().meta({ id: "KnowledgeVectorChunkMutationResult" });

// Vector Databases are the product-facing resource. The existing knowledge
// source definition remains the internal LiteLLM attachment representation so
// Agent runtime contracts do not leak provider-specific storage details.
export const vectorDatabaseDefinitionSchema = knowledgeSourceDefinitionSchema
  .meta({ id: "VectorDatabaseDefinition" });
export const createVectorDatabaseDefinitionSchema = createKnowledgeSourceDefinitionSchema
  .meta({ id: "CreateVectorDatabaseDefinition" });
export const updateVectorDatabaseDefinitionSchema = updateKnowledgeSourceDefinitionSchema
  .meta({ id: "UpdateVectorDatabaseDefinition" });
export const vectorChunkInputSchema = knowledgeVectorChunkInputSchema
  .meta({ id: "VectorChunkInput" });
export const upsertVectorChunksSchema = z.object({
  chunks: z.array(vectorChunkInputSchema).min(1).max(128),
}).strict().meta({ id: "UpsertVectorChunks" });
export const vectorChunkMutationResultSchema = z.object({
  upserted: z.number().int().min(0),
}).strict().meta({ id: "VectorChunkMutationResult" });

export const vectorDocumentStatuses = [
  "QUEUED",
  "PARSING",
  "EMBEDDING",
  "READY",
  "FAILED",
] as const;

export const vectorMetadataTypes = ["string", "number", "boolean", "date"] as const;
export const vectorMetadataKeySchema = z.string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores; start with a letter.");
export const vectorMetadataValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), value: z.string().max(2_000) }).strict(),
  z.object({ type: z.literal("number"), value: z.number().finite() }).strict(),
  z.object({ type: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("date"), value: z.iso.date() }).strict(),
]);
export const vectorCustomMetadataSchema = z.record(
  vectorMetadataKeySchema,
  vectorMetadataValueSchema,
).superRefine((metadata, context) => {
  if (Object.keys(metadata).length > 32) {
    context.addIssue({
      code: "custom",
      message: "A Vector Document supports at most 32 custom metadata fields.",
    });
  }
}).meta({ id: "VectorCustomMetadata" });
export const vectorMetadataFieldSchema = z.object({
  key: vectorMetadataKeySchema,
  type: z.enum(vectorMetadataTypes),
  documentCount: z.number().int().min(1),
}).strict().meta({ id: "VectorMetadataField" });

export const vectorDocumentSchema = z.object({
  id: z.string().trim().min(1).max(160),
  databaseId: z.string().trim().min(1).max(160),
  folderId: z.string().uuid().nullable(),
  filename: z.string().trim().min(1).max(500),
  directoryPath: z.string().trim().startsWith("/").max(2_000),
  mediaType: z.string().trim().min(1).max(160),
  byteSize: z.number().int().min(1),
  contentHash: z.string().trim().min(1).max(160),
  status: z.enum(vectorDocumentStatuses),
  activeRevision: z.number().int().min(1),
  pageCount: z.number().int().min(0),
  chunkCount: z.number().int().min(0),
  ocrPageCount: z.number().int().min(0),
  parser: z.literal("docling"),
  uploadedBy: z.string().trim().min(1).nullable(),
  customMetadata: vectorCustomMetadataSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  error: z.string().max(4_000).nullable(),
}).strict().meta({ id: "VectorDocument" });

export const vectorFolderSchema = z.object({
  id: z.string().uuid(),
  databaseId: z.string().trim().min(1).max(160),
  parentId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(240),
  path: z.string().trim().startsWith("/").max(2_000),
  directChildCount: z.number().int().min(0),
  totalFileCount: z.number().int().min(0),
  totalVectorCount: z.number().int().min(0),
  processingFileCount: z.number().int().min(0),
  failedFileCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict().meta({ id: "VectorFolder" });

export const createVectorFolderSchema = z.object({
  name: z.string().trim().min(1).max(240),
  parentId: z.string().uuid().nullable().default(null),
}).strict().meta({ id: "CreateVectorFolder" });

export const updateVectorFolderSchema = z.object({
  name: z.string().trim().min(1).max(240).optional(),
  parentId: z.string().uuid().nullable().optional(),
}).strict().refine((input) => input.name !== undefined || input.parentId !== undefined, {
  message: "Rename or move information is required.",
}).meta({ id: "UpdateVectorFolder" });

export const updateVectorDocumentSchema = z.object({
  filename: z.string().trim().min(1).max(500).optional(),
  folderId: z.string().uuid().nullable().optional(),
  customMetadata: vectorCustomMetadataSchema.optional(),
}).strict().refine((input) => input.filename !== undefined || input.folderId !== undefined || input.customMetadata !== undefined, {
  message: "File metadata or location information is required.",
}).meta({ id: "UpdateVectorDocument" });

export const vectorDeletionImpactSchema = z.object({
  fileCount: z.number().int().min(0),
  vectorCount: z.number().int().min(0),
  processingFileCount: z.number().int().min(0),
  failedFileCount: z.number().int().min(0),
}).strict().meta({ id: "VectorDeletionImpact" });

export const vectorDocumentChunkSchema = z.object({
  id: z.string().trim().min(1).max(240),
  content: z.string(),
  pageNumber: z.number().int().min(1).nullable(),
  chunkIndex: z.number().int().min(0),
  tokenCount: z.number().int().min(0),
  sectionPath: z.array(z.string().max(500)).max(32),
  label: z.string().trim().max(120).nullable(),
  attributes: z.record(z.string(), z.unknown()),
}).strict().meta({ id: "VectorDocumentChunk" });

export const vectorDocumentDetailSchema = vectorDocumentSchema.extend({
  chunks: z.array(vectorDocumentChunkSchema),
}).strict().meta({ id: "VectorDocumentDetail" });

export const vectorIngestionJobSchema = z.object({
  id: z.string().uuid(),
  databaseId: z.string().trim().min(1).max(160),
  documentId: z.string().trim().min(1).max(160),
  revision: z.number().int().min(1),
  status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED"]),
  phase: z.enum(["QUEUED", "PARSING", "EMBEDDING", "FINALIZING", "COMPLETED", "FAILED"]),
  progress: z.number().int().min(0).max(100),
  attempts: z.number().int().min(0),
  error: z.string().max(4_000).nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
}).strict().meta({ id: "VectorIngestionJob" });

export const vectorDatabaseStatsSchema = z.object({
  documentCount: z.number().int().min(0),
  readyDocumentCount: z.number().int().min(0),
  chunkCount: z.number().int().min(0),
  failedDocumentCount: z.number().int().min(0),
  processingDocumentCount: z.number().int().min(0),
}).strict().meta({ id: "VectorDatabaseStats" });

export const vectorDatabaseOverviewSchema = z.object({
  database: vectorDatabaseDefinitionSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  stats: vectorDatabaseStatsSchema,
  metadataSchema: z.array(vectorMetadataFieldSchema),
  folders: z.array(vectorFolderSchema),
  documents: z.array(vectorDocumentSchema),
  jobs: z.array(vectorIngestionJobSchema),
}).strict().meta({ id: "VectorDatabaseOverview" });

export const vectorDatabaseSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(8_000),
  topK: z.number().int().min(1).max(50).default(8),
  folderId: z.string().uuid().nullable().optional(),
  metadataFilters: z.array(z.object({
    key: vectorMetadataKeySchema,
    operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]),
    value: vectorMetadataValueSchema,
  }).strict().superRefine((filter, context) => {
    if ((filter.value.type === "string" || filter.value.type === "boolean")
      && filter.operator !== "eq" && filter.operator !== "ne") {
      context.addIssue({
        code: "custom",
        path: ["operator"],
        message: `${filter.value.type} metadata supports only equals and does not equal.`,
      });
    }
  })).max(8).optional(),
}).strict().meta({ id: "VectorDatabaseSearchInput" });

export const vectorDatabaseSearchResultSchema = z.object({
  query: z.string(),
  durationMs: z.number().int().min(0),
  results: z.array(z.object({
    id: z.string(),
    chunkId: z.string(),
    documentId: z.string().nullable(),
    content: z.string(),
    filename: z.string(),
    directoryPath: z.string().startsWith("/"),
    score: z.number(),
    pageNumber: z.number().int().min(1).nullable(),
    chunkIndex: z.number().int().min(0).nullable(),
    sectionPath: z.array(z.string()),
    attributes: z.record(z.string(), z.unknown()),
  }).strict()),
}).strict().meta({ id: "VectorDatabaseSearchResult" });

export const agentSpecializationDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(2).max(120),
  roleLabel: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(500),
  icon: z.enum(["briefcase", "headphones", "settings", "sparkles", "telescope", "users"]),
  systemPrompt: z.string().max(8_000),
  defaultSkillIds: z.array(z.string().trim().min(1).max(160)).max(64),
  defaultMcpServerIds: z.array(z.string().trim().min(1).max(160)).max(64),
  defaultKnowledgeSourceIds: z.array(z.string().trim().min(1).max(160)).max(64),
});

export const agentGardenBuiltInTypeIds = [
  ...agentPlatformIds,
  "claude-code",
] as const;

export const agentGardenIntegrationTypeIds = [
  ...agentGardenBuiltInTypeIds,
  "a2a",
] as const;

export const agentGardenUsageModeIds = [
  "INTERACTIVE",
  "CALLABLE",
  "HYBRID",
] as const;

export const agentGardenUsageCapabilitiesSchema = z.object({
  interactive: z.boolean(),
  canDelegate: z.boolean(),
  acceptsDelegation: z.boolean(),
}).strict();

export const agentGardenSkillSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).default(""),
  tags: z.array(z.string().trim().min(1).max(80)).max(32).default([]),
}).strict();

export const agentGardenA2aProfileSchema = z.object({
  protocolBinding: z.enum(["JSONRPC", "HTTP+JSON"]),
  protocolVersion: z.literal("1.0"),
  tenant: z.string().trim().min(1).max(240).nullable(),
  streaming: z.boolean(),
  pushNotifications: z.boolean(),
  extendedAgentCard: z.boolean(),
  defaultInputModes: z.array(z.string().trim().min(1).max(200)).max(64),
  defaultOutputModes: z.array(z.string().trim().min(1).max(200)).max(64),
}).strict();

export const agentGardenEntrySchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(10).max(2_000),
  source: z.enum(["BUILT_IN", "PROJECT_REGISTERED"]),
  integrationType: z.enum(agentGardenIntegrationTypeIds),
  platformLabel: z.string().trim().min(1).max(120),
  category: z.string().trim().min(2).max(80),
  owner: z.string().trim().min(1).max(120),
  tags: z.array(z.string().trim().min(1).max(80)).max(32),
  status: z.enum(["READY", "COMING_SOON", "UNCHECKED", "UNAVAILABLE"]),
  usageMode: z.enum(agentGardenUsageModeIds),
  usageCapabilities: agentGardenUsageCapabilitiesSchema,
  endpoint: z.string().trim().url().nullable(),
  agentCardUrl: z.string().trim().url().nullable(),
  a2a: agentGardenA2aProfileSchema.nullable(),
  authType: z.enum(["none", "bearer_token", "api_key"]),
  authReference: optionalMcpSecretReferenceSchema,
  internalNetworkOnly: z.boolean(),
  configuration: z.record(z.string(), z.string()),
  skills: z.array(agentGardenSkillSchema).max(1_000),
  specializationId: z.string().trim().min(1).max(64).nullable(),
  createdAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
  lastDiscoveredAt: z.string().datetime().nullable(),
  lastDiscoveryError: z.string().max(4_000).nullable(),
}).strict();

export const agentOnboardSourceTypeIds = [
  "container-image",
  "git-repository",
  "existing-agent",
] as const;

const managedAgentIdentitySchema = z.object({
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(2_000),
  category: z.string().trim().min(2).max(80),
  owner: z.string().trim().min(1).max(120),
  tags: z.array(z.string().trim().min(1).max(80)).max(32).default([]),
});

const containerImageReferenceSchema = z.string().trim().min(1).max(500).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/,
  "Enter an OCI image reference without a URL scheme or whitespace.",
);

const containerCommandSchema = z
  .array(z.string().min(1).max(500))
  .max(64)
  .default([]);

const agentCardPathSchema = z.string().trim().min(1).max(240).startsWith(
  "/",
  "Agent Card path must start with /.",
).refine(
  (path) => !path.includes("?") && !path.includes("#"),
  "Agent Card path cannot contain a query string or fragment.",
);

const imagePullSecretNameSchema = z.union([
  z.literal(""),
  z.string().trim().min(1).max(253).regex(
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/,
    "Image pull Secret name must be a lowercase Kubernetes resource name.",
  ),
]);

export const onboardContainerImageAgentSchema = managedAgentIdentitySchema
  .extend({
    sourceType: z.literal("container-image"),
    image: containerImageReferenceSchema,
    containerPort: z.number().int().min(1).max(65_535).default(8_080),
    agentCardPath: agentCardPathSchema.default(
      "/.well-known/agent-card.json",
    ),
    imagePullSecretName: imagePullSecretNameSchema.default(""),
    command: containerCommandSchema,
    args: containerCommandSchema,
    usageMode: z.literal("CALLABLE").default("CALLABLE"),
  })
  .strict();

export const onboardGitRepositoryAgentSchema = managedAgentIdentitySchema
  .extend({
    sourceType: z.literal("git-repository"),
    repositoryUrl: z.string().trim().url(),
    revision: z.string().trim().min(1).max(200).default("main"),
    contextDir: z.string().trim().min(1).max(240).default("."),
    dockerfile: z.string().trim().min(1).max(240).default("Dockerfile"),
    containerPort: z.number().int().min(1).max(65_535).default(8_080),
    agentCardPath: agentCardPathSchema.default(
      "/.well-known/agent-card.json",
    ),
    usageMode: z.literal("CALLABLE").default("CALLABLE"),
  })
  .strict()
  .superRefine((value, context) => {
    let protocol: string;
    try {
      protocol = new URL(value.repositoryUrl).protocol;
    } catch {
      return;
    }
    if (protocol !== "https:" && protocol !== "http:") {
      context.addIssue({
        code: "custom",
        path: ["repositoryUrl"],
        message: "Git repository URL must use HTTP or HTTPS.",
      });
    }
  });

export const onboardExistingAgentSchema = managedAgentIdentitySchema
  .extend({
    sourceType: z.literal("existing-agent"),
    agentCardUrl: z.string().trim().url(),
    authType: z.enum(["none", "bearer_token", "api_key"]).default("none"),
    authReference: optionalMcpSecretReferenceSchema.default(""),
    internalNetworkOnly: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    let protocol: string;
    try {
      protocol = new URL(value.agentCardUrl).protocol;
    } catch {
      return;
    }
    if (protocol !== "https:" && protocol !== "http:") {
      context.addIssue({
        code: "custom",
        path: ["agentCardUrl"],
        message: "Agent Card URL must use HTTP or HTTPS.",
      });
    }
    if (value.authType !== "none" && !value.authReference) {
      context.addIssue({
        code: "custom",
        path: ["authReference"],
        message: "A Secret reference is required for this authentication type.",
      });
    }
  });

export const onboardAgentSchema = z.discriminatedUnion("sourceType", [
  onboardContainerImageAgentSchema,
  onboardGitRepositoryAgentSchema,
  onboardExistingAgentSchema,
]).meta({ id: "OnboardAgentInput" });

export const a2aAgentInstanceSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().trim().min(1).max(160),
  kind: z.literal("A2A"),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2_000),
  runtime: z.enum(["kubernetes", "external"]),
  status: z.enum(instanceStatuses),
  provisioningStage: z.enum(provisioningStages).optional(),
  runtimeNamespace: z.string().trim().min(1).max(253).nullable(),
  deploymentName: z.string().trim().min(1).max(253).nullable(),
  serviceName: z.string().trim().min(1).max(253).nullable(),
  podName: z.string().trim().min(1).max(253).nullable(),
  labelSelector: z.string().trim().min(1).max(500).nullable(),
  imageReference: z.string().trim().min(1).max(500).nullable(),
  imageDigest: z.string().trim().min(1).max(500).nullable(),
  endpoint: z.string().trim().url().nullable(),
  agentCardUrl: z.string().trim().url().nullable(),
  a2a: agentGardenA2aProfileSchema.nullable(),
  skills: z.array(agentGardenSkillSchema).max(1_000),
  createdBy: z.object({
    id: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    username: z.string().trim().min(1),
  }).strict().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  logs: z.array(z.string().max(4_000)).max(1_000),
  error: z.string().max(4_000).nullable(),
}).strict();

/** @deprecated Use a2aAgentInstanceSchema. */
export const managedA2aInstanceSchema = a2aAgentInstanceSchema;

export const agentGardenSnapshotSchema = z.object({
  agents: z.array(agentGardenEntrySchema),
  instances: z.array(a2aAgentInstanceSchema),
}).strict();

export const resourceKindSchema = z.enum([
  "skills",
  "mcp-servers",
  "vector-databases",
]);

export const createModelDeploymentSchema = z.object({
  providerAccountId: z.string().trim().min(1),
  modelId: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(1).max(160),
  modelType: z.enum(modelTypes),
  capabilities: z.array(z.enum(modelCapabilities)).max(modelCapabilities.length).optional(),
  inputModalities: z.array(z.enum(modelInputModalities)).min(1).max(modelInputModalities.length).optional(),
  outputModalities: z.array(z.enum(modelOutputModalities)).min(1).max(modelOutputModalities.length).optional(),
  inputFeePerMillionTokens: z.number().min(0).max(1_000_000).optional(),
  outputFeePerMillionTokens: z.number().min(0).max(1_000_000).optional(),
  feePerAudioMinute: z.number().min(0).max(1_000_000).optional(),
});

const agentAccessPolicyIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(64)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Access Policy bindings must be unique.",
  );

export const createInstanceSchema = z.object({
  name: z.string().trim().min(3).max(64),
  description: z.string().trim().max(300).default(""),
  runtime: z.literal("openshell"),
  agentPlatform: z.enum(agentPlatformIds).default(defaultAgentPlatformId),
  accessPolicyIds: agentAccessPolicyIdsSchema,
  policyId: sandboxPolicyIdSchema.optional(),
  modelRoutingId: z.string().trim().min(1).max(160),
  systemPrompt: z.string().trim().min(10).max(8000),
  specializationId: z.string().trim().min(1).max(64).optional(),
  skillIds: z.array(z.string().trim().min(1).max(160)).max(64).optional(),
  mcpServerIds: z.array(z.string().trim().min(1).max(160)).max(64).optional(),
  knowledgeSourceIds: z.array(z.string().trim().min(1).max(160)).max(64).optional(),
  memory: agentMemoryConfigurationSchema.optional(),
  durableMemoryId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (
    value.memory
    && getAgentPlatformDefinition(value.agentPlatform).capabilities.memory
      === "none"
  ) {
    context.addIssue({
      code: "custom",
      path: ["memory"],
      message: "Memory is currently available only for OpenClaw Instances.",
    });
  }
}).meta({ id: "CreateInstanceInput" });

export const updateInstanceAccessPoliciesSchema = z.object({
  accessPolicyIds: agentAccessPolicyIdsSchema,
}).strict();

export const createInstanceLogSessionSchema = z.object({
  tailLines: z.number().int().min(1).max(2_000).default(200),
  timestamps: z.boolean().default(true),
  previous: z.boolean().default(false),
}).strict();

const nullableQuotaInteger = z.number().int().min(0).max(1_000_000_000).nullable();

export const updateProjectQuotaSchema = z.object({
  hardBudgetUsd: z.number().min(0).max(10_000_000).nullable(),
  budgetDuration: z.enum(["1d", "7d", "30d"]).nullable(),
  tpmLimit: nullableQuotaInteger,
  maxInstances: nullableQuotaInteger,
  maxMcpIntegrations: nullableQuotaInteger,
  maxKnowledgeBaseIntegrations: nullableQuotaInteger,
}).strict().superRefine((value, context) => {
  if (value.hardBudgetUsd !== null && value.budgetDuration === null) {
    context.addIssue({
      code: "custom",
      path: ["budgetDuration"],
      message: "Select a reset period when a spend budget is configured.",
    });
  }
});

export const createInferenceGatewaySchema = z.object({
  name: z.string().trim().min(3).max(64),
  baseUrl: z.string().trim().url(),
  adminUiUrl: z.string().trim().url(),
  adminCredentialRef: z.string().trim().min(1).max(160),
});

const modelDeploymentIdSchema = z.string().uuid();
const fallbackModelDeploymentIdsSchema = z
  .array(modelDeploymentIdSchema)
  .max(8)
  .default([]);
const retryCountSchema = z.number().int().min(0).max(10).default(2);
const semanticRouteSchema = z.object({
  intent: z.string().trim().min(2).max(64).regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and hyphens.",
  ),
  description: z.string().trim().min(3).max(240),
  modelDeploymentId: modelDeploymentIdSchema,
  utterances: z.array(z.string().trim().min(2).max(500)).min(2).max(50),
  scoreThreshold: z.number().min(0).max(1).default(0.5),
}).strict();

export const modelRoutingPolicySchema = z.discriminatedUnion("mode", [
  z.object({
    version: z.literal(1).default(1),
    mode: z.literal("SINGLE"),
    modelDeploymentId: modelDeploymentIdSchema,
    fallbackModelDeploymentIds: fallbackModelDeploymentIdsSchema,
    retries: retryCountSchema,
  }).strict(),
  z.object({
    version: z.literal(1).default(1),
    mode: z.literal("COMPLEXITY"),
    simpleModelDeploymentId: modelDeploymentIdSchema,
    complexModelDeploymentId: modelDeploymentIdSchema,
    fallbackModelDeploymentIds: fallbackModelDeploymentIdsSchema,
    retries: retryCountSchema,
  }).strict(),
  z.object({
    version: z.literal(1).default(1),
    mode: z.literal("SEMANTIC"),
    defaultModelDeploymentId: modelDeploymentIdSchema,
    embeddingModelDeploymentId: modelDeploymentIdSchema,
    routes: z.array(semanticRouteSchema).min(1).max(16),
    fallbackModelDeploymentIds: fallbackModelDeploymentIdsSchema,
    retries: retryCountSchema,
  }).strict(),
]).superRefine((policy, context) => {
  if (
    policy.mode === "SINGLE"
    && policy.fallbackModelDeploymentIds.includes(policy.modelDeploymentId)
  ) {
    context.addIssue({
      code: "custom",
      path: ["fallbackModelDeploymentIds"],
      message: "Fallbacks must be different from the primary model.",
    });
  }
  if (policy.mode === "COMPLEXITY") {
    if (policy.simpleModelDeploymentId === policy.complexModelDeploymentId) {
      context.addIssue({
        code: "custom",
        path: ["complexModelDeploymentId"],
        message: "Simple and complex tiers must use different model deployments.",
      });
    }
    if (
      policy.fallbackModelDeploymentIds.includes(policy.simpleModelDeploymentId)
      || policy.fallbackModelDeploymentIds.includes(policy.complexModelDeploymentId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fallbackModelDeploymentIds"],
        message: "Fallbacks must be different from both routing tiers.",
      });
    }
  }
  if (policy.mode === "SEMANTIC") {
    const routeIntents = policy.routes.map((route) => route.intent);
    if (new Set(routeIntents).size !== routeIntents.length) {
      context.addIssue({
        code: "custom",
        path: ["routes"],
        message: "Semantic route intents must be unique.",
      });
    }
    const routeTargets = policy.routes.map((route) => route.modelDeploymentId);
    if (new Set(routeTargets).size !== routeTargets.length) {
      context.addIssue({
        code: "custom",
        path: ["routes"],
        message: "Each semantic route must target a different model deployment.",
      });
    }
    if (routeTargets.includes(policy.defaultModelDeploymentId)) {
      context.addIssue({
        code: "custom",
        path: ["routes"],
        message: "Semantic route targets must be different from the default model.",
      });
    }
    const routedModels = new Set([
      policy.defaultModelDeploymentId,
      ...routeTargets,
    ]);
    if (policy.fallbackModelDeploymentIds.some((id) => routedModels.has(id))) {
      context.addIssue({
        code: "custom",
        path: ["fallbackModelDeploymentIds"],
        message: "Fallbacks must be different from the default and routed models.",
      });
    }
  }
});

const modelRoutingKeyPolicyValueSchema = z.object({
  perInstance: z.literal(true).default(true),
  rotationDays: z.number().int().min(1).max(365).default(90),
});
const modelRoutingKeyPolicySchema = modelRoutingKeyPolicyValueSchema.default({
  perInstance: true,
  rotationDays: 90,
});

const modelRoutingAuditPolicyValueSchema = z.object({
  controlPlane: z.literal(true).default(true),
  requestLogs: z.boolean().default(true),
  capturePrompts: z.literal(false).default(false),
});
const modelRoutingAuditPolicySchema = modelRoutingAuditPolicyValueSchema.default({
  controlPlane: true,
  requestLogs: true,
  capturePrompts: false,
});

const createModelRoutingBaseSchema = z.object({
  name: z.string().trim().min(2).max(64),
  description: z.string().trim().max(300).default(""),
  gatewayId: z.string().trim().min(1),
  routingPolicy: modelRoutingPolicySchema,
  complianceDomain: z.enum(complianceDomains),
  isDefault: z.boolean().default(false),
  keyPolicy: modelRoutingKeyPolicySchema,
  auditPolicy: modelRoutingAuditPolicySchema,
}).strict();

export const createModelRoutingSchema = createModelRoutingBaseSchema;

export const updateModelRoutingSchema = z.object({
  name: z.string().trim().min(2).max(64).optional(),
  description: z.string().trim().max(300).optional(),
  isDefault: z.boolean().optional(),
  keyPolicy: modelRoutingKeyPolicyValueSchema.optional(),
  auditPolicy: modelRoutingAuditPolicyValueSchema.optional(),
  routingPolicy: modelRoutingPolicySchema.optional(),
  suspended: z.boolean().optional(),
}).strict();

export type InstanceStatus = (typeof instanceStatuses)[number];
export type ProvisioningStage = (typeof provisioningStages)[number];
export type ProviderKind = (typeof providerKinds)[number];
export type ModelType = (typeof modelTypes)[number];
export type ModelCapability = (typeof modelCapabilities)[number];
export type ModelInputModality = (typeof modelInputModalities)[number];
export type ModelOutputModality = (typeof modelOutputModalities)[number];
export type AgentMemoryConfiguration = z.infer<
  typeof agentMemoryConfigurationSchema
>;
export type SandboxPolicyId = z.infer<typeof sandboxPolicyIdSchema>;
export type SandboxPolicyInput = z.infer<typeof sandboxPolicyInputSchema>;
export type CreateSandboxPolicyInput = z.infer<typeof createSandboxPolicySchema>;
export type UpdateSandboxPolicyInput = z.infer<typeof updateSandboxPolicySchema>;
export type ProviderResourceStatus = (typeof providerResourceStatuses)[number];
export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;
export type SkillTrustLevel = (typeof skillTrustLevels)[number];
export type SkillCompatibilityTarget = (typeof skillCompatibilityTargets)[number];
export type CreateSkillDefinitionInput = z.infer<typeof createSkillDefinitionSchema>;
export type UpdateSkillDefinitionInput = z.infer<typeof updateSkillDefinitionSchema>;
export type McpServerDefinition = z.infer<typeof mcpServerDefinitionSchema>;
export type McpServerConnection = z.infer<typeof mcpServerConnectionSchema>;
export type McpToolDefinition = z.infer<typeof mcpToolDefinitionSchema>;
export type McpServerTemplate = z.infer<typeof mcpServerTemplateSchema>;
export type CreateMcpServerDefinitionInput = z.infer<typeof createMcpServerDefinitionSchema>;
export type UpdateMcpServerDefinitionInput = z.infer<typeof updateMcpServerDefinitionSchema>;
export type AccessPolicyStatus = (typeof accessPolicyStatuses)[number];
export type AccessPolicyDecision = (typeof accessPolicyDecisions)[number];
export type AccessPolicyToolRule = z.infer<typeof accessPolicyToolRuleSchema>;
export type AccessPolicyServerRule = z.infer<typeof accessPolicyServerRuleSchema>;
export type AgentGardenIntegrationType = (typeof agentGardenIntegrationTypeIds)[number];
export type AgentGardenUsageMode = (typeof agentGardenUsageModeIds)[number];
export type AgentGardenUsageCapabilities = z.infer<typeof agentGardenUsageCapabilitiesSchema>;
export type AgentGardenSkill = z.infer<typeof agentGardenSkillSchema>;
export type AgentGardenA2aProfile = z.infer<typeof agentGardenA2aProfileSchema>;
export type AgentGardenEntry = z.infer<typeof agentGardenEntrySchema>;
export type AgentOnboardSourceType =
  (typeof agentOnboardSourceTypeIds)[number];
export type OnboardContainerImageAgentInput = z.infer<
  typeof onboardContainerImageAgentSchema
>;
export type OnboardGitRepositoryAgentInput = z.infer<
  typeof onboardGitRepositoryAgentSchema
>;
export type OnboardExistingAgentInput = z.infer<
  typeof onboardExistingAgentSchema
>;
export type OnboardAgentInput = z.infer<typeof onboardAgentSchema>;

export interface AgentMarketplaceBrief {
  tagline: string;
  overview: string;
  useCases: string[];
  inputs: string[];
  outputs: string[];
  requirements: string[];
}
export type AgentGardenSnapshot = z.infer<typeof agentGardenSnapshotSchema>;
export type A2aAgentInstance = z.infer<typeof a2aAgentInstanceSchema>;
/** @deprecated Use A2aAgentInstance. */
export type ManagedA2aInstance = A2aAgentInstance;
export type CreateAccessPolicyInput = z.infer<typeof createAccessPolicySchema>;
export type UpdateAccessPolicyInput = z.infer<typeof updateAccessPolicySchema>;
export type KnowledgeSourceDefinition = z.infer<typeof knowledgeSourceDefinitionSchema>;
export type CreateKnowledgeSourceDefinitionInput = z.infer<typeof createKnowledgeSourceDefinitionSchema>;
export type UpdateKnowledgeSourceDefinitionInput = z.infer<typeof updateKnowledgeSourceDefinitionSchema>;
export type KnowledgeVectorChunkInput = z.infer<typeof knowledgeVectorChunkInputSchema>;
export type UpsertKnowledgeVectorChunksInput = z.infer<typeof upsertKnowledgeVectorChunksSchema>;
export type VectorDatabaseDefinition = z.infer<typeof vectorDatabaseDefinitionSchema>;
export type CreateVectorDatabaseDefinitionInput = z.infer<typeof createVectorDatabaseDefinitionSchema>;
export type UpdateVectorDatabaseDefinitionInput = z.infer<typeof updateVectorDatabaseDefinitionSchema>;
export type VectorChunkInput = z.infer<typeof vectorChunkInputSchema>;
export type UpsertVectorChunksInput = z.infer<typeof upsertVectorChunksSchema>;
export type VectorMetadataType = z.infer<typeof vectorMetadataValueSchema>["type"];
export type VectorMetadataValue = z.infer<typeof vectorMetadataValueSchema>;
export type VectorCustomMetadata = z.infer<typeof vectorCustomMetadataSchema>;
export type VectorMetadataField = z.infer<typeof vectorMetadataFieldSchema>;
export type VectorDocument = z.infer<typeof vectorDocumentSchema>;
export type VectorFolder = z.infer<typeof vectorFolderSchema>;
export type CreateVectorFolderInput = z.infer<typeof createVectorFolderSchema>;
export type UpdateVectorFolderInput = z.infer<typeof updateVectorFolderSchema>;
export type UpdateVectorDocumentInput = z.infer<typeof updateVectorDocumentSchema>;
export type VectorDeletionImpact = z.infer<typeof vectorDeletionImpactSchema>;
export type VectorDocumentChunk = z.infer<typeof vectorDocumentChunkSchema>;
export type VectorDocumentDetail = z.infer<typeof vectorDocumentDetailSchema>;
export type VectorIngestionJob = z.infer<typeof vectorIngestionJobSchema>;
export type VectorDatabaseStats = z.infer<typeof vectorDatabaseStatsSchema>;
export type VectorDatabaseOverview = z.infer<typeof vectorDatabaseOverviewSchema>;
export type VectorDatabaseSearchInput = z.infer<typeof vectorDatabaseSearchInputSchema>;
export type VectorDatabaseSearchResult = z.infer<typeof vectorDatabaseSearchResultSchema>;
export type AgentSpecializationDefinition = z.infer<typeof agentSpecializationDefinitionSchema>;
export type ResourceKind = z.infer<typeof resourceKindSchema>;
export type ProviderConnectionDraft = z.infer<typeof providerConnectionDraftSchema>;
export type DiscoverProviderModelsInput = z.infer<typeof discoverProviderModelsSchema>;
export type ProviderModelSelection = z.infer<typeof providerModelSelectionSchema>;
export type CreateProviderConnectionInput = z.infer<typeof createProviderConnectionSchema>;
export type CreateModelDeploymentInput = z.infer<typeof createModelDeploymentSchema>;
export type CreateInstanceInput = z.infer<typeof createInstanceSchema>;
export type UpdateInstanceAccessPoliciesInput = z.infer<
  typeof updateInstanceAccessPoliciesSchema
>;
export type CreateInstanceLogSessionInput = z.infer<
  typeof createInstanceLogSessionSchema
>;
export type UpdateProjectQuotaInput = z.infer<typeof updateProjectQuotaSchema>;
export type ComplianceDomain = (typeof complianceDomains)[number];
export type ModelRoutingStatus = (typeof modelRoutingStatuses)[number];
export type ModelRoutingCapabilityState = (typeof modelRoutingCapabilityStates)[number];
export type ModelRoutingMode = (typeof modelRoutingModes)[number];
export type ModelRoutingPolicy = z.infer<typeof modelRoutingPolicySchema>;
export type CreateInferenceGatewayInput = z.infer<typeof createInferenceGatewaySchema>;
export type CreateModelRoutingInput = z.infer<typeof createModelRoutingSchema>;
export type UpdateModelRoutingInput = z.infer<typeof updateModelRoutingSchema>;

export interface InferenceGateway {
  id: string;
  name: string;
  baseUrl: string;
  adminUiUrl: string;
  credentialSource: "ENVIRONMENT" | "SECRET_REFERENCE";
  status: "UNKNOWN" | "READY" | "DEGRADED";
  validationMessage: string;
  validatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRoutingCondition {
  type: "BINDING" | "GATEWAY" | "COMPLIANCE" | "CAPABILITY";
  status: "PASS" | "FAIL" | "UNKNOWN";
  reason: string;
}

export interface ModelRoutingCapabilities {
  automaticRouting: ModelRoutingCapabilityState;
  routerType: "COMPLEXITY_ROUTER" | "SEMANTIC_ROUTER" | "OTHER" | "UNKNOWN";
  complexityTierCount?: number;
  semanticRouteCount?: number;
  sessionAffinity: ModelRoutingCapabilityState;
  adaptiveRouting: ModelRoutingCapabilityState;
  failover: ModelRoutingCapabilityState;
  generalFallback: ModelRoutingCapabilityState;
  contextWindowFallback: ModelRoutingCapabilityState;
  contentPolicyFallback: ModelRoutingCapabilityState;
  retries: ModelRoutingCapabilityState;
  requestAudit: ModelRoutingCapabilityState;
}

export interface InferenceResourceOrigin {
  scope: "PROJECT" | "DEPARTMENT";
  scopeId: string;
  scopeName?: string;
  inherited: boolean;
  editable: boolean;
  accessSources?: Array<
    | "PROJECT_INHERITANCE"
    | "DEPARTMENT_ASSIGNMENT"
    | "ROUTING_DEPENDENCY"
  >;
  routingDependencyIds?: string[];
  projectDefault?: {
    slot: "CHAT" | "EMBEDDING" | "SPEECH_TO_TEXT" | "ROUTING";
    managedBy: "PROJECT" | "DEPARTMENT";
  };
}

export interface ModelRouting {
  id: string;
  name: string;
  description: string;
  gatewayId: string;
  managementMode: "LITELLM_MANAGED";
  publicModelAlias: string;
  routingPolicy: ModelRoutingPolicy;
  complianceDomain: ComplianceDomain;
  status: ModelRoutingStatus;
  isDefault: boolean;
  keyPolicy: CreateModelRoutingInput["keyPolicy"];
  auditPolicy: CreateModelRoutingInput["auditPolicy"];
  capabilities: ModelRoutingCapabilities;
  conditions: ModelRoutingCondition[];
  configurationHash: string;
  observedGeneration: number;
  validationMessage: string;
  liteLLMTeamId?: string;
  liteLLMVersion?: string;
  consumers: number;
  lastSynchronizedAt?: string;
  createdAt: string;
  updatedAt: string;
  origin?: InferenceResourceOrigin;
}

export interface ModelRoutingBinding {
  id: string;
  modelRoutingId: string;
  agentId: string;
  liteLLMTeamId: string;
  liteLLMTokenId: string;
  keyAlias: string;
  keyFingerprint: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  revokedAt?: string;
}

export type ModelRoutingConsumer = Omit<ModelRoutingBinding, "liteLLMTokenId">;

export interface ModelRoutingAuditEvent {
  eventId: string;
  timestamp: string;
  actor: string;
  type: string;
  modelRoutingId: string;
  agentId?: string;
  configurationHash: string;
  complianceDomain: ComplianceDomain;
  result: "SUCCESS" | "FAILED";
  reason: string;
}

export interface ResourceCatalog {
  skills: SkillDefinition[];
  mcpServers: McpServerDefinition[];
  mcpServerTemplates: McpServerTemplate[];
  vectorDatabases: VectorDatabaseDefinition[];
  specializations: AgentSpecializationDefinition[];
}

export interface AccessPolicy extends CreateAccessPolicyInput {
  id: string;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastReconciledAt?: string;
  lastReconciliationError?: string;
}

export interface AccessPolicyVersion {
  policyId: string;
  revision: number;
  actor: string;
  summary: string;
  snapshot: AccessPolicy;
  createdAt: string;
}

export interface SandboxPolicy extends SandboxPolicyInput {
  id: SandboxPolicyId;
  enforcement: "ENFORCE";
  source: "BUILT_IN" | "CUSTOM";
  immutable: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SandboxPolicyCatalog {
  defaultPolicyId: SandboxPolicyId;
  templatePolicyYaml: string;
  policies: SandboxPolicy[];
}

export interface ProviderValidationCheck {
  id: "endpoint" | "catalog" | "credentials" | "inference";
  label: string;
  status: "PASS" | "FAIL" | "SKIP";
}

export interface ProviderAccount {
  id: string;
  name: string;
  providerKind: ProviderKind;
  presetId: ProviderKind;
  endpoint: string;
  config: Record<string, unknown>;
  complianceDomain: ComplianceDomain;
  endpointRegion: string;
  crossBorderTransfer: false;
  discoveredModels: string[];
  status: ProviderResourceStatus;
  checks: ProviderValidationCheck[];
  credentialState: "STORED";
  validationMessage: string;
  validationLatencyMs?: number;
  validatedAt?: string;
  createdAt: string;
  updatedAt: string;
  origin?: InferenceResourceOrigin;
}

export interface ProviderDiscoveryResult {
  providerKind: ProviderKind;
  mode: "remote" | "suggested" | "manual";
  models: ProviderPresetModel[];
  checks: ProviderValidationCheck[];
  message: string;
  latencyMs?: number;
}

export interface ProviderModelFailure {
  model: ProviderModelSelection;
  message: string;
}

export interface ProviderConnectionCreationResult {
  account: ProviderAccount;
  models: ModelDeployment[];
  failures: ProviderModelFailure[];
}

export interface ModelDeployment extends CreateModelDeploymentInput {
  capabilities: ModelCapability[];
  inputModalities: ModelInputModality[];
  outputModalities: ModelOutputModality[];
  id: string;
  providerPresetId: ProviderKind;
  providerName: string;
  endpoint: string;
  complianceDomain: ComplianceDomain;
  endpointRegion: string;
  crossBorderTransfer: false;
  litellmModelName: string;
  status: ProviderResourceStatus;
  checks: ProviderValidationCheck[];
  validationMessage: string;
  validationLatencyMs?: number;
  validatedAt?: string;
  createdAt: string;
  updatedAt: string;
  origin?: InferenceResourceOrigin;
}

export interface DepartmentInferenceAvailability {
  departmentId: string;
  departmentName: string;
  models: ModelDeployment[];
  routings: ModelRouting[];
}

export const assignDepartmentInferenceResourceSchema = z.object({
  projectIds: z.array(z.string().trim().min(1).max(160))
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Project IDs must be unique."),
  setAsProjectDefault: z.boolean().default(false),
}).strict();

export type AssignDepartmentInferenceResourceInput = z.infer<
  typeof assignDepartmentInferenceResourceSchema
>;

export interface DepartmentInferenceResourceProjectAssignment {
  projectId: string;
  projectName: string;
  projectInherited: boolean;
  departmentAssigned: boolean;
  isProjectDefault: boolean;
  defaultManagedBy?: "PROJECT" | "DEPARTMENT";
}

export interface DepartmentInferenceResourceAssignmentView {
  departmentId: string;
  resourceId: string;
  resourceKind: "MODEL" | "ROUTING";
  dependencies: Array<{
    id: string;
    name: string;
    modelType: ModelType;
  }>;
  projects: DepartmentInferenceResourceProjectAssignment[];
}

export type CostGroupBy =
  | "instance"
  | "model_endpoint"
  | "provider_account"
  | "virtual_key";

export type CostFilterKey =
  | "instance"
  | "model_endpoint"
  | "provider"
  | "provider_account"
  | "virtual_key"
  | "project";

export type CostFilters = Partial<Record<CostFilterKey, string[]>>;

export interface CostQueryParams {
  startTime: string;
  endTime: string;
  groupBy: CostGroupBy;
  filters: CostFilters;
  timezone: string;
}

export interface CostBreakdownItem {
  id: string;
  label: string;
  detail: string;
  spend: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  share: number;
  lastActive?: string;
  provider?: string;
  providerAccount?: string;
  modelsUsed?: number;
  boundInstance?: string;
  boundInstanceId?: string;
  user?: string;
  team?: string;
}

export interface CostDailyPoint {
  date: string;
  spend: number;
  tokens: number;
  requests: number;
  active: number;
  activeObjectIds?: string[];
}

export interface CostTrendSeriesPoint {
  id: string;
  label: string;
  spend: number;
  tokens: number;
  requests: number;
}

export interface CostTrendPoint {
  date: string;
  series: CostTrendSeriesPoint[];
}

export interface CostComparison {
  current: number;
  previous: number;
  changePercent?: number;
}

export interface CostSummary {
  totalSpend: CostComparison;
  totalTokens: CostComparison;
  requests: CostComparison;
  highestCostInstance?: CostBreakdownItem;
  highestCostModel?: CostBreakdownItem;
}

export interface CostInsight {
  id:
    | "highest_spend_day"
    | "average_daily_spend"
    | "active_group"
    | "active_model_endpoints"
    | "most_expensive_provider"
    | "peak_tokens_day";
  label: string;
  subject?: string;
  value: number;
  valueKind: "currency" | "count" | "tokens";
}

export interface CostFilterOption {
  value: string;
  label: string;
}

export type ModelCostGranularity = "daily" | "weekly" | "cumulative";
export type ModelCostTrendGranularity = "day" | "week" | "month";
export type ModelCostSortDirection = "asc" | "desc";

export interface ModelCostObjectSpend {
  id: string;
  name: string;
  spendUsd: number;
  share: number;
}

export interface ModelCostSummaryResponse {
  currency: "USD";
  totalSpendUsd: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requests: number;
  unknownCostRequests: number;
  uncorrelatedRunRequests: number;
  highestCostInstance?: ModelCostObjectSpend;
  highestCostModel?: ModelCostObjectSpend;
  comparison: {
    spendPercent?: number;
    tokensPercent?: number;
    requestsPercent?: number;
  };
}

export interface ModelCostActivityItem {
  date: string;
  spendUsd: number;
  tokens: number;
  requests: number;
  activeObjects: number;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface ModelCostActivityResponse {
  currency: "USD";
  granularity: ModelCostGranularity;
  items: ModelCostActivityItem[];
  legend: {
    min: number;
    max: number;
    thresholds: [number, number, number, number, number];
  };
}

export interface ModelCostInsightsResponse {
  currency: "USD";
  highestSpendDay?: { date: string; spendUsd: number };
  averageDailySpendUsd: number;
  activeInstances: number;
  activeModelEndpoints: number;
  activeProviderAccounts: number;
  activeVirtualKeys: number;
  mostExpensiveProvider?: { provider: string; spendUsd: number };
  peakTokensDay?: { date: string; tokens: number };
  unknownCostRequests: number;
}

export interface ModelCostRankingItem extends ModelCostObjectSpend {
  tokens: number;
  requests: number;
  rank: number;
}

export interface ModelCostRankingResponse {
  currency: "USD";
  items: ModelCostRankingItem[];
  totalSpendUsd: number;
}

export interface ModelCostTrendSeriesItem {
  date: string;
  spendUsd: number;
  tokens: number;
  requests: number;
}

export interface ModelCostTrendSeries {
  id: string;
  name: string;
  items: ModelCostTrendSeriesItem[];
}

export interface ModelCostTrendResponse {
  currency: "USD";
  dates: string[];
  series: ModelCostTrendSeries[];
}

export interface ModelCostBreakdownItem {
  id: string;
  name: string;
  detail: string;
  spendUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
  averageCostPerRequest: number;
  share: number;
  lastActive?: string;
  provider?: string;
  providerAccount?: string;
  modelsUsed?: number;
  boundInstance?: string;
  boundInstanceId?: string;
  user?: string;
  team?: string;
}

export interface ModelCostBreakdownResponse {
  currency: "USD";
  items: ModelCostBreakdownItem[];
  total: number;
  page: number;
  pageSize: number;
  filterOptions: Record<CostFilterKey, CostFilterOption[]>;
}

export interface ModelCostDataQualityResponse {
  unmappedRequests: number;
  unmappedInstances: number;
  unmappedModelEndpoints: number;
  unmappedProviderAccounts: number;
  tokenMismatchRequests: number;
  negativeSpendRequests: number;
  unknownCostRequests: number;
  uncorrelatedRunRequests: number;
  duplicateRequests: number;
  lateArrivingRequests: number;
  lastSyncAt?: string;
  syncLagSeconds?: number;
  litellmSpend: number;
  taliSpend: number;
  spendDifference: number;
}

export type PlatformAuditActorType = "user" | "service_account" | "system";
export type PlatformAuditOutcome = "success" | "failed" | "denied";
export type PlatformAuditSortDirection = "asc" | "desc";

export interface PlatformAuditLogQuery {
  query?: string;
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  objectType?: string;
  outcome?: PlatformAuditOutcome;
  cursor?: string;
  limit?: number;
  direction?: PlatformAuditSortDirection;
}

export interface PlatformAuditLogFacets {
  actors: Array<{
    id: string;
    name: string;
    email?: string;
  }>;
  actions: string[];
  objectTypes: string[];
}

export interface PlatformAuditLogEvent {
  id: string;
  projectId: string;
  occurredAt: string;
  actor: {
    type: PlatformAuditActorType;
    id: string;
    name: string;
    email?: string;
  };
  authorization: {
    scope: "project";
    role: string;
    decision: "allowed" | "denied" | "approval_required";
    capability?: ProjectCapability;
    reason?: string;
  };
  action: string;
  verb: string;
  object: {
    type: string;
    id: string;
    name: string;
  };
  outcome: PlatformAuditOutcome;
  summary: string;
  request: {
    id: string;
    method: string;
    route: string;
    ipAddress: string;
    userAgent: string;
    parameters?: Record<string, unknown>;
    body?: unknown;
  };
  trace?: {
    traceId: string;
    spanId?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface PlatformAuditLogListResponse {
  data: PlatformAuditLogEvent[];
  nextCursor?: string;
  totalCount: number;
  facets: PlatformAuditLogFacets;
}

export interface InstanceCreator {
  id: string;
  displayName: string;
  username: string;
}

export interface Instance extends Omit<CreateInstanceInput, "policyId"> {
  schemaVersion: 2;
  id: string;
  policyId: SandboxPolicyId;
  providerAccountId: string;
  providerName: string;
  modelDeploymentId: string;
  model: string;
  modelType: "llm";
  inferenceMode: "PLATFORM_MANAGED";
  modelRoutingId: string;
  modelRoutingBindingId: string;
  modelRoutingStatus: ModelRoutingStatus;
  modelRoutingComplianceDomain: ComplianceDomain;
  modelRoutingCapabilities: ModelRoutingCapabilities;
  modelRoutingKeyFingerprint: string;
  modelRoutingLastSynchronizedAt?: string;
  costKeyAlias: string;
  liteLLMTokenId?: string;
  liteLLMKeyBlockedAt?: string;
  liteLLMTeamId?: string;
  modelRoutingBindingRevokedAt?: string;
  serviceAccountId?: string;
  sandboxName: string;
  status: InstanceStatus;
  createdBy?: InstanceCreator;
  createdAt: string;
  updatedAt: string;
  deletionCompletedAt?: string;
  operationId?: string;
  runtimePhase?: string;
  provisioningStage?: ProvisioningStage;
  logs: string[];
  httpEndpoint?: HttpEndpoint;
  error?: string;
}

export type AgentInstanceRole = "SUPERVISOR" | "SPECIALIST" | "HYBRID";
export type AgentInstanceRuntimeType = "OPENSHELL" | "KUBERNETES" | "EXTERNAL";

export interface AgentInstanceRuntimeView {
  type: AgentInstanceRuntimeType;
  managed: boolean;
  namespace?: string;
  workloadName?: string;
  serviceName?: string;
  podName?: string;
  imageReference?: string;
  imageDigest?: string;
}

export interface A2aAgentProtocolView {
  type: "A2A";
  version: "1.0";
  direction: Array<"CLIENT" | "SERVER">;
  binding?: "JSONRPC" | "HTTP+JSON";
  endpoint?: string;
  agentCardUrl?: string;
  agentCardStatus: "VALID" | "INVALID" | "UNCHECKED";
  lastDiscoveredAt?: string;
  lastDiscoveryError?: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    extendedAgentCard: boolean;
    defaultInputModes: string[];
    defaultOutputModes: string[];
  };
  skills: AgentGardenSkill[];
}

export type AgentProtocolView = A2aAgentProtocolView;

export interface AgentInstanceCapabilityView {
  interactive: boolean;
  canPlan: boolean;
  canDelegate: boolean;
  acceptsDelegation: boolean;
  terminal: boolean;
  liveLogs: boolean;
}

export interface AgentInstanceObservabilityView {
  logSources: Array<"RUNTIME" | "LIFECYCLE" | "PROTOCOL" | "AUDIT">;
  terminal: {
    supported: boolean;
    reason?: string;
  };
}

interface AgentInstanceDetailBase {
  resourceType: "AGENT_INSTANCE";
  id: string;
  name: string;
  description: string;
  role: AgentInstanceRole;
  status: InstanceStatus;
  platform: { id: string; name: string };
  runtimeView: AgentInstanceRuntimeView;
  protocols: AgentProtocolView[];
  capabilities: AgentInstanceCapabilityView;
  observability: AgentInstanceObservabilityView;
  createdBy?: InstanceCreator;
  createdAt: string;
  updatedAt: string;
}

export interface SupervisorAgentInstanceDetail extends AgentInstanceDetailBase {
  kind: "SUPERVISOR";
  instance: Instance;
  definition: null;
}

export interface A2aStandardAgentInstanceDetail extends AgentInstanceDetailBase {
  kind: "A2A";
  instance: A2aAgentInstance;
  definition: AgentGardenEntry;
}

export type AgentInstanceDetail =
  | SupervisorAgentInstanceDetail
  | A2aStandardAgentInstanceDetail;

export interface AgentInstanceActivityEvent {
  id: string;
  kind: "LIFECYCLE" | "CONNECTION" | "INVOCATION";
  status: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  title: string;
  description: string;
  occurredAt: string;
  coordinatorInstanceId?: string;
  requestId?: string;
  durationMs?: number;
}

export interface AgentInstanceLogSessionResponse {
  id: string;
  expiresAt: string;
  websocketUrl: string;
}

/**
 * Sensitive interaction material returned only after
 * CAP_AGENT_INSTANCE_INTERACT admission. It is deliberately separate from
 * the Instance configuration representation.
 */
export interface InstanceInteractionAccess {
  instanceId: string;
  status: InstanceStatus;
  httpEndpoint?: HttpEndpoint;
}

/** Runtime diagnostics disclosed only by CAP_AGENT_INSTANCE_LOG_VIEW. */
export interface InstanceRuntimeLogView {
  instanceId: string;
  logs: string[];
  error?: string;
}

export interface ProjectQuotaUsage {
  spendUsd: number;
  totalTokens: number;
  instances: number;
  mcpIntegrations: number;
  knowledgeBaseIntegrations: number;
}

export interface ProjectQuota {
  projectId: string;
  hardBudgetUsd: number | null;
  budgetDuration: "1d" | "7d" | "30d" | null;
  budgetPeriodStartedAt: string | null;
  budgetResetsAt: string | null;
  tpmLimit: number | null;
  maxInstances: number | null;
  maxMcpIntegrations: number | null;
  maxKnowledgeBaseIntegrations: number | null;
  litellmTeamId: string | null;
  syncStatus: "pending" | "synced" | "failed";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  revision: number;
  usage: ProjectQuotaUsage;
}

export interface HttpEndpoint {
  kind: "openclaw-webui" | "hermes-dashboard";
  status: "READY" | "UNAVAILABLE";
  url?: string;
  reason?: string;
}

export interface RunnerSandbox {
  name: string;
  agentPlatform: AgentPlatformId;
  phase:
    | "PROVISIONING"
    | "READY"
    | "FAILED"
    | "NOT_FOUND"
    | "DESTROYING";
  operationId?: string;
  provisioningStage?: ProvisioningStage;
  logs: string[];
  httpEndpoint?: HttpEndpoint;
  error?: string;
}

export interface SandboxAuditEvent {
  id: string;
  timestamp: string;
  source: "gateway" | "sandbox" | "unknown";
  category: string;
  severity: "INFO" | "LOW" | "MED" | "HIGH" | "CRIT" | "UNKNOWN";
  decision:
    | "ALLOWED"
    | "DENIED"
    | "BLOCKED"
    | "APPROVED"
    | "REJECTED"
    | "OBSERVED";
  summary: string;
  policy?: string;
  raw: string;
}

export interface RunnerHealth {
  ok: boolean;
  mode: string;
  runtimeImages?: Record<AgentPlatformId, string>;
  sandbox?: {
    provider: "openshell";
    cpu: string;
    memory: string;
    gatewayEndpoint: string;
    workspace: string;
    serviceBaseUrl: string;
    kubernetesServiceCidrs: string[];
    gatewayImage?: string;
    supervisorImage?: string;
    defaultImage?: string;
    defaultImagePullPolicy?: string;
    tlsDisabled?: boolean;
  };
}

export interface RuntimeStatus {
  mode: string;
  terminal: {
    available: boolean;
    kind: "nemoclaw-tui";
    transport: "nemoclaw" | "openshell" | "none";
    reason?: string;
  };
}

export function supportsNemoClawTui(mode: string): boolean {
  return mode === "nemoclaw" || mode === "openshell-kubernetes";
}

export interface TerminalSessionResponse {
  id: string;
  expiresAt: string;
  websocketUrl: string;
}

export interface TerminalTarget {
  id: string;
  containerName: string;
  displayName?: string;
  primary: boolean;
  available: boolean;
  reason?: string;
  shells: string[];
}

export const createTerminalSessionInputSchema = z.object({
  targetId: z.string().trim().min(1).max(128),
});

export type CreateTerminalSessionInput = z.infer<
  typeof createTerminalSessionInputSchema
>;

const terminalResizePrefix = "\u0000TALI_RESIZE:";

export interface TerminalResize {
  cols: number;
  rows: number;
}

export type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "invalid-control" };

export function encodeTerminalResize({ cols, rows }: TerminalResize): string {
  return `${terminalResizePrefix}${cols}:${rows}`;
}

export function parseTerminalClientMessage(
  input: string,
): TerminalClientMessage {
  if (!input.startsWith(terminalResizePrefix))
    return { type: "input", data: input };
  const parts = input.slice(terminalResizePrefix.length).split(":");
  if (parts.length !== 2) return { type: "invalid-control" };
  const [colsText, rowsText] = parts;
  if (colsText === undefined || rowsText === undefined)
    return { type: "invalid-control" };
  const cols = Number(colsText);
  const rows = Number(rowsText);
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 2 ||
    cols > 500 ||
    rows < 1 ||
    rows > 300
  )
    return { type: "invalid-control" };
  return { type: "resize", cols, rows };
}
