#!/usr/bin/env node

class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockedError";
  }
}

const jars = new Map();

function jar(origin) {
  if (!jars.has(origin)) jars.set(origin, new Map());
  return jars.get(origin);
}

function updateCookies(response, origin) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) jar(origin).set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(origin) {
  return [...jar(origin)].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function request(url, init = {}) {
  const target = new URL(url);
  const headers = new Headers(init.headers);
  const cookies = cookieHeader(target.origin);
  if (cookies) headers.set("cookie", cookies);
  const response = await fetch(target, { ...init, headers, redirect: "manual" });
  updateCookies(response, target.origin);
  return response;
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function main() {
  if (process.env.TALI_LIVE_E2E !== "1") {
    throw new BlockedError("Set TALI_LIVE_E2E=1 before running deployed SSO E2E.");
  }
  const username = process.env.TALI_SSO_USERNAME;
  const password = process.env.TALI_SSO_PASSWORD;
  if (!username || !password) {
    throw new BlockedError("TALI_SSO_USERNAME and TALI_SSO_PASSWORD are required.");
  }
  const baseUrl = new URL(process.env.TALI_BASE_URL ?? "http://127.0.0.1:18080");
  const start = await request(new URL("/api/auth/sso?callbackURL=/", baseUrl));
  if (start.status !== 302) {
    throw new Error(`Control SSO start returned HTTP ${start.status}.`);
  }
  const authorizationUrl = new URL(start.headers.get("location") ?? "", baseUrl);
  if (authorizationUrl.origin === baseUrl.origin) {
    throw new Error("Control SSO did not redirect to the configured Keycloak issuer.");
  }

  const loginPage = await request(authorizationUrl);
  if (!loginPage.ok) {
    throw new Error(`Keycloak login page returned HTTP ${loginPage.status}.`);
  }
  const html = await loginPage.text();
  const action = html.match(/<form[^>]+action="([^"]+)"/i)?.[1];
  if (!action) throw new Error("Keycloak did not render its credential form.");
  let response = await request(decodeHtml(action), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
  });

  let finalUrl = new URL(response.headers.get("location") ?? "", authorizationUrl);
  for (let redirects = 0; redirects < 6 && response.status >= 300 && response.status < 400; redirects += 1) {
    response = await request(finalUrl);
    const location = response.headers.get("location");
    if (!location) break;
    finalUrl = new URL(location, finalUrl);
  }
  if (response.status >= 400) {
    throw new Error(`SSO callback chain returned HTTP ${response.status}.`);
  }
  if (!cookieHeader(baseUrl.origin)) {
    throw new Error("Control did not issue an authenticated SSO session cookie.");
  }

  const profileResponse = await request(new URL("/api/v1/profile", baseUrl));
  const profile = await profileResponse.json();
  if (!profileResponse.ok) {
    throw new Error(`SSO profile returned HTTP ${profileResponse.status}: ${JSON.stringify(profile)}`);
  }
  if (profile.ssoIdentity?.providerId !== "corporate-sso") {
    throw new Error("The authenticated Control profile is not linked to corporate-sso.");
  }
  if (profile.ssoIdentity.groupClaimError) {
    throw new Error(`Control could not verify the SSO group claim: ${profile.ssoIdentity.groupClaimError}`);
  }
  const expectedGroup = process.env.TALI_SSO_EXPECTED_GROUP;
  if (expectedGroup && !profile.ssoIdentity.groups.includes(expectedGroup)) {
    throw new Error(`SSO profile omitted expected group ${expectedGroup}.`);
  }

  const contextResponse = await request(new URL("/api/v1/access-context", baseUrl));
  const context = await contextResponse.json();
  if (!contextResponse.ok || !context.options?.length) {
    throw new Error("SSO role binding did not produce any selectable Control access context.");
  }
  const selected = context.options.find((option) => option.level === "project") ?? context.options[0];
  const switchResponse = await request(new URL("/api/v1/access-context", baseUrl), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      level: selected.level,
      resourceId: selected.resourceId,
      roleId: selected.roleId,
    }),
  });
  const switched = await switchResponse.json();
  if (!switchResponse.ok || switched.active?.id !== selected.id) {
    throw new Error(`SSO Role switch failed: ${JSON.stringify(switched)}`);
  }

  console.log(JSON.stringify({
    result: "PASS",
    level: "L4-live-no-model",
    module: "access",
    evidence: {
      accessContext: switched.active.id,
      groupCount: profile.ssoIdentity.groups.length,
      issuer: profile.ssoIdentity.issuer,
      providerId: profile.ssoIdentity.providerId,
      username: profile.username,
    },
  }, null, 2));
}

main().catch((error) => {
  const blocked = error instanceof BlockedError;
  console.error(JSON.stringify({
    result: blocked ? "BLOCKED" : "FAIL",
    reason: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = blocked ? 2 : 1;
});
