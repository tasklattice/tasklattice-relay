import {
  getAgentPlatformDefinition,
  type AgentMemoryConfiguration,
  type AgentPlatformId,
  type HttpEndpoint,
} from "@tali/contracts";

type NativeMemoryConfiguration = Extract<
  AgentMemoryConfiguration,
  { mode: "native" }
>;
type HybridMemoryConfiguration = Extract<
  AgentMemoryConfiguration,
  { mode: "hybrid" }
>;

export type RuntimeMemoryConfiguration =
  | NativeMemoryConfiguration
  | (Omit<HybridMemoryConfiguration, "embeddingModelDeploymentId"> & {
      embeddingModel: string;
    });

export interface AgentPlatformRuntime {
  id: AgentPlatformId;
  instructionsPath: string;
  terminalCommand: string;
  headlessCommand?: string;
  inferenceBinaries: readonly string[];
  endpointKind?: HttpEndpoint["kind"];
  sandboxImage: () => string;
  bootstrapScript: (
    dashboardOrigin: string,
    dashboardPort: string,
    inferenceEndpoint: string,
    model: string,
    memory?: RuntimeMemoryConfiguration,
    projectRuntimeBridgeUrl?: string,
    coordinatorInstanceId?: string,
    runtimeBridgeEnabled?: boolean,
  ) => string;
  healthProbe: (dashboardPort: string) => string;
  startupLogs: readonly string[];
}

const openClawBootstrapScript = (
  dashboardOrigin: string,
  dashboardPort: string,
  inferenceEndpoint: string,
  model: string,
  memory?: RuntimeMemoryConfiguration,
  projectRuntimeBridgeUrl?: string,
  coordinatorInstanceId?: string,
  runtimeBridgeEnabled = false,
) => {
  const memoryPayload = Buffer.from(
    JSON.stringify(memory ?? null),
    "utf8",
  ).toString("base64");
  const durableMemoryEndpoint =
    runtimeBridgeEnabled && projectRuntimeBridgeUrl && coordinatorInstanceId
      ? `${projectRuntimeBridgeUrl.replace(/\/$/, "")}/v1/memory/coordinators/${encodeURIComponent(coordinatorInstanceId)}`
      : "";
  const durableMemoryEndpointPayload = Buffer.from(
    durableMemoryEndpoint,
    "utf8",
  ).toString("base64");
  return `#!/usr/bin/env bash
set -euo pipefail

readonly telemetry_env_file=/tmp/tali-run-telemetry.env
source "$telemetry_env_file"
rm -f "$telemetry_env_file"
export TALI_RUN_TELEMETRY_ENDPOINT="$(printf '%s' "$TALI_RUN_TELEMETRY_ENDPOINT_B64" | base64 -d)"
export TALI_RUN_TELEMETRY_TOKEN="$(printf '%s' "$TALI_RUN_TELEMETRY_TOKEN_B64" | base64 -d)"
unset TALI_RUN_TELEMETRY_ENDPOINT_B64 TALI_RUN_TELEMETRY_TOKEN_B64
export TALI_DURABLE_MEMORY_ENDPOINT="$(printf '%s' '${durableMemoryEndpointPayload}' | base64 -d)"
readonly config_file=/sandbox/.openclaw/openclaw.json
readonly hash_file=/sandbox/.openclaw/.config-hash

node - "$config_file" "${dashboardOrigin}" "${inferenceEndpoint}" "${model}" "${memoryPayload}" <<'NODE'
const fs = require("node:fs");
const [configFile, corsOrigin, inferenceEndpoint, modelId, memoryPayload] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
const memory = JSON.parse(Buffer.from(memoryPayload, "base64").toString("utf8"));
const controlUi = (config.gateway ??= {}).controlUi ??= {};
const origins = Array.isArray(controlUi.allowedOrigins)
  ? controlUi.allowedOrigins
  : [];
controlUi.allowedOrigins = [...new Set([...origins, corsOrigin])];
const provider = config.models.providers.inference;
provider.baseUrl = inferenceEndpoint;
provider.apiKey = process.env.OPENAI_API_KEY || "OPENAI_API_KEY";
provider.models = [{
  ...provider.models[0],
  id: modelId,
  name: "inference/" + modelId,
}];
config.agents.defaults.model.primary = "inference/" + modelId;
const plugins = (config.plugins ??= {});
const pluginLoad = (plugins.load ??= {});
const pluginPaths = Array.isArray(pluginLoad.paths) ? pluginLoad.paths : [];
pluginLoad.paths = [...new Set([
  ...pluginPaths,
  "/usr/local/lib/tali/openclaw-run-telemetry",
  ...(process.env.TALI_DURABLE_MEMORY_ENDPOINT && process.env.TALI_DURABLE_MEMORY_TOKEN
    ? ["/usr/local/lib/tali/openclaw-durable-memory"]
    : []),
])];
const pluginEntries = (plugins.entries ??= {});
pluginEntries["tali-run-telemetry"] = {
  enabled: true,
  hooks: { allowConversationAccess: true },
};
if (process.env.TALI_DURABLE_MEMORY_ENDPOINT && process.env.TALI_DURABLE_MEMORY_TOKEN) {
  pluginEntries["tali-durable-memory"] = {
    enabled: true,
    hooks: {
      allowConversationAccess: true,
      allowPromptInjection: true,
      timeouts: { before_prompt_build: 2200 },
    },
  };
}
if (memory) {
  const workspaceDirectory = "/sandbox/.openclaw/workspace";
  const dailyMemoryDirectory = workspaceDirectory + "/memory";
  const durableMemoryFile = workspaceDirectory + "/MEMORY.md";
  fs.mkdirSync(dailyMemoryDirectory, { recursive: true, mode: 0o770 });
  if (!fs.existsSync(durableMemoryFile)) {
    fs.writeFileSync(
      durableMemoryFile,
      "# OpenClaw Memory\\n\\n<!-- Durable, Instance-scoped memory managed by the OpenClaw Agent. -->\\n",
      { mode: 0o660 },
    );
  }
  config.memory = {
    ...(config.memory ?? {}),
    backend: "builtin",
    citations: memory.citations,
  };
  if (memory.mode === "hybrid") {
    const secretProviders = (config.secrets ??= {}).providers ??= {};
    secretProviders.tali = {
      source: "env",
      allowlist: ["OPENAI_API_KEY"],
    };
    config.agents.defaults.memorySearch = {
      ...(config.agents.defaults.memorySearch ?? {}),
      enabled: true,
      sources: memory.includeSessionTranscripts
        ? ["memory", "sessions"]
        : ["memory"],
      experimental: {
        sessionMemory: memory.includeSessionTranscripts,
      },
      provider: "openai-compatible",
      remote: {
        baseUrl: inferenceEndpoint,
        apiKey: {
          source: "env",
          provider: "tali",
          id: "OPENAI_API_KEY",
        },
      },
      fallback: "none",
      model: memory.embeddingModel,
      query: {
        maxResults: memory.maxResults,
        minScore: memory.minScore,
      },
    };
  } else {
    config.agents.defaults.memorySearch = {
      ...(config.agents.defaults.memorySearch ?? {}),
      enabled: false,
      sources: ["memory"],
    };
  }
}
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\\n", {
  mode: 0o660,
});
NODE

(cd "$(dirname "$config_file")" && sha256sum "$(basename "$config_file")" >"$hash_file")
exec env "NEMOCLAW_DASHBOARD_PORT=${dashboardPort}" /usr/local/bin/nemoclaw-start
`;
};

const hermesBootstrapScript = (
  dashboardOrigin: string,
  dashboardPort: string,
  inferenceEndpoint: string,
  model: string,
  _memory?: RuntimeMemoryConfiguration,
  projectRuntimeBridgeUrl?: string,
  coordinatorInstanceId?: string,
  runtimeBridgeEnabled = false,
) => {
  const upstreamDashboardPort = dashboardPort === "18790" ? "18791" : "18790";
  const secureCookie = new URL(dashboardOrigin).protocol === "https:";
  const projectRuntimeBridgeToken = runtimeBridgeEnabled
    ? "$TALI_PROJECT_RUNTIME_BRIDGE_TOKEN"
    : undefined;
  const a2aRegistryArgument =
    projectRuntimeBridgeUrl && coordinatorInstanceId && projectRuntimeBridgeToken
      ? ` \\\n  --a2a-registry-url "${projectRuntimeBridgeUrl.replace(/\/$/, "")}/v1/hermes/a2a-agents?coordinatorInstanceId=${encodeURIComponent(coordinatorInstanceId)}"`
      : "";
  const a2aRegistryTokenArgument = projectRuntimeBridgeToken
    ? ` --a2a-registry-token "${projectRuntimeBridgeToken}"`
    : "";
  const vectorDatabaseRegistryArgument =
    projectRuntimeBridgeUrl && coordinatorInstanceId && projectRuntimeBridgeToken
      ? ` \\\n  --vector-database-registry-url "${projectRuntimeBridgeUrl.replace(/\/$/, "")}/v1/hermes/vector-databases?coordinatorInstanceId=${encodeURIComponent(coordinatorInstanceId)}" \\\n  --vector-database-registry-token "${projectRuntimeBridgeToken}"`
      : "";
  const durableMemoryEnabled = Boolean(
    projectRuntimeBridgeUrl && coordinatorInstanceId && projectRuntimeBridgeToken,
  );
  const durableMemoryEndpoint = durableMemoryEnabled
    ? `${projectRuntimeBridgeUrl!.replace(/\/$/, "")}/v1/memory/coordinators/${encodeURIComponent(coordinatorInstanceId!)}`
    : "";
  const durableMemoryEndpointPayload = Buffer.from(
    durableMemoryEndpoint,
    "utf8",
  ).toString("base64");
  const durableMemoryProviderArgument = durableMemoryEnabled
    ? " \\\n  --durable-memory-provider tali_relay"
    : "";
  return `#!/usr/bin/env bash
set -euo pipefail

readonly telemetry_env_file=/tmp/tali-run-telemetry.env
source "$telemetry_env_file"
rm -f "$telemetry_env_file"
export TALI_RUN_TELEMETRY_ENDPOINT="$(printf '%s' "$TALI_RUN_TELEMETRY_ENDPOINT_B64" | base64 -d)"
export TALI_RUN_TELEMETRY_TOKEN="$(printf '%s' "$TALI_RUN_TELEMETRY_TOKEN_B64" | base64 -d)"
unset TALI_RUN_TELEMETRY_ENDPOINT_B64 TALI_RUN_TELEMETRY_TOKEN_B64

readonly hermes_dir=/sandbox/.hermes
readonly config_file="$hermes_dir/config.yaml"
readonly hash_file="$hermes_dir/.config-hash"
readonly config_bootstrap=/usr/local/lib/tali/bootstrap-hermes-config.py
readonly webui_auth_proxy=/usr/local/lib/tali/hermes-webui-auth-proxy.py
readonly webui_secret_file=/tmp/tali-hermes-webui-secret
readonly webui_public_port=${dashboardPort}
readonly webui_upstream_port=${upstreamDashboardPort}
readonly webui_secure_cookie=${secureCookie ? "1" : "0"}
export TALI_DURABLE_MEMORY_ENDPOINT="$(printf '%s' '${durableMemoryEndpointPayload}' | base64 -d)"

# OpenShell provisions the persistent workspace root with a setgid, writable
# mode so uploaded files can be staged before the workload starts. Hermes
# deliberately accepts a narrower posture. Only normalize the mount when the
# current sandbox identity owns it; otherwise fail closed and leave the
# upstream boundary validator to report the unexpected ownership.
if [ "$(id -u)" -ne 0 ]; then
  readonly sandbox_identity="$(id -u):$(id -g)"
  readonly workspace_identity="$(stat -c '%u:%g' /sandbox)"
  readonly hermes_identity="$(stat -c '%u:%g' /sandbox/.hermes)"
  if [ "$workspace_identity" != "$sandbox_identity" ]; then
    echo "Refusing to normalize /sandbox owned by $workspace_identity for $sandbox_identity" >&2
    exit 1
  fi
  if [ "$hermes_identity" != "$sandbox_identity" ]; then
    echo "Refusing to normalize /sandbox/.hermes owned by $hermes_identity for $sandbox_identity" >&2
    exit 1
  fi
  chmod 0770 /sandbox
  chmod g-s /sandbox
  chmod 3770 /sandbox/.hermes
fi

printf '[bootstrap] Hermes identity current=%s account=%s workspace=%s state=%s\n' \
  "$(id -u):$(id -g)" \
  "$(id -u sandbox):$(id -g sandbox)" \
  "$(stat -c '%u:%g:%a' /sandbox)" \
  "$(stat -c '%u:%g:%a' /sandbox/.hermes)" >&2

"$config_bootstrap" \
  --config "$config_file" \
  --hash-file "$hash_file" \
  --endpoint "${inferenceEndpoint}" \
  --model "${model}" \
  --template-endpoint https://inference.local/v1 \
  --template-model deepseek-chat${a2aRegistryArgument}${a2aRegistryTokenArgument}${vectorDatabaseRegistryArgument}${durableMemoryProviderArgument}

if [ ! -x "$webui_auth_proxy" ]; then
  echo "Hermes Web UI authentication proxy is unavailable" >&2
  exit 1
fi
umask 077
/opt/hermes/.venv/bin/python3 -I -c 'import secrets,sys;sys.stdout.write(secrets.token_urlsafe(48))' >"$webui_secret_file"
chmod 0600 "$webui_secret_file"

webui_proxy_args=(
  "$webui_auth_proxy"
  --listen-port "$webui_public_port"
  --upstream-port "$webui_upstream_port"
  --secret-file "$webui_secret_file"
  --parent-pid "$$"
)
if [ "$webui_secure_cookie" = "1" ]; then
  webui_proxy_args+=(--secure-cookie)
fi
/opt/hermes/.venv/bin/python3 -I "\${webui_proxy_args[@]}" &

# Preserve NemoClaw's OpenShell-managed process contract: this shell must be
# replaced by nemoclaw-start so it remains the supervisor's direct child. The
# proxy watches this stable PID and exits when the runtime is replaced or dies.
exec env "NEMOCLAW_DASHBOARD_PORT=$webui_upstream_port" "NEMOCLAW_MODEL_OVERRIDE=${model}" /usr/local/bin/nemoclaw-start
`;
};

const deepAgentsBootstrapScript = (
  _dashboardOrigin: string,
  _dashboardPort: string,
  inferenceEndpoint: string,
  model: string,
  _memory?: RuntimeMemoryConfiguration,
) => {
  const modelPayload = Buffer.from(model, "utf8").toString("base64");
  const endpointPayload = Buffer.from(inferenceEndpoint, "utf8").toString(
    "base64",
  );
  return `#!/usr/bin/env bash
set -euo pipefail

readonly config_generator=/opt/nemoclaw-deepagents-code/generate-config.ts
readonly config_file=/sandbox/.deepagents/config.toml
readonly selected_model="$(printf '%s' '${modelPayload}' | base64 -d)"
readonly upstream_endpoint="$(printf '%s' '${endpointPayload}' | base64 -d)"

if [ ! -f "$config_generator" ] || [ ! -x /usr/local/bin/dcode ]; then
  echo "Deep Agents Code runtime is unavailable in this image" >&2
  exit 1
fi

env \
  NEMOCLAW_MODEL="$selected_model" \
  NEMOCLAW_INFERENCE_PROVIDER_ID=inference \
  NEMOCLAW_UPSTREAM_PROVIDER=tali-litellm \
  NEMOCLAW_UPSTREAM_ENDPOINT_URL="$upstream_endpoint" \
  NEMOCLAW_INFERENCE_BASE_URL="$upstream_endpoint" \
  NEMOCLAW_INFERENCE_API=openai-completions \
  node --experimental-strip-types "$config_generator"

chown sandbox:sandbox "$config_file"
chmod 0660 "$config_file"
exec /usr/local/bin/nemoclaw-start
`;
};

const agentPlatformRuntimeRegistry = {
  openclaw: {
    id: "openclaw",
    instructionsPath: "/sandbox/.openclaw/workspace/AGENTS.md",
    terminalCommand: "exec openclaw tui",
    inferenceBinaries: ["/usr/local/bin/node"],
    endpointKind: "openclaw-webui",
    sandboxImage: () =>
      process.env.OPENSHELL_SANDBOX_IMAGE ??
      getAgentPlatformDefinition("openclaw").sandboxImage,
    bootstrapScript: openClawBootstrapScript,
    healthProbe: (dashboardPort) =>
      `test -x /usr/local/bin/nemoclaw-start && test -f /sandbox/.openclaw/openclaw.json && curl -fsS --max-time 3 http://127.0.0.1:${dashboardPort}/health >/dev/null`,
    startupLogs: [
      "OpenClaw Agent instructions uploaded to the sandbox workspace.",
      "NemoClaw supervisor started the OpenClaw Agent gateway.",
      "OpenClaw gateway health check: Ready",
    ],
  },
  hermes: {
    id: "hermes",
    instructionsPath: "/sandbox/.hermes/SOUL.md",
    terminalCommand: "exec hermes --tui",
    inferenceBinaries: [
      "/usr/local/bin/hermes",
      "/usr/local/bin/python",
      "/usr/local/bin/python3",
      "/opt/hermes/.venv/bin/python3",
      "/usr/bin/python3.*",
    ],
    endpointKind: "hermes-dashboard",
    sandboxImage: () =>
      process.env.OPENSHELL_HERMES_SANDBOX_IMAGE ??
      getAgentPlatformDefinition("hermes").sandboxImage,
    bootstrapScript: hermesBootstrapScript,
    healthProbe: (dashboardPort) => {
      const upstreamDashboardPort = dashboardPort === "18790" ? "18791" : "18790";
      return `test -x /usr/local/bin/hermes && test -f /sandbox/.hermes/config.yaml && curl -fsS --max-time 3 http://127.0.0.1:8642/health >/dev/null && curl -fsS --max-time 3 http://127.0.0.1:${dashboardPort}/__tali/health >/dev/null && dashboard_status="$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:${upstreamDashboardPort}/)" && test "$dashboard_status" -ge 200 && test "$dashboard_status" -lt 500`;
    },
    startupLogs: [
      "Hermes Agent instructions uploaded to the sandbox state directory.",
      "Hermes Kanban and Project-scoped A2A peers enabled through the Runtime Bridge.",
      "NemoClaw supervisor started the Hermes gateway.",
      "Hermes API health check: Ready",
    ],
  },
  deepagents: {
    id: "deepagents",
    instructionsPath: "/sandbox/.deepagents/agent/AGENTS.md",
    terminalCommand: "exec dcode",
    headlessCommand: "dcode -n",
    inferenceBinaries: [
      "/usr/local/bin/dcode",
      "/opt/venv/bin/python3*",
      "/opt/venv/lib/python3.13/**",
    ],
    sandboxImage: () =>
      process.env.OPENSHELL_DEEPAGENTS_SANDBOX_IMAGE ??
      getAgentPlatformDefinition("deepagents").sandboxImage,
    bootstrapScript: deepAgentsBootstrapScript,
    healthProbe: () =>
      "test -x /usr/local/bin/dcode && test -s /sandbox/.deepagents/config.toml && test -s /tmp/nemoclaw-proxy-env.sh && dcode --version >/dev/null",
    startupLogs: [
      "Deep Agents instructions uploaded to the managed Agent state directory.",
      "NemoClaw initialized the terminal-oriented Deep Agents runtime.",
      "Deep Agents TUI and headless runtime check: Ready",
    ],
  },
} as const satisfies Record<AgentPlatformId, AgentPlatformRuntime>;

export function getAgentPlatformRuntime(
  agentPlatform: AgentPlatformId,
): AgentPlatformRuntime {
  return agentPlatformRuntimeRegistry[agentPlatform];
}
