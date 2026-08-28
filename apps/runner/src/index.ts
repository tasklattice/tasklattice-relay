import express from "express";
import {
  agentPlatformIds,
  defaultAgentPlatformId,
  mapAgentPlatforms,
  parseTerminalClientMessage,
  type AgentPlatformId,
  type ProvisioningStage,
  type RunnerSandbox,
} from "@tali/contracts";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { getAgentPlatformRuntime } from "./agent-platform.js";
import {
  installAgentInstructions,
  nemoClawTerminalArguments,
  onboardCommand,
  runCommand,
  verifyDeepSeek,
  type ProvisionInput,
} from "./nemoclaw.js";
import {
  deleteOpenShellSandbox,
  deleteOpenShellProvider,
  deleteOpenShellWebUiEndpoint,
  ensureOpenShellWebUiEndpoint,
  getOpenShellAuditEvents,
  observeOpenShellSandbox,
  openShellArguments,
  openShellBinary,
  openShellGatewayEndpoint,
  openShellKubernetesServiceCidrs,
  openShellServiceBaseUrl,
  openShellTerminalArguments,
  openShellWorkspace,
  issueOpenShellWebUiEndpoint,
  provisionOpenShellSandbox,
  type OpenShellTarget,
} from "./openshell.js";
import {
  projectTargetRoutingEnabled,
  resolveOpenShellTarget,
  runnerRuntimeTargetSchema,
  sandboxStateKey,
  type RunnerRuntimeTarget,
} from "./runtime-target.js";
import {
  projectServiceProxyEnabled,
  startProjectServiceProxy,
} from "./project-service-proxy.js";

type Phase = RunnerSandbox["phase"];
type SandboxState = RunnerSandbox;

const app = express();
const server = createServer(app);
const sockets = new WebSocketServer({ noServer: true });
const port = Number(process.env.PORT ?? 9090);
const host = process.env.HOST ?? "127.0.0.1";
const token = process.env.NEMOCLAW_RUNNER_TOKEN ?? "local-dev-token";
const mode = process.env.NEMOCLAW_RUNNER_MODE ?? "nemoclaw";
const isOpenShell = mode === "openshell-kubernetes";
const states = new Map<string, SandboxState>();
const activeProvisions = new Set<string>();
const provisionTasks = new Map<string, Promise<void>>();
const shutdownTimeoutMs = Number(
  process.env.NEMOCLAW_RUNNER_SHUTDOWN_TIMEOUT_MS ?? "540000",
);
let shuttingDown = false;
const agentPlatformSchema = z.enum(agentPlatformIds);
const runtimeMemorySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("native"),
    citations: z.enum(["auto", "on", "off"]),
  }).strict(),
  z.object({
    mode: z.literal("hybrid"),
    embeddingModel: z.string().min(1).max(240),
    includeSessionTranscripts: z.boolean(),
    citations: z.enum(["auto", "on", "off"]),
    maxResults: z.number().int().min(1).max(20),
    minScore: z.number().min(0).max(1),
  }).strict(),
]);
const createSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/),
  agentPlatform: agentPlatformSchema.default(defaultAgentPlatformId),
  providerName: z.string().min(1).max(80),
  model: z.string().min(1).max(200),
  inferenceEndpoint: z.string().url(),
  systemPrompt: z.string().min(10).max(8000),
  policyYaml: z.string().min(10).max(64_000),
  apiKey: z.string().min(16).max(512).optional(),
  instanceId: z.string().uuid(),
  projectRuntimeBridgeToken: z.string()
    .regex(/^tali_prc_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .max(2_048)
    .optional(),
  durableMemoryEnabled: z.boolean().optional(),
  sandboxImage: z.string().trim().min(3).max(500).regex(/^\S+$/).optional(),
  sandboxResources: z.object({
    cpu: z.string().trim().min(1).max(32).regex(
      /^(?:[1-9]\d*m|[1-9]\d*(?:\.\d+)?|0\.\d+)$/,
    ).optional(),
    memory: z.string().trim().min(1).max(32).regex(
      /^[1-9]\d*(?:\.\d+)?(?:Ki|Mi|Gi|Ti|K|M|G|T)?$/,
    ).optional(),
  }).strict().optional(),
  runTelemetry: z.object({
    endpoint: z.string().url(),
    token: z.string().min(32).max(2_048),
  }).strict(),
  memory: runtimeMemorySchema.optional(),
  runtimeTarget: runnerRuntimeTargetSchema.optional(),
});

function authorized(header: string | undefined): boolean {
  return header === `Bearer ${token}`;
}
function responseState(state: SandboxState): SandboxState {
  return state;
}

function updateProvisioningStage(
  state: SandboxState,
  stage: ProvisioningStage,
  message?: string,
): void {
  state.provisioningStage = stage;
  if (message && state.logs.at(-1) !== message) state.logs.push(message);
}

function rejectTerminalUpgrade(
  socket: Duplex,
  status: number,
  message: string,
): void {
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Conflict"}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

async function readySandboxState(
  name: string,
  agentPlatform: AgentPlatformId,
  runtimeTarget?: RunnerRuntimeTarget,
): Promise<SandboxState | undefined> {
  const key = sandboxStateKey(name, runtimeTarget);
  const local = states.get(key);
  if (local?.phase === "READY") return local;
  if (!isOpenShell) return undefined;

  const observed = await observeOpenShellSandbox(
    name,
    resolveOpenShellTarget(runtimeTarget),
  );
  if (observed?.phase.toLowerCase() !== "ready") return undefined;
  const recovered: SandboxState = {
    name,
    agentPlatform,
    phase: "READY",
    provisioningStage: "READY",
    logs: local?.logs ?? [],
  };
  states.set(key, recovered);
  return recovered;
}

async function provision(
  input: ProvisionInput,
  operationId: string,
  runtimeTarget?: RunnerRuntimeTarget,
): Promise<void> {
  const key = sandboxStateKey(input.name, runtimeTarget);
  const openShellTarget = isOpenShell
    ? resolveOpenShellTarget(runtimeTarget)
    : undefined;
  activeProvisions.add(key);
  const state = states.get(key);
  if (!state) {
    activeProvisions.delete(key);
    return;
  }
  try {
    let httpEndpoint: RunnerSandbox["httpEndpoint"];
    const platformRuntime = getAgentPlatformRuntime(input.agentPlatform);
    if (process.env.DEEPSEEK_VERIFY_ON_CREATE === "1") {
      await verifyDeepSeek(input);
      state.logs.push("DeepSeek provider preflight succeeded through AI SDK.");
    }
    if (mode === "fixture") {
      const fixtureStages: ReadonlyArray<[ProvisioningStage, string]> = [
        ["PROVIDER", "Fixture provider configuration accepted."],
        ["SANDBOX", "Fixture Sandbox policy applied."],
        ["POD", "Fixture Kubernetes Pod created and initializing."],
        ["RUNTIME", "Fixture NemoClaw services starting inside the Pod."],
        [
          "ENDPOINT",
          platformRuntime.endpointKind
            ? "Fixture Web UI endpoint publishing."
            : "Fixture terminal-only interaction surface confirmed.",
        ],
      ];
      const fixtureDelayMs = Number(
        process.env.NEMOCLAW_FIXTURE_PROVISION_DELAY_MS ?? "350",
      );
      for (const [stage, message] of fixtureStages) {
        updateProvisioningStage(state, stage, message);
        await new Promise((resolve) =>
          setTimeout(resolve, fixtureDelayMs / fixtureStages.length),
        );
      }
      state.logs.push(
        "Fixture host accepted the typed NemoClaw provisioning request.",
        "Sandbox phase: Ready",
      );
    } else if (isOpenShell) {
      await provisionOpenShellSandbox(input, openShellTarget, {
        onStage: (stage, message) => updateProvisioningStage(state, stage, message),
        onLog: (lines) => state.logs.push(...lines),
      });
      updateProvisioningStage(state, "RUNTIME", "Initializing NemoClaw services inside the Pod.");
      state.logs.push(...platformRuntime.startupLogs);
      if (platformRuntime.endpointKind) {
        try {
          updateProvisioningStage(
            state,
            "ENDPOINT",
            `Publishing the ${input.agentPlatform} browser endpoint.`,
          );
          httpEndpoint = {
            kind: platformRuntime.endpointKind,
            status: "READY",
            url: await ensureOpenShellWebUiEndpoint(
              input.name,
              input.agentPlatform,
              openShellTarget,
            ),
          };
          state.logs.push(
            `${input.agentPlatform} browser endpoint exposed through OpenShell service routing.`,
          );
        } catch (error) {
          httpEndpoint = {
            kind: platformRuntime.endpointKind,
            status: "UNAVAILABLE",
            reason:
              error instanceof Error
                ? error.message
                : `Unable to expose the ${input.agentPlatform} browser endpoint.`,
          };
          state.logs.push(
            `${input.agentPlatform} Web UI unavailable: ${httpEndpoint.reason}`,
          );
        }
      } else {
        updateProvisioningStage(
          state,
          "ENDPOINT",
          `${input.agentPlatform} is terminal-only; no browser endpoint is published.`,
        );
      }
    } else {
      updateProvisioningStage(state, "RUNTIME", "Starting NemoClaw non-interactive onboarding.");
      const command = onboardCommand(input);
      const result = await runCommand("nemoclaw", command.args, command.env);
      state.logs.push(...result.stdout.split("\n").filter(Boolean).slice(-100));
      if (result.exitCode !== 0)
        throw new Error(
          result.stderr.trim() || `nemoclaw exited ${result.exitCode}`,
        );
      await installAgentInstructions(input);
      state.logs.push(
        `Agent instructions installed for ${input.agentPlatform}.`,
      );
    }
    states.set(key, {
      ...state,
      phase: "READY",
      provisioningStage: "READY",
      operationId,
      ...(httpEndpoint ? { httpEndpoint } : {}),
    });
  } catch (error) {
    states.set(key, {
      ...state,
      phase: "FAILED",
      operationId,
      error: error instanceof Error ? error.message : "Provisioning failed.",
    });
  } finally {
    activeProvisions.delete(key);
  }
}

function runtimeTargetFromQuery(value: unknown): RunnerRuntimeTarget | undefined {
  if (value === undefined) {
    if (projectTargetRoutingEnabled()) {
      throw new Error("A Project Runtime Target is required for this operation.");
    }
    return undefined;
  }
  return runnerRuntimeTargetSchema.parse({ namespace: value });
}

app.use(express.json({ limit: "32kb" }));
app.get("/health", (_request, response) => response.json({
  ok: true,
  mode,
  runtimeImages: mapAgentPlatforms(
    (platform) => getAgentPlatformRuntime(platform.id).sandboxImage(),
  ),
  ...(isOpenShell
    ? {
        sandbox: {
          provider: "openshell",
          cpu: process.env.OPENSHELL_SANDBOX_CPU ?? "1",
          memory: process.env.OPENSHELL_SANDBOX_MEMORY ?? "2Gi",
          ...(projectTargetRoutingEnabled()
            ? {
                gatewayEndpoint: "project-runtime-target",
                workspace: "project-runtime-target",
              }
            : {
                gatewayEndpoint: openShellGatewayEndpoint(),
                workspace: openShellWorkspace(),
              }),
          serviceBaseUrl: openShellServiceBaseUrl(),
          kubernetesServiceCidrs: openShellKubernetesServiceCidrs(),
          projectTargetRouting: projectTargetRoutingEnabled(),
          projectServiceProxy: projectServiceProxyEnabled(),
          ...(process.env.OPENSHELL_GATEWAY_IMAGE
            ? { gatewayImage: process.env.OPENSHELL_GATEWAY_IMAGE }
            : {}),
          ...(process.env.OPENSHELL_SUPERVISOR_IMAGE
            ? { supervisorImage: process.env.OPENSHELL_SUPERVISOR_IMAGE }
            : {}),
          ...(process.env.OPENSHELL_DEFAULT_SANDBOX_IMAGE
            ? { defaultImage: process.env.OPENSHELL_DEFAULT_SANDBOX_IMAGE }
            : {}),
          ...(process.env.OPENSHELL_DEFAULT_SANDBOX_IMAGE_PULL_POLICY
            ? {
                defaultImagePullPolicy:
                  process.env.OPENSHELL_DEFAULT_SANDBOX_IMAGE_PULL_POLICY,
              }
            : {}),
          ...(process.env.OPENSHELL_TLS_DISABLED
            ? { tlsDisabled: process.env.OPENSHELL_TLS_DISABLED === "true" }
            : {}),
        },
      }
    : {}),
}));
app.use((request, response, next) =>
  authorized(request.headers.authorization)
    ? next()
    : response.status(401).json({ error: "Unauthorized." }),
);

app.post("/v1/sandboxes", (request, response, next) => {
  try {
    if (shuttingDown)
      return void response
        .status(503)
        .json({ error: "Runtime Runner is draining for shutdown." });
    const parsedInput = createSchema.parse(request.body);
    const runtimeTarget = parsedInput.runtimeTarget;
    if (isOpenShell) resolveOpenShellTarget(runtimeTarget);
    const input: ProvisionInput = {
      name: parsedInput.name,
      agentPlatform: parsedInput.agentPlatform,
      providerName: parsedInput.providerName,
      model: parsedInput.model,
      inferenceEndpoint: parsedInput.inferenceEndpoint,
      systemPrompt: parsedInput.systemPrompt,
      policyYaml: parsedInput.policyYaml,
      ...(parsedInput.apiKey ? { apiKey: parsedInput.apiKey } : {}),
      ...(parsedInput.projectRuntimeBridgeToken
        ? { projectRuntimeBridgeToken: parsedInput.projectRuntimeBridgeToken }
        : {}),
      ...(parsedInput.durableMemoryEnabled !== undefined
        ? { durableMemoryEnabled: parsedInput.durableMemoryEnabled }
        : {}),
      ...(parsedInput.sandboxImage
        ? { sandboxImage: parsedInput.sandboxImage }
        : {}),
      ...(parsedInput.sandboxResources
        ? { sandboxResources: parsedInput.sandboxResources }
        : {}),
      ...(parsedInput.memory ? { memory: parsedInput.memory } : {}),
      instanceId: parsedInput.instanceId,
      runTelemetry: parsedInput.runTelemetry,
    };
    const key = sandboxStateKey(input.name, runtimeTarget);
    if (states.has(key))
      return void response
        .status(409)
        .json({ error: "Sandbox already exists." });
    const operationId = crypto.randomUUID();
    const state: SandboxState = {
      name: input.name,
      agentPlatform: input.agentPlatform,
      phase: "PROVISIONING",
      provisioningStage: "QUEUED",
      operationId,
      logs: ["NemoClaw provisioning queued."],
    };
    states.set(key, state);
    const task = provision(input, operationId, runtimeTarget).finally(() => {
      provisionTasks.delete(key);
    });
    provisionTasks.set(key, task);
    response.status(202).json(responseState(state));
  } catch (error) {
    next(error);
  }
});

app.get("/v1/sandboxes/:name/interaction", async (request, response, next) => {
  try {
    const name = z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/)
      .parse(request.params.name);
    const agentPlatform = agentPlatformSchema.parse(
      request.query.agentPlatform ?? defaultAgentPlatformId,
    );
    const subject = z.string().min(1).max(200).parse(request.query.subject);
    const runtimeTarget = runtimeTargetFromQuery(request.query.runtimeTarget);
    const openShellTarget = isOpenShell
      ? resolveOpenShellTarget(runtimeTarget)
      : undefined;
    const state = await readySandboxState(name, agentPlatform, runtimeTarget);
    if (!state)
      return void response.status(409).json({
        error: "Web UI access is available only when the Sandbox is ready.",
      });
    const platformRuntime = getAgentPlatformRuntime(agentPlatform);
    if (!platformRuntime.endpointKind)
      return void response.status(409).json({
        error:
          `${agentPlatform} is a terminal-only Agent and does not publish a Web UI endpoint.`,
      });
    if (!isOpenShell) {
      const httpEndpoint = state.httpEndpoint;
      return void response.json(
        httpEndpoint ?? {
          kind: platformRuntime.endpointKind,
          status: "UNAVAILABLE",
          reason: "The active runtime does not publish a Web UI endpoint.",
        },
      );
    }
    response.setHeader("cache-control", "no-store");
    try {
      response.json({
        kind: platformRuntime.endpointKind,
        status: "READY",
        url: await issueOpenShellWebUiEndpoint(
          name,
          agentPlatform,
          subject,
          openShellTarget,
        ),
      });
    } catch (error) {
      response.json({
        kind: platformRuntime.endpointKind,
        status: "UNAVAILABLE",
        reason:
          error instanceof Error
            ? error.message
            : `Unable to issue ${agentPlatform} Web UI access.`,
      });
    }
  } catch (error) {
    next(error);
  }
});

app.get("/v1/sandboxes/:name", async (request, response, next) => {
  try {
    const name = z.string().parse(request.params.name);
    const agentPlatform = agentPlatformSchema.parse(
      request.query.agentPlatform ?? defaultAgentPlatformId,
    );
    const runtimeTarget = runtimeTargetFromQuery(request.query.runtimeTarget);
    const key = sandboxStateKey(name, runtimeTarget);
    const openShellTarget = isOpenShell
      ? resolveOpenShellTarget(runtimeTarget)
      : undefined;
    const local = states.get(key);
    if (
      local?.phase === "FAILED" ||
      mode === "fixture" ||
      activeProvisions.has(key)
    )
      return void response.json(
        local ?? { name, agentPlatform, phase: "NOT_FOUND", logs: [] },
      );
    if (isOpenShell) {
      const observed = await observeOpenShellSandbox(name, openShellTarget);
      const normalized = observed?.phase.toLowerCase();
      const phase: Phase = !observed
        ? "NOT_FOUND"
        : normalized === "ready"
          ? "READY"
          : normalized === "failed" || normalized === "error"
            ? "FAILED"
            : "PROVISIONING";
      let httpEndpoint = local?.httpEndpoint;
      const platformRuntime = getAgentPlatformRuntime(agentPlatform);
      if (
        phase === "READY" &&
        platformRuntime.endpointKind &&
        httpEndpoint?.status !== "READY"
      ) {
        try {
          httpEndpoint = {
            kind: platformRuntime.endpointKind,
            status: "READY",
            url: await ensureOpenShellWebUiEndpoint(
              name,
              agentPlatform,
              openShellTarget,
            ),
          };
        } catch (error) {
          httpEndpoint = {
            kind: platformRuntime.endpointKind,
            status: "UNAVAILABLE",
            reason:
              error instanceof Error
                ? error.message
                : `Unable to expose the ${agentPlatform} browser endpoint.`,
          };
        }
      }
      const next: SandboxState = {
        name,
        agentPlatform,
        phase,
        ...(phase === "READY"
          ? { provisioningStage: "READY" as const }
          : local?.provisioningStage
            ? { provisioningStage: local.provisioningStage }
            : phase === "PROVISIONING"
              ? { provisioningStage: "POD" as const }
              : {}),
        ...(local?.operationId ? { operationId: local.operationId } : {}),
        logs: local?.logs ?? [],
        ...(httpEndpoint ? { httpEndpoint } : {}),
      };
      if (phase === "NOT_FOUND") states.delete(key);
      else states.set(key, next);
      return void response.json(next);
    }
    const result = await runCommand("nemoclaw", [
      "sandbox",
      "status",
      name,
      "--json",
    ]);
    if (result.exitCode !== 0 && !result.stdout)
      return void response.json({
        name,
        agentPlatform,
        phase: "FAILED",
        logs: [],
        error: result.stderr.trim(),
      });
    const payload = JSON.parse(result.stdout) as {
      found?: boolean;
      phase?: string;
    };
    const observedPhase = payload.phase?.toLowerCase();
    const phase: Phase =
      payload.found === false
        ? "NOT_FOUND"
        : observedPhase === "ready"
          ? "READY"
          : observedPhase === "failed" || observedPhase === "error"
            ? "FAILED"
            : "PROVISIONING";
    response.json({ name, agentPlatform, phase, logs: local?.logs ?? [] });
  } catch (error) {
    next(error);
  }
});

app.get("/v1/sandboxes/:name/audit", async (request, response, next) => {
  try {
    const name = z.string().parse(request.params.name);
    const runtimeTarget = runtimeTargetFromQuery(request.query.runtimeTarget);
    if (!isOpenShell) return void response.json({ data: [] });
    response.json({
      data: await getOpenShellAuditEvents(
        name,
        resolveOpenShellTarget(runtimeTarget),
      ),
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/v1/sandboxes/:name", async (request, response, next) => {
  try {
    const name = z.string().parse(request.params.name);
    const agentPlatform = agentPlatformSchema.parse(
      request.query.agentPlatform ?? defaultAgentPlatformId,
    );
    const runtimeTarget = runtimeTargetFromQuery(request.query.runtimeTarget);
    const key = sandboxStateKey(name, runtimeTarget);
    const openShellTarget = isOpenShell
      ? resolveOpenShellTarget(runtimeTarget)
      : undefined;
    const current = states.get(key) ?? {
      name,
      agentPlatform,
      phase: "DESTROYING" as const,
      logs: [],
    };
    states.set(key, { ...current, phase: "DESTROYING" });
    if (isOpenShell) {
      if (getAgentPlatformRuntime(agentPlatform).endpointKind)
        await deleteOpenShellWebUiEndpoint(name, openShellTarget);
      await deleteOpenShellSandbox(name, openShellTarget);
      await deleteOpenShellProvider(name, openShellTarget);
    } else if (mode !== "fixture") {
      const result = await runCommand("nemoclaw", [name, "destroy", "--yes"]);
      if (result.exitCode !== 0)
        throw new Error(result.stderr.trim() || "NemoClaw destroy failed.");
    }
    states.delete(key);
    response.status(202).json({
      name,
      agentPlatform,
      phase: "NOT_FOUND",
      logs: [...current.logs, "Sandbox destroyed."],
    });
  } catch (error) {
    next(error);
  }
});

server.on("upgrade", async (request, socket, head) => {
  if (!authorized(request.headers.authorization))
    return void rejectTerminalUpgrade(socket, 401, "Unauthorized.");
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  const match = url.pathname.match(/^\/v1\/sandboxes\/([a-z0-9-]+)\/terminal$/);
  if (!match)
    return void rejectTerminalUpgrade(socket, 409, "Unknown terminal path.");
  const sandboxName = match[1] ?? "";
  const parsedAgentPlatform = agentPlatformSchema.safeParse(
    url.searchParams.get("agentPlatform") ?? defaultAgentPlatformId,
  );
  if (!parsedAgentPlatform.success)
    return void rejectTerminalUpgrade(socket, 409, "Unknown Agent platform.");
  const agentPlatform = parsedAgentPlatform.data;
  let runtimeTarget: RunnerRuntimeTarget | undefined;
  let openShellTarget: ReturnType<typeof resolveOpenShellTarget>;
  let state: SandboxState | undefined;
  try {
    runtimeTarget = runtimeTargetFromQuery(
      url.searchParams.get("runtimeTarget") ?? undefined,
    );
    openShellTarget = isOpenShell
      ? resolveOpenShellTarget(runtimeTarget)
      : undefined;
    state = await readySandboxState(
      sandboxName,
      agentPlatform,
      runtimeTarget,
    );
  } catch (error) {
    console.error(
      `[terminal ${sandboxName}] unable to recover sandbox state: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (!state)
    return void rejectTerminalUpgrade(
      socket,
      409,
      "NemoClaw sandbox is not ready for terminal access.",
    );
  if (mode === "fixture")
    return void rejectTerminalUpgrade(
      socket,
      409,
      "Fixture mode cannot launch the NemoClaw TUI and never exposes a host shell.",
    );
  if (socket.destroyed) return;
  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    const connectionId = crypto.randomUUID().slice(0, 8);
    console.info(
      `[terminal ${connectionId}] allocating terminal for ${state.name}`,
    );
    try {
      const terminal = pty.spawn(
        isOpenShell ? openShellBinary() : "nemoclaw",
        isOpenShell
          ? openShellTerminalArguments(
              state.name,
              agentPlatform,
              openShellTarget,
            )
          : nemoClawTerminalArguments(state.name, agentPlatform),
        {
          name: "xterm-256color",
          cols: 100,
          rows: 30,
          cwd: process.cwd(),
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          ),
        },
      );
      console.info(
        `[terminal ${connectionId}] PTY allocated for ${state.name}`,
      );
      let receivedOutput = false;
      terminal.onData((data) => {
        if (!receivedOutput) {
          receivedOutput = true;
          console.info(
            `[terminal ${connectionId}] ${agentPlatform} TUI produced output`,
          );
        }
        if (webSocket.readyState === WebSocket.OPEN) webSocket.send(data);
      });
      webSocket.send(
        `Connected to NemoClaw runtime ${state.name}\r\n` +
          `Opening the ${agentPlatform} TUI inside the Sandbox…\r\n`,
      );
      terminal.onExit(({ exitCode }) => {
        console.info(
          `[terminal ${connectionId}] PTY exited with code ${exitCode}`,
        );
        if (webSocket.readyState === WebSocket.OPEN)
          webSocket.close(1000, `Terminal exited ${exitCode}`);
      });
      webSocket.on("message", (raw) => {
        const message = parseTerminalClientMessage(raw.toString());
        if (message.type === "resize")
          terminal.resize(message.cols, message.rows);
        else if (message.type === "input") terminal.write(message.data);
      });
      webSocket.on("close", () => {
        console.info(`[terminal ${connectionId}] browser disconnected`);
        try {
          terminal.kill();
        } catch {
          // The PTY may already have exited on its own.
        }
      });
      webSocket.on("error", (error) =>
        console.error(
          `[terminal ${connectionId}] browser WebSocket error: ${error.message}`,
        ),
      );
    } catch (error) {
      webSocket.send(
        `Unable to allocate Agent terminal: ${error instanceof Error ? error.message : "unknown error"}\r\n`,
      );
      webSocket.close(1011, "Terminal allocation failed");
    }
  });
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error);
    if (error instanceof z.ZodError)
      return void response
        .status(400)
        .json({ error: error.issues[0]?.message ?? "Invalid request." });
    response.status(500).json({
      error:
        error instanceof Error ? error.message : "Unexpected runner error.",
    });
  },
);

server.listen(port, host, () =>
  console.log(`TaskLattice Relay Runtime Runner listening on ${host}:${port} (${mode})`),
);
const projectServiceProxy = startProjectServiceProxy();

async function gracefulShutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  projectServiceProxy?.close();
  console.info(
    `${signal} received; draining ${provisionTasks.size} active provisioning task(s).`,
  );

  let timeout: NodeJS.Timeout | undefined;
  const drained = await Promise.race([
    Promise.allSettled([...provisionTasks.values()]).then(() => true),
    new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), shutdownTimeoutMs);
      timeout.unref();
    }),
  ]);
  if (timeout) clearTimeout(timeout);

  for (const client of sockets.clients) client.close(1012, "Runner restarting");
  server.closeAllConnections();
  if (!drained)
    console.error(
      `Runner shutdown timed out with ${provisionTasks.size} provisioning task(s) still active.`,
    );
  process.exit(drained ? 0 : 1);
}

process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => void gracefulShutdown("SIGINT"));
