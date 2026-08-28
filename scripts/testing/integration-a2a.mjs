#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

const agentId = "a2a-pull-request-risk-scanner";
const marker = `A2A-INTEGRATION-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const output = [];
const server = spawn(
  process.execPath,
  ["apps/example-mcp-server/dist/index.js", "a2a", agentId],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      TALI_A2A_BASE_URL: baseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (chunk) => output.push(chunk.toString()));
server.stderr.on("data", (chunk) => output.push(chunk.toString()));

try {
  await waitForHealth();
  const python = execFileSync("python3", ["-"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, TALI_A2A_INTEGRATION_URL: baseUrl, TALI_A2A_MARKER: marker },
    input: `
import importlib.util
import json
import os
import sys
from pathlib import Path

path = Path("runtime-integrations/hermes-a2a-plugin/client.py").resolve()
spec = importlib.util.spec_from_file_location("tali_hermes_a2a_client", path)
client = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = client
spec.loader.exec_module(client)

base_url = os.environ["TALI_A2A_INTEGRATION_URL"]
marker = os.environ["TALI_A2A_MARKER"]
peer = client.parse_peer("risk-scanner", {
    "url": base_url,
    "card_url": base_url + "/.well-known/agent-card.json",
    "timeout": 10,
    "capabilities": ["scan-pull-request-risk"],
})
card = client.discover_agent(peer)
result = client.send_message(peer, "Assess this deterministic change: " + marker)
assert card["name"] == "Pull Request Risk Scanner"
assert card["supportedInterfaces"][0]["protocolBinding"] == "JSONRPC"
assert "Risk: Medium" in result["text"]
assert marker in result["text"]
print(json.dumps({
    "agent": card["name"],
    "binding": card["supportedInterfaces"][0]["protocolBinding"],
    "marker": marker,
    "response": result["text"].splitlines()[0],
}))
`,
  }).trim();
  const evidence = JSON.parse(python);
  console.log(JSON.stringify({
    result: "PASS",
    level: "L2-integration",
    module: "a2a",
    evidence,
  }, null, 2));
} catch (error) {
  const diagnostics = output.join("").trim();
  if (diagnostics) process.stderr.write(`A2A server logs:\n${diagnostics}\n`);
  throw error;
} finally {
  server.kill("SIGTERM");
  if (server.exitCode === null) {
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function reservePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const selected = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  if (!selected) throw new Error("Unable to reserve a local A2A integration port.");
  return selected;
}

async function waitForHealth(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`A2A server exited with ${server.exitCode}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
      lastError = new Error(`A2A health returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError ?? new Error("Timed out waiting for the A2A integration server.");
}
