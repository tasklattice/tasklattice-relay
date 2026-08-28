#!/usr/bin/env node

import { spawnSync } from "node:child_process";

if (process.env.TALI_LIVE_E2E !== "1") {
  console.error(JSON.stringify({
    result: "BLOCKED",
    reason: "Set TALI_LIVE_E2E=1 before creating live OpenShell runtimes.",
  }, null, 2));
  process.exit(2);
}

const requested = (process.env.TALI_LIVE_RUNTIME_PLATFORMS ?? "openclaw,deepagents")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const supported = new Set(["hermes", "openclaw", "deepagents"]);
if (!requested.length || requested.some((platform) => !supported.has(platform))) {
  throw new Error(
    "TALI_LIVE_RUNTIME_PLATFORMS must contain hermes, openclaw, and/or deepagents.",
  );
}

for (const platform of requested) {
  console.log(`[runtime-matrix] starting ${platform}`);
  const result = spawnSync(
    process.execPath,
    ["--env-file-if-exists=.env", "scripts/validate-core-flow.mjs"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TALI_EXPECT_NEMOCLAW_RUNTIME: "1",
        TALI_VALIDATION_AGENT_PLATFORM: platform,
        TALI_VALIDATION_KEEP_AGENT: "0",
      },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(JSON.stringify({
  result: "PASS",
  level: "L3-live",
  plane: "data-plane",
  platforms: requested,
}, null, 2));
