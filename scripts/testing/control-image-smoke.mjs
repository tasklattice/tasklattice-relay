#!/usr/bin/env node
// Run a locally built production image against a disposable database only.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";

const image = process.argv[2] ?? "relay-review-control:local";
const prefix = `relay-image-check-${randomBytes(6).toString("hex")}`;
const database = `${prefix}-db`;
const app = `${prefix}-app`;
const directory = mkdtempSync(join(tmpdir(), "relay-image-check-"));
const credential = randomBytes(32).toString("hex");
const adminPassword = randomBytes(24).toString("hex");
const docker = (args, options = {}) => execFileSync("docker", args, {
  encoding: "utf8", timeout: 300000, stdio: ["pipe", "pipe", "pipe"], ...options,
});
const pause = () => new Promise(resolve => setTimeout(resolve, 500));
let networkCreated = false;
try {
  // Match the world-readable Secret mount, using ephemeral test credentials.
  chmodSync(directory, 0o755);
  writeFileSync(join(directory, "control.toml"), stringify({
    schema_version: 1,
    server: { public_urls: ["http://localhost:8080"] },
    database: { url: `postgresql://postgres:${credential}@${database}:5432/relay_image_test` },
    auth: { secret: randomBytes(32).toString("hex"), local: { enabled: true,
      initial_platform_administrator_username: "review-admin",
      initial_platform_administrator_email: "review-admin@example.test",
      initial_platform_administrator_password: adminPassword } },
    memory: { enabled: false },
  }), { mode: 0o644 });
  docker(["network", "create", "--internal", prefix]);
  networkCreated = true;
  docker(["run", "-d", "--name", database, "--network", prefix,
    "--memory", "512m", "--cpus", "1", "-e", "POSTGRES_PASSWORD",
    "-e", "POSTGRES_DB=relay_image_test", "pgvector/pgvector:0.8.6-pg17"],
  { env: { ...process.env, POSTGRES_PASSWORD: credential } });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { docker(["exec", database, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); ready = true; break; }
    catch { await pause(); }
  }
  assert(ready, "isolated database must become ready");
  for (const identity of ["10001:10001", "1000880000:0"]) {
    let configDirectory = directory;
    if (identity === "1000880000:0") {
      const configPath = join(directory, "control.toml");
      const upgraded = parse(readFileSync(configPath, "utf8"));
      upgraded.auth.local.initial_platform_administrator_username = "changed-bootstrap-admin";
      upgraded.auth.local.initial_platform_administrator_email = "changed@example.test";
      upgraded.auth.local.initial_platform_administrator_password = randomBytes(24).toString("hex");
      // Use a fresh Secret revision directory. Reusing a changed host file can
      // leave Docker Desktop/OrbStack bind mounts with stale file-size metadata.
      configDirectory = join(directory, "next-revision");
      mkdirSync(configDirectory, { mode: 0o755 });
      writeFileSync(join(configDirectory, "control.toml"), stringify(upgraded), { mode: 0o644 });
      // The existing identity and password must still work after reentry.
    }
    const common = ["--network", prefix, "--user", identity, "--read-only",
      "--cap-drop=ALL", "--security-opt=no-new-privileges", "--tmpfs", "/tmp:rw,nosuid,size=128m",
      "-e", "TALI_CONFIG=/etc/tali/control.toml", "-e", "XDG_CACHE_HOME=/tmp/.cache",
      "-v", `${configDirectory}:/etc/tali:ro`];
    // Real release init commands: the second identity also checks upgrade reentry.
    docker(["run", "--rm", ...common, "-w", "/app/apps/control", "--entrypoint",
      "/app/node_modules/.bin/prisma", image, "migrate", "deploy", "--config", "prisma.config.ts"]);
    docker(["run", "--rm", ...common, "-w", "/app/apps/control", "--entrypoint",
      "node", image, "prisma/seed-built-in-skills.mjs"]);
    docker(["run", "--rm", ...common, "--entrypoint", "node", image, "--input-type=module", "-e", `
      import assert from 'node:assert/strict'; import { existsSync, readFileSync } from 'node:fs';
      for (const name of ['shadcn','braces','micromatch','fast-glob','ts-morph'])
        assert(!existsSync('/app/node_modules/' + name), name + ' must not ship');
      const versions = ['prisma','@prisma/client','@prisma/adapter-pg'].map(name =>
        JSON.parse(readFileSync('/app/node_modules/' + name + '/package.json')).version);
      assert.equal(new Set(versions).size, 1);
    `]);
    docker(["run", "-d", "--name", app, ...common, "--memory", "768m", "--cpus", "1", image]);
    // Keep HTTP inside the internal network too; publish no application port.
    const request = async (path, options = {}) => {
      const raw = docker(["exec", "-i", app, "node", "--input-type=module", "-e", `
        let input = ''; for await (const chunk of process.stdin) input += chunk;
        const { path, options } = JSON.parse(input);
        const response = await fetch('http://localhost:8080' + path, {
          ...options, signal: AbortSignal.timeout(5000),
          headers: { origin: 'http://localhost:8080', ...options.headers }
        });
        console.log(JSON.stringify({ status: response.status, headers: [...response.headers], body: await response.text() }));
      `], { input: JSON.stringify({ path, options }), maxBuffer: 8 * 1024 * 1024 });
      const { status, headers, body } = JSON.parse(raw);
      return new Response(body, { status, headers });
    };
    ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { const response = await request("/api/health"); if (response.ok && (await response.json()).ok) { ready = true; break; } }
      catch { /* the server is still starting */ }
      await pause();
    }
    assert(ready, "production server must connect to PostgreSQL");
    const document = await (await request("/api/v1/openapi.json")).json();
    assert(document.components.schemas.OnboardAgentInput.oneOf.length > 0);
    const login = await request("/api/auth/sign-in/username", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "review-admin", password: adminPassword }) });
    if (login.status !== 200) {
      const { code, message } = await login.json();
      throw new Error(`Production login failed: HTTP ${login.status}; ${code}; ${message}`);
    }
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert(cookie, "login must issue a session cookie");
    const session = await request("/api/auth/get-session", { headers: { cookie } });
    assert.equal((await session.json()).user.email, "review-admin@example.test");
    const page = await request("/login");
    assert.equal(page.status, 200);
    const html = await page.text();
    const cssPaths = [...html.matchAll(/(?:href|src)="([^"\s]+\.css)"/g)].map(match => match[1]);
    assert(cssPaths.length, "SSR must reference compiled styles");
    for (const path of cssPaths) {
      const css = await request(path);
      assert.equal(css.status, 200, "compiled CSS must load without the shadcn CLI");
      assert((await css.text()).length > 1000);
    }
    const license = await request("/licenses/shadcn.txt");
    assert.equal(license.status, 200);
    assert((await license.text()).includes("Copyright (c) 2023 shadcn"));
    docker(["rm", "-f", app]);
    console.log(`UID ${identity}: migrations, seed, pruned dependencies, database health, login/session, OpenAPI and SSR/CSS passed.`);
  }
} catch (error) {
  // Keep command diagnostics useful while redacting all generated credentials.
  const diagnostic = error?.stderr ? String(error.stderr) : error.message;
  console.error(diagnostic.replaceAll(credential, "[redacted]").replaceAll(adminPassword, "[redacted]"));
  try {
    const result = spawnSync("docker", ["logs", app], { encoding: "utf8", timeout: 10000 });
    const logs = (result.stdout ?? "") + (result.stderr ?? "");
    console.error(logs.replaceAll(credential, "[redacted]").replaceAll(adminPassword, "[redacted]"));
  } catch { /* the application container may not exist yet */ }
  process.exitCode = 1;
} finally {
  if (networkCreated) {
    for (const name of [app, database]) {
      try { docker(["rm", "-fv", name]); } catch { /* already removed or never created */ }
    }
    try { docker(["network", "rm", prefix]); }
    catch { console.error(`Unable to remove isolated test network ${prefix}`); process.exitCode = 1; }
  }
  rmSync(directory, { recursive: true, force: true });
}
