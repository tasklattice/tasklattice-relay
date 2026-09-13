import { prisma } from "../db/prisma";
import type { BuiltinRoleId, PlatformCapability } from "@tali/contracts";
import { RoleCatalogService } from "../authorization/role-catalog";
import { getControlConfig } from "../config/control-config";
import { jsonResponse, problemResponse } from "../http/responses";
import { PlatformSettingsService } from "../platform/platform-settings-service";
import { auth } from "./better-auth";

export type SystemRole = "user" | "platform_administrator";

export interface AuthUser {
  displayName: string;
  email: string;
  hasPassword: boolean;
  id: string;
  systemRole: SystemRole;
  username: string;
}

export interface PlatformPrincipal {
  accessContext?: {
    level: "platform" | "department" | "project";
    resourceId: string | null;
    roleId: BuiltinRoleId;
  };
  sessionId?: string;
  user: AuthUser;
}

interface AuthenticationRequestContext extends Record<string, unknown> {
  platformAuthentication?: Promise<PlatformPrincipal>;
  platformAuthenticationResponseHeaders?: Headers;
}

type ContextualRequest = Request & { context?: AuthenticationRequestContext };

function authenticationContext(request: Request): AuthenticationRequestContext {
  const contextualRequest = request as ContextualRequest;
  return (contextualRequest.context ??= {});
}

async function resolveAuth(
  request: Request,
  context: AuthenticationRequestContext,
): Promise<PlatformPrincipal> {
  const result = await (await auth()).api.getSession({
    headers: request.headers,
    returnHeaders: true,
  });
  context.platformAuthenticationResponseHeaders = result.headers;
  const session = result.response;
  if (!session) throw new Error("Authentication required.");

  const [user, accessContext] = await Promise.all([
    prisma().user.findUnique({
      where: { id: session.user.id },
      include: {
        authAccounts: {
          where: { providerId: "credential" },
          select: { id: true },
          take: 1,
        },
      },
    }),
    prisma().accessContextSession.findUnique({
      where: { sessionId: session.session.id },
    }),
  ]);
  if (!user || user.status !== "active") {
    throw new Error("The TaskLattice Relay account is disabled or unavailable.");
  }
  return {
    ...(accessContext ? {
      accessContext: {
        level: accessContext.level.toLowerCase() as
          | "platform"
          | "department"
          | "project",
        resourceId: accessContext.resourceId,
        roleId: accessContext.roleId as BuiltinRoleId,
      },
    } : {}),
    sessionId: session.session.id,
    user: {
      displayName: user.displayName,
      email: user.email,
      hasPassword: user.authAccounts.length > 0,
      id: user.id,
      systemRole: user.systemRole === "platform_administrator"
        || user.externalPlatformAdministrator
        ? "platform_administrator"
        : "user",
      username: user.username ?? user.email,
    },
  };
}

export function requireAuth(request: Request): Promise<PlatformPrincipal> {
  const context = authenticationContext(request);
  context.platformAuthentication ??= resolveAuth(request, context);
  return context.platformAuthentication;
}

export async function requirePlatformAdministrator(
  request: Request,
  capability: PlatformCapability = "CAP_PLATFORM_VIEW",
): Promise<PlatformPrincipal> {
  const principal = await requireAuth(request);
  if (
    principal.sessionId
    && principal.accessContext?.level !== "platform"
  ) {
    throw new Error(
      "Access denied: select Platform Administrator access for this session.",
    );
  }
  if (principal.user.systemRole !== "platform_administrator") {
    throw new Error(
      "You do not have permission to administer the TaskLattice Relay platform.",
    );
  }
  if (!await new RoleCatalogService().hasCapability("ROLE_PLATFORM_ADMIN", capability)) {
    throw new Error(`Platform Administrator does not grant ${capability}.`);
  }
  return principal;
}

export function applyAuthenticationResponseHeaders(
  request: Request,
  response: Response,
): void {
  const headers = (request as ContextualRequest).context
    ?.platformAuthenticationResponseHeaders;
  if (!headers) return;

  const setCookies = headers.getSetCookie();
  for (const value of setCookies) response.headers.append("set-cookie", value);
}

export function unauthorizedResponse(error: unknown): Response {
  return problemResponse(
    401,
    error instanceof Error ? error.message : "Authentication required.",
  );
}

export async function publicAuthConfig() {
  const runtime = await new PlatformSettingsService().authRuntimeSettings();
  return {
    authRequired: true,
    canonicalOrigin: new URL(getControlConfig().server.public_url!).origin,
    developmentDefaults:
      !process.env.TALI_CONFIG && process.env.NODE_ENV !== "production",
    localEnabled: runtime.localAuthenticationEnabled,
    mode: runtime.sso.enabled ? "local-sso" : "local",
    providerName: runtime.sso.enabled
      ? runtime.sso.displayName
      : "Company SSO",
    ssoEnabled: runtime.sso.enabled,
  } as const;
}

export async function handleAuthMe(request: Request): Promise<Response> {
  try {
    const principal = await requireAuth(request);
    return jsonResponse({
      identity: {
        type: "authenticated",
        userId: principal.user.id,
        username: principal.user.username,
      },
      user: principal.user,
    });
  } catch (error) {
    return unauthorizedResponse(error);
  }
}
