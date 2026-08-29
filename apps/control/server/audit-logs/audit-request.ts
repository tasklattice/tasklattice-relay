import type { PlatformAuditLogEvent } from "@tali/contracts";
import type { PlatformPrincipal } from "../auth/auth";
import { requireAuth } from "../auth/auth";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { sanitizeRuntimeMemoryText } from "../runtime-bridge/memory-runtime-sanitizer";
import { AuditLogService } from "./audit-log-service";
import {
  decisiveAdmissionEvidence,
  type AdmissionEvidence,
} from "../authorization/authorization-context";

const maxBodyBytes = 64 * 1024;
const sensitiveKey =
  /(?:authorization|cookie|password|passphrase|secret|token|credential|api[-_]?key|master[-_]?key|private[-_]?key|client[-_]?secret|code[-_]?verifier)/i;
const operationSegments = new Set([
  "discover",
  "exports",
  "inherit",
  "invalidate",
  "provision",
  "refresh",
  "redact",
  "reextract",
  "replay",
  "restore",
  "rotate-model-credential",
  "suspend",
  "switch",
  "sync",
  "validate",
  "verify",
]);

interface AuditDescriptor {
  action: string;
  objectId?: string;
  objectType: string;
  operation: string;
  projectId?: string;
}

export interface CapturedAuditRequest {
  admission?: readonly AdmissionEvidence[];
  auth?: PlatformPrincipal;
  body?: unknown;
  descriptor: AuditDescriptor;
  ipAddress: string;
  method: string;
  parameters?: Record<string, unknown>;
  path: string;
  requestId: string;
  startedAt: number;
  trace?: PlatformAuditLogEvent["trace"];
  userAgent: string;
}

const resources: Array<{
  segment: string;
  prefix: string;
  type: string;
}> = [
  { segment: "terminal-sessions", prefix: "terminal_session", type: "Terminal Session" },
  { segment: "access-policies", prefix: "access_policy", type: "Access Policy" },
  { segment: "model-routings", prefix: "model_routing", type: "Routing" },
  { segment: "mcp-servers", prefix: "mcp_server", type: "MCP Server" },
  { segment: "vector-databases", prefix: "vector_database", type: "Vector Database" },
  { segment: "invitations", prefix: "project_member", type: "Project Member" },
  { segment: "providers", prefix: "provider", type: "Provider" },
  { segment: "instances", prefix: "instance", type: "Instance" },
  { segment: "memories", prefix: "memory", type: "Memory" },
  { segment: "policies", prefix: "runtime_policy", type: "Runtime Policy" },
  { segment: "members", prefix: "project_member", type: "Project Member" },
  { segment: "models", prefix: "model", type: "Model" },
  { segment: "skills", prefix: "skill", type: "Skill" },
  { segment: "agents", prefix: "agent_garden_agent", type: "Agent Garden Agent" },
  { segment: "quota", prefix: "project_quota", type: "Project Quota" },
];

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeRuntimeMemoryText(value, 4096);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  }
  if (typeof value !== "object") return String(value);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : sanitize(item, depth + 1),
    ]),
  );
}

async function captureBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/application\/(?:[^;]+\+)?json/i.test(contentType)) {
    return contentType
      ? { contentType, retained: false }
      : undefined;
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBodyBytes) {
    return { byteLength: contentLength, retained: false, reason: "body_too_large" };
  }
  try {
    const text = await request.clone().text();
    if (!text) return undefined;
    if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
      return {
        byteLength: Buffer.byteLength(text, "utf8"),
        retained: false,
        reason: "body_too_large",
      };
    }
    return sanitize(JSON.parse(text));
  } catch {
    return { retained: false, reason: "unparseable_json" };
  }
}

function descriptor(method: string, path: string): AuditDescriptor | undefined {
  if (method === "PUT" && path === "/api/v1/access-context") {
    return {
      action: "user.access_context_select",
      objectType: "Access Context",
      operation: "switch",
    };
  }
  if (method === "GET" && path === "/api/v1/projects") {
    return {
      action: "user.project_context_sync",
      objectType: "Project Membership",
      operation: "sync",
    };
  }
  if (method === "POST" && path === "/api/v1/projects") {
    return { action: "project.create", objectType: "Project", operation: "create" };
  }
  if (method === "POST" && path === "/api/v1/platform/projects") {
    return {
      action: "platform.project_create",
      objectType: "Project",
      operation: "create",
    };
  }
  if (method === "POST" && path === "/api/v1/platform/departments") {
    return {
      action: "platform.department_create",
      objectType: "Department",
      operation: "create",
    };
  }
  if (method === "PUT" && path === "/api/v1/platform/settings") {
    return {
      action: "platform.settings_update",
      objectId: "platform",
      objectType: "Platform Settings",
      operation: "update",
    };
  }
  if (method === "PUT" && path === "/api/v1/platform/infrastructure") {
    return {
      action: "platform.infrastructure_update",
      objectId: "platform",
      objectType: "Platform Infrastructure",
      operation: "update",
    };
  }
  if (
    method === "POST"
    && path === "/api/v1/platform/infrastructure/validate"
  ) {
    return {
      action: "platform.infrastructure_validate",
      objectId: "platform",
      objectType: "Platform Infrastructure",
      operation: "validate",
    };
  }
  if (method === "PUT" && path === "/api/v1/platform/security") {
    return {
      action: "platform.security_update",
      objectId: "platform",
      objectType: "Platform Security",
      operation: "update",
    };
  }
  if (
    method === "PUT"
    && path === "/api/v1/platform/security/role-bindings"
  ) {
    return {
      action: "platform.security_role_bindings_update",
      objectId: "platform",
      objectType: "Platform Security Role Bindings",
      operation: "update",
    };
  }
  if (method === "PUT" && path === "/api/v1/platform/email") {
    return {
      action: "platform.email_update",
      objectId: "platform",
      objectType: "Platform Email",
      operation: "update",
    };
  }
  if (method === "POST" && path === "/api/v1/platform/security/validate") {
    return {
      action: "platform.security_validate",
      objectId: "platform",
      objectType: "Platform Security",
      operation: "validate",
    };
  }
  if (method === "POST" && path === "/api/v1/platform/email/validate") {
    return {
      action: "platform.email_validate",
      objectId: "platform",
      objectType: "Platform Email",
      operation: "validate",
    };
  }
  const departmentMatch = path.match(/^\/api\/v1\/departments\/([^/]+)$/);
  if (departmentMatch && method === "PATCH") {
    return {
      action: "department.update",
      objectId: decodeURIComponent(departmentMatch[1]!),
      objectType: "Department",
      operation: "update",
    };
  }
  const departmentSettingsMatch = path.match(
    /^\/api\/v1\/departments\/([^/]+)\/settings$/,
  );
  if (departmentSettingsMatch && method === "PUT") {
    return {
      action: "department.settings_update",
      objectId: decodeURIComponent(departmentSettingsMatch[1]!),
      objectType: "Department Settings",
      operation: "update",
    };
  }
  const departmentAssignmentMatch = path.match(
    /^\/api\/v1\/departments\/([^/]+)\/(models|model-routings)\/([^/]+)\/assignments(?:\/([^/]+))?$/,
  );
  if (
    departmentAssignmentMatch
    && (method === "POST" || method === "DELETE")
  ) {
    const routing = departmentAssignmentMatch[2] === "model-routings";
    const operation = method === "POST" ? "assign" : "unassign";
    return {
      action: `department_${routing ? "model_routing" : "model"}.${operation}`,
      objectId: decodeURIComponent(departmentAssignmentMatch[3]!),
      objectType: routing ? "Department Routing" : "Department Model",
      operation,
    };
  }
  const departmentResourceMatch = path.match(
    /^\/api\/v1\/departments\/([^/]+)\/(.*)$/,
  );
  if (departmentResourceMatch) {
    const tail = departmentResourceMatch[2]!
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    const unsafe = method === "POST" || method === "PUT"
      || method === "PATCH" || method === "DELETE";
    const resource = resources.find((candidate) => tail.includes(candidate.segment));
    if (unsafe && resource) {
      const resourceIndex = tail.lastIndexOf(resource.segment);
      const possibleId = tail[resourceIndex + 1];
      const customOperation = tail.find((segment) => operationSegments.has(segment));
      const operation = method === "DELETE"
        ? customOperation ?? "delete"
        : customOperation
          ? customOperation.replaceAll("-", "_")
          : method === "POST"
            ? "create"
            : "update";
      return {
        action: `department_${resource.prefix}.${operation}`,
        ...(
          possibleId
          && !operationSegments.has(possibleId)
          && possibleId !== "discover"
            ? { objectId: possibleId }
            : {}
        ),
        objectType: `Department ${resource.type}`,
        operation,
      };
    }
  }
  if (path === "/api/auth/sign-in/username" && method === "POST") {
    return { action: "auth.login", objectType: "Session", operation: "login" };
  }
  if (path === "/api/auth/sign-out" && method === "POST") {
    return { action: "auth.logout", objectType: "Session", operation: "logout" };
  }
  if (path === "/api/auth/callback/corporate-sso" && method === "GET") {
    return { action: "auth.sso_callback", objectType: "Session", operation: "login" };
  }
  if (path === "/api/v1/profile" && method === "PATCH") {
    return { action: "profile.update", objectType: "User Profile", operation: "update" };
  }
  if (path === "/api/v1/profile/password" && method === "POST") {
    return { action: "credential.rotate", objectType: "Credential", operation: "rotate" };
  }
  if (path === "/api/v1/notifications/read-all" && method === "POST") {
    return {
      action: "notification.read_all",
      objectType: "Notification",
      operation: "update",
    };
  }
  const notificationMatch = path.match(/^\/api\/v1\/notifications\/([^/]+)$/);
  if (notificationMatch && method === "PATCH") {
    return {
      action: "notification.update",
      objectId: decodeURIComponent(notificationMatch[1]!),
      objectType: "Notification",
      operation: "update",
    };
  }
  if (/^\/api\/v1\/demo-agents\/[^/]+$/.test(path) && method === "POST") {
    return {
      action: "demo_agent.execute",
      objectId: decodeURIComponent(path.split("/").at(-1) ?? ""),
      objectType: "Demo Agent",
      operation: "execute",
    };
  }
  const runtimeBridgeDispatch = path.match(
    /^\/api\/v1\/runtime-bridge\/coordinators\/([^/]+)\/agents\/([^/]+)$/,
  );
  if (runtimeBridgeDispatch && method === "POST") {
    return {
      action: "agent_delegation.execute",
      objectId: decodeURIComponent(runtimeBridgeDispatch[2]!),
      objectType: "A2A Agent",
      operation: "execute",
    };
  }
  const runtimeBridgeVectorSearch = path.match(
    /^\/api\/v1\/runtime-bridge\/coordinators\/[^/]+\/vector-databases\/([^/]+)\/search$/,
  );
  if (runtimeBridgeVectorSearch && method === "POST") {
    return {
      action: "vector_database.search",
      objectId: decodeURIComponent(runtimeBridgeVectorSearch[1]!),
      objectType: "Vector Database",
      operation: "search",
    };
  }
  const runtimeBridgeMemory = path.match(
    /^\/api\/v1\/runtime-bridge\/coordinators\/([^/]+)\/memory\/(recall|retain)$/,
  );
  if (runtimeBridgeMemory && method === "POST") {
    const operation = runtimeBridgeMemory[2]!;
    return {
      action: `memory.${operation}`,
      objectId: decodeURIComponent(runtimeBridgeMemory[1]!),
      objectType: "Durable Memory",
      operation,
    };
  }

  const projectMatch = path.match(/^\/api\/v1\/projects\/([^/]+)(?:\/(.*))?$/);
  if (!projectMatch) return undefined;
  const projectId = decodeURIComponent(projectMatch[1]!);
  const tail = (projectMatch[2] ?? "").split("/").filter(Boolean).map(decodeURIComponent);
  if (!tail.length) {
    const operation = method === "DELETE" ? "delete" : "update";
    return {
      action: `project.${operation}`,
      ...(projectId ? { objectId: projectId } : {}),
      objectType: "Project",
      operation,
      projectId,
    };
  }

  const unsafe = method === "POST" || method === "PUT"
    || method === "PATCH" || method === "DELETE";
  if (!unsafe) return undefined;

  if (
    tail[0] === "instances"
    && tail[2] === "access-policies"
  ) {
    return {
      action: "instance.access_policies_update",
      ...(tail[1] ? { objectId: tail[1] } : {}),
      objectType: "Instance",
      operation: "update",
      projectId,
    };
  }

  if (tail[0] === "role" && method === "PUT") {
    return {
      action: "project_role.switch",
      objectId: projectId,
      objectType: "Project Role",
      operation: "switch",
      projectId,
    };
  }

  if (
    tail[0] === "catalog"
    && tail[1] === "vector-databases"
    && tail[3] === "chunks"
  ) {
    if (tail.length === 4 && method === "PUT") {
      return {
        action: "vector_chunk.batch_upsert",
        ...(tail[2] ? { objectId: tail[2] } : {}),
        objectType: "Vector Chunk",
        operation: "update",
        projectId,
      };
    }
    if (tail.length === 5 && method === "DELETE") {
      return {
        action: "vector_chunk.delete",
        ...(tail[4] ? { objectId: tail[4] } : {}),
        objectType: "Vector Chunk",
        operation: "delete",
        projectId,
      };
    }
  }

  const resource = resources.find((candidate) => tail.includes(candidate.segment));
  if (!resource) {
    return {
      action: `project.${method.toLowerCase()}`,
      objectId: projectId,
      objectType: "Project",
      operation: method.toLowerCase(),
      projectId,
    };
  }
  const resourceIndex = tail.lastIndexOf(resource.segment);
  const possibleId = tail[resourceIndex + 1];
  const customOperation = tail.find((segment) => operationSegments.has(segment));
  const operation = method === "DELETE"
    ? "delete"
    : customOperation
      ? customOperation.replaceAll("-", "_")
      : resource.segment === "invitations"
        ? "invite"
        : method === "POST"
          ? "create"
          : "update";

  return {
    action: `${resource.prefix}.${operation}`,
    ...(
      possibleId
      && !operationSegments.has(possibleId)
      && possibleId !== "discover"
        ? { objectId: possibleId }
        : {}
    ),
    objectType: resource.type,
    operation,
    projectId,
  };
}

function sensitiveReadDescriptor(url: URL): AuditDescriptor | undefined {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const match = pathname.match(
    /^\/api\/v1\/projects\/([^/]+)\/(?:instances\/([^/]+)\/(audit|interaction|logs)|audit-logs)$/,
  );
  if (!match) return undefined;
  const projectId = decodeURIComponent(match[1]!);
  const instanceId = match[2] ? decodeURIComponent(match[2]) : undefined;
  if (instanceId) {
    const interaction = match[3] === "interaction";
    const logs = match[3] === "logs";
    return {
      action: interaction
        ? "instance.interact"
        : logs
          ? "instance.logs_view"
          : "instance.audit_view",
      objectId: instanceId,
      objectType: interaction
        ? "Agent Instance"
        : logs
          ? "Runtime Log"
          : "Instance Audit",
      operation: "view",
      projectId,
    };
  }
  if (url.searchParams.get("include_sensitive") !== "true") return undefined;
  return {
    action: "audit_log.sensitive_content_view",
    objectType: "Audit Log",
    operation: "view",
    projectId,
  };
}

function traceContext(request: Request): PlatformAuditLogEvent["trace"] | undefined {
  const traceparent = request.headers.get("traceparent");
  const match = traceparent?.match(
    /^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/i,
  );
  return match ? { traceId: match[1]!.toLowerCase(), spanId: match[2]!.toLowerCase() } : undefined;
}

export async function captureAuditRequest(
  request: Request,
): Promise<CapturedAuditRequest | undefined> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const requestDescriptor = descriptor(method, url.pathname)
    ?? (method === "GET" ? sensitiveReadDescriptor(url) : undefined);
  if (!requestDescriptor) return undefined;
  let auth: PlatformPrincipal | undefined;
  try {
    auth = await requireAuth(request);
  } catch {
    auth = undefined;
  }
  const parameters = Object.fromEntries(url.searchParams.entries());
  if (requestDescriptor.projectId) parameters.projectId = requestDescriptor.projectId;
  return {
    ...(auth ? { auth } : {}),
    ...(request.body ? { body: await captureBody(request) } : {}),
    descriptor: requestDescriptor,
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown",
    method,
    ...(Object.keys(parameters).length
      ? { parameters: sanitize(parameters) as Record<string, unknown> }
      : {}),
    path: url.pathname,
    requestId: request.headers.get("x-request-id")?.slice(0, 200) || crypto.randomUUID(),
    startedAt: Date.now(),
    ...(traceContext(request) ? { trace: traceContext(request) } : {}),
    userAgent: (request.headers.get("user-agent") || "unknown").slice(0, 1000),
  };
}

/**
 * Creates a lightweight audit envelope for a read request only when admission
 * denied it. Successful high-volume reads remain outside the mutation audit
 * stream, while every denied CAP check is still durable and searchable.
 */
export async function captureDeniedAdmissionRequest(
  request: Request,
  evidence: AdmissionEvidence,
): Promise<CapturedAuditRequest> {
  const url = new URL(request.url);
  let auth: PlatformPrincipal | undefined;
  try {
    auth = await requireAuth(request);
  } catch {
    auth = undefined;
  }
  const parameters = Object.fromEntries(url.searchParams.entries());
  parameters.projectId = evidence.projectId;
  return {
    admission: [evidence],
    ...(auth ? { auth } : {}),
    descriptor: {
      action: "authorization.denied",
      ...(evidence.resourceId ? { objectId: evidence.resourceId } : {}),
      objectType: evidence.resourceType,
      operation: "authorize",
      projectId: evidence.projectId,
    },
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown",
    method: request.method.toUpperCase(),
    parameters: sanitize(parameters) as Record<string, unknown>,
    path: url.pathname,
    requestId: request.headers.get("x-request-id")?.slice(0, 200) || crypto.randomUUID(),
    startedAt: Date.now(),
    ...(traceContext(request) ? { trace: traceContext(request) } : {}),
    userAgent: (request.headers.get("user-agent") || "unknown").slice(0, 1000),
  };
}

async function responseJson(response: Response): Promise<Record<string, unknown> | undefined> {
  if (!response.headers.get("content-type")?.includes("application/json")) return undefined;
  try {
    const text = await response.clone().text();
    if (!text || Buffer.byteLength(text, "utf8") > maxBodyBytes) return undefined;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function resultSubject(result?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!result) return undefined;
  const nested = result.account ?? result.user;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : result;
}

async function principalFromResponseCookie(
  response: Response,
): Promise<PlatformPrincipal | undefined> {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie
    .split(/,(?=\s*[^;,]+=)/)
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
  if (!cookie) return undefined;
  try {
    return await requireAuth(
      new Request("http://tasklattice.local/audit-session", {
        headers: { cookie },
      }),
    );
  } catch {
    return undefined;
  }
}

function operationVerb(operation: string, outcome: PlatformAuditLogEvent["outcome"]): string {
  if (outcome !== "success") return "attempted";
  return ({
    bind: "bound",
    create: "created",
    delete: "deleted",
    discover: "discovered",
    execute: "executed",
    invite: "invited",
    login: "signed in",
    logout: "signed out",
    provision: "provisioned",
    refresh: "refreshed",
    rotate: "rotated",
    rotate_model_credential: "rotated",
    suspend: "suspended",
    switch: "switched",
    sync: "synchronized",
    unbind: "unbound",
    update: "updated",
    validate: "validated",
    view: "viewed",
    verify: "verified",
  } as Record<string, string>)[operation] ?? operation;
}

export async function writeAuditResponse(
  captured: CapturedAuditRequest,
  response: Response,
  database: PrismaClient = prisma(),
): Promise<void> {
  const result = await responseJson(response);
  const auth = captured.auth ?? (await principalFromResponseCookie(response));
  const subject = resultSubject(result);
  let projectId = captured.descriptor.projectId;
  if (!projectId && captured.descriptor.action === "project.create") {
    projectId = typeof subject?.id === "string" ? subject.id : undefined;
  }
  const membership = projectId && auth
    ? await database.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: auth.user.id } },
        select: { role: true },
      })
    : undefined;
  const admission = decisiveAdmissionEvidence(captured.admission ?? []);
  const outcome: PlatformAuditLogEvent["outcome"] =
    response.status === 401 || response.status === 403
      ? "denied"
      : response.status < 400
        ? "success"
        : "failed";
  const actor = auth?.user;
  const body = captured.body && typeof captured.body === "object"
    ? captured.body as Record<string, unknown>
    : undefined;
  const objectId =
    (typeof subject?.id === "string" ? subject.id : undefined)
    || (typeof subject?.email === "string" ? subject.email : undefined)
    || captured.descriptor.objectId
    || (typeof body?.id === "string" ? body.id : undefined)
    || projectId
    || "platform";
  const objectName =
    (typeof subject?.name === "string" ? subject.name : undefined)
    || (typeof subject?.displayName === "string" ? subject.displayName : undefined)
    || (typeof subject?.email === "string" ? subject.email : undefined)
    || (typeof body?.name === "string" ? body.name : undefined)
    || (typeof body?.displayName === "string" ? body.displayName : undefined)
    || (typeof body?.email === "string" ? body.email : undefined)
    || objectId;
  const verb = operationVerb(captured.descriptor.operation, outcome);
  const actorName = actor?.displayName
    || (typeof body?.username === "string" ? body.username : "Anonymous");

  await new AuditLogService(projectId ?? "platform", database).record({
    ...(projectId ? { projectId } : {}),
    actor: {
      type: "user",
      id: actor?.id || (typeof body?.username === "string" ? body.username : "anonymous"),
      name: actorName,
      ...(actor?.email ? { email: actor.email } : {}),
    },
    authorization: {
      role: admission?.roleId || membership?.role || actor?.systemRole || "none",
      decision: admission?.decision === "APPROVAL_REQUIRED"
        ? "approval_required"
        : admission?.decision === "DENY"
          ? "denied"
          : admission?.decision === "ALLOW"
            ? "allowed"
            : outcome === "denied"
              ? "denied"
              : "allowed",
      ...(admission?.capability ? { capability: admission.capability } : {}),
      ...(admission?.reason ? { reason: admission.reason } : {}),
    },
    action: captured.descriptor.action,
    verb,
    object: {
      type: captured.descriptor.objectType,
      id: objectId,
      name: objectName,
    },
    outcome,
    summary: `${actorName} ${verb} ${objectName}.`,
    request: {
      id: captured.requestId,
      method: captured.method,
      route: captured.path,
      ipAddress: captured.ipAddress,
      userAgent: captured.userAgent,
      ...(captured.parameters ? { parameters: captured.parameters } : {}),
      ...(captured.body !== undefined ? { body: captured.body } : {}),
    },
    ...(captured.trace ? { trace: captured.trace } : {}),
    metadata: {
      durationMs: Date.now() - captured.startedAt,
      httpStatus: response.status,
      retentionDays: 90,
      ...(captured.admission?.length
        ? {
            admission: captured.admission.map((item) => ({
              capability: item.capability,
              decision: item.decision,
              relation: item.relation,
              resourceType: item.resourceType,
              ...(item.resourceId ? { resourceId: item.resourceId } : {}),
              ...(item.roleId ? { roleId: item.roleId } : {}),
              ...(item.policyId ? { policyId: item.policyId } : {}),
              reason: item.reason,
            })),
          }
        : {}),
    },
  });
}

export async function purgeExpiredAuditLogs(
  database: PrismaClient = prisma(),
  now = new Date(),
): Promise<number> {
  return new AuditLogService("platform", database).purgeExpired(90, now);
}
