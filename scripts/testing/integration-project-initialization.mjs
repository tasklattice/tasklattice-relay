#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
const name = `tali-project-init-${process.pid}`;
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", timeout: 120000, ...options });
try {
  run("docker", ["run", "-d", "--name", name, "-p", "127.0.0.1::5432",
    "-e", "POSTGRES_PASSWORD=integration-only", "-e", "POSTGRES_DB=tali",
    "pgvector/pgvector:0.8.6-pg17"]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { run("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { stdio: "ignore" }); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  const migrationRoot = "apps/control/prisma/migrations";
  for (const entry of readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    run("docker", ["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "tali"],
      { input: readFileSync(`${migrationRoot}/${entry.name}/migration.sql`, "utf8"), stdio: ["pipe", "ignore", "pipe"] });
  }
  const port = run("docker", ["port", name, "5432/tcp"]).trim().split(":").at(-1);
  const url = `postgresql://postgres:integration-only@127.0.0.1:${port}/tali`;
  process.stdout.write(run("npx", ["vitest", "run", "--config", "vitest.config.ts", "server/projects/project-initialization.postgres.test.ts"],
    { cwd: "apps/control", env: { ...process.env, ASYNC_PROJECT_DATABASE_URL: url } }));
} finally {
  try { run("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch { /* absent */ }
}
