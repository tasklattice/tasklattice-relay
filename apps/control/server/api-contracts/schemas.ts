import {
  assignableProjectMembershipRoles,
  builtinProjectRoleIds,
  departmentNameSchema,
  projectIdSchema,
  projectNameSchema,
  projectCapabilities,
  projectMembershipRoles,
  projectOverviewRanges,
  resourceKindSchema,
} from "@tali/contracts";
import { z } from "zod";

const id = z.string().min(1);
const uuid = z.string().uuid();
const timestamp = z.iso.datetime();
const nullableTimestamp = timestamp.nullable();
const money = z.number().nonnegative();

export const projectParamsSchema = z.object({ projectId: id });
export const departmentParamsSchema = z.object({ departmentId: id });
export const instanceParamsSchema = projectParamsSchema.extend({ instanceId: uuid });
export const instanceOperationParamsSchema = instanceParamsSchema.extend({
  operationId: uuid,
});
export const providerParamsSchema = projectParamsSchema.extend({ providerId: uuid });
export const modelParamsSchema = projectParamsSchema.extend({ modelId: uuid });
export const routingParamsSchema = projectParamsSchema.extend({ routingId: uuid });
export const departmentProviderParamsSchema = departmentParamsSchema.extend({ providerId: uuid });
export const departmentModelParamsSchema = departmentParamsSchema.extend({ modelId: uuid });
export const departmentRoutingParamsSchema = departmentParamsSchema.extend({ routingId: uuid });
export const departmentModelAssignmentParamsSchema = departmentModelParamsSchema.extend({
  projectId: id,
});
export const departmentRoutingAssignmentParamsSchema = departmentRoutingParamsSchema.extend({
  projectId: id,
});
export const runtimePolicyParamsSchema = projectParamsSchema.extend({ policyId: id });
export const accessPolicyParamsSchema = projectParamsSchema.extend({ policyId: uuid });
export const notificationParamsSchema = z.object({ notificationId: uuid });
export const memberParamsSchema = projectParamsSchema.extend({ memberId: id });
export const gardenAgentParamsSchema = projectParamsSchema.extend({ id });
export const traceParamsSchema = projectParamsSchema.extend({
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
});
export const catalogCollectionParamsSchema = projectParamsSchema.extend({
  kind: resourceKindSchema,
});
export const catalogResourceParamsSchema = catalogCollectionParamsSchema.extend({ id });
export const catalogNamedResourceParamsSchema = projectParamsSchema.extend({ id });
export const vectorChunkParamsSchema = catalogNamedResourceParamsSchema.extend({
  chunkId: id,
});
export const vectorDocumentParamsSchema = catalogNamedResourceParamsSchema.extend({
  documentId: id,
});
export const vectorFolderParamsSchema = catalogNamedResourceParamsSchema.extend({
  folderId: uuid,
});
export const demoAgentParamsSchema = z.object({ id });
export const runtimeBridgeCoordinatorParamsSchema = z.object({
  coordinatorInstanceId: id,
});
export const runtimeBridgeAgentParamsSchema = runtimeBridgeCoordinatorParamsSchema
  .extend({ agentId: id });
export const runtimeBridgeVectorDatabaseParamsSchema = runtimeBridgeCoordinatorParamsSchema
  .extend({ databaseId: id });
export const memoryParamsSchema = projectParamsSchema.extend({ memoryId: uuid });
export const memoryBindingParamsSchema = memoryParamsSchema.extend({ bindingId: uuid });
export const memoryItemParamsSchema = memoryParamsSchema.extend({ itemId: id });
export const memoryConversationParamsSchema = memoryParamsSchema.extend({ conversationId: id });
export const memoryOutboxParamsSchema = memoryParamsSchema.extend({ outboxId: uuid });
export const memoryExportParamsSchema = memoryParamsSchema.extend({ token: z.string().min(1) });
export const demoAgentMessageInputSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  method: z.literal("SendMessage"),
  params: z.object({
    message: z.object({
      messageId: z.string().min(1),
      role: z.literal("ROLE_USER"),
      parts: z.array(z.object({
        text: z.string().trim().min(1).max(4_000),
      }).passthrough()).min(1).max(16),
    }).passthrough(),
  }).passthrough(),
}).passthrough().meta({ id: "DemoAgentMessageInput" });

export const problemDetailsSchema = z.object({
  type: z.string().default("about:blank"),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  instance: z.string().optional(),
  code: z.string(),
  errors: z.array(z.object({
    path: z.string(),
    message: z.string(),
    code: z.string(),
  })).optional(),
  authorization: z.object({
    capability: z.string().optional(),
    decision: z.enum(["DENY", "APPROVAL_REQUIRED"]),
    policyId: z.string().optional(),
    reason: z.string().optional(),
  }).optional(),
}).meta({ id: "ProblemDetails" });

export const messageSchema = z.object({ message: z.string() });
export const updatedCountSchema = z.object({ updatedCount: z.number().int().nonnegative() });

export const authConfigSchema = z.object({
  authRequired: z.literal(true),
  developmentDefaults: z.boolean(),
  localEnabled: z.boolean(),
  mode: z.enum(["local", "local-sso"]),
  providerName: z.string(),
  ssoEnabled: z.boolean(),
}).meta({ id: "AuthConfig" });

export const authUserSchema = z.object({
  displayName: z.string(),
  email: z.email(),
  hasPassword: z.boolean(),
  id,
  systemRole: z.enum(["user", "platform_administrator"]),
  username: z.string(),
}).meta({ id: "AuthUser" });

export const currentUserSchema = z.object({
  identity: z.object({
    type: z.literal("authenticated"),
    userId: id,
    username: z.string(),
  }),
  user: authUserSchema,
}).meta({ id: "CurrentUser" });

export const accessContextInputSchema = z.discriminatedUnion("level", [
  z.object({
    level: z.literal("platform"),
    resourceId: z.null(),
    roleId: z.literal("ROLE_PLATFORM_ADMIN"),
  }),
  z.object({
    level: z.literal("department"),
    resourceId: id,
    roleId: z.literal("ROLE_DEPARTMENT_ADMIN"),
  }),
  z.object({
    level: z.literal("project"),
    resourceId: id,
    roleId: z.enum(builtinProjectRoleIds),
  }),
]).meta({ id: "SelectAccessContextInput" });

export const accessContextOptionSchema = accessContextInputSchema.and(z.object({
  description: z.string(),
  id,
  resourceName: z.string(),
  roleLabel: z.string(),
  target: z.string().startsWith("/"),
})).meta({ id: "AccessContextOption" });

export const accessContextStateSchema = z.object({
  active: accessContextOptionSchema.nullable(),
  options: z.array(accessContextOptionSchema),
}).meta({ id: "AccessContextState" });

export const profileInputSchema = z.object({
  language: z.enum(["en-US", "zh-CN", "zh-TW"]),
  theme: z.enum(["system", "light", "dark"]),
  timezone: z.string().trim().min(1).max(120).refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Invalid timezone."),
}).meta({ id: "UpdateProfileInput" });

export const profileSchema = profileInputSchema.extend({
  displayName: z.string(),
  email: z.email(),
  hasPassword: z.boolean(),
  systemRole: z.enum(["user", "platform_administrator"]),
  username: z.string(),
}).meta({ id: "Profile" });

export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12, "New password must contain at least 12 characters.").max(128),
}).refine(
  (input) => input.currentPassword !== input.newPassword,
  "New password must be different from the current password.",
).meta({ id: "ChangePasswordInput" });

export const projectInvitationInputSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
  role: z.enum(assignableProjectMembershipRoles),
}).meta({ id: "ProjectInvitationInput" });

export const createProjectInputSchema = z.object({
  departmentId: id.max(80),
  id: projectIdSchema.optional(),
  name: projectNameSchema,
  invitations: z.array(projectInvitationInputSchema).max(25),
}).superRefine(({ invitations }, context) => {
  const seen = new Set<string>();
  invitations.forEach(({ email }, index) => {
    const canonicalEmail = email.trim().toLowerCase();
    if (seen.has(canonicalEmail)) {
      context.addIssue({
        code: "custom",
        message: "Each invited email address must be unique.",
        path: ["invitations", index, "email"],
      });
    }
    seen.add(canonicalEmail);
  });
}).meta({ id: "CreateProjectInput" });

export const updateProjectInputSchema = z.object({
  name: projectNameSchema,
}).meta({ id: "UpdateProjectInput" });

export const projectRoleInputSchema = z.object({
  role: z.enum(assignableProjectMembershipRoles),
}).meta({ id: "SwitchProjectRoleInput" });

export const projectSummarySchema = z.looseObject({
  department: z.object({
    id,
    name: z.string(),
    role: z.enum(["administrator", "member"]).nullable(),
  }),
  id,
  name: z.string(),
  avatar: z.string().optional(),
  memberCount: z.number().int().nonnegative(),
  assignedRoles: z.array(z.enum(projectMembershipRoles)),
  activeRole: z.enum(projectMembershipRoles),
  effectiveCapabilities: z.array(z.enum(projectCapabilities)),
}).meta({ id: "ProjectSummary" });

export const projectMemberSchema = z.looseObject({
  id,
  kind: z.literal("human"),
  name: z.string(),
  email: z.email(),
  roles: z.array(z.enum(projectMembershipRoles)),
  activeRole: z.enum(projectMembershipRoles).optional(),
  status: z.enum(["active", "invited"]),
}).meta({ id: "ProjectMember" });

export const projectDeletionScheduleSchema = z.object({
  delayMinutes: z.number().int().nonnegative(),
  projectId: id,
  requestedAt: timestamp,
  scheduledFor: timestamp,
  status: z.literal("scheduled"),
}).meta({ id: "ProjectDeletionSchedule" });

export const projectDeletionImpactSchema = z.object({
  activeResources: z.array(z.object({
    id,
    kind: z.enum([
      "instance", "provider", "model", "gateway", "routing", "mcp-server", "vector-database", "memory",
    ]),
    kindLabel: z.string(),
    name: z.string(),
    status: z.string(),
  })),
  auditLogsRetained: z.literal(true),
  delayMinutes: z.number().int().nonnegative(),
  projectId: id,
  projectName: z.string(),
  resourceCounts: z.array(z.object({
    count: z.number().int().nonnegative(),
    kind: z.string(),
    label: z.string(),
  })),
  totalResourceCount: z.number().int().nonnegative(),
}).meta({ id: "ProjectDeletionImpact" });

export const updateDepartmentInputSchema = z.object({
  description: z.string().trim().max(500).nullable(),
  hardBudgetUsd: money.max(1_000_000_000).nullable(),
  name: departmentNameSchema,
}).meta({ id: "UpdateDepartmentInput" });

export const departmentSummarySchema = z.object({
  id,
  name: z.string(),
  description: z.string().optional(),
  hardBudgetUsd: money.nullable(),
  allocatedBudgetUsd: money,
  memberCount: z.number().int().nonnegative(),
  projectCount: z.number().int().nonnegative(),
  role: z.literal("administrator"),
  status: z.enum(["active", "suspended"]),
}).meta({ id: "DepartmentSummary" });

export const departmentDetailSchema = departmentSummarySchema.extend({
  createdAt: timestamp,
  members: z.array(z.object({
    id,
    displayName: z.string(),
    email: z.email(),
    role: z.enum(["administrator", "member"]),
    status: z.enum(["active", "suspended"]),
  })),
  projects: z.array(z.object({
    id,
    name: z.string(),
    hardBudgetUsd: money.nullable(),
    memberCount: z.number().int().nonnegative(),
  })),
}).meta({ id: "DepartmentDetail" });

export const notificationInputSchema = z.object({ read: z.boolean() })
  .meta({ id: "UpdateNotificationInput" });
export const notificationSchema = z.object({
  actionHref: z.string().nullable(),
  createdAt: timestamp,
  id: uuid,
  message: z.string(),
  readAt: nullableTimestamp,
  severity: z.enum(["info", "success", "warning", "error"]),
  title: z.string(),
}).meta({ id: "Notification" });
export const notificationInboxSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
}).meta({ id: "NotificationInbox" });

export const queryValueSchema = z.union([z.string(), z.array(z.string())]).optional();
export const auditQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  actorId: z.string().trim().max(200).optional(),
  action: z.string().trim().max(200).optional(),
  objectType: z.string().trim().max(200).optional(),
  outcome: z.enum(["success", "failed", "denied"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  include_sensitive: z.enum(["true", "false"]).optional(),
}).meta({ id: "AuditLogQuery" });

export const projectOverviewQuerySchema = z.object({
  range: z.enum(projectOverviewRanges).default("7d"),
  timezone: z.string().min(1).max(80).default("UTC"),
}).meta({ id: "ProjectOverviewQuery" });

const costGroupBySchema = z.enum(["instance", "model_endpoint", "provider_account", "virtual_key"]);
const costFilterKeySchema = z.enum([
  "instance", "model_endpoint", "provider", "provider_account", "virtual_key", "project",
]);
const costFiltersSchema = z.partialRecord(
  costFilterKeySchema,
  z.array(z.string().min(1)).max(100),
);
export const costCommonQuerySchema = z.object({
  start_time: z.string(),
  end_time: z.string(),
  timezone: z.string().default("UTC"),
  project_id: z.string().optional(),
  filters: z.string().default("{}").transform((value, context) => {
    try {
      return costFiltersSchema.parse(JSON.parse(value));
    } catch {
      context.addIssue({
        code: "custom",
        message: "filters must be a valid JSON object of string arrays.",
      });
      return z.NEVER;
    }
  }),
}).meta({ id: "CostQuery" });
export const costQuerySchemas = {
  summary: costCommonQuerySchema,
  activity: costCommonQuerySchema.extend({
    granularity: z.enum(["daily", "weekly", "cumulative"]).default("daily"),
  }),
  insights: costCommonQuerySchema,
  ranking: costCommonQuerySchema.extend({
    group_by: costGroupBySchema.default("instance"),
    limit: z.coerce.number().int().min(1).max(100).default(5),
  }),
  trend: costCommonQuerySchema.extend({
    group_by: costGroupBySchema.default("instance"),
    granularity: z.enum(["day", "week", "month"]).default("day"),
    top_n: z.coerce.number().int().min(1).max(20).default(5),
  }),
  breakdown: costCommonQuerySchema.extend({
    group_by: costGroupBySchema.default("instance"),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(200).default(25),
    sort: z.enum([
      "name", "spend_usd", "prompt_tokens", "completion_tokens", "total_tokens",
      "requests", "average_cost_per_request", "share", "last_active",
    ]).default("spend_usd"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    search: z.string().max(200).default(""),
  }),
  "data-quality": costCommonQuerySchema,
} as const;

export const traceListSchema = z.object({
  data: z.array(z.looseObject({ traceId: z.string() })),
  source: z.literal("fixture"),
}).meta({ id: "TraceList" });
export const traceSchema = z.looseObject({ traceId: z.string() }).meta({ id: "Trace" });

/** Explicit envelope for evolving domain read models. Known identity fields stay typed. */
export const domainObjectSchema = z.looseObject({ id });
export const domainCollectionSchema = z.array(domainObjectSchema);
export const domainDataSchema = z.looseObject({ data: z.array(domainObjectSchema) });
export const openObjectSchema = z.looseObject({});
