#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const name = `tali-openshell-pg-test-${process.pid}`;
const run = (command, args, options = {}) => execFileSync(command, args,
  { encoding: "utf8", timeout: 120_000, ...options });
try {
  run("docker", ["run", "-d", "--name", name, "-p", "127.0.0.1::5432",
    "-e", "POSTGRES_PASSWORD=integration-only", "-e", "POSTGRES_DB=openshell_provisioning_test",
    "pgvector/pgvector:0.8.6-pg17"]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      run("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { stdio: "ignore" });
      ready = true;
      break;
    } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  const port = run("docker", ["port", name, "5432/tcp"]).trim().split(":").at(-1);
  run("npx", ["vitest", "run", "--config", "vitest.config.ts", "server/kubernetes/project-openshell-database.postgres.test.ts"],
    { cwd: "apps/control", stdio: "inherit", env: { ...process.env,
      TALI_OPENSHELL_TEST_DATABASE_URL: `postgresql://postgres:integration-only@127.0.0.1:${port}/openshell_provisioning_test` } });
} finally {
  try { run("docker", ["rm", "-fv", name], { stdio: "ignore" }); } catch { /* absent */ }
}
