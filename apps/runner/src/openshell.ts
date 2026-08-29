import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  getAgentPlatformDefinition,
  type AgentPlatformId,
  type ProvisioningStage,
  type SandboxAuditEvent,
} from "@tali/contracts";
import { parse, stringify } from "yaml";
import { getAgentPlatformRuntime } from "./agent-platform.js";
import {
  agentMemoryInstructions,
  runCommand,
  type ProvisionInput,
} from "./nemoclaw.js";

const nemoClawGatewayPort = process.env.NEMOCLAW_DASHBOARD_PORT ?? "18789";
const hermesDashboardUpstreamPort =
  nemoClawGatewayPort === "18790" ? "18791" : "18790";
const nemoClawWebUiService = "webui";
const hermesWebUiSecretFile = "/tmp/tali-hermes-webui-secret";
const hermesWebUiTokenTtlSeconds = 5 * 60;
const kubernetesServiceDnsSuffix = "svc.cluster.local";
const defaultKubernetesServiceCidrs = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
] as const;

export function openShellKubernetesServiceCidrs(): string[] {
  return (
    process.env.OPENSHELL_KUBERNETES_SERVICE_CIDRS
      ?.split(",")
      .map((cidr) => cidr.trim())
      .filter(Boolean)
    ?? [...defaultKubernetesServiceCidrs]
  );
}

export interface OpenShellSandbox {
  name: string;
  phase: string;
}

export interface OpenShellTarget {
  gatewayEndpoint: string;
  serviceBaseUrl: string;
  workspace: string;
}

export interface ProvisioningObserver {
  onLog?: (lines: string[]) => void;
  onStage?: (stage: ProvisioningStage, message: string) => void;
}

export const taliLiteLlmProviderProfileId = "tali-litellm";
export const taliRuntimeBridgeProviderProfileId = "tali-runtime-bridge";

export function taliLiteLlmProviderProfile(
  inferenceEndpoint: string,
  routingId = taliLiteLlmProviderProfileId,
  resourceVersion?: number,
): string {
  const endpoint = new URL(inferenceEndpoint);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")
    throw new Error("The Instance inference endpoint must use HTTP or HTTPS.");
  const port = endpoint.port
    ? Number(endpoint.port)
    : endpoint.protocol === "https:"
      ? 443
      : 80;
  const isKubernetesService =
    endpoint.hostname === kubernetesServiceDnsSuffix ||
    endpoint.hostname.endsWith(`.${kubernetesServiceDnsSuffix}`);
  return stringify(
    {
      id: routingId,
      ...(resourceVersion !== undefined
        ? { resource_version: resourceVersion }
        : {}),
      display_name: "TaskLattice Relay LiteLLM",
      description:
        "TaskLattice Relay instance-scoped inference through the LiteLLM gateway",
      category: "inference",
      credentials: [
        {
          name: "api_key",
          description: "TaskLattice Relay Instance virtual key",
          // Deep Agents Code reads its provider key from this dedicated name;
          // both names resolve to the same instance-scoped LiteLLM credential.
          env_vars: ["OPENAI_API_KEY", "DEEPAGENTS_CODE_OPENAI_API_KEY"],
          required: true,
          auth_style: "bearer",
          header_name: "authorization",
          query_param: "",
        },
        {
          name: "run_telemetry_token",
          description: "TaskLattice Relay Instance Run telemetry token",
          env_vars: ["TALI_RUN_TELEMETRY_TOKEN"],
          required: true,
          auth_style: "bearer",
          header_name: "authorization",
          query_param: "",
        },
      ],
      endpoints: [
        {
          host: endpoint.hostname,
          port,
          protocol: "rest",
          // Use the explicit full method set for this provider-composed
          // endpoint before enforcing the tunneled POST.
          // The virtual key remains model-scoped; full only affects methods
          // sent to this one exact LiteLLM host and port.
          access: "full",
          enforcement: "enforce",
          ...(isKubernetesService
            ? { allowed_ips: openShellKubernetesServiceCidrs() }
            : {}),
        },
      ],
      binaries: [
        "/usr/local/bin/node",
        "/usr/local/bin/hermes",
        "/opt/hermes/.venv/bin/python",
        "/opt/hermes/.venv/bin/python3",
        "/usr/local/bin/python",
        "/usr/local/bin/python3",
        "/usr/bin/python3.*",
        "/usr/local/bin/dcode",
        "/opt/venv/bin/python3*",
        "/opt/venv/lib/python3.13/**",
      ],
      inference_capable: true,
      discovery: { credentials: ["api_key", "run_telemetry_token"] },
    },
    { lineWidth: 0 },
  ).trimEnd() + "\n";
}

export function taliRuntimeBridgeProviderProfile(
  runtimeBridgeUrl: string,
  resourceVersion?: number,
): string {
  const endpoint = new URL(runtimeBridgeUrl);
  if (
    endpoint.protocol !== "http:"
    || !endpoint.hostname.endsWith(`.${kubernetesServiceDnsSuffix}`)
  ) {
    throw new Error(
      "The Project Runtime Bridge must use an in-cluster HTTP Service URL.",
    );
  }
  return stringify(
    {
      id: taliRuntimeBridgeProviderProfileId,
      ...(resourceVersion !== undefined
        ? { resource_version: resourceVersion }
        : {}),
      display_name: "TaskLattice Relay Runtime Bridge",
      description:
        "Instance-scoped Project orchestration, Vector Database, and durable Memory access",
      category: "other",
      credentials: [
        {
          name: "runtime_bridge_token",
          description: "TaskLattice Relay Instance Runtime Bridge token",
          env_vars: ["TALI_PROJECT_RUNTIME_BRIDGE_TOKEN"],
          required: true,
          auth_style: "bearer",
          header_name: "authorization",
          query_param: "",
        },
      ],
      endpoints: [
        {
          host: endpoint.hostname,
          port: endpoint.port ? Number(endpoint.port) : 80,
          protocol: "rest",
          access: "full",
          enforcement: "enforce",
          allowed_ips: openShellKubernetesServiceCidrs(),
        },
      ],
      binaries: [
        "/usr/local/bin/hermes",
        "/opt/hermes/.venv/bin/python",
        "/opt/hermes/.venv/bin/python3",
        "/usr/local/bin/python",
        "/usr/local/bin/python3",
        "/usr/bin/python3.*",
        "/usr/local/bin/node",
      ],
      inference_capable: false,
      discovery: { credentials: ["runtime_bridge_token"] },
    },
    { lineWidth: 0 },
  ).trimEnd() + "\n";
}

export function openShellBinary(): string {
  return process.env.OPENSHELL_BIN ?? "openshell";
}

export function openShellGatewayEndpoint(target?: OpenShellTarget): string {
  return target?.gatewayEndpoint ?? process.env.OPENSHELL_GATEWAY_ENDPOINT
    ?? "http://openshell.openshell.svc.cluster.local:8080";
}

export function openShellArguments(
  args: string[],
  target?: OpenShellTarget,
): string[] {
  return [
    "--gateway-endpoint",
    openShellGatewayEndpoint(target),
    "--workspace",
    openShellWorkspace(target),
    ...args,
  ];
}

export function openShellWorkspaceAdminArguments(
  args: string[],
  target?: OpenShellTarget,
): string[] {
  return [
    "--gateway-endpoint",
    openShellGatewayEndpoint(target),
    // Every OpenShell Gateway bootstraps this workspace. Workspace creation
    // must be issued from a scope that already exists on 0.0.106.
    "--workspace",
    "default",
    ...args,
  ];
}

export function openShellAuditArguments(
  name: string,
  target?: OpenShellTarget,
): string[] {
  return openShellArguments([
    "logs",
    name,
    "--source",
    "sandbox",
    "--since",
    "24h",
  ], target);
}

function auditTimestamp(value: string): string {
  const epochSeconds = Number(value);
  if (Number.isFinite(epochSeconds))
    return new Date(epochSeconds * 1_000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date(0).toISOString()
    : parsed.toISOString();
}

export function parseOpenShellAuditLog(output: string): SandboxAuditEvent[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((raw, index) => {
      const match = raw.match(
        /^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(\S+)\s+\[([^\]]+)\]\s+(.*)$/,
      );
      if (!match || match[3]?.trim() !== "OCSF") return [];
      const body = match[7] ?? "";
      const decision =
        (["ALLOWED", "DENIED", "BLOCKED", "APPROVED", "REJECTED"] as const).find(
          (value) => new RegExp(`\\b${value}\\b`).test(body),
        ) ?? "OBSERVED";
      const severity = match[6]?.trim().toUpperCase();
      const normalizedSeverity = (
        ["INFO", "LOW", "MED", "HIGH", "CRIT"] as const
      ).find((value) => value === severity) ?? "UNKNOWN";
      const source = match[2]?.trim();
      const timestamp = auditTimestamp(match[1] ?? "");
      const policy = body.match(/\[policy:([^\s\]]+)/)?.[1];
      return [
        {
          id: `${timestamp}-${index}`,
          timestamp,
          source:
            source === "gateway" || source === "sandbox" ? source : "unknown",
          category: match[5] ?? "OCSF",
          severity: normalizedSeverity,
          decision,
          summary: body,
          ...(policy && policy !== "-" ? { policy } : {}),
          raw,
        } satisfies SandboxAuditEvent,
      ];
    })
    .reverse();
}

export async function getOpenShellAuditEvents(
  name: string,
  target?: OpenShellTarget,
): Promise<SandboxAuditEvent[]> {
  const result = await runCommand(
    openShellBinary(),
    openShellAuditArguments(name, target),
  );
  if (result.exitCode !== 0)
    throw new Error(
      result.stderr.trim() || "Unable to read OpenShell sandbox audit logs.",
    );
  return parseOpenShellAuditLog(result.stdout);
}

export function deepSeekProviderCreateCommand(
  input: ProvisionInput,
  target?: OpenShellTarget,
): {
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const apiKey = input.apiKey;
  return {
    args: openShellArguments([
      "provider",
      "create",
      "--name",
      openShellProviderName(input.name),
      "--type",
      taliLiteLlmProviderProfileId,
      "--global-profile",
      "--credential",
      "OPENAI_API_KEY",
      "--credential",
      "DEEPAGENTS_CODE_OPENAI_API_KEY",
      "--credential",
      "TALI_RUN_TELEMETRY_TOKEN",
      "--config",
      `OPENAI_BASE_URL=${input.inferenceEndpoint}`,
    ], target),
    env: {
      ...process.env,
      ...(apiKey
        ? {
            OPENAI_API_KEY: apiKey,
            DEEPAGENTS_CODE_OPENAI_API_KEY: apiKey,
            TALI_RUN_TELEMETRY_TOKEN: input.runTelemetry.token,
          }
        : {}),
    },
  };
}

export function runtimeBridgeProviderCreateCommand(
  input: ProvisionInput,
  runtimeBridgeUrl: string,
  target?: OpenShellTarget,
): {
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const runtimeBridgeToken = input.projectRuntimeBridgeToken;
  return {
    args: openShellArguments([
      "provider",
      "create",
      "--name",
      openShellRuntimeBridgeProviderName(input.name),
      "--type",
      taliRuntimeBridgeProviderProfileId,
      "--global-profile",
      "--credential",
      "TALI_PROJECT_RUNTIME_BRIDGE_TOKEN",
      "--config",
      `TALI_PROJECT_RUNTIME_BRIDGE_URL=${runtimeBridgeUrl}`,
    ], target),
    env: {
      ...process.env,
      ...(runtimeBridgeToken
        ? {
            TALI_PROJECT_RUNTIME_BRIDGE_TOKEN: runtimeBridgeToken,
          }
        : {}),
    },
  };
}

export function openShellLiteLlmProfileExportArguments(
  target?: OpenShellTarget,
): string[] {
  return openShellArguments([
    "provider",
    "profile",
    "export",
    "--global",
    taliLiteLlmProviderProfileId,
  ], target);
}

export function openShellLiteLlmProfileApplyArguments(
  profileFile: string,
  resourceVersion?: number,
  target?: OpenShellTarget,
): string[] {
  return openShellArguments(
    resourceVersion !== undefined
      ? [
          "provider",
          "profile",
          "update",
          "--global",
          taliLiteLlmProviderProfileId,
          "--file",
          profileFile,
        ]
      : [
          "provider",
          "profile",
          "import",
          "--global",
          "--file",
          profileFile,
    ],
    target,
  );
}

async function ensureLiteLlmProviderProfile(
  inferenceEndpoint: string,
  target?: OpenShellTarget,
): Promise<void> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "tali-openshell-profile-"),
  );
  const profileFile = join(temporaryDirectory, "tali-litellm.yaml");
  try {
    const existing = await runCommand(
      openShellBinary(),
      openShellLiteLlmProfileExportArguments(target),
    );
    let resourceVersion: number | undefined;
    const desiredProfile = parse(
      taliLiteLlmProviderProfile(inferenceEndpoint),
    ) as unknown;
    if (existing.exitCode === 0) {
      const exported = parse(existing.stdout) as unknown;
      if (!isRecord(exported) || !Number.isInteger(exported.resource_version))
        throw new Error(
          "OpenShell exported the TaskLattice Relay LiteLLM Provider profile without a resource version.",
        );
      resourceVersion = exported.resource_version as number;
      const currentProfile = { ...exported };
      delete currentProfile.resource_version;
      // OpenShell exports read-only resolution metadata with the profile.
      // Neither field belongs in an imported profile document.
      delete currentProfile.source;
      delete currentProfile.scope;
      if (isDeepStrictEqual(currentProfile, desiredProfile)) return;
    }
    await writeFile(
      profileFile,
      taliLiteLlmProviderProfile(
        inferenceEndpoint,
        taliLiteLlmProviderProfileId,
        resourceVersion,
      ),
      { mode: 0o600 },
    );
    if (existing.exitCode !== 0) {
      const linted = await runCommand(
        openShellBinary(),
        openShellArguments([
          "provider",
          "profile",
          "lint",
          "--file",
          profileFile,
        ], target),
      );
      if (linted.exitCode !== 0)
        throw new Error(
          linted.stderr.trim() ||
            "OpenShell rejected the TaskLattice Relay LiteLLM Provider profile.",
        );
    }
    let applied = await runCommand(
      openShellBinary(),
      openShellLiteLlmProfileApplyArguments(
        profileFile,
        resourceVersion,
        target,
      ),
    );
    if (applied.exitCode !== 0 && existing.exitCode !== 0) {
      // A concurrent Instance may have imported the shared profile after the
      // export probe. Re-enter once so its resource_version is preserved.
      await ensureLiteLlmProviderProfile(inferenceEndpoint, target);
      return;
    }
    if (applied.exitCode !== 0)
      throw new Error(
        applied.stderr.trim() ||
          "Unable to register the TaskLattice Relay LiteLLM Provider profile.",
      );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export function openShellRuntimeBridgeProfileExportArguments(
  target?: OpenShellTarget,
): string[] {
  return openShellArguments([
    "provider",
    "profile",
    "export",
    "--global",
    taliRuntimeBridgeProviderProfileId,
  ], target);
}

export function openShellRuntimeBridgeProfileApplyArguments(
  profileFile: string,
  resourceVersion?: number,
  target?: OpenShellTarget,
): string[] {
  return openShellArguments(
    resourceVersion !== undefined
      ? [
          "provider",
          "profile",
          "update",
          "--global",
          taliRuntimeBridgeProviderProfileId,
          "--file",
          profileFile,
        ]
      : [
          "provider",
          "profile",
          "import",
          "--global",
          "--file",
          profileFile,
        ],
    target,
  );
}

async function ensureRuntimeBridgeProviderProfile(
  runtimeBridgeUrl: string,
  target?: OpenShellTarget,
): Promise<void> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "tali-runtime-bridge-profile-"),
  );
  const profileFile = join(temporaryDirectory, "tali-runtime-bridge.yaml");
  try {
    const existing = await runCommand(
      openShellBinary(),
      openShellRuntimeBridgeProfileExportArguments(target),
    );
    let resourceVersion: number | undefined;
    const desiredProfile = parse(
      taliRuntimeBridgeProviderProfile(runtimeBridgeUrl),
    ) as unknown;
    if (existing.exitCode === 0) {
      const exported = parse(existing.stdout) as unknown;
      if (!isRecord(exported) || !Number.isInteger(exported.resource_version))
        throw new Error(
          "OpenShell exported the Runtime Bridge Provider profile without a resource version.",
        );
      resourceVersion = exported.resource_version as number;
      const currentProfile = { ...exported };
      delete currentProfile.resource_version;
      delete currentProfile.source;
      delete currentProfile.scope;
      if (isDeepStrictEqual(currentProfile, desiredProfile)) return;
    }
    await writeFile(
      profileFile,
      taliRuntimeBridgeProviderProfile(runtimeBridgeUrl, resourceVersion),
      { mode: 0o600 },
    );
    if (existing.exitCode !== 0) {
      const linted = await runCommand(
        openShellBinary(),
        openShellArguments([
          "provider",
          "profile",
          "lint",
          "--file",
          profileFile,
        ], target),
      );
      if (linted.exitCode !== 0)
        throw new Error(
          linted.stderr.trim()
            || "OpenShell rejected the Runtime Bridge Provider profile.",
        );
    }
    const applied = await runCommand(
      openShellBinary(),
      openShellRuntimeBridgeProfileApplyArguments(
        profileFile,
        resourceVersion,
        target,
      ),
    );
    if (applied.exitCode !== 0 && existing.exitCode !== 0) {
      await ensureRuntimeBridgeProviderProfile(runtimeBridgeUrl, target);
      return;
    }
    if (applied.exitCode !== 0)
      throw new Error(
        applied.stderr.trim()
          || "Unable to register the Runtime Bridge Provider profile.",
      );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function ensureProviderPolicyCompositionEnabled(
  target?: OpenShellTarget,
): Promise<void> {
  const current = await runCommand(
    openShellBinary(),
    openShellArguments(["settings", "get", "--global", "--json"], target),
  );
  if (current.exitCode !== 0)
    throw new Error(
      current.stderr.trim() || "Unable to read OpenShell global settings.",
    );
  const document = JSON.parse(current.stdout) as unknown;
  if (
    isRecord(document) &&
    isRecord(document.settings) &&
    document.settings.providers_v2_enabled === "true"
  )
    return;
  const enabled = await runCommand(
    openShellBinary(),
    openShellArguments([
      "settings",
      "set",
      "--global",
      "--key",
      "providers_v2_enabled",
      "--value",
      "true",
      "--yes",
    ], target),
  );
  if (enabled.exitCode !== 0)
    throw new Error(
      enabled.stderr.trim() ||
        "Unable to enable OpenShell Provider policy composition.",
    );
}

export function openShellProviderName(sandboxName: string): string {
  const name = sandboxName.startsWith("tali-")
    ? sandboxName
    : `tali-${sandboxName}`;
  return name.slice(0, 63).replace(/-$/, "");
}

export function openShellRuntimeBridgeProviderName(sandboxName: string): string {
  return `${openShellProviderName(sandboxName).slice(0, 55).replace(/-$/, "")}-bridge`;
}

export function isOpenShellProviderAttachedError(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("provider")
    && normalized.includes("attached to")
    && normalized.includes("sandbox");
}

export function isOpenShellWorkspaceNotFoundError(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("workspace '") && normalized.includes("not found");
}

function openShellDeletionTiming(): { pollMs: number; timeoutMs: number } {
  return {
    pollMs: Math.max(
      100,
      Number(process.env.OPENSHELL_DELETE_POLL_INTERVAL_MS) || 500,
    ),
    timeoutMs: Math.max(
      1_000,
      Number(process.env.OPENSHELL_DELETE_TIMEOUT_MS) || 60_000,
    ),
  };
}

function waitForDeletionPoll(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitForOpenShellGateway(
  target: OpenShellTarget | undefined,
  observer?: ProvisioningObserver,
): Promise<void> {
  const timeoutMs = Number(
    process.env.OPENSHELL_GATEWAY_READY_TIMEOUT_MS ?? "180000",
  );
  const deadline = Date.now() + timeoutMs;
  let lastError = "Gateway is not ready.";
  observer?.onLog?.([
    `Waiting for Project OpenShell Gateway ${openShellGatewayEndpoint(target)}.`,
  ]);
  while (Date.now() < deadline) {
    const result = await runCommand(
      openShellBinary(),
      openShellArguments(["status"], target),
    );
    if (result.exitCode === 0) return;
    lastError = result.stderr.trim() || result.stdout.trim() || lastError;
    await waitForDeletionPoll(1_000);
  }
  throw new Error(
    `Project OpenShell Gateway did not become ready within ${timeoutMs}ms: ${lastError.slice(-2_000)}`,
  );
}

async function ensureOpenShellWorkspace(
  target: OpenShellTarget | undefined,
  observer?: ProvisioningObserver,
): Promise<void> {
  if (!target || target.workspace === "default") return;
  const workspace = openShellWorkspace(target);
  const existing = await runCommand(
    openShellBinary(),
    openShellWorkspaceAdminArguments(["workspace", "get", workspace], target),
  );
  if (existing.exitCode === 0) return;

  observer?.onLog?.([
    `Initializing OpenShell workspace ${workspace} for the Project Runtime Target.`,
  ]);
  const created = await runCommand(
    openShellBinary(),
    openShellWorkspaceAdminArguments([
      "workspace",
      "create",
      "--name",
      workspace,
      "--label",
      "tali.io/managed=true",
      "--label",
      `tali.io/project-namespace=${workspace}`,
    ], target),
  );
  if (created.exitCode === 0) return;

  // A concurrent first Agent may have created the same Project workspace.
  const retry = await runCommand(
    openShellBinary(),
    openShellWorkspaceAdminArguments(["workspace", "get", workspace], target),
  );
  if (retry.exitCode !== 0)
    throw new Error(
      created.stderr.trim()
        || created.stdout.trim()
        || `Unable to initialize OpenShell workspace ${workspace}.`,
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function composeOpenShellInferencePolicy(
  policyYaml: string,
  _inferenceEndpoint: string,
  agentPlatform: AgentPlatformId,
  telemetryEndpoint?: string,
  projectRuntimeBridgeUrl?: string,
): string {
  const document = parse(policyYaml) as unknown;
  if (!isRecord(document) || document.version !== 1)
    throw new Error("OpenShell Policy YAML must be an object with version: 1.");

  if (agentPlatform === "hermes") {
    const filesystemPolicy = isRecord(document.filesystem_policy)
      ? { ...document.filesystem_policy }
      : {};
    if (
      filesystemPolicy.read_write !== undefined
      && !Array.isArray(filesystemPolicy.read_write)
    ) {
      throw new Error("OpenShell Policy filesystem_policy.read_write must be an array.");
    }
    const readWrite = Array.isArray(filesystemPolicy.read_write)
      ? [...filesystemPolicy.read_write]
      : [];
    // Hermes' browser Chat launches its TUI in a nested PTY. OpenShell 0.0.106
    // can safely prepare the existing devpts mount, while adding /dev/ptmx
    // itself would fail because that path is a symlink. Landlock authorizes
    // the resolved /dev/pts/ptmx device through this mount-level rule.
    if (!readWrite.includes("/dev/pts")) readWrite.push("/dev/pts");
    filesystemPolicy.read_write = readWrite;
    document.filesystem_policy = filesystemPolicy;
  }

  const networkPolicies = isRecord(document.network_policies)
    ? { ...document.network_policies }
    : {};
  // Provider v2 composes the inference endpoint as an isolated `_provider_*`
  // rule. Keeping the legacy direct rule in a business policy can match first
  // and bypass credential resolution, so remove only TaskLattice Relay's old entry.
  delete networkPolicies.tali_inference_gateway;
  delete networkPolicies.tali_project_runtime_bridge;
  if (
    telemetryEndpoint
    && getAgentPlatformDefinition(agentPlatform).capabilities.embeddedRunTelemetry
  ) {
    const endpoint = new URL(telemetryEndpoint);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new Error("The Run telemetry endpoint must use HTTP or HTTPS.");
    }
    const port = endpoint.port
      ? Number(endpoint.port)
      : endpoint.protocol === "https:"
        ? 443
        : 80;
    const isKubernetesService =
      endpoint.hostname === kubernetesServiceDnsSuffix
      || endpoint.hostname.endsWith(`.${kubernetesServiceDnsSuffix}`);
    networkPolicies.tali_run_telemetry = {
      name: "tali-run-telemetry",
      endpoints: [{
        host: endpoint.hostname,
        port,
        protocol: "rest",
        enforcement: "enforce",
        access: "full",
        ...(isKubernetesService ? { allowed_ips: openShellKubernetesServiceCidrs() } : {}),
      }],
      binaries: getAgentPlatformRuntime(agentPlatform).inferenceBinaries
        .map((path) => ({ path })),
    };
  }
  if (projectRuntimeBridgeUrl) new URL(projectRuntimeBridgeUrl);
  if (Object.keys(networkPolicies).length > 0)
    document.network_policies = networkPolicies;
  else
    delete document.network_policies;

  return stringify(document, { lineWidth: 0 }).trimEnd() + "\n";
}

export function openShellSandboxCreateArguments(
  input: ProvisionInput,
  instructionsFile: string,
  bootstrapFile: string,
  policyFile: string,
  telemetryFile?: string,
  target?: OpenShellTarget,
): string[] {
  const runtime = getAgentPlatformRuntime(input.agentPlatform);
  const capabilities = getAgentPlatformDefinition(input.agentPlatform)
    .capabilities;
  const nemoClawVersion = (process.env.NEMOCLAW_VERSION ?? "0.0.114")
    .replace(/^v/, "");
  const cpuLimit = input.sandboxResources?.cpu
    ?? process.env.OPENSHELL_SANDBOX_CPU
    ?? "1";
  const cpuRequest = process.env.OPENSHELL_SANDBOX_CPU_REQUEST?.trim();
  const cpuArguments = cpuRequest && cpuRequest !== cpuLimit
    ? [
        "--driver-config-json",
        JSON.stringify({
          kubernetes: {
            containers: {
              agent: {
                resources: {
                  limits: { cpu: cpuLimit },
                  requests: { cpu: cpuRequest },
                },
              },
            },
          },
        }),
      ]
    : ["--cpu", cpuLimit];
  return openShellArguments([
    "sandbox",
    "create",
    "--name",
    input.name,
    "--from",
    input.sandboxImage ?? runtime.sandboxImage(),
    ...cpuArguments,
    "--memory",
    input.sandboxResources?.memory ?? process.env.OPENSHELL_SANDBOX_MEMORY ?? "2Gi",
    "--provider",
    openShellProviderName(input.name),
    ...(input.projectRuntimeBridgeToken && target
      ? ["--provider", openShellRuntimeBridgeProviderName(input.name)]
      : []),
    "--policy",
    policyFile,
    "--label",
    "tali.ai/managed=true",
    "--label",
    `tali.io/instance-id=${input.instanceId}`,
    "--label",
    "tali.io/runtime-provider=nemoclaw",
    "--label",
    `tali.io/nemoclaw-version=${nemoClawVersion}`,
    "--env",
    `TALI_AGENT_INSTANCE_ID=${input.instanceId}`,
    ...(input.agentPlatform === "hermes"
      ? ["--env", "HERMES_LAZY_INSTALL_TARGET=/sandbox/.hermes/lazy-packages"]
      : []),
    "--upload",
    `${instructionsFile}:${runtime.instructionsPath}`,
    "--upload",
    `${bootstrapFile}:/tmp/tali-nemoclaw-start`,
    ...(telemetryFile && capabilities.embeddedRunTelemetry
      ? ["--upload", `${telemetryFile}:/tmp/tali-run-telemetry.env`]
      : []),
    "--no-tty",
    "--",
    "/bin/bash",
    "/tmp/tali-nemoclaw-start",
  ], target);
}

export function runTelemetryEnvironmentFile(input: ProvisionInput): string {
  return [
    `TALI_RUN_TELEMETRY_ENDPOINT_B64=${Buffer.from(input.runTelemetry.endpoint, "utf8").toString("base64")}`,
    "",
  ].join("\n");
}

export function openShellNemoClawProbeArguments(
  name: string,
  agentPlatform: AgentPlatformId,
  target?: OpenShellTarget,
): string[] {
  const runtime = getAgentPlatformRuntime(agentPlatform);
  return openShellArguments([
    "sandbox",
    "exec",
    "--name",
    name,
    "--",
    "/bin/sh",
    "-lc",
    runtime.healthProbe(nemoClawGatewayPort),
  ], target);
}

export function openShellTerminalArguments(
  name: string,
  agentPlatform: AgentPlatformId,
  target?: OpenShellTarget,
): string[] {
  const runtime = getAgentPlatformRuntime(agentPlatform);
  return openShellArguments([
    "sandbox",
    "exec",
    "--name",
    name,
    "--tty",
    "--timeout",
    "0",
    "--env",
    "TERM=xterm-256color",
    "--env",
    "COLORTERM=truecolor",
    "--",
    "/bin/bash",
    "-lc",
    runtime.terminalCommand,
  ], target);
}

export function openShellWebUiServiceArguments(
  name: string,
  action: "delete" | "expose" | "get",
  target?: OpenShellTarget,
): string[] {
  return openShellArguments([
    "service",
    action,
    name,
    ...(action === "expose" ? [nemoClawGatewayPort] : []),
    nemoClawWebUiService,
  ], target);
}

export function openShellWorkspace(target?: OpenShellTarget): string {
  const workspace = target?.workspace
    ?? process.env.OPENSHELL_WORKSPACE?.trim()
    ?? "default";
  if (
    workspace.length > 19 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(workspace) ||
    workspace.includes("--")
  )
    throw new Error(
      "OPENSHELL_WORKSPACE must be a DNS-1123 label without consecutive hyphens and no longer than 19 characters.",
    );
  return workspace;
}

export function openShellServiceBaseUrl(target?: OpenShellTarget): string {
  return target?.serviceBaseUrl ?? process.env.OPENSHELL_SERVICE_BASE_URL
    ?? "http://openshell.localhost:8080";
}

export function openShellWebUiOrigin(
  name: string,
  target?: OpenShellTarget,
): string {
  const base = new URL(openShellServiceBaseUrl(target));
  base.hostname = `${openShellWorkspace(target)}--${name}--${nemoClawWebUiService}.${base.hostname}`;
  return base.origin;
}

export function openShellWebUiTokenArguments(
  name: string,
  target?: OpenShellTarget,
): string[] {
  return openShellArguments([
    "sandbox",
    "exec",
    "--name",
    name,
    "--",
    "node",
    "-e",
    'const c=require("/sandbox/.openclaw/openclaw.json");process.stdout.write(c.gateway.auth.token)',
  ], target);
}

export function openShellHermesWebUiSecretArguments(
  name: string,
  target?: OpenShellTarget,
): string[] {
  return openShellArguments([
    "sandbox",
    "exec",
    "--name",
    name,
    "--",
    "/bin/sh",
    "-lc",
    `test -s ${hermesWebUiSecretFile} && cat ${hermesWebUiSecretFile}`,
  ], target);
}

export function openShellHermesWebUiProbeArguments(
  name: string,
  target?: OpenShellTarget,
): string[] {
  return openShellArguments([
    "sandbox",
    "exec",
    "--name",
    name,
    "--",
    "/bin/sh",
    "-lc",
    `curl -fsS --max-time 3 http://127.0.0.1:${nemoClawGatewayPort}/__tali/health >/dev/null && dashboard_status="$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:${hermesDashboardUpstreamPort}/)" && test "$dashboard_status" -ge 200 && test "$dashboard_status" -lt 500 && test -s ${hermesWebUiSecretFile}`,
  ], target);
}

export function openShellWebUiOriginProbeArguments(
  name: string,
  endpointUrl: string,
  target?: OpenShellTarget,
): string[] {
  return openShellArguments([
    "sandbox",
    "exec",
    "--name",
    name,
    "--",
    "node",
    "-e",
    'const c=require("/sandbox/.openclaw/openclaw.json");if(!c.gateway?.controlUi?.allowedOrigins?.includes(process.argv[1]))process.exit(1)',
    new URL(endpointUrl).origin,
  ], target);
}

export function openShellWebUiOriginEnsureArguments(
  name: string,
  endpointUrl: string,
  target?: OpenShellTarget,
): string[] {
  return openShellArguments([
    "sandbox",
    "exec",
    "--name",
    name,
    "--",
    "node",
    "-e",
    'const fs=require("node:fs");const p="/sandbox/.openclaw/openclaw.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));const u=(c.gateway??={}).controlUi??={};const a=Array.isArray(u.allowedOrigins)?u.allowedOrigins:[];const o=process.argv[1];if(!a.includes(o)){u.allowedOrigins=[...new Set([...a,o])];const t=`${p}.tali-${process.pid}.tmp`;try{fs.writeFileSync(t,JSON.stringify(c,null,2)+"\\n",{mode:0o660});fs.chmodSync(t,0o660);fs.renameSync(t,p)}finally{if(fs.existsSync(t))fs.unlinkSync(t)}}',
    new URL(endpointUrl).origin,
  ], target);
}

export function tokenizedOpenClawUrl(endpointUrl: string, token: string): string {
  const url = new URL(endpointUrl);
  url.hash = new URLSearchParams({ token: token.trim() }).toString();
  return url.toString();
}

export function tokenizedHermesDashboardUrl(
  endpointUrl: string,
  secret: string,
  subject: string,
  now = Date.now(),
  nonce = randomUUID(),
): string {
  const key = secret.trim();
  if (key.length < 32)
    throw new Error("Hermes Web UI authentication secret is invalid.");
  const issuedAt = Math.floor(now / 1_000);
  const subjectBinding = createHmac("sha256", key)
    .update(`subject\0${subject}`)
    .digest("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      aud: "tali-hermes-dashboard",
      exp: issuedAt + hermesWebUiTokenTtlSeconds,
      iat: issuedAt,
      jti: nonce,
      sub: subjectBinding,
      typ: "access",
    }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", key)
    .update(payload)
    .digest("base64url");
  const url = new URL(endpointUrl);
  url.searchParams.set("access_token", `${payload}.${signature}`);
  return url.toString();
}

export async function deleteOpenShellWebUiEndpoint(
  name: string,
  target?: OpenShellTarget,
): Promise<void> {
  const result = await runCommand(
    openShellBinary(),
    openShellWebUiServiceArguments(name, "delete", target),
  );
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode !== 0 && !output.includes("service endpoint not found"))
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Unable to delete the Web UI endpoint.",
    );
}

export function parseOpenShellServiceUrl(output: string): string | undefined {
  const plain = output.replace(/\u001b\[[0-9;]*m/g, "");
  const candidate = plain.match(/https?:\/\/[^\s]+/g)?.at(-1);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export async function ensureOpenShellWebUiEndpoint(
  name: string,
  agentPlatform: AgentPlatformId,
  target?: OpenShellTarget,
): Promise<string> {
  if (!getAgentPlatformRuntime(agentPlatform).endpointKind) {
    throw new Error(
      `${agentPlatform} is a terminal-only Agent and does not publish a Web UI endpoint.`,
    );
  }
  const existing = await runCommand(
    openShellBinary(),
    openShellWebUiServiceArguments(name, "get", target),
  );
  let endpointUrl = parseOpenShellServiceUrl(existing.stdout);
  if (existing.exitCode !== 0 || !endpointUrl) {
    const exposed = await runCommand(
      openShellBinary(),
      openShellWebUiServiceArguments(name, "expose", target),
    );
    endpointUrl = parseOpenShellServiceUrl(exposed.stdout);
    if (exposed.exitCode !== 0 || !endpointUrl)
      throw new Error(
        exposed.stderr.trim() ||
          exposed.stdout.trim() ||
          "OpenShell did not return a NemoClaw Web UI endpoint.",
      );
  }

  const expectedOrigin = openShellWebUiOrigin(name, target);
  if (new URL(endpointUrl).origin !== expectedOrigin) {
    if (agentPlatform === "hermes")
      await deleteOpenShellWebUiEndpoint(name, target);
    throw new Error(
      "The OpenShell service URL does not match OPENSHELL_SERVICE_BASE_URL and OPENSHELL_WORKSPACE; Web UI access was not issued.",
    );
  }

  if (agentPlatform === "hermes") {
    const proxyProbe = await runCommand(
      openShellBinary(),
      openShellHermesWebUiProbeArguments(name, target),
    );
    if (proxyProbe.exitCode !== 0) {
      // An older Hermes image may still have the unauthenticated Dashboard on
      // this port. Never leave the predictable route published when the
      // authentication boundary cannot prove it owns the listener.
      await deleteOpenShellWebUiEndpoint(name, target);
      throw new Error(
        "The Hermes Dashboard authentication proxy is not ready; the unauthenticated endpoint remains unavailable.",
      );
    }
    return endpointUrl;
  }

  // Instances created before OpenShell added the workspace route prefix retain
  // the former origin in OpenClaw. Migrate only after the gateway-returned URL
  // has passed the exact trusted-origin check above.
  const originEnsure = await runCommand(
    openShellBinary(),
    openShellWebUiOriginEnsureArguments(name, endpointUrl, target),
  );
  if (originEnsure.exitCode !== 0)
    throw new Error(
      originEnsure.stderr.trim() ||
        "The OpenClaw gateway Web UI origin allowlist could not be updated.",
    );

  const originProbe = await runCommand(
    openShellBinary(),
    openShellWebUiOriginProbeArguments(name, endpointUrl, target),
  );
  if (originProbe.exitCode !== 0)
    throw new Error(
      "The OpenClaw gateway did not retain the routed Web UI origin allowlist.",
    );

  const token = await runCommand(
    openShellBinary(),
    openShellWebUiTokenArguments(name, target),
  );
  if (token.exitCode !== 0 || !token.stdout.trim())
    throw new Error(
      token.stderr.trim() || "Unable to resolve the OpenClaw Web UI token.",
    );

  return tokenizedOpenClawUrl(endpointUrl, token.stdout);
}

export async function issueOpenShellWebUiEndpoint(
  name: string,
  agentPlatform: AgentPlatformId,
  subject: string,
  target?: OpenShellTarget,
): Promise<string> {
  const endpointUrl = await ensureOpenShellWebUiEndpoint(
    name,
    agentPlatform,
    target,
  );
  if (agentPlatform !== "hermes") return endpointUrl;
  const secret = await runCommand(
    openShellBinary(),
    openShellHermesWebUiSecretArguments(name, target),
  );
  if (secret.exitCode !== 0 || !secret.stdout.trim())
    throw new Error("Unable to issue Hermes Web UI access.");
  return tokenizedHermesDashboardUrl(endpointUrl, secret.stdout, subject);
}

async function createOpenShellNemoClawSandbox(
  input: ProvisionInput,
  instructionsFile: string,
  bootstrapFile: string,
  policyFile: string,
  telemetryFile: string | undefined,
  target: OpenShellTarget | undefined,
  observer?: ProvisioningObserver,
): Promise<string[]> {
  const timeoutMs = Number(process.env.NEMOCLAW_START_TIMEOUT_MS ?? "180000");
  return new Promise((resolve, reject) => {
    const child = spawn(
      openShellBinary(),
      openShellSandboxCreateArguments(
        input,
        instructionsFile,
        bootstrapFile,
        policyFile,
        telemetryFile,
        target,
      ),
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let pendingLine = "";
    let settled = false;
    let probing = false;
    const append = (data: Buffer) => {
      const chunk = data.toString();
      output = (output + chunk).slice(-64_000);
      const parts = `${pendingLine}${chunk}`.split(/\r?\n/);
      pendingLine = parts.pop() ?? "";
      const lines = parts.filter(Boolean);
      if (lines.length) observer?.onLog?.(lines);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const flushPendingLine = () => {
      if (!pendingLine) return;
      observer?.onLog?.([pendingLine]);
      pendingLine = "";
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(probeTimer);
      clearTimeout(timeoutTimer);
      flushPendingLine();
      if (error) reject(error);
      else resolve(output.split("\n").filter(Boolean).slice(-100));
    };

    const probeTimer = setInterval(async () => {
      if (settled || probing) return;
      probing = true;
      try {
        const probe = await runCommand(
          openShellBinary(),
          openShellNemoClawProbeArguments(
            input.name,
            input.agentPlatform,
            target,
          ),
        );
        if (probe.exitCode === 0) {
          // OpenShell 0.0.106 keeps the startup command attached to the create
          // stream. Once health is proven, detach the local CLI; the sandbox
          // runtime keeps the long-lived NemoClaw process running.
          settled = true;
          clearInterval(probeTimer);
          clearTimeout(timeoutTimer);
          flushPendingLine();
          child.kill("SIGTERM");
          resolve(output.split("\n").filter(Boolean).slice(-100));
        }
      } finally {
        probing = false;
      }
    }, 1_000);

    const timeoutTimer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        new Error(
          `NemoClaw gateway startup timed out. ${output.trim().slice(-4_000)}`,
        ),
      );
    }, timeoutMs);

    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (settled) return;
      finish(
        new Error(
          output.trim() || `OpenShell sandbox creation exited ${code ?? 1}.`,
        ),
      );
    });
  });
}

async function ensureInstanceProvider(
  input: ProvisionInput,
  target?: OpenShellTarget,
): Promise<void> {
  await ensureProviderPolicyCompositionEnabled(target);
  await ensureLiteLlmProviderProfile(input.inferenceEndpoint, target);
  const providerName = openShellProviderName(input.name);
  const existing = await runCommand(
    openShellBinary(),
    openShellArguments(["provider", "get", providerName], target),
  );
  if (existing.exitCode === 0) {
    const plain = existing.stdout.replace(/\u001b\[[0-9;]*m/g, "");
    const providerType = plain.match(/^\s*Type:\s*(\S+)/m)?.[1];
    if (providerType === taliLiteLlmProviderProfileId) return;
    throw new Error(
      `Existing OpenShell Provider ${providerName} uses legacy type ${providerType ?? "unknown"}; migrate or remove it before reprovisioning this Instance.`,
    );
  }

  const apiKey = input.apiKey;
  if (!apiKey)
    throw new Error(
      "A LiteLLM virtual key is required to create the OpenShell provider.",
    );

  const command = deepSeekProviderCreateCommand(input, target);
  const created = await runCommand(
    openShellBinary(),
    command.args,
    command.env,
  );
  if (created.exitCode !== 0) {
    // Another concurrent request may have created the shared provider.
    const retry = await runCommand(
      openShellBinary(),
      openShellArguments(["provider", "get", providerName], target),
    );
    if (retry.exitCode !== 0)
      throw new Error(
        created.stderr.trim() || "Unable to configure the Instance Provider.",
      );
  }
}

async function ensureRuntimeBridgeProvider(
  input: ProvisionInput,
  runtimeBridgeUrl: string,
  target?: OpenShellTarget,
): Promise<void> {
  await ensureRuntimeBridgeProviderProfile(runtimeBridgeUrl, target);
  const providerName = openShellRuntimeBridgeProviderName(input.name);
  const existing = await runCommand(
    openShellBinary(),
    openShellArguments(["provider", "get", providerName], target),
  );
  if (existing.exitCode === 0) {
    const plain = existing.stdout.replace(/\u001b\[[0-9;]*m/g, "");
    const providerType = plain.match(/^\s*Type:\s*(\S+)/m)?.[1];
    if (providerType === taliRuntimeBridgeProviderProfileId) return;
    throw new Error(
      `Existing OpenShell Provider ${providerName} uses type ${providerType ?? "unknown"}; remove it before reprovisioning this Instance.`,
    );
  }
  if (!input.projectRuntimeBridgeToken)
    throw new Error(
      "An Instance-scoped Runtime Bridge token is required to attach Project runtime capabilities.",
    );
  const command = runtimeBridgeProviderCreateCommand(
    input,
    runtimeBridgeUrl,
    target,
  );
  const created = await runCommand(
    openShellBinary(),
    command.args,
    command.env,
  );
  if (created.exitCode !== 0) {
    const retry = await runCommand(
      openShellBinary(),
      openShellArguments(["provider", "get", providerName], target),
    );
    if (retry.exitCode !== 0)
      throw new Error(
        created.stderr.trim()
          || "Unable to configure the Runtime Bridge Provider.",
      );
  }
}

export async function provisionOpenShellSandbox(
  input: ProvisionInput,
  target?: OpenShellTarget,
  observer?: ProvisioningObserver,
): Promise<string[]> {
  await waitForOpenShellGateway(target, observer);
  await ensureOpenShellWorkspace(target, observer);
  observer?.onStage?.("PROVIDER", "Creating isolated LiteLLM and Runtime Bridge Providers for this Instance.");
  await ensureInstanceProvider(input, target);

  const projectRuntimeBridgeUrl = target && input.projectRuntimeBridgeToken
    ? `http://tali-agent-runtime-bridge.${target.workspace}.svc.cluster.local:8080`
    : undefined;
  if (projectRuntimeBridgeUrl) {
    await ensureRuntimeBridgeProvider(input, projectRuntimeBridgeUrl, target);
  }

  observer?.onStage?.("SANDBOX", "Applying the OpenShell policy and scoped Provider attachment.");

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "tali-openshell-"));
  const runtime = getAgentPlatformRuntime(input.agentPlatform);
  const capabilities = getAgentPlatformDefinition(input.agentPlatform)
    .capabilities;
  const instructionsFile = join(temporaryDirectory, "AGENTS.md");
  const bootstrapFile = join(temporaryDirectory, "tali-nemoclaw-start");
  const policyFile = join(temporaryDirectory, "openshell-policy.yaml");
  const telemetryFile = capabilities.embeddedRunTelemetry
    ? join(temporaryDirectory, "tali-run-telemetry.env")
    : undefined;
  const hermesRuntimeInstructions = input.agentPlatform === "hermes"
    ? [
        "",
        "## Project orchestration",
        "For multi-step requests, create and maintain a Hermes Kanban plan before dispatching work.",
        "Use a2a_list and a2a_discover to inspect Project-enabled remote specialists.",
        "Before every a2a_call, create a Kanban card with assignee 'tali-a2a' and initial_status 'blocked'; pass that card's task_id to a2a_call.",
        "The A2A tool claims that reserved card as running and records dispatch events. Add returned evidence, then complete or block the card explicitly.",
        "",
        "## Project Vector Databases",
        "Project Vector Databases are shared, live Project resources rather than Instance memory.",
        "Use vector_database_list to discover the current Project databases and vector_database_search for questions about uploaded documents or Project-specific knowledge.",
        "Ground answers in the returned chunks and cite filename, page, and section when available. Never claim that a document says something when the search results do not support it.",
      ].join("\n")
    : "";
  try {
    await writeFile(
      instructionsFile,
      `## TaskLattice Relay Agent Instructions\n\n${input.systemPrompt.trim()}${agentMemoryInstructions(input.memory, input.agentPlatform)}${hermesRuntimeInstructions}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      bootstrapFile,
      runtime.bootstrapScript(
        openShellWebUiOrigin(input.name, target),
        nemoClawGatewayPort,
        input.inferenceEndpoint,
        input.model,
        input.memory,
        projectRuntimeBridgeUrl,
        input.instanceId,
        Boolean(projectRuntimeBridgeUrl),
        Boolean(input.durableMemoryEnabled),
      ),
      { mode: 0o600 },
    );
    await writeFile(
      policyFile,
      composeOpenShellInferencePolicy(
        input.policyYaml ?? "version: 1\n",
        input.inferenceEndpoint,
        input.agentPlatform,
        capabilities.embeddedRunTelemetry ? input.runTelemetry.endpoint : undefined,
        projectRuntimeBridgeUrl,
      ),
      { mode: 0o600 },
    );
    if (telemetryFile) {
      await writeFile(telemetryFile, runTelemetryEnvironmentFile(input), {
        mode: 0o600,
      });
    }
    observer?.onStage?.("POD", "Creating the OpenShell Sandbox and starting its Kubernetes Pod.");
    return await createOpenShellNemoClawSandbox(
      input,
      instructionsFile,
      bootstrapFile,
      policyFile,
      telemetryFile,
      target,
      observer,
    );
  } catch (error) {
    await deleteOpenShellSandbox(input.name, target).catch(() => undefined);
    await deleteOpenShellProvider(input.name, target).catch(() => undefined);
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function deleteOpenShellProvider(
  name: string,
  target?: OpenShellTarget,
): Promise<void> {
  const timing = openShellDeletionTiming();
  for (const providerName of [
    openShellRuntimeBridgeProviderName(name),
    openShellProviderName(name),
  ]) {
    const deadline = Date.now() + timing.timeoutMs;
    while (true) {
      const result = await runCommand(
        openShellBinary(),
        openShellArguments(["provider", "delete", providerName], target),
      );
      const output = `${result.stdout}\n${result.stderr}`;
      if (result.exitCode === 0 || output.toLowerCase().includes("not found"))
        break;
      if (!isOpenShellProviderAttachedError(output) || Date.now() >= deadline)
        throw new Error(
          result.stderr.trim() || "OpenShell Provider deletion failed.",
        );
      await waitForDeletionPoll(timing.pollMs);
    }
  }
}

export async function observeOpenShellSandbox(
  name: string,
  target?: OpenShellTarget,
): Promise<OpenShellSandbox | undefined> {
  const result = await runCommand(
    openShellBinary(),
    openShellArguments(["sandbox", "list", "-o", "json"], target),
  );
  if (result.exitCode !== 0) {
    const output = `${result.stdout}\n${result.stderr}`;
    // A fresh Project Gateway only contains OpenShell's bootstrapped default
    // workspace. Treat the routed workspace as empty so provisioning can reach
    // ensureOpenShellWorkspace() and initialize it on the first Agent.
    if (target && isOpenShellWorkspaceNotFoundError(output)) return undefined;
    throw new Error(
      result.stderr.trim() || "Unable to list OpenShell sandboxes.",
    );
  }
  const sandboxes = JSON.parse(result.stdout) as OpenShellSandbox[];
  return sandboxes.find((sandbox) => sandbox.name === name);
}

export async function deleteOpenShellSandbox(
  name: string,
  target?: OpenShellTarget,
): Promise<void> {
  const result = await runCommand(
    openShellBinary(),
    openShellArguments(["sandbox", "delete", name], target),
  );
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (
    result.exitCode !== 0 &&
    !output.includes("sandbox not found") &&
    !output.includes("not found")
  )
    throw new Error(
      result.stderr.trim() || "OpenShell sandbox deletion failed.",
    );
  const timing = openShellDeletionTiming();
  const deadline = Date.now() + timing.timeoutMs;
  while (await observeOpenShellSandbox(name, target)) {
    if (Date.now() >= deadline)
      throw new Error(
        `OpenShell sandbox ${name} is still present after the deletion timeout.`,
      );
    await waitForDeletionPoll(timing.pollMs);
  }
}
