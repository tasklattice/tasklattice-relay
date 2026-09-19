import { requestOrigin } from "../http/request-origin";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { PlatformSettingsService } from "../platform/platform-settings-service";
import type { BetterAuthInstance } from "./better-auth";
import { corporateSsoProviderId } from "./external-role-bindings";

interface OidcLogoutDiscovery {
  end_session_endpoint?: unknown;
  revocation_endpoint?: unknown;
}

interface SignOutBody {
  disableRedirect?: boolean;
}

function httpEndpoint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      return null;
    }
    return endpoint.toString();
  } catch {
    return null;
  }
}

async function readSignOutBody(request: Request): Promise<SignOutBody> {
  try {
    return await request.clone().json() as SignOutBody;
  } catch {
    return {};
  }
}

function withProviderLogout(
  response: Response,
  providerLogoutUrl: string,
  disableRedirect: boolean,
): Response {
  const headers = new Headers(response.headers);
  if (disableRedirect) headers.delete("location");
  else headers.set("location", providerLogoutUrl);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({
    success: true,
    url: providerLogoutUrl,
    redirect: !disableRedirect,
  }), {
    headers,
    status: response.status,
  });
}

/**
 * Completes both halves of an SSO logout.
 *
 * Better Auth always owns deletion of the Relay session and cookie. This
 * wrapper additionally revokes the stored refresh token, removes all cached
 * Provider tokens, and returns Keycloak's RP-Initiated Logout URL so the
 * browser SSO cookie is cleared as well.
 */
export async function handleSsoSignOut(
  request: Request,
  instance: BetterAuthInstance,
  db: PrismaClient = prisma(),
  oidcFetch: typeof fetch = fetch,
): Promise<Response> {
  const origin = requestOrigin(request);
  const body = await readSignOutBody(request);
  let providerLogoutUrl = "";
  let accountId = "";

  try {
    const session = await instance.api.getSession({ headers: request.headers });
    if (session?.user.id) {
      const runtime = await new PlatformSettingsService(db).authRuntimeSettings();
      const account = await db.authAccount.findFirst({
        where: {
          providerId: corporateSsoProviderId,
          userId: session.user.id,
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          idToken: true,
          refreshToken: true,
        },
      });

      if (runtime.sso.enabled && account) {
        accountId = account.id;
        const discoveryUrl = `${runtime.sso.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
        const discoveryResponse = await oidcFetch(discoveryUrl, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(5_000),
        });
        if (!discoveryResponse.ok) {
          throw new Error(`OIDC discovery failed with HTTP ${discoveryResponse.status}.`);
        }
        const discovery = await discoveryResponse.json() as OidcLogoutDiscovery;
        const revocationEndpoint = httpEndpoint(discovery.revocation_endpoint);
        const endSessionEndpoint = httpEndpoint(discovery.end_session_endpoint);

        if (account.refreshToken && revocationEndpoint) {
          const revocation = await oidcFetch(revocationEndpoint, {
            body: new URLSearchParams({
              client_id: runtime.sso.clientId,
              client_secret: runtime.sso.clientSecret,
              token: account.refreshToken,
              token_type_hint: "refresh_token",
            }),
            headers: { "content-type": "application/x-www-form-urlencoded" },
            method: "POST",
            signal: AbortSignal.timeout(5_000),
          });
          if (!revocation.ok) {
            console.warn(
              `OIDC refresh-token revocation failed with HTTP ${revocation.status}; continuing logout.`,
            );
          }
        }

        if (endSessionEndpoint) {
          const logoutUrl = new URL(endSessionEndpoint);
          if (account.idToken) {
            logoutUrl.searchParams.set("id_token_hint", account.idToken);
          }
          logoutUrl.searchParams.set(
            "post_logout_redirect_uri",
            `${origin}/login`,
          );
          logoutUrl.searchParams.set("client_id", runtime.sso.clientId);
          providerLogoutUrl = logoutUrl.toString();
        }
      }
    }
  } catch (error) {
    console.warn(
      "Unable to prepare OIDC Provider logout; continuing with Relay session deletion.",
      error,
    );
  }

  const response = await instance.handler(request);

  if (accountId) {
    try {
      await db.authAccount.update({
        where: { id: accountId },
        data: {
          accessToken: null,
          accessTokenExpiresAt: null,
          idToken: null,
          refreshToken: null,
          refreshTokenExpiresAt: null,
        },
      });
    } catch (error) {
      console.warn("Unable to clear cached OIDC tokens after logout.", error);
    }
  }

  return providerLogoutUrl
    ? withProviderLogout(response, providerLogoutUrl, body.disableRedirect === true)
    : response;
}
