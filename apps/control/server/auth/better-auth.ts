import { requestOrigin } from "../http/request-origin";
import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { hashPassword } from "better-auth/crypto";
import { createLocalAccountIssuer } from "better-auth/db";
import { genericOAuth, username } from "better-auth/plugins";
import { getControlConfig } from "../config/control-config";
import { ensureBuiltinRoleCatalog } from "../authorization/role-catalog";
import { prisma } from "../db/prisma";
import {
  PlatformSettingsService,
  type PlatformAuthRuntimeSettings,
} from "../platform/platform-settings-service";
import { betterAuthCookiePrefix } from "./cookies";
import {
  corporateSsoProviderId,
  synchronizeExternalRoleBindings,
} from "./external-role-bindings";

export const authSessionIdleTimeoutSeconds = 30 * 60;
export const authSessionUpdateAgeSeconds = 0;

function createBetterAuth(
  runtime: PlatformAuthRuntimeSettings,
  origin: string,
) {
  const config = getControlConfig();

  return betterAuth({
    appName: "TaskLattice Relay",
    baseURL: origin,
    basePath: "/api/auth",
    secret: config.auth.secret,
    trustedOrigins: config.server.public_urls,
    advanced: { cookiePrefix: betterAuthCookiePrefix },
    database: prismaAdapter(prisma(), {
      provider: "postgresql",
      transaction: true,
    }),
    emailAndPassword: {
      enabled: runtime.localAuthenticationEnabled,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    user: {
      modelName: "User",
      fields: { name: "displayName" },
      additionalFields: {
        language: {
          type: "string",
          defaultValue: "en-US",
          input: false,
          returned: true,
        },
        timezone: {
          type: "string",
          defaultValue: "UTC",
          input: false,
          returned: true,
        },
        theme: {
          type: "string",
          defaultValue: "system",
          input: false,
          returned: true,
        },
        systemRole: {
          type: ["user", "platform_administrator"],
          defaultValue: "user",
          input: false,
          returned: true,
        },
        status: {
          type: ["active", "disabled"],
          defaultValue: "active",
          input: false,
          returned: true,
        },
      },
    },
    session: {
      modelName: "AuthSession",
      expiresIn: authSessionIdleTimeoutSeconds,
      updateAge: authSessionUpdateAgeSeconds,
    },
    account: { modelName: "AuthAccount" },
    verification: { modelName: "AuthVerification" },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await prisma().user.findUnique({
              where: { id: session.userId },
              select: { status: true },
            });
            if (user?.status !== "active") return false;
            if (runtime.sso.enabled) {
              const account = await prisma().authAccount.findFirst({
                where: {
                  userId: session.userId,
                  providerId: corporateSsoProviderId,
                },
                select: { idToken: true },
                orderBy: { updatedAt: "desc" },
              });
              if (account?.idToken) {
                await synchronizeExternalRoleBindings(
                  session.userId,
                  account.idToken,
                  runtime.sso.groupClaim,
                );
              }
            }
            return true;
          },
        },
      },
    },
    plugins: [
      username({
        displayUsername: false,
        immutableUsername: true,
        minUsernameLength: 3,
        maxUsernameLength: 64,
        usernameValidator: (value) => /^[a-zA-Z0-9._-]+$/.test(value),
      }),
      genericOAuth({
        config: runtime.sso.enabled
          ? [
              {
                providerId: corporateSsoProviderId,
                name: runtime.sso.displayName,
                discoveryUrl: `${runtime.sso.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
                clientId: runtime.sso.clientId,
                clientSecret: runtime.sso.clientSecret,
                scopes: ["openid", "profile", "email", "groups"],
                requireIdTokenVerification: true,
                postLogoutRedirectURI: `${origin}/login`,
                mapProfileToUser: (profile) => ({
                  name:
                    typeof profile.name === "string" && profile.name.trim()
                      ? profile.name
                      : typeof profile.email === "string"
                        ? profile.email
                        : "SSO User",
                  emailVerified: profile.email_verified === true,
                }),
              },
            ]
          : [],
      }),
    ],
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;

interface BetterAuthState {
  instance: BetterAuthInstance;
  revisionKey: string;
}

declare global {
  var taliBetterAuth: BetterAuthInstance | undefined;
  var taliBetterAuthLocalState: Map<string, BetterAuthState> | undefined;
  var taliBetterAuthSsoState: Map<string, BetterAuthState> | undefined;
}

export async function auth(request: Request): Promise<BetterAuthInstance> {
  const origin = requestOrigin(request);
  const cache = (globalThis.taliBetterAuthLocalState ??= new Map());
  const cached = cache.get(origin);
  const runtime = await new PlatformSettingsService().authRuntimeSettings();
  const revisionKey = `${runtime.revision}:${runtime.localAuthenticationEnabled}`;
  if (cached?.revisionKey === revisionKey) {
    return cached.instance;
  }
  const instance = createBetterAuth(
    {
      ...runtime,
      sso: { ...runtime.sso, enabled: false },
    },
    origin,
  );
  cache.set(origin, { instance, revisionKey });
  return instance;
}

export async function ssoAuth(request: Request): Promise<BetterAuthInstance> {
  const origin = requestOrigin(request);
  const cache = (globalThis.taliBetterAuthSsoState ??= new Map());
  const cached = cache.get(origin);
  const settings = new PlatformSettingsService();
  const revisionKey = await settings.authRevisionKey();
  if (cached?.revisionKey === revisionKey) {
    return cached.instance;
  }
  const runtime = await settings.authRuntimeSettings();
  const instance = createBetterAuth(runtime, origin);
  cache.set(origin, {
    instance,
    revisionKey: String(runtime.revision),
  });
  return instance;
}

export function resetBetterAuthForTests(): void {
  globalThis.taliBetterAuth = undefined;
  globalThis.taliBetterAuthLocalState = undefined;
  globalThis.taliBetterAuthSsoState = undefined;
}

export async function ensureInitialPlatformAdministrator(): Promise<void> {
  await ensureBuiltinRoleCatalog();
  const local = getControlConfig().auth.local;
  const username = local.initial_platform_administrator_username;
  const email = local.initial_platform_administrator_email;
  const password = local.initial_platform_administrator_password;
  if (!username || !email || !password) {
    if (!local.enabled) return;
    throw new Error(
      "Local authentication requires an initial Platform Administrator username, email, and password.",
    );
  }

  const administrator = await prisma().user.upsert({
    where: { id: "local-admin" },
    create: {
      id: "local-admin",
      username,
      email,
      emailVerified: true,
      displayName: "Platform Administrator",
      systemRole: "platform_administrator",
      status: "active",
    },
    // Bootstrap values are create-only. Platform-managed identity changes
    // must not be silently reverted during a later process restart.
    update: {},
  });

  const issuer = createLocalAccountIssuer("credential");
  const existingCredential = await prisma().authAccount.findUnique({
    where: { issuer_accountId: { issuer, accountId: administrator.id } },
  });
  if (existingCredential) return;

  await prisma().authAccount.create({
    data: {
      id: randomUUID(),
      userId: administrator.id,
      providerId: "credential",
      issuer,
      accountId: administrator.id,
      password: await hashPassword(password),
    },
  });
}

export const betterAuthOidcProviderId = corporateSsoProviderId;
