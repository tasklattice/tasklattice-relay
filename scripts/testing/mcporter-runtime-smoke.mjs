#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const graph = resolve(process.argv[2] ?? "infra/npm/mcporter-runtime");
const load = path => import(pathToFileURL(join(graph, "node_modules", path)).href);
const { McpServer } = await load("@modelcontextprotocol/sdk/dist/esm/server/mcp.js");
const { StreamableHTTPServerTransport } = await load("@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js");
const { z } = await load("zod/index.js");
const execute = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "relay-mcporter-smoke-"));
const calls = [];
const marker = randomUUID();
const http = createServer(async (request, response) => {
  const server = new McpServer({ name: "relay-mcporter-acceptance", version: "1.0.0" });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  server.registerTool("echo", { inputSchema: { message: z.string() } }, async ({ message }) => {
    calls.push(message);
    return { content: [{ type: "text", text: message }] };
  });
  response.on("close", () => { void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});
try {
  await new Promise((ready, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", ready);
  });
  const { stdout: version } = await execute(process.execPath, [join(graph, "node_modules/mcporter/dist/cli.js"), "--version"], { cwd: directory });
  assert.equal(version.trim(), "0.7.3");
  const { stdout } = await execute(process.execPath, [
    join(graph, "node_modules/mcporter/dist/cli.js"), "call",
    "--http-url", `http://127.0.0.1:${http.address().port}/mcp`, "--allow-http",
    "--tool", "echo", "--args", JSON.stringify({ message: marker }), "--output", "json",
  ], { cwd: directory, timeout: 30000 });
  assert(stdout.includes(marker), stdout);
  assert.deepEqual(calls, [marker]);
  console.log("PASS: mcporter 0.7.3 discovers and invokes a real MCP HTTP tool with the patched SDK.");
} finally {
  http.closeAllConnections();
  await new Promise(resolve => http.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
