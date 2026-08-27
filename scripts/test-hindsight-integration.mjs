#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";

const hindsightImage = "ghcr.io/vectorize-io/hindsight-api:0.9.2-slim@sha256:7635a15739361dbdf221ba796ad25a813f876144fe113022eea8e26cb6ee75e7";
const postgresImage = "pgvector/pgvector:0.8.6-pg17";
const namePrefix = `tali-hindsight-it-${process.pid}`;
const networkName = `${namePrefix}-network`;
const postgresName = `${namePrefix}-postgres`;
const apiName = `${namePrefix}-api`;
const workerName = `${namePrefix}-worker`;
const apiKey = "tali-hindsight-live-integration-key";
const embeddingDimensions = 64;

function docker(args, options = {}) {
  const output = execFileSync("docker", args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  return typeof output === "string" ? output.trim() : "";
}

function removeContainer(name) {
  try {
    docker(["rm", "--force", name]);
  } catch {
    // The integration resource may not have been created yet.
  }
}

function removeNetwork(name) {
  try {
    docker(["network", "rm", name]);
  } catch {
    // The integration resource may not have been created yet.
  }
}

function embeddingFor(value) {
  const digest = createHash("sha256").update(String(value)).digest();
  const vector = Array.from({ length: embeddingDimensions }, (_, index) => {
    const byte = digest[index % digest.length];
    return ((byte ?? 128) - 127.5) / 127.5;
  });
  const magnitude = Math.sqrt(vector.reduce((sum, entry) => sum + entry * entry, 0));
  return vector.map((entry) => entry / magnitude);
}

function spawnAndWait(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${code ?? signal ?? "no status"}.`));
    });
  });
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function startEmbeddingServer() {
  let requestCount = 0;
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "POST" && url.pathname === "/v1/embeddings") {
        requestCount += 1;
        const body = await readJson(request);
        const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          object: "list",
          model: body.model ?? "integration-embedding",
          data: inputs.map((input, index) => ({
            object: "embedding",
            index,
            embedding: embeddingFor(input),
          })),
          usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
        }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/models") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          object: "list",
          data: [{ id: "integration-embedding", object: "model" }],
        }));
        return;
      }
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Not found" } }));
    })().catch((error) => {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: String(error) } }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Embedding fixture did not bind TCP.");
  return { server, port: address.port, get requestCount() { return requestCount; } };
}

async function waitForPostgres(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = docker(["inspect", "--format", "{{.State.Health.Status}}", postgresName]);
    if (state === "healthy") return;
    if (state === "unhealthy") throw new Error("The Hindsight integration PostgreSQL became unhealthy.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the Hindsight integration PostgreSQL.");
}

async function waitForApi(baseUrl, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const state = docker(["inspect", "--format", "{{.State.Status}}", apiName]);
    if (state !== "running") {
      throw new Error(`The Hindsight integration API entered container state ${state}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw lastError ?? new Error("Timed out waiting for the Hindsight integration API.");
}

async function waitForWorker(baseUrl, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const state = docker(["inspect", "--format", "{{.State.Status}}", workerName]);
    if (state !== "running") {
      throw new Error(`The Hindsight integration worker entered container state ${state}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = new Error(`worker health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error("Timed out waiting for the Hindsight integration worker.");
}

let embeddingFixture;
let failed = false;
try {
  docker(["version", "--format", "{{.Server.Version}}"]);
  removeContainer(workerName);
  removeContainer(apiName);
  removeContainer(postgresName);
  removeNetwork(networkName);
  embeddingFixture = await startEmbeddingServer();

  docker(["network", "create", networkName]);
  docker([
    "run", "--detach",
    "--name", postgresName,
    "--network", networkName,
    "--env", "POSTGRES_USER=hindsight",
    "--env", "POSTGRES_PASSWORD=hindsight",
    "--env", "POSTGRES_DB=hindsight",
    "--health-cmd", "pg_isready --username=hindsight --dbname=hindsight",
    "--health-interval", "1s",
    "--health-timeout", "3s",
    "--health-retries", "30",
    postgresImage,
  ]);
  await waitForPostgres();

  const databaseUrl = `postgresql://hindsight:hindsight@${postgresName}:5432/hindsight`;
  docker([
    "run", "--rm",
    "--network", networkName,
    "--user", "1000770000:0",
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,size=268435456",
    "--env", "HOME=/tmp",
    "--env", "PYTHONDONTWRITEBYTECODE=1",
    "--env", `HINDSIGHT_API_DATABASE_URL=${databaseUrl}`,
    "--env", `HINDSIGHT_API_MIGRATION_DATABASE_URL=${databaseUrl}`,
    "--env", "HINDSIGHT_API_DATABASE_SCHEMA=hindsight",
    "--env", "HINDSIGHT_API_EMBEDDINGS_PROVIDER=openai",
    "--env", "HINDSIGHT_API_RERANKER_PROVIDER=rrf",
    "--env", "HINDSIGHT_API_WORKER_ID=tali-hindsight-integration",
    hindsightImage,
    "hindsight-admin", "run-db-migration",
    "--schema", "hindsight",
    "--embedding-dimension", String(embeddingDimensions),
  ], { stdio: "inherit" });
  docker([
    "run", "--detach",
    "--name", apiName,
    "--network", networkName,
    "--user", "1000770000:0",
    "--add-host", "host.docker.internal:host-gateway",
    "--publish", "127.0.0.1::8888",
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,size=268435456",
    "--env", "HOME=/tmp",
    "--env", "PYTHONDONTWRITEBYTECODE=1",
    "--env", "HINDSIGHT_API_PORT=8888",
    "--env", `HINDSIGHT_API_DATABASE_URL=${databaseUrl}`,
    "--env", `HINDSIGHT_API_MIGRATION_DATABASE_URL=${databaseUrl}`,
    "--env", "HINDSIGHT_API_DATABASE_SCHEMA=hindsight",
    "--env", "HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP=false",
    "--env", "HINDSIGHT_API_VECTOR_EXTENSION=pgvector",
    "--env", "HINDSIGHT_API_TEXT_SEARCH_EXTENSION=native",
    "--env", "HINDSIGHT_API_TENANT_EXTENSION=hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
    "--env", `HINDSIGHT_API_TENANT_API_KEY=${apiKey}`,
    "--env", "HINDSIGHT_API_MCP_ENABLED=false",
    "--env", "HINDSIGHT_API_LLM_TRACE_ENABLED=false",
    "--env", "HINDSIGHT_API_LLM_DEBUG_DUMP_4XX=false",
    "--env", "HINDSIGHT_API_LLM_PROVIDER=none",
    "--env", "HINDSIGHT_API_EMBEDDINGS_PROVIDER=openai",
    "--env", `HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL=http://host.docker.internal:${embeddingFixture.port}/v1`,
    "--env", "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY=integration-key",
    "--env", "HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL=integration-embedding",
    "--env", `HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS=${embeddingDimensions}`,
    "--env", "HINDSIGHT_API_RERANKER_PROVIDER=rrf",
    "--env", "HINDSIGHT_API_WORKER_ENABLED=false",
    "--env", "HINDSIGHT_API_WORKER_ID=tali-hindsight-integration",
    hindsightImage,
  ]);

  const portOutput = docker(["port", apiName, "8888/tcp"]);
  const port = portOutput.match(/:(\d+)$/)?.[1];
  if (!port) throw new Error(`Could not resolve the Hindsight API port from ${portOutput}.`);
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForApi(baseUrl);
  await spawnAndWait("docker", [
    "exec", apiName, "python", "-c",
    `import json,urllib.request; request=urllib.request.Request("http://host.docker.internal:${embeddingFixture.port}/v1/embeddings", data=json.dumps({"model":"integration-embedding","input":["preflight"]}).encode(), headers={"Content-Type":"application/json"}); print(urllib.request.urlopen(request, timeout=5).status)`,
  ], { stdio: "inherit" });

  docker([
    "run", "--detach",
    "--name", workerName,
    "--network", networkName,
    "--user", "1000770001:0",
    "--add-host", "host.docker.internal:host-gateway",
    "--publish", "127.0.0.1::8889",
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,size=268435456",
    "--env", "HOME=/tmp",
    "--env", "PYTHONDONTWRITEBYTECODE=1",
    "--env", `HINDSIGHT_API_DATABASE_URL=${databaseUrl}`,
    "--env", `HINDSIGHT_API_MIGRATION_DATABASE_URL=${databaseUrl}`,
    "--env", "HINDSIGHT_API_DATABASE_SCHEMA=hindsight",
    "--env", "HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP=false",
    "--env", "HINDSIGHT_API_VECTOR_EXTENSION=pgvector",
    "--env", "HINDSIGHT_API_TEXT_SEARCH_EXTENSION=native",
    "--env", "HINDSIGHT_API_TENANT_EXTENSION=hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
    "--env", `HINDSIGHT_API_TENANT_API_KEY=${apiKey}`,
    "--env", "HINDSIGHT_API_LLM_TRACE_ENABLED=false",
    "--env", "HINDSIGHT_API_LLM_DEBUG_DUMP_4XX=false",
    "--env", "HINDSIGHT_API_LLM_PROVIDER=none",
    "--env", "HINDSIGHT_API_EMBEDDINGS_PROVIDER=openai",
    "--env", `HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL=http://host.docker.internal:${embeddingFixture.port}/v1`,
    "--env", "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY=integration-key",
    "--env", "HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL=integration-embedding",
    "--env", `HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS=${embeddingDimensions}`,
    "--env", "HINDSIGHT_API_RERANKER_PROVIDER=rrf",
    "--env", "HINDSIGHT_API_WORKER_ID=tali-hindsight-integration-worker",
    "--env", "HINDSIGHT_API_WORKER_HTTP_PORT=8889",
    hindsightImage,
    "hindsight-worker",
  ]);
  const workerPortOutput = docker(["port", workerName, "8889/tcp"]);
  const workerPort = workerPortOutput.match(/:(\d+)$/)?.[1];
  if (!workerPort) {
    throw new Error(`Could not resolve the Hindsight worker port from ${workerPortOutput}.`);
  }
  await waitForWorker(`http://127.0.0.1:${workerPort}`);

  await spawnAndWait(
    "npm",
    ["run", "test:hindsight:live", "--workspace", "@tali/control"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TALI_HINDSIGHT_INTEGRATION_URL: baseUrl,
        TALI_HINDSIGHT_INTEGRATION_API_KEY: apiKey,
      },
      stdio: "inherit",
    },
  );
  if (embeddingFixture.requestCount < 2) {
    throw new Error(`Expected Hindsight to call the embedding endpoint; observed ${embeddingFixture.requestCount} request(s).`);
  }
} catch (error) {
  failed = true;
  try {
    for (const [name, label] of [[apiName, "API"], [workerName, "worker"]]) {
      const logs = spawnSync("docker", ["logs", "--tail", "200", name], {
        encoding: "utf8",
      });
      const output = `${logs.stdout ?? ""}${logs.stderr ?? ""}`.trim();
      if (output) process.stderr.write(`\nHindsight ${label} logs:\n${output}\n`);
    }
  } catch {
    // The API container may not have started.
  }
  console.error(error);
} finally {
  removeContainer(workerName);
  removeContainer(apiName);
  removeContainer(postgresName);
  removeNetwork(networkName);
  if (embeddingFixture) {
    await new Promise((resolve) => embeddingFixture.server.close(resolve));
  }
}

if (failed) process.exitCode = 1;
