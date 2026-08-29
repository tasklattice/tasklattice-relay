#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";

const postgresImage = "pgvector/pgvector:0.8.6-pg17";
const doclingImage = "ghcr.io/docling-project/docling-serve-cpu:v1.29.0";
const prefix = `tali-docling-vector-it-${process.pid}`;
const postgresName = `${prefix}-postgres`;
const doclingName = `${prefix}-docling`;

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
    // The integration container may not have been created yet.
  }
}

function publishedPort(container, target) {
  const output = docker(["port", container, `${target}/tcp`]);
  const port = output.match(/:(\d+)$/)?.[1];
  if (!port) throw new Error(`Could not resolve ${container} port ${target}.`);
  return port;
}

async function waitForPostgres(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = docker(["inspect", "--format", "{{.State.Health.Status}}", postgresName]);
    if (state === "healthy") return;
    if (state === "unhealthy") throw new Error("The pgvector integration database became unhealthy.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the pgvector integration database.");
}

async function waitForDocling(baseUrl, timeoutMs = 10 * 60 * 1_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const state = docker(["inspect", "--format", "{{.State.Status}}", doclingName]);
    if (state !== "running") throw new Error(`Docling entered container state ${state}.`);
    try {
      const response = await fetch(`${baseUrl}/readyz`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = new Error(`Docling readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw lastError ?? new Error("Timed out waiting for Docling.");
}

function spawnAndWait(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal ?? "no status"}.`));
    });
  });
}

let failed = false;
try {
  docker(["version", "--format", "{{.Server.Version}}"]) ;
  removeContainer(doclingName);
  removeContainer(postgresName);
  docker([
    "run", "--detach",
    "--name", postgresName,
    "--publish", "127.0.0.1::5432",
    "--env", "POSTGRES_USER=vector",
    "--env", "POSTGRES_PASSWORD=vector",
    "--env", "POSTGRES_DB=vector",
    "--health-cmd", "pg_isready --username=vector --dbname=vector",
    "--health-interval", "1s",
    "--health-timeout", "3s",
    "--health-retries", "30",
    postgresImage,
  ]);
  docker([
    "run", "--detach",
    "--name", doclingName,
    "--publish", "127.0.0.1::5001",
    "--tmpfs", "/tmp:rw,nosuid,size=1073741824",
    "--env", "UVICORN_HOST=0.0.0.0",
    "--env", "UVICORN_PORT=5001",
    "--env", "UVICORN_WORKERS=1",
    "--env", "DOCLING_DEVICE=cpu",
    "--env", "DOCLING_NUM_THREADS=2",
    "--env", "DOCLING_SERVE_ENG_KIND=local",
    "--env", "DOCLING_SERVE_ENG_LOC_NUM_WORKERS=1",
    "--env", "DOCLING_SERVE_MAX_FILE_SIZE=1048576",
    "--env", "DOCLING_SERVE_MAX_NUM_PAGES=10",
    "--env", "DOCLING_SERVE_MAX_SYNC_WAIT=600",
    "--env", "XDG_CACHE_HOME=/tmp/docling-cache",
    "--env", "HF_HOME=/tmp/docling-cache/huggingface",
    doclingImage,
  ]);

  await waitForPostgres();
  const postgresPort = publishedPort(postgresName, 5432);
  const doclingPort = publishedPort(doclingName, 5001);
  const doclingUrl = `http://127.0.0.1:${doclingPort}`;
  await waitForDocling(doclingUrl);
  await spawnAndWait(
    "npm",
    ["run", "test:docling-vector:live", "--workspace", "@tali/control"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TALI_DOCLING_INTEGRATION_URL: doclingUrl,
        TALI_VECTOR_DATABASE_INTEGRATION_URL:
          `postgresql://vector:vector@127.0.0.1:${postgresPort}/vector`,
      },
      stdio: "inherit",
    },
  );
  console.log("Docling/Embedding/PostgreSQL Vector Database integration passed.");
} catch (error) {
  failed = true;
  for (const [name, label] of [[doclingName, "Docling"], [postgresName, "pgvector"]]) {
    const logs = spawnSync("docker", ["logs", "--tail", "200", name], { encoding: "utf8" });
    const output = `${logs.stdout ?? ""}${logs.stderr ?? ""}`.trim();
    if (output) process.stderr.write(`\n${label} logs:\n${output}\n`);
  }
  console.error(error);
} finally {
  removeContainer(doclingName);
  removeContainer(postgresName);
}

if (failed) process.exitCode = 1;
