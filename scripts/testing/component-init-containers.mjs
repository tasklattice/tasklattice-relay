#!/usr/bin/env node
// Real initialization against a disposable database; no Kubernetes access.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";

const run = (command, args, options = {}) => execFileSync(command, args,
  { encoding: "utf8", timeout: 300000, ...options });
const directory = mkdtempSync(join(tmpdir(), "relay-init-"));
chmodSync(directory, 0o755);
const name = `relay-init-${process.pid}`;
try {
  const password = "test-'\\${UNCHANGED}-pass +";
  writeFileSync(join(directory, "values.json"), JSON.stringify({ secrets: {
    hindsightDatabasePassword: password, postgresPassword: password,
  } }));
  const objects = parseAllDocuments(run("helm", ["template", "init-test", "charts/tali-relay",
    "--kube-version", "1.29.0", "-f", join(directory, "values.json")])).map((doc) => doc.toJSON());
  const pod = (component) => objects.find((o) => o.spec?.template
    && o.metadata?.labels?.["app.kubernetes.io/component"] === component).spec.template.spec;
  const migration = pod("hindsight-migration");
  const bootstrap = migration.initContainers[0];
  assert.equal(bootstrap.image, migration.containers[0].image);
  const secret = objects.find((o) => o.stringData?.["hindsight-config.json"]);
  const config = JSON.parse(secret.stringData["hindsight-config.json"]);
  const url = new URL(config.common.HINDSIGHT_API_DATABASE_URL);
  assert.equal(decodeURIComponent(url.password), password);
  url.hostname = "database";
  config.common.HINDSIGHT_API_DATABASE_URL = url.toString();
  config.common.HINDSIGHT_API_MIGRATION_DATABASE_URL = url.toString();
  for (const folder of ["config", "launcher", "postgres"]) mkdirSync(join(directory, folder));
  writeFileSync(join(directory, "config/config.json"), JSON.stringify(config));
  const adminUrl = new URL(objects.find((o) => o.stringData?.["admin-url"]).stringData["admin-url"]);
  assert.equal(decodeURIComponent(adminUrl.password), password);
  adminUrl.hostname = "database";
  writeFileSync(join(directory, "postgres/admin-url"), adminUrl.toString());
  const launcher = objects.find((o) => o.data?.["bootstrap.py"]).data;
  for (const [key, value] of Object.entries(launcher)) writeFileSync(join(directory, "launcher", key), value);
  run("docker", ["network", "create", "--internal", name]);
  run("docker", ["run", "-d", "--name", name, "--network", name, "--network-alias", "database",
    "-e", "POSTGRES_USER=litellm", "-e", `POSTGRES_PASSWORD=${password}`, pod("postgresql").containers[0].image]);
  const provider = (command, input) => run("docker", ["run", "--rm", "-i", "--network", name,
    "--user", "1000:1000", "--read-only", "--tmpfs", "/tmp",
    "-v", `${directory}/config:/etc/hindsight:ro`,
    "-v", `${directory}/launcher:/etc/hindsight-launcher:ro`,
    "-v", `${directory}/postgres:/etc/postgresql:ro`,
    "--entrypoint", command[0], bootstrap.image, ...command.slice(1)], { input });
  for (let index = 0; index < 2; index++) {
    process.stdout.write(provider(bootstrap.command));
    provider(migration.containers[0].command);
  }
  process.stdout.write(provider(["python", "-"], `
import asyncio, json
import asyncpg
async def check():
    config = json.load(open('/etc/hindsight/config.json'))
    connection = await asyncpg.connect(config['common']['HINDSIGHT_API_DATABASE_URL'])
    extensions = await connection.fetch('SELECT extname FROM pg_extension')
    assert {'vector', 'pg_trgm'}.issubset({row['extname'] for row in extensions})
    schema = config['migration']['schema']
    assert await connection.fetchval('SELECT count(*) FROM information_schema.tables WHERE table_schema=$1', schema) > 0
    assert await connection.fetchval('SELECT pg_get_userbyid(nspowner) = current_user FROM pg_namespace WHERE nspname=$1', schema)
    await connection.close()
asyncio.run(check())
print('Hindsight: bootstrap and real migrations passed twice; escaped password, extensions and schema owner verified')
`));
  const lite = pod("litellm");
  const wait = lite.initContainers.find((c) => c.name === "wait-for-postgresql");
  assert.equal(wait.image, lite.containers[0].image);
  process.stdout.write(run("docker", ["run", "--rm", "--network", name,
    "--user", "65532:65532", "--read-only", "--tmpfs", "/tmp",
    "-e", `DATABASE_URL=${adminUrl}`,
    "--entrypoint", wait.command[0], process.env.LITELLM_TEST_IMAGE ?? wait.image,
    ...wait.command.slice(1), ...(wait.args ?? [])]));
} finally {
  try { run("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch { /* not created */ }
  try { run("docker", ["network", "rm", name], { stdio: "ignore" }); } catch { /* not created */ }
  rmSync(directory, { recursive: true, force: true });
}
