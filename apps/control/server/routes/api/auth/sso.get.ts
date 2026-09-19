import {
  requestOrigin,
  sameOriginCallback,
} from "../../../http/request-origin";
import { defineHandler } from "nitro";
import { ssoAuth } from "../../../auth/better-auth";
import { problemResponse } from "../../../http/responses";

export default defineHandler(async (event) => {
  const requestUrl = new URL(event.req.url);
  const origin = requestOrigin(event.req);
  const requestedCallback = requestUrl.searchParams.get("callbackURL") ?? "/";
  const callbackURL = sameOriginCallback(requestedCallback, origin);

  const authResponse = await (
    await ssoAuth(event.req)
  ).handler(
    new Request(new URL("/api/auth/sign-in/social", origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: origin,
      },
      body: JSON.stringify({
        callbackURL,
        disableRedirect: true,
        provider: "corporate-sso",
      }),
    }),
  );
  const payload = (await authResponse.json()) as {
    message?: string;
    url?: string;
  };
  if (!authResponse.ok || !payload.url) {
    return problemResponse(
      authResponse.status >= 400 ? authResponse.status : 502,
      payload.message ?? "Unable to start SSO authentication.",
      { code: "sso_start_failed" },
    );
  }

  const headers = new Headers({ location: payload.url });
  const stateCookie = authResponse.headers.get("set-cookie");
  if (stateCookie) headers.set("set-cookie", stateCookie);
  return new Response(null, { status: 302, headers });
});
