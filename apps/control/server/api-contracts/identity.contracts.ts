import { z } from "zod";
import { updateDepartmentSettingsSchema, projectNamespaceCheckSchema } from "@tali/contracts";
import { defineContracts } from "./contract";
import { projectRoute, response, route } from "./helpers";
import {
  authConfigSchema,
  accessContextInputSchema,
  accessContextStateSchema,
  changePasswordInputSchema,
  createProjectInputSchema,
  currentUserSchema,
  departmentDetailSchema,
  departmentParamsSchema,
  departmentSummarySchema,
  memberParamsSchema,
  messageSchema,
  notificationInboxSchema,
  notificationInputSchema,
  notificationParamsSchema,
  notificationSchema,
  profileInputSchema,
  profileSchema,
  projectDeletionImpactSchema,
  projectDeletionScheduleSchema,
  projectInvitationInputSchema,
  projectMemberSchema,
  projectOverviewQuerySchema,
  projectParamsSchema,
  projectRoleInputSchema,
  projectSummarySchema,
  updateDepartmentInputSchema,
  updateProjectInputSchema,
  updatedCountSchema,
  domainObjectSchema,
  openObjectSchema,
} from "./schemas";

export const identityContracts = defineContracts([
  route({
    auth: "public", method: "get", path: "/auth/config", operationId: "getAuthConfig",
    summary: "Read public authentication configuration", tags: ["Authentication"],
    responses: { 200: response("Authentication configuration", authConfigSchema) },
  }),
  route({
    method: "get", path: "/auth/me", operationId: "getCurrentUser",
    summary: "Read the current user", tags: ["Authentication"],
    responses: { 200: response("Current user", currentUserSchema) },
  }),
  route({
    method: "get", path: "/access-context", operationId: "getAccessContext",
    summary: "List and read the current session access context", tags: ["Authentication"],
    responses: { 200: response("Access context", accessContextStateSchema) },
  }),
  route({
    method: "put", path: "/access-context", operationId: "selectAccessContext",
    summary: "Select the current session access context", tags: ["Authentication"],
    request: { body: accessContextInputSchema },
    responses: { 200: response("Selected access context", accessContextStateSchema) },
  }),
  route({
    method: "get", path: "/profile", operationId: "getProfile",
    summary: "Read the current user's profile", tags: ["Profile"],
    responses: { 200: response("Personal profile", profileSchema) },
  }),
  route({
    method: "patch", path: "/profile", operationId: "updateProfile",
    summary: "Update the current user's profile", tags: ["Profile"],
    request: { body: profileInputSchema },
    responses: { 200: response("Updated personal profile", profileSchema) },
  }),
  route({
    method: "post", path: "/profile/password", operationId: "changePassword",
    summary: "Change the current user's password", tags: ["Profile"],
    request: { body: changePasswordInputSchema },
    responses: { 204: response("Password changed") },
  }),
  route({
    method: "get", path: "/notifications", operationId: "listNotifications",
    summary: "List the current user's notifications", tags: ["Notifications"],
    responses: { 200: response("Notification inbox", notificationInboxSchema) },
  }),
  route({
    method: "patch", path: "/notifications/{notificationId}", operationId: "updateNotification",
    summary: "Update a notification", tags: ["Notifications"],
    request: { params: notificationParamsSchema, body: notificationInputSchema },
    responses: { 200: response("Updated notification", notificationSchema) },
  }),
  route({
    method: "post", path: "/notifications/read-all", operationId: "markAllNotificationsRead",
    summary: "Mark all notifications as read", tags: ["Notifications"],
    responses: { 200: response("Update count", updatedCountSchema) },
  }),
  route({
    method: "get", path: "/departments", operationId: "listDepartments",
    summary: "List Departments administered by the current user", tags: ["Departments"],
    responses: { 200: response("Department list", z.array(departmentSummarySchema)) },
  }),
  route({
    method: "get", path: "/departments/{departmentId}", operationId: "getDepartment",
    summary: "Read a Department", tags: ["Departments"], request: { params: departmentParamsSchema },
    responses: { 200: response("Department details", departmentDetailSchema) },
  }),
  route({
    method: "patch", path: "/departments/{departmentId}", operationId: "updateDepartment",
    summary: "Update a Department", tags: ["Departments"],
    request: { params: departmentParamsSchema, body: updateDepartmentInputSchema },
    responses: { 200: response("Updated Department", departmentDetailSchema) },
  }),
  route({
    method: "get", path: "/departments/{departmentId}/settings", operationId: "getDepartmentSettings",
    summary: "Read Department defaults and quota", tags: ["Departments"],
    request: { params: departmentParamsSchema },
    responses: { 200: response("Department settings", openObjectSchema) },
  }),
  route({
    method: "put", path: "/departments/{departmentId}/settings", operationId: "updateDepartmentSettings",
    summary: "Update Department defaults and quota", tags: ["Departments"],
    request: { params: departmentParamsSchema, body: updateDepartmentSettingsSchema },
    responses: { 200: response("Updated Department settings", openObjectSchema) },
  }),
  route({
    method: "get", path: "/projects", operationId: "listProjects",
    summary: "List Projects available to the current user", tags: ["Projects"],
    responses: { 200: response("Project list", z.array(projectSummarySchema)) },
  }),
  route({
    method: "post", path: "/projects", operationId: "createProject",
    summary: "Create a Project and queue background initialization", tags: ["Projects"], request: { body: createProjectInputSchema },
    responses: { 201: response("Created Project", projectSummarySchema) },
  }),
  projectRoute({
    method: "patch", path: "", operationId: "updateProject", summary: "Update a Project",
    tags: ["Projects"], request: { params: projectParamsSchema, body: updateProjectInputSchema },
    responses: { 200: response("Updated Project", projectSummarySchema) },
  }),
  projectRoute({
    method: "delete", path: "", operationId: "deleteProject", summary: "Schedule Project deletion",
    tags: ["Projects"], responses: { 202: response("Deletion scheduled", projectDeletionScheduleSchema) },
  }),
  projectRoute({
    method: "get", path: "/resource-operations/{id}", operationId: "getResourceOperation",
    summary: "Read background resource operation", tags: ["Projects"],
    request: { params: projectParamsSchema.extend({ id: z.string().uuid() }) },
    responses: { 200: response("Resource operation", z.object({ id: z.string().uuid(), action: z.string(), status: z.string(), result: z.unknown(), lastError: z.string().nullable(), createdAt: z.string(), updatedAt: z.string() })) },
  }),
  projectRoute({
    method: "get", path: "/initialization/check", operationId: "checkProjectNamespace",
    summary: "Check the live Project Namespace and ownership", tags: ["Projects"],
    responses: { 200: response("Namespace check", projectNamespaceCheckSchema) },
  }),
  projectRoute({
    method: "post", path: "/initialization/reconcile", operationId: "reinitializeProject",
    summary: "Reinitialize Project infrastructure, including previously ready Projects", tags: ["Projects"],
    responses: { 202: response("Initialization scheduled", z.object({ status: z.string(), generation: z.number(), observedGeneration: z.number(), attempts: z.number(), lastError: z.string().nullable(), updatedAt: z.string().nullable() })) },
  }),
  projectRoute({
    method: "get", path: "/initialization", operationId: "getProjectInitialization",
    summary: "Read asynchronous Project initialization", tags: ["Projects"],
    responses: { 200: response("Initialization status", z.object({ status: z.string(), generation: z.number(), observedGeneration: z.number(), attempts: z.number(), lastError: z.string().nullable(), updatedAt: z.string().nullable() })) },
  }),
  projectRoute({
    method: "post", path: "/initialization/retry", operationId: "retryProjectInitialization",
    summary: "Retry failed Project initialization", tags: ["Projects"],
    responses: { 202: response("Initialization scheduled", z.object({ status: z.string(), generation: z.number(), observedGeneration: z.number(), attempts: z.number(), lastError: z.string().nullable(), updatedAt: z.string().nullable() })) },
  }),
  projectRoute({
    method: "get", path: "/deletion-impact", operationId: "getProjectDeletionImpact",
    summary: "Preview Project deletion impact", tags: ["Projects"],
    responses: { 200: response("Deletion impact", projectDeletionImpactSchema) },
  }),
  projectRoute({
    method: "get", path: "/members", operationId: "listProjectMembers",
    summary: "List Project members", tags: ["Project members"],
    responses: { 200: response("Project member list", z.array(projectMemberSchema)) },
  }),
  projectRoute({
    method: "post", path: "/members/invitations", operationId: "inviteProjectMember",
    summary: "Invite a Project member", tags: ["Project members"],
    request: { body: projectInvitationInputSchema },
    responses: { 201: response("Created invitation", domainObjectSchema) },
  }),
  projectRoute({
    method: "delete", path: "/members/{memberId}", operationId: "removeProjectMember",
    summary: "Remove a Project member", tags: ["Project members"],
    request: { params: memberParamsSchema }, responses: { 200: response("Member removed", messageSchema) },
  }),
  projectRoute({
    method: "put", path: "/role", operationId: "switchProjectRole", summary: "Switch active Project role",
    tags: ["Project members"], request: { body: projectRoleInputSchema },
    responses: { 200: response("Updated role selection", domainObjectSchema) },
  }),
  projectRoute({
    method: "get", path: "/authorization/capabilities", operationId: "listProjectCapabilities",
    summary: "List Project capabilities", tags: ["Authorization"],
    responses: { 200: response("Capability catalog", z.object({ data: z.array(domainObjectSchema) })) },
  }),
  projectRoute({
    method: "get", path: "/authorization/roles", operationId: "listProjectRoles",
    summary: "List built-in Project roles", tags: ["Authorization"],
    responses: { 200: response("Role catalog", z.object({ data: z.array(domainObjectSchema) })) },
  }),
  projectRoute({
    method: "get", path: "/overview", operationId: "getProjectOverview", summary: "Read Project overview",
    tags: ["Projects"], request: { query: projectOverviewQuerySchema },
    responses: { 200: response("Project overview", domainObjectSchema) },
  }),
]);
