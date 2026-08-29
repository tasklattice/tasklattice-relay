#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";

const keycloakImage = "quay.io/keycloak/keycloak:26.7.0";
const name = `tali-keycloak-it-${process.pid}`;
const temporaryDirectory = mkdtempSync(join(tmpdir(), "tali-keycloak-it-"));
const realmPath = join(temporaryDirectory, "tali-realm.json");
const clientId = "tali-control-plane";
const clientSecret = "integration-client-secret";
const testPassword = "integration-user-password";
const redirectUri = "http://127.0.0.1:38080/api/auth/callback/corporate-sso";

function docker(args, options = {}) {
  const output = execFileSync("docker", args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  return typeof output === "string" ? output.trim() : "";
}

function removeContainer() {
  try {
    docker(["rm", "--force", name]);
  } catch {
    // The integration container may not have been created yet.
  }
}

function reservePort() {
  const probe = execFileSync(
    process.execPath,
    ["-e", "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"],
    { encoding: "utf8" },
  );
  return Number.parseInt(probe.trim(), 10);
}

function renderRealm(baseUrl) {
  const rendered = execFileSync("helm", [
    "template",
    "tali-relay",
    "charts/tali-relay",
    "--namespace",
    "tali-keycloak-integration",
    "--kube-version",
    "1.29.0",
    "--set-string",
    `control.publicUrl=${redirectUri.replace(/\/api\/auth\/callback\/corporate-sso$/, "")}`,
    "--set",
    "keycloak.enabled=true",
    "--set-string",
    `keycloak.publicUrl=${baseUrl}`,
  ], { encoding: "utf8" });
  const objects = parseAllDocuments(rendered, { uniqueKeys: false })
    .map((document) => {
      if (document.errors.length) throw document.errors[0];
      return document.toJS();
    })
    .filter((object) => object && typeof object === "object");
  const configMap = objects.find((object) =>
    object.kind === "ConfigMap"
    && object.metadata?.name === "tali-relay-keycloak-realm"
  );
  const realm = configMap?.data?.["tali-realm.json"];
  if (typeof realm !== "string" || !realm.includes('"realm": "tali"')) {
    throw new Error("The Helm chart did not render the embedded Keycloak realm.");
  }
  // The Keycloak image runs as a non-root UID on Linux. Docker Desktop can
  // obscure this bind-mount permission mismatch, so make the generated,
  // placeholder-only realm import readable inside the container.
  writeFileSync(realmPath, realm, { mode: 0o644 });
}

async function waitForDiscovery(baseUrl, timeoutMs = 180_000) {
  const url = `${baseUrl}/realms/tali/.well-known/openid-configuration`;
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return response.json();
      lastError = new Error(`OIDC discovery returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw lastError ?? new Error("Timed out waiting for Keycloak OIDC discovery.");
}

function updateCookies(cookieJar, response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(cookieJar) {
  return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function jwtPayload(token) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Keycloak returned an invalid JWT.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function completeAuthorizationCodeFlow(discovery) {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  const authorizationUrl = new URL(discovery.authorization_endpoint);
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email groups",
    state,
    nonce: randomBytes(16).toString("hex"),
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const cookies = new Map();
  const loginResponse = await fetch(authorizationUrl, { redirect: "manual" });
  updateCookies(cookies, loginResponse);
  if (!loginResponse.ok) {
    throw new Error(`Keycloak authorization endpoint returned HTTP ${loginResponse.status}.`);
  }
  const loginHtml = await loginResponse.text();
  const action = loginHtml.match(/<form[^>]+action="([^"]+)"/i)?.[1];
  if (!action) throw new Error("Keycloak did not render a login form.");

  const credentialResponse = await fetch(decodeHtmlAttribute(action), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(cookies),
    },
    body: new URLSearchParams({ username: "alice", password: testPassword }),
  });
  updateCookies(cookies, credentialResponse);
  const callback = new URL(credentialResponse.headers.get("location") ?? "", redirectUri);
  if (`${callback.origin}${callback.pathname}` !== redirectUri) {
    const detail = (await credentialResponse.text()).slice(0, 1_000);
    throw new Error(`Keycloak login did not redirect to Control: ${callback.toString()} ${detail}`);
  }
  if (callback.searchParams.get("state") !== state) {
    throw new Error("Keycloak returned an invalid OAuth state.");
  }
  const code = callback.searchParams.get("code");
  if (!code) throw new Error(`Keycloak login failed: ${callback.searchParams.get("error") ?? "missing code"}`);

  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Keycloak token exchange returned HTTP ${tokenResponse.status}: ${(await tokenResponse.text()).slice(0, 1_000)}`);
  }
  return tokenResponse.json();
}

let failed = false;
try {
  docker(["version", "--format", "{{.Server.Version}}"]) ;
  removeContainer();
  const port = reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  renderRealm(baseUrl);
  docker([
    "run", "--detach",
    "--name", name,
    "--publish", `127.0.0.1:${port}:8080`,
    "--mount", `type=bind,src=${realmPath},dst=/opt/keycloak/data/import/tali-realm.json,readonly`,
    "--env", "KC_BOOTSTRAP_ADMIN_USERNAME=admin",
    "--env", "KC_BOOTSTRAP_ADMIN_PASSWORD=integration-admin-password",
    "--env", `TALI_KEYCLOAK_CLIENT_SECRET=${clientSecret}`,
    "--env", `TALI_KEYCLOAK_TEST_USER_PASSWORD=${testPassword}`,
    keycloakImage,
    "start-dev",
    "--import-realm",
    `--hostname=${baseUrl}`,
    "--health-enabled=true",
  ]);

  const discovery = await waitForDiscovery(baseUrl);
  if (discovery.issuer !== `${baseUrl}/realms/tali`) {
    throw new Error(`Unexpected Keycloak issuer: ${discovery.issuer}`);
  }
  const jwksResponse = await fetch(discovery.jwks_uri);
  const jwks = await jwksResponse.json();
  if (!jwksResponse.ok || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw new Error("Keycloak did not publish an OIDC signing key.");
  }

  const tokens = await completeAuthorizationCodeFlow(discovery);
  const claims = jwtPayload(tokens.access_token);
  const groups = Array.isArray(claims.groups) ? claims.groups : [];
  if (claims.preferred_username !== "alice") {
    throw new Error(`Expected the alice identity, received ${claims.preferred_username}.`);
  }
  if (!groups.includes("/tali/d/dep1/p/proj1/r/ROLE_PROJECT_ADMIN")) {
    throw new Error(`Keycloak access token omitted the Project role group: ${JSON.stringify(groups)}`);
  }
  const userInfoResponse = await fetch(discovery.userinfo_endpoint, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = await userInfoResponse.json();
  if (!userInfoResponse.ok || userInfo.email !== "alice@tali.test") {
    throw new Error("Keycloak userinfo did not return the configured test identity.");
  }
  console.log(`Keycloak integration passed (${jwks.keys.length} signing keys, ${groups.length} role groups).`);
} catch (error) {
  failed = true;
  const logs = spawnSync("docker", ["logs", "--tail", "200", name], { encoding: "utf8" });
  const output = `${logs.stdout ?? ""}${logs.stderr ?? ""}`.trim();
  if (output) process.stderr.write(`\nKeycloak logs:\n${output}\n`);
  console.error(error);
} finally {
  removeContainer();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

if (failed) process.exitCode = 1;
