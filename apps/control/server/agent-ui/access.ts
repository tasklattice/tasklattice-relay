import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Instance } from "@tali/contracts";
import { requireAuth, type PlatformPrincipal } from "../auth/auth";
import { ProjectAdmissionService } from "../authorization/admission-control";
import { prisma } from "../db/prisma";
import { getControlConfig } from "../config/control-config";
import { encryptPlatformSecret, decryptPlatformSecret } from "../platform/platform-secret-crypto";
import { projectRoleFromBuiltinRole } from "../projects/project-access";
import { getInstanceServiceForProject } from "../services";
import { requestOrigin } from "../http/request-origin";
import { problemResponse } from "../http/responses";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";

export const sessionLifetimeMs = 5 * 60_000;
export const maximumSessionLifetimeMs = 60 * 60_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const generation = (instance: Instance) => `${instance.createdAt}:${instance.operationId ?? ""}`;
export const agentUiUrl = (projectId: string, instanceId: string) => `/${encodeURIComponent(projectId)}/${encodeURIComponent(instanceId)}/ui/`;
async function requireAgentPrincipal(request: Request) {
  try { return await requireAuth(request); }
  catch { throw new Response("Login to Relay is required.", { status: 401 }); }
}
function requireSameOrigin(request: Request): void {
  // Same decision as the Control guard: the browser-provided Origin must be one
  // of the configured public URLs. Proxy header disagreement is not a denial.
  const origin = request.headers.get("origin");
  let allowedOrigin: string | null = null;
  try { allowedOrigin = origin ? new URL(origin).origin : null; } catch { allowedOrigin = null; }
  let expected: string | null = null;
  try { expected = requestOrigin(request); } catch { expected = null; }
  if (allowedOrigin && allowedOrigin === expected) return;
  throw problemResponse(403, "Invalid request origin.", { code: "CONTROL_ORIGIN_FORBIDDEN" });
}

export async function authorizeInstance(principal: PlatformPrincipal, projectId: string, instanceId: string) {
  const service = getInstanceServiceForProject(projectId);
  const instance = await service.store.get(instanceId);
  if (!instance || instance.status !== "READY" || !["hermes", "openclaw"].includes(instance.agentPlatform)) {
    throw new Response("Agent Web UI is unavailable.", { status: 404 });
  }
  const row = await prisma().agentRecord.findUnique({ where: { projectId_id: { projectId, id: instanceId } }, select: { ownerUserId: true, deletedAt: true } });
  if (!row || row.deletedAt) throw new Response("Agent Web UI is unavailable.", { status: 404 });
  const preferredRole = principal.accessContext?.level === "project" && principal.accessContext.resourceId === projectId
    ? projectRoleFromBuiltinRole(principal.accessContext.roleId) : null;
  await new ProjectAdmissionService().authorize(
    new Request(`http://internal/api/v1/projects/${encodeURIComponent(projectId)}/instances/${encodeURIComponent(instanceId)}/interaction`),
    principal.user.id, "CAP_AGENT_INSTANCE_INTERACT",
    { resourceType: "AgentInstance", resourceId: instanceId, relation: row.ownerUserId === principal.user.id ? "OWNER" : "PROJECT_ANY" }, preferredRole,
  );
  return { service, instance };
}

export async function runnerRequest(sandboxName: string, namespace: string, path: string, init: RequestInit = {}) {
  const runtime = await loadPlatformRuntimeConfiguration();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${runtime.runner.token}`);
  headers.set("x-tali-runtime-target", namespace);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  try {
    return await fetch(`${runtime.runner.url.replace(/\/$/, "")}/v1/sandboxes/${encodeURIComponent(sandboxName)}/web-ui${path}`, {
      ...init, headers, redirect: "manual", signal: init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal,
    });
  } finally { clearTimeout(timer); }
}

export async function createAgentUiSession(request: Request, projectId: string, instanceId: string, navigation = false) {
  if (!navigation) requireSameOrigin(request);
  else if (request.method !== "GET" || request.headers.get("origin") === "null") throw new Response("Invalid navigation.", { status: 403 });
  const principal = await requireAgentPrincipal(request);
  if (!principal.sessionId) throw new Response("Login required.", { status: 401 });
  const { service, instance } = await authorizeInstance(principal, projectId, instanceId);
  const target = await service.runnerRuntimeTarget();
  if (!target) throw new Response("Project runtime is unavailable.", { status: 409 });
  const endpoint = await service.runner.getSandboxInteraction(instance.sandboxName, instance.agentPlatform, principal.user.id, target);
  if (!endpoint.url || endpoint.status !== "READY") throw new Response("Agent Web UI is unavailable.", { status: 502 });
  const upstream = new URL(endpoint.url);
  let secret: string;
  if (instance.agentPlatform === "openclaw") {
    secret = new URLSearchParams(upstream.hash.slice(1)).get("token") ?? "";
  } else {
    const exchange = await runnerRequest(instance.sandboxName, target.namespace, `/${upstream.search}`);
    await exchange.body?.cancel();
    const cookie = exchange.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]!)
      .find((cookie) => cookie.startsWith("tali_hermes_session=")) ?? "";
    if (!cookie) throw new Response("Agent authentication is unavailable.", { status: 502 });
    const page = await runnerRequest(instance.sandboxName, target.namespace, "/", { headers: { cookie, origin: upstream.origin } });
    const reader = page.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); throw new Response("Agent authentication document is too large.", { status: 502 }); }
      chunks.push(result.value);
    }
    const token = Buffer.concat(chunks).toString("utf8").match(/window\.__HERMES_SESSION_TOKEN__\s*=\s*["']([^"']+)["']/)?.[1];
    if (!page.ok || !token) throw new Response("Agent authentication is unavailable.", { status: 502 });
    secret = JSON.stringify({ cookie, token });
  }
  if (!secret) throw new Response("Agent authentication is unavailable.", { status: 502 });
  const id = randomUUID();
  const credential = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await prisma().agentUiSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const active = await prisma().agentUiSession.count({ where: { authSessionId: principal.sessionId } });
  if (active >= 16) throw new Response("Too many active Agent windows.", { status: 429 });
  await prisma().agentUiSession.create({ data: {
    id, credentialHash: hash(credential), authSessionId: principal.sessionId, actorId: principal.user.id,
    projectId, instanceId, sandboxName: instance.sandboxName, generation: generation(instance), namespace: target.namespace,
    platform: instance.agentPlatform, upstreamOrigin: upstream.origin,
    upstreamSecret: encryptPlatformSecret(secret, getControlConfig().auth.secret), expiresAt,
  } });
  return { id, credential, expiresAt: expiresAt.toISOString(), contentUrl: `/_agent-ui/${id}/${credential}/` };
}

export async function validateAgentUiSession(id: string, credential: string) {
  if (!/^[\da-f-]{36}$/.test(id) || !/^[\w-]{43}$/.test(credential)) throw new Response("Invalid Agent session.", { status: 401 });
  const record = await prisma().agentUiSession.findUnique({ where: { id }, include: { authSession: { include: { user: true, accessContext: true } } } });
  if (!record || !timingSafeEqual(Buffer.from(record.credentialHash), Buffer.from(hash(credential)))
    || record.expiresAt.getTime() <= Date.now() || record.createdAt.getTime() + maximumSessionLifetimeMs <= Date.now() || record.authSession.expiresAt.getTime() <= Date.now()
    || record.authSession.userId !== record.actorId || record.authSession.user.status !== "active") {
    throw new Response("Agent session expired.", { status: 401 });
  }
  const { user, accessContext } = record.authSession;
  const { instance, service } = await authorizeInstance({ sessionId: record.authSessionId,
    user: { id: user.id, displayName: user.displayName, email: user.email, username: user.username ?? user.email, hasPassword: false, systemRole: "user" },
    ...(accessContext ? { accessContext: { level: accessContext.level.toLowerCase() as "project", resourceId: accessContext.resourceId, roleId: accessContext.roleId as NonNullable<PlatformPrincipal["accessContext"]>["roleId"] } } : {}),
  }, record.projectId, record.instanceId);
  const target = await service.runnerRuntimeTarget();
  if (generation(instance) !== record.generation || instance.sandboxName !== record.sandboxName || instance.agentPlatform !== record.platform || target?.namespace !== record.namespace) {
    throw new Response("Agent runtime changed. Reopen the Web UI.", { status: 401 });
  }
  return record;
}

export const upstreamSecret = (record: { upstreamSecret: string }) => decryptPlatformSecret(record.upstreamSecret, getControlConfig().auth.secret);
export const hermesCredentials = (record: { upstreamSecret: string }) => JSON.parse(upstreamSecret(record)) as { cookie: string; token: string };

export async function renewAgentUiSession(request: Request, projectId: string, instanceId: string) {
  requireSameOrigin(request);
  const principal = await requireAgentPrincipal(request);
  const input = await request.json() as { id?: string; credential?: string; close?: boolean };
  const record = await validateAgentUiSession(input.id ?? "", input.credential ?? "");
  if (record.projectId !== projectId || record.instanceId !== instanceId || record.authSessionId !== principal.sessionId || record.actorId !== principal.user.id) throw new Response("Invalid Agent session.", { status: 403 });
  if (input.close) {
    await prisma().agentUiSession.delete({ where: { id: record.id } });
    return { closed: true };
  }
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await prisma().agentUiSession.update({ where: { id: record.id }, data: { expiresAt } });
  return { expiresAt: expiresAt.toISOString() };
}
