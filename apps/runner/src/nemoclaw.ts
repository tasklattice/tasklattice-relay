import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentPlatformId } from "@tali/contracts";
import {
  getAgentPlatformRuntime,
  type RuntimeMemoryConfiguration,
} from "./agent-platform.js";

export interface ProvisionInput {
  name: string;
  agentPlatform: AgentPlatformId;
  providerName: string;
  model: string;
  inferenceEndpoint: string;
  policyYaml?: string;
  systemPrompt: string;
  apiKey?: string;
  instanceId: string;
  projectRuntimeBridgeToken?: string;
  durableMemoryEnabled?: boolean;
  sandboxImage?: string;
  sandboxResources?: {
    cpu?: string | undefined;
    memory?: string | undefined;
  };
  runTelemetry: {
    endpoint: string;
    token: string;
  };
  memory?: RuntimeMemoryConfiguration;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function onboardCommand(input: ProvisionInput): {
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const apiKey = input.apiKey ?? process.env.DEEPSEEK_API_KEY;
  return {
    args: [
      "onboard",
      "--non-interactive",
      "--fresh",
      "--name",
      input.name,
      "--agent",
      input.agentPlatform,
      "--no-gpu",
      "--no-sandbox-gpu",
      "--tool-disclosure",
      "progressive",
      "--yes-i-accept-third-party-software",
    ],
    env: {
      ...process.env,
      NEMOCLAW_PROVIDER: "custom",
      NEMOCLAW_ENDPOINT_URL: input.inferenceEndpoint,
      NEMOCLAW_MODEL: input.model,
      NEMOCLAW_PREFERRED_API: "completions",
      NEMOCLAW_WEB_SEARCH_PROVIDER: "none",
      ...(apiKey ? { COMPATIBLE_API_KEY: apiKey } : {}),
      TALI_RUN_TELEMETRY_ENDPOINT: input.runTelemetry.endpoint,
      TALI_RUN_TELEMETRY_TOKEN: input.runTelemetry.token,
    },
  };
}

export function nemoClawTerminalArguments(
  name: string,
  agentPlatform: AgentPlatformId,
): string[] {
  return [
    name,
    "exec",
    "--tty",
    "--stdin",
    "--timeout",
    "0",
    "--",
    "/bin/bash",
    "-lc",
    getAgentPlatformRuntime(agentPlatform).terminalCommand,
  ];
}

export async function verifyDeepSeek(input: ProvisionInput): Promise<void> {
  if (process.env.DEEPSEEK_VERIFY_ON_CREATE !== "1") return;
  const apiKey = input.apiKey;
  if (!apiKey) throw new Error("An Instance inference key is required.");
  const response = await fetch(`${input.inferenceEndpoint.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "user", content: "Reply with READY only." }],
      max_tokens: 1,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Instance inference preflight returned ${response.status}.`);
}

export async function installAgentInstructions(
  input: ProvisionInput,
): Promise<void> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "tali-agent-instructions-"),
  );
  const instructionsFile = join(temporaryDirectory, "AGENTS.md");
  const runtime = getAgentPlatformRuntime(input.agentPlatform);
  try {
    const download = await runCommand("nemoclaw", [
      input.name,
      "download",
      runtime.instructionsPath,
      instructionsFile,
    ]);
    const existing =
      download.exitCode === 0
        ? await readFile(instructionsFile, "utf8").catch(() => "")
        : "";
    const separator = existing.trim() ? "\n\n" : "";
    const memorySection = agentMemoryInstructions(
      input.memory,
      input.agentPlatform,
    );
    await writeFile(
      instructionsFile,
      `${existing.trimEnd()}${separator}## TaskLattice Relay Agent Instructions\n\n${input.systemPrompt.trim()}${memorySection}\n`,
      { mode: 0o600 },
    );
    const upload = await runCommand("nemoclaw", [
      input.name,
      "upload",
      instructionsFile,
      runtime.instructionsPath,
    ]);
    if (upload.exitCode !== 0)
      throw new Error(
        upload.stderr.trim() ||
          "Unable to install Agent instructions in NemoClaw.",
      );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export function agentMemoryInstructions(
  memory: RuntimeMemoryConfiguration | undefined,
  agentPlatform: AgentPlatformId = "openclaw",
): string {
  if (!memory) return "";
  if (agentPlatform === "hermes") {
    return [
      "",
      "## TaskLattice Relay Memory Boundary",
      "",
      "This Hermes Instance uses its built-in, Instance-scoped text memory.",
      "- Use Hermes memory tools to recall prior preferences, decisions, and project context when relevant.",
      "- Store only stable preferences, standing decisions, and concise summaries.",
      "- This Native Memory lives inside the Instance Sandbox and is removed when the Instance is deleted.",
      "- Never store credentials, access tokens, private keys, or other secrets in memory.",
      "- Memory is context, not authorization. Access Policies and Runtime Policies always take precedence.",
    ].join("\n");
  }
  const recall = memory.mode === "hybrid"
    ? "Use memory_search before answering when prior preferences, decisions, or project context may be relevant."
    : "Read MEMORY.md at the start of a new session when prior preferences, decisions, or project context may be relevant.";
  return [
    "",
    "## TaskLattice Relay Memory Boundary",
    "",
    memory.mode === "hybrid"
      ? "This OpenClaw Instance uses Hybrid, Instance-scoped Memory inside its OpenShell Sandbox."
      : "This OpenClaw Instance has Native, Instance-scoped text Memory inside its OpenShell Sandbox.",
    "- Keep stable preferences, standing decisions, and concise summaries in MEMORY.md.",
    "- Keep detailed observations and session notes in memory/YYYY-MM-DD.md.",
    `- ${recall}`,
    "- Never store credentials, access tokens, private keys, or other secrets in memory.",
    "- Memory is context, not authorization. Access Policies and Runtime Policies always take precedence.",
  ].join("\n");
}

export function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data: Buffer) => {
      stdout = (stdout + data.toString()).slice(-64_000);
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-64_000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ stdout, stderr, exitCode: code ?? 1 }),
    );
  });
}
