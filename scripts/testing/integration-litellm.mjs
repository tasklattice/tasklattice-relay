#!/usr/bin/env node
// Render the real Chart into a disposable Docker stack; never access Kubernetes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import { materializeBootstrapSecrets } from "./helm-bootstrap-fixture.mjs";

const name = `relay-litellm-it-${randomUUID().slice(0, 8)}`;
const database = `${name}-db`;
const directory = mkdtempSync(join(tmpdir(), `${name}-`));
const secrets = [];
const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), String(value))
  .replace(/sk-[\w-]+/g, "[redacted]");
const run = (command, args, options = {}) => {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 300_000,
      stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
  } catch (error) {
    throw new Error(redact(`${command} failed: ${error.stdout ?? ""}\n${error.stderr ?? ""}`));
  }
};
const docker = (...args) => run("docker", args);
const pause = () => new Promise(resolve => setTimeout(resolve, 1000));
let failed = false;
try {
  const objects = materializeBootstrapSecrets(parseAllDocuments(run("helm", ["template", "litellm-test",
    "charts/tali-relay", "--kube-version", "1.29.0"])).map(doc => doc.toJSON()));
  const pod = component => objects.find(object => object.spec?.template
    && object.metadata?.labels?.["app.kubernetes.io/component"] === component).spec.template.spec;
  const secretValue = ref => objects.find(object => object.kind === "Secret"
    && object.metadata.name === ref.name).stringData[ref.key];
  const environment = container => Object.fromEntries(container.env.map(entry => [entry.name,
    entry.value ?? secretValue(entry.valueFrom.secretKeyRef)]));
  const lite = pod("litellm");
  const container = lite.containers[0];
  const env = environment(container);
  const pg = pod("postgresql").containers[0];
  const pgEnv = environment(pg);
  secrets.push(env.LITELLM_MASTER_KEY, env.LITELLM_SALT_KEY, env.UI_PASSWORD, pgEnv.POSTGRES_PASSWORD);
  const url = new URL(env.DATABASE_URL);
  url.hostname = database;
  env.DATABASE_URL = url.toString();
  const configVolume = lite.volumes.find(volume => volume.name === "litellm-config").secret;
  const config = secretValue({ name: configVolume.secretName, key: "litellm-config.yaml" });
  // Mount only this synthetic file; the private parent also holds the env file.
  writeFileSync(join(directory, "config.yaml"), config, { mode: 0o644 });
  chmodSync(directory, 0o755);
  writeFileSync(join(directory, "litellm.env"), Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n"), { mode: 0o600 });
  writeFileSync(join(directory, "postgres.env"), Object.entries(pgEnv).map(([key, value]) => `${key}=${value}`).join("\n"), { mode: 0o600 });
  docker("network", "create", name);
  docker("run", "-d", "--name", database, "--network", name, "--env-file", join(directory, "postgres.env"), pg.image);
  const wait = lite.initContainers.find(item => item.name === "wait-for-postgresql");
  assert.equal(wait.image, container.image);
  docker("run", "--rm", "--name", `${name}-wait`, "--network", name,
    "--user", `${lite.securityContext.runAsUser}:${lite.securityContext.runAsGroup}`,
    "--env-file", join(directory, "litellm.env"), "--read-only", "--tmpfs", "/tmp",
    "--entrypoint", wait.command[0], wait.image, ...wait.command.slice(1), ...wait.args);
  docker("run", "-d", "--name", name, "--network", name, "-p", "127.0.0.1::4000",
    "--user", `${lite.securityContext.runAsUser}:${lite.securityContext.runAsGroup}`,
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--env-file", join(directory, "litellm.env"),
    "-v", `${directory}/config.yaml:/etc/litellm/config.yaml:ro`, container.image, ...container.args);
  const address = docker("port", name, "4000/tcp");
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const baseUrl = `http://${address}`;
  const deadline = Date.now() + 180_000;
  while (true) {
    try {
      const response = await fetch(baseUrl + container.readinessProbe.httpGet.path, { signal: AbortSignal.timeout(2000) });
      if (response.ok) break;
    } catch { /* migration or server startup */ }
    assert.equal(docker("inspect", name, "--format", "{{.State.Running}}"), "true", "LiteLLM exited at startup");
    assert.ok(Date.now() < deadline, "LiteLLM readiness timed out");
    await pause();
  }
  console.log(`Testing Chart image ${container.image}`);
  const version = container.image.match(/:(\d+\.\d+\.\d+)-guard\.\d+$/)?.[1];
  assert.ok(version, "Chart must pin a released Provider image");
  process.stdout.write(run(process.execPath, ["../../node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.ts",
    "server/providers/litellm.integration.test.ts"], { cwd: "apps/control", env: { ...process.env,
      RELAY_LITELLM_TEST_URL: baseUrl, RELAY_LITELLM_TEST_KEY: env.LITELLM_MASTER_KEY,
      RELAY_LITELLM_TEST_VERSION: version, RELAY_LITELLM_TEST_CONTAINER: name } }) + "\n");
} catch (error) {
  failed = true;
  console.error(redact(error.message));
  try { console.error(redact(docker("logs", "--tail", "80", name))); } catch { /* not started */ }
  process.exitCode = 1;
} finally {
  for (const container of [`${name}-wait`, name, database]) {
    try { docker("rm", "-fv", container); } catch { /* absent */ }
  }
  try { docker("network", "rm", name); } catch { if (!failed) process.exitCode = 1; }
  rmSync(directory, { recursive: true, force: true });
}
