import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "better-auth/crypto";
import {
  developmentControlConfig,
  setControlConfigForTests,
} from "../config/control-config";
import { createTestPrisma } from "../test/prisma";
import { PlatformSettingsService } from "../platform/platform-settings-service";
import {
  applyAuthenticationResponseHeaders,
  handleAuthMe,
  publicAuthConfig,
} from "./auth";
import {
  auth,
  authSessionIdleTimeoutSeconds,
  ensureInitialPlatformAdministrator,
  resetBetterAuthForTests,
  ssoAuth,
} from "./better-auth";
import { betterAuthSessionCookieName } from "./cookies";
import { corporateSsoProviderId } from "./external-role-bindings";
import { handleSsoSignOut } from "./sso-sign-out";
import type { ValidatePlatformSsoSettingsInput } from "@tali/contracts";

async function saveValidatedSecurity(
  service: PlatformSettingsService,
  input: ValidatePlatformSsoSettingsInput,
) {
  const validation = await service.validateSecurity(input);
  return service.updateSecurity(
    { ...input, validationToken: validation.validationToken },
    "admin",
  );
}

function cookieHeader(response: Response): string {
  return (response.headers.get("set-cookie") ?? "")
    .split(/,(?=\s*[^;,]+=)/)
    .map((cookie) => cookie.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function signIn(password: string): Promise<Response> {
  return (await auth()).handler(
    new Request("http://tali.local/api/auth/sign-in/username", {
      body: JSON.stringify({
        password,
        rememberMe: true,
        username: "admin",
      }),
      headers: {
        "content-type": "application/json",
        origin: "http://tali.local",
      },
      method: "POST",
    }),
  );
}

describe("Better Auth platform authentication", () => {
  const db = createTestPrisma();

  beforeEach(async () => {
    globalThis.taliPrisma = db;
    vi.stubEnv("TALI_CONFIG", "/test/control.toml");
    const config = developmentControlConfig();
    config.server.public_url = "http://tali.local";
    config.auth.local.initial_platform_administrator_password = "correct-horse-battery";
    setControlConfigForTests(config);
    resetBetterAuthForTests();
    await db.authSession.deleteMany();
    await db.authAccount.deleteMany();
    await db.platformSettingsRecord.deleteMany();
    await ensureInitialPlatformAdministrator();
  });

  afterEach(() => {
    resetBetterAuthForTests();
    setControlConfigForTests(undefined);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("signs in with a username and resolves the cookie-backed application principal", async () => {
    const response = await signIn("correct-horse-battery");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain(
      `${betterAuthSessionCookieName}=`,
    );
    expect(response.headers.get("set-cookie")).not.toContain(
      "better-auth.session_token=",
    );
    expect(response.headers.get("set-cookie")).toContain(
      `Max-Age=${authSessionIdleTimeoutSeconds}`,
    );

    const request = new Request("http://tali.local/api/v1/auth/me", {
      headers: { cookie: cookieHeader(response) },
    });
    const me = await handleAuthMe(request);
    applyAuthenticationResponseHeaders(request, me);
    expect(me.status).toBe(200);
    expect(me.headers.get("set-cookie")).toContain(
      `${betterAuthSessionCookieName}=`,
    );
    expect(me.headers.get("set-cookie")).toContain(
      `Max-Age=${authSessionIdleTimeoutSeconds}`,
    );
    await expect(me.json()).resolves.toMatchObject({
      identity: { type: "authenticated", userId: "local-admin" },
      user: {
        hasPassword: true,
        id: "local-admin",
        systemRole: "platform_administrator",
        username: "admin",
      },
    });
    await expect(db.authSession.count()).resolves.toBe(1);

    const defaultCookie = cookieHeader(response).replace(
      `${betterAuthSessionCookieName}=`,
      "better-auth.session_token=",
    );
    const defaultCookieMe = await handleAuthMe(
      new Request("http://tali.local/api/v1/auth/me", {
        headers: { cookie: defaultCookie },
      }),
    );
    expect(defaultCookieMe.status).toBe(401);
  });

  it("bootstraps the canonical admin / password development credentials", async () => {
    const config = developmentControlConfig();
    config.server.public_url = "http://tali.local";
    expect(config.auth.local.initial_platform_administrator_username).toBe("admin");
    expect(config.auth.local.initial_platform_administrator_password).toBe("password");

    setControlConfigForTests(config);
    resetBetterAuthForTests();
    await db.authSession.deleteMany();
    await db.authAccount.deleteMany();
    await ensureInitialPlatformAdministrator();

    const response = await signIn("password");
    expect(response.status).toBe(200);
  });

  it("rejects invalid credentials and does not accept the removed bearer-token protocol", async () => {
    const invalid = await signIn("incorrect-password");
    expect(invalid.status).toBe(401);

    const bearerOnly = await handleAuthMe(
      new Request("http://tali.local/api/v1/auth/me", {
        headers: { authorization: "Bearer legacy.jwt.token" },
      }),
    );
    expect(bearerOnly.status).toBe(401);
  });

  it("bootstraps one scrypt credential without rewriting it on restart", async () => {
    const first = await db.authAccount.findFirstOrThrow({
      where: { providerId: "credential", userId: "local-admin" },
    });
    expect(first.password).toBeTruthy();
    await expect(
      verifyPassword({
        hash: first.password!,
        password: "correct-horse-battery",
      }),
    ).resolves.toBe(true);

    const config = developmentControlConfig();
    config.server.public_url = "http://tali.local";
    config.auth.local.initial_platform_administrator_password = "different-password-value";
    setControlConfigForTests(config);
    await ensureInitialPlatformAdministrator();

    const second = await db.authAccount.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(second.password).toBe(first.password);
  });

  it("publishes enabled login methods without exposing Better Auth secrets", async () => {
    const discoveryFetch = vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(
      String(input).endsWith("/jwks")
        ? { keys: [{ kid: "signing-key", kty: "RSA" }] }
        : {
            issuer: "https://identity.example/realms/agents",
            authorization_endpoint: "https://identity.example/authorize",
            token_endpoint: "https://identity.example/token",
            jwks_uri: "https://identity.example/jwks",
          },
    ), { status: 200 })) as unknown as typeof fetch;
    await saveValidatedSecurity(new PlatformSettingsService(db, discoveryFetch), {
      localAuthenticationEnabled: true,
      sso: {
        clientId: "tali",
        clientSecret: { action: "replace", value: "provider-secret" },
        displayName: "Example ID",
        enabled: true,
        issuer: "https://identity.example/realms/agents",
      },
    });

    expect(await publicAuthConfig()).toEqual({
      authRequired: true,
      canonicalOrigin: "http://tali.local",
      developmentDefaults: false,
      localEnabled: true,
      mode: "local-sso",
      providerName: "Example ID",
      ssoEnabled: true,
    });
    expect(JSON.stringify(await publicAuthConfig())).not.toContain("provider-secret");
    expect(JSON.stringify(await publicAuthConfig())).not.toContain(
      developmentControlConfig().auth.secret,
    );
  });

  it("refreshes the authentication provider after the shared settings revision changes", async () => {
    const discoveryFetch = vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(
      String(input).endsWith("/jwks")
        ? { keys: [{ kid: "signing-key", kty: "RSA" }] }
        : {
            issuer: "https://identity.example",
            authorization_endpoint: "https://identity.example/authorize",
            token_endpoint: "https://identity.example/token",
            jwks_uri: "https://identity.example/jwks",
          },
    ), { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", discoveryFetch);
    const settings = new PlatformSettingsService(db, discoveryFetch);
    const before = await ssoAuth();

    await saveValidatedSecurity(settings, {
      localAuthenticationEnabled: true,
      sso: {
        clientId: "online-client",
        clientSecret: { action: "replace", value: "online-secret" },
        displayName: "Online SSO",
        enabled: true,
        issuer: "https://identity.example",
      },
    });

    expect(await publicAuthConfig()).toEqual({
      authRequired: true,
      canonicalOrigin: "http://tali.local",
      developmentDefaults: false,
      localEnabled: true,
      mode: "local-sso",
      providerName: "Online SSO",
      ssoEnabled: true,
    });
    expect(JSON.stringify(await publicAuthConfig())).not.toContain("online-secret");
    const reconfigured = await ssoAuth();
    expect(reconfigured).not.toBe(before);
    await reconfigured.api.getSession({ headers: new Headers() });
  });

  it("clears the Relay session and returns the OIDC Provider logout URL", async () => {
    const issuer = "https://identity.example/realms/tali";
    const discoveryFetchMock = vi.fn(async (
      input: string | URL | Request,
      _init?: RequestInit,
    ) => {
      if (String(input) === `${issuer}/revoke`) {
        return new Response(null, { status: 204 });
      }
      if (String(input) === `${issuer}/jwks`) {
        return new Response(JSON.stringify({
          keys: [{ kid: "signing-key", kty: "RSA" }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        end_session_endpoint: `${issuer}/logout`,
        revocation_endpoint: `${issuer}/revoke`,
        id_token_signing_alg_values_supported: ["RS256"],
      }), { status: 200 });
    });
    const discoveryFetch = discoveryFetchMock as unknown as typeof fetch;
    vi.stubGlobal("fetch", discoveryFetch);
    await saveValidatedSecurity(new PlatformSettingsService(db, discoveryFetch), {
      localAuthenticationEnabled: true,
      sso: {
        clientId: "tali-control-plane",
        clientSecret: { action: "replace", value: "provider-secret" },
        displayName: "Example ID",
        enabled: true,
        issuer,
      },
    });
    const idToken = "header.payload.signature";
    const refreshToken = "refresh-token-value";
    await db.authAccount.create({
      data: {
        id: "local-admin-sso-account",
        accountId: "external-local-admin",
        providerId: corporateSsoProviderId,
        issuer,
        userId: "local-admin",
        idToken,
        refreshToken,
      },
    });
    const signedIn = await signIn("correct-horse-battery");

    const sso = await ssoAuth();
    const response = await handleSsoSignOut(
      new Request("http://tali.local/api/auth/sign-out", {
        body: JSON.stringify({
          callbackURL: "/login",
          disableRedirect: true,
        }),
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader(signedIn),
          origin: "http://tali.local",
        },
        method: "POST",
      }),
      sso,
      db,
      discoveryFetch,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      redirect?: boolean;
      success: boolean;
      url?: string;
    };
    expect(payload).toMatchObject({ success: true, redirect: false });
    const logoutUrl = new URL(payload.url!);
    expect(logoutUrl.origin + logoutUrl.pathname).toBe(`${issuer}/logout`);
    expect(logoutUrl.searchParams.get("id_token_hint")).toBe(idToken);
    expect(logoutUrl.searchParams.get("client_id")).toBe("tali-control-plane");
    expect(logoutUrl.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://tali.local/login",
    );
    await expect(db.authSession.count()).resolves.toBe(0);
    expect(response.headers.get("set-cookie")).toContain(
      `${betterAuthSessionCookieName}=`,
    );
    const revokeCall = discoveryFetchMock.mock.calls.find(
      ([input]) => String(input) === `${issuer}/revoke`,
    );
    expect(revokeCall).toBeDefined();
    const revokeBody = revokeCall?.[1]?.body as URLSearchParams;
    expect(revokeBody.get("token")).toBe(refreshToken);
    expect(revokeBody.get("token_type_hint")).toBe("refresh_token");
    expect(revokeBody.get("client_id")).toBe("tali-control-plane");
    const clearedAccount = await db.authAccount.findUnique({
      where: { id: "local-admin-sso-account" },
    });
    expect(clearedAccount).toMatchObject({
      accessToken: null,
      idToken: null,
      refreshToken: null,
    });
  });

  it("keeps Local authentication available when OIDC discovery is offline", async () => {
    const discoveryFetch = vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(
      String(input).endsWith("/jwks")
        ? { keys: [{ kid: "signing-key", kty: "RSA" }] }
        : {
            issuer: "https://identity.example",
            authorization_endpoint: "https://identity.example/authorize",
            token_endpoint: "https://identity.example/token",
            jwks_uri: "https://identity.example/jwks",
          },
    ), { status: 200 })) as unknown as typeof fetch;
    await saveValidatedSecurity(new PlatformSettingsService(db, discoveryFetch), {
      localAuthenticationEnabled: true,
      sso: {
        clientId: "online-client",
        clientSecret: { action: "replace", value: "online-secret" },
        displayName: "Online SSO",
        enabled: true,
        issuer: "https://identity.example",
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("identity provider offline");
    }));

    const sso = await ssoAuth();
    await expect(sso.handler(new Request(
      "http://tali.local/api/auth/sign-in/social",
      {
        body: JSON.stringify({
          callbackURL: "/proj1",
          provider: "corporate-sso",
        }),
        headers: {
          "content-type": "application/json",
          origin: "http://tali.local",
        },
        method: "POST",
      },
    ))).rejects.toThrow("discovery returned no valid data");

    await expect(signIn("correct-horse-battery")).resolves.toMatchObject({
      status: 200,
    });
  });

  it("requires one canonical public URL for every authentication mode", async () => {
    const config = developmentControlConfig();
    delete config.server.public_url;
    setControlConfigForTests(config);
    resetBetterAuthForTests();
    await expect(auth()).rejects.toThrow(
      "server.public_url is required for Better Auth",
    );
  });
});
