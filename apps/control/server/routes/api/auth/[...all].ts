import { defineHandler } from "nitro";
import { auth, ssoAuth } from "../../../auth/better-auth";
import { handleSsoSignOut } from "../../../auth/sso-sign-out";

const ssoPaths = new Set([
  "/api/auth/sign-in/social",
  "/api/auth/link-social",
  "/api/auth/callback/corporate-sso",
  // The SSO-aware instance owns the OIDC provider metadata and stored ID
  // token needed to build Keycloak's RP-Initiated Logout URL. Local accounts
  // still sign out normally because they have no corporate-sso account.
  "/api/auth/sign-out",
]);

export default defineHandler(async (event) => {
  const pathname = new URL(event.req.url).pathname.replace(/\/+$/, "");
  const instance = ssoPaths.has(pathname) ? await ssoAuth(event.req) : await auth(event.req);
  if (pathname === "/api/auth/sign-out") {
    return handleSsoSignOut(event.req, instance);
  }
  return instance.handler(event.req);
});
