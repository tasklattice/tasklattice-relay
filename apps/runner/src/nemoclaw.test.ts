import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  encodeTerminalResize,
  parseTerminalClientMessage,
} from "@tali/contracts";
import { agentMemoryInstructions, nemoClawTerminalArguments, onboardCommand } from "./nemoclaw.js";
import { getAgentPlatformRuntime } from "./agent-platform.js";
import {
  composeOpenShellInferencePolicy,
  deepSeekProviderCreateCommand,
  isOpenShellProviderAttachedError,
  isOpenShellWorkspaceNotFoundError,
  openShellLiteLlmProfileApplyArguments,
  openShellLiteLlmProfileExportArguments,
  openShellRuntimeBridgeProfileApplyArguments,
  openShellRuntimeBridgeProfileExportArguments,
  openShellHermesWebUiProbeArguments,
  openShellHermesWebUiSecretArguments,
  openShellNemoClawProbeArguments,
  openShellAuditArguments,
  openShellSandboxCreateArguments,
  openShellRuntimeBridgeProviderName,
  openShellTerminalArguments,
  openShellWebUiOrigin,
  openShellWebUiOriginEnsureArguments,
  openShellWebUiOriginProbeArguments,
  openShellWebUiServiceArguments,
  openShellWebUiTokenArguments,
  openShellWorkspace,
  openShellWorkspaceAdminArguments,
  parseOpenShellServiceUrl,
  parseOpenShellAuditLog,
  runTelemetryEnvironmentFile,
  runtimeBridgeProviderCreateCommand,
  taliLiteLlmProviderProfile,
  taliLiteLlmProviderProfileId,
  taliRuntimeBridgeProviderProfile,
  taliRuntimeBridgeProviderProfileId,
  tokenizedOpenClawUrl,
  tokenizedHermesDashboardUrl,
} from "./openshell.js";

describe("NemoClaw command contract", () => {
  it("maps the scoped LiteLLM endpoint without putting the key in argv", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "host-secret-value");
    const command = onboardCommand({
      name: "tali-research-a1b2c3d4",
      agentPlatform: "openclaw",
      providerName: "DeepSeek",
      model: "tali/provider/deepseek-chat",
      inferenceEndpoint: "http://tali-litellm:4000/v1",
      systemPrompt: "You are a research agent.",
      apiKey: "database-secret-value",
      instanceId: "11111111-1111-4111-8111-111111111111",
      runTelemetry: {
        endpoint: "http://tali-control:8080/api/internal/run-events",
        token: "test-run-telemetry-token-with-safe-length",
      },
    });
    expect(command.args).toContain("openclaw");
    expect(command.args.join(" ")).not.toContain("database-secret-value");
    expect(command.env.NEMOCLAW_PROVIDER).toBe("custom");
    expect(command.env.NEMOCLAW_ENDPOINT_URL).toBe("http://tali-litellm:4000/v1");
    expect(command.env.COMPATIBLE_API_KEY).toBe("database-secret-value");
  });

  it("selects Hermes through the same NemoClaw onboarding contract", () => {
    const command = onboardCommand({
      name: "tali-hermes-a1b2c3d4",
      agentPlatform: "hermes",
      providerName: "DeepSeek",
      model: "tali/provider/deepseek-chat",
      inferenceEndpoint: "http://tali-litellm:4000/v1",
      systemPrompt: "You are a research agent.",
      apiKey: "database-secret-value",
      instanceId: "22222222-2222-4222-8222-222222222222",
      runTelemetry: {
        endpoint: "http://tali-control:8080/api/internal/run-events",
        token: "test-run-telemetry-token-with-safe-length",
      },
    });

    expect(command.args).toContain("hermes");
    expect(command.args).not.toContain("openclaw");
  });
});

describe("OpenShell Kubernetes command contract", () => {
  const input = {
    name: "tali-research-a1b2c3d4",
    agentPlatform: "openclaw" as const,
    providerName: "DeepSeek",
    model: "tali/provider/deepseek-chat",
    inferenceEndpoint: "http://tali-litellm:4000/v1",
    systemPrompt: "You are a research agent.",
    apiKey: "database-secret-value",
    instanceId: "11111111-1111-4111-8111-111111111111",
    runTelemetry: {
      endpoint: "http://tali-control:8080/api/internal/run-events",
      token: "test-run-telemetry-token-with-safe-length",
    },
  };

  it("passes the virtual key through the Provider environment only", () => {
    const command = deepSeekProviderCreateCommand(input);
    expect(command.args.join(" ")).not.toContain("database-secret-value");
    expect(command.args).toContain(taliLiteLlmProviderProfileId);
    expect(command.args).toContain("OPENAI_API_KEY");
    expect(command.args).toContain("DEEPAGENTS_CODE_OPENAI_API_KEY");
    expect(command.args).toContain("TALI_RUN_TELEMETRY_TOKEN");
    expect(command.args).toContain("OPENAI_BASE_URL=http://tali-litellm:4000/v1");
    expect(command.env.OPENAI_API_KEY).toBe("database-secret-value");
    expect(command.env.DEEPAGENTS_CODE_OPENAI_API_KEY).toBe(
      "database-secret-value",
    );
    expect(command.env.TALI_RUN_TELEMETRY_TOKEN).toBe(
      "test-run-telemetry-token-with-safe-length",
    );
  });

  it("keeps the shared LiteLLM Provider profile in platform scope", () => {
    expect(openShellLiteLlmProfileExportArguments().slice(-5)).toEqual([
      "provider",
      "profile",
      "export",
      "--global",
      taliLiteLlmProviderProfileId,
    ]);
    expect(
      openShellLiteLlmProfileApplyArguments("/tmp/tali-litellm.yaml"),
    ).toContain("--global");
    expect(
      openShellLiteLlmProfileApplyArguments(
        "/tmp/tali-litellm.yaml",
        1,
      ),
    ).toContain("--global");
  });

  it("defines a separate Runtime Bridge Provider without putting its token in argv", () => {
    const runtimeBridgeUrl =
      "http://tali-agent-runtime-bridge.tp-abcdefghijklmnop.svc.cluster.local:8080";
    const bridgeInput = {
      ...input,
      projectRuntimeBridgeToken: "tali_prc_v1.test-payload.test-signature",
    };
    const command = runtimeBridgeProviderCreateCommand(
      bridgeInput,
      runtimeBridgeUrl,
      { workspace: "tp-abcdefghijklmnop" },
    );
    const profile = taliRuntimeBridgeProviderProfile(runtimeBridgeUrl);

    expect(command.args).toContain(taliRuntimeBridgeProviderProfileId);
    expect(command.args).toContain("TALI_PROJECT_RUNTIME_BRIDGE_TOKEN");
    expect(command.args).not.toContain("TALI_DURABLE_MEMORY_TOKEN");
    expect(command.args.join(" ")).not.toContain(
      "tali_prc_v1.test-payload.test-signature",
    );
    expect(command.env.TALI_PROJECT_RUNTIME_BRIDGE_TOKEN).toBe(
      "tali_prc_v1.test-payload.test-signature",
    );
    expect(profile).toContain("id: tali-runtime-bridge");
    expect(profile).toContain("inference_capable: false");
    expect(profile).not.toContain("TALI_DURABLE_MEMORY_TOKEN");
    expect(openShellRuntimeBridgeProfileExportArguments()).toContain("--global");
    expect(openShellRuntimeBridgeProfileApplyArguments("/tmp/bridge.yaml"))
      .toContain("--global");
  });

  it("recognizes the transient Provider attachment conflict during deletion", () => {
    expect(
      isOpenShellProviderAttachedError(
        "provider 'tali-instance' is attached to sandbox(es): tali-instance",
      ),
    ).toBe(true);
    expect(
      isOpenShellProviderAttachedError("provider 'tali-instance' not found"),
    ).toBe(false);
  });

  it("recognizes a missing routed workspace during the first Agent lookup", () => {
    expect(
      isOpenShellWorkspaceNotFoundError(
        "code: 'Some requested entity was not found', message: \"workspace 'tp-abcdefghijklmnop' not found\"",
      ),
    ).toBe(true);
    expect(isOpenShellWorkspaceNotFoundError("sandbox not found")).toBe(false);
  });

  it("defines LiteLLM credential injection for every Agent runtime", () => {
    const profile = taliLiteLlmProviderProfile(
      "http://tali-litellm.tali-sandboxes.svc.cluster.local:4000/v1",
    );

    expect(profile).toContain("id: tali-litellm");
    expect(profile).toContain("env_vars:\n      - OPENAI_API_KEY");
    expect(profile).toContain("- DEEPAGENTS_CODE_OPENAI_API_KEY");
    expect(profile).toContain("- TALI_RUN_TELEMETRY_TOKEN");
    expect(profile).toContain("auth_style: bearer");
    expect(profile).toContain("header_name: authorization");
    expect(profile).toContain(
      "host: tali-litellm.tali-sandboxes.svc.cluster.local",
    );
    expect(profile).toContain("port: 4000");
    expect(profile).toContain("access: full");
    expect(profile).toContain("allowed_ips:");
    expect(profile).toContain("- 192.168.0.0/16");
    expect(profile).toContain("- /usr/local/bin/node");
    expect(profile).toContain("- /opt/hermes/.venv/bin/python");
    expect(profile).toContain("- /usr/local/bin/dcode");
    expect(profile).toContain("- /opt/venv/bin/python3*");
  });

  it("creates a managed Pod-backed sandbox with uploaded instructions", () => {
    const args = openShellSandboxCreateArguments(
      input,
      "/tmp/AGENTS.md",
      "/tmp/tali-nemoclaw-start",
      "/tmp/openshell-policy.yaml",
      "/tmp/tali-run-telemetry.env",
    );
    expect(args).toContain("ghcr.io/tasklattice/tali-nemoclaw-sandbox:dev");
    expect(args).toContain("tali.ai/managed=true");
    expect(args).toContain("tali.io/runtime-provider=nemoclaw");
    expect(args).toContain("tali.io/nemoclaw-version=0.0.114");
    expect(args).toContain(
      "/tmp/AGENTS.md:/sandbox/.openclaw/workspace/AGENTS.md",
    );
    expect(args).toContain(
      "/tmp/tali-nemoclaw-start:/tmp/tali-nemoclaw-start",
    );
    expect(args).toContain("tali-research-a1b2c3d4");
    expect(args).toContain(
      "/tmp/tali-run-telemetry.env:/tmp/tali-run-telemetry.env",
    );
    expect(args.join(" ")).not.toContain("test-run-telemetry-token-with-safe-length");
    expect(runTelemetryEnvironmentFile(input)).not.toContain(
      "test-run-telemetry-token-with-safe-length",
    );
    expect(runTelemetryEnvironmentFile(input)).not.toContain(
      "TALI_RUN_TELEMETRY_TOKEN",
    );
    expect(args).toContain("--policy");
    expect(args).toContain("/tmp/openshell-policy.yaml");
    expect(args).not.toContain(
      "HERMES_LAZY_INSTALL_TARGET=/sandbox/.hermes/lazy-packages",
    );
    expect(args).toContain("1");
    expect(args).toContain("2Gi");
    expect(args.slice(-4)).toEqual([
      "--no-tty",
      "--",
      "/bin/bash",
      "/tmp/tali-nemoclaw-start",
    ]);
  });

  it("pins the managed lazy-install boundary for Hermes Sandboxes", () => {
    const args = openShellSandboxCreateArguments(
      { ...input, agentPlatform: "hermes" },
      "/tmp/AGENTS.md",
      "/tmp/tali-nemoclaw-start",
      "/tmp/openshell-policy.yaml",
    );

    expect(args).toContain(
      "HERMES_LAZY_INSTALL_TARGET=/sandbox/.hermes/lazy-packages",
    );
  });

  it("applies platform resource overrides only to newly created Sandboxes", () => {
    const args = openShellSandboxCreateArguments(
      {
        ...input,
        sandboxResources: { cpu: "1500m", memory: "4Gi" },
      },
      "/tmp/AGENTS.md",
      "/tmp/tali-nemoclaw-start",
      "/tmp/openshell-policy.yaml",
    );

    expect(args[args.indexOf("--cpu") + 1]).toBe("1500m");
    expect(args[args.indexOf("--memory") + 1]).toBe("4Gi");
  });

  it("uses the official Kubernetes driver config for separate CPU request and limit", () => {
    vi.stubEnv("OPENSHELL_SANDBOX_CPU", "1");
    vi.stubEnv("OPENSHELL_SANDBOX_CPU_REQUEST", "500m");
    const args = openShellSandboxCreateArguments(
      input,
      "/tmp/AGENTS.md",
      "/tmp/tali-nemoclaw-start",
      "/tmp/openshell-policy.yaml",
    );

    expect(args).not.toContain("--cpu");
    expect(
      JSON.parse(args[args.indexOf("--driver-config-json") + 1] ?? "null"),
    ).toEqual({
      kubernetes: {
        containers: {
          agent: {
            resources: {
              limits: { cpu: "1" },
              requests: { cpu: "500m" },
            },
          },
        },
      },
    });
    vi.unstubAllEnvs();
  });

  it("leaves inference routing to the attached Provider profile", () => {
    const policy = composeOpenShellInferencePolicy(
      "version: 1\nnetwork_policies:\n  github:\n    name: github\n  tali_inference_gateway:\n    name: legacy\n",
      "http://tali-litellm.tali-sandboxes.svc.cluster.local:4000/v1",
      "openclaw",
    );

    expect(policy).toContain("github:");
    expect(policy).not.toContain("tali_inference_gateway:");
    expect(policy).not.toContain("tali-litellm");
  });

  it("allows the Hermes runtime to post lifecycle telemetry", () => {
    const policy = composeOpenShellInferencePolicy(
      "version: 1\n",
      "https://inference.example.com/v1",
      "hermes",
      "http://tali-control.tali.svc.cluster.local:38080/api/internal/run-events",
    );

    expect(policy).toContain("tali_run_telemetry:");
    expect(policy).toContain("host: tali-control.tali.svc.cluster.local");
    expect(policy).toContain("path: /opt/hermes/.venv/bin/python3");
    expect(policy).not.toContain("/usr/bin/curl");
  });

  it("allows Hermes to allocate nested PTYs through the devpts mount", () => {
    const policy = composeOpenShellInferencePolicy(
      "version: 1\nfilesystem_policy:\n  read_write:\n    - /sandbox\n    - /tmp\n    - /dev/null\n",
      "https://inference.example.com/v1",
      "hermes",
    );

    expect(policy).toContain("- /dev/pts");
    expect(policy).not.toContain("/dev/ptmx");
    expect(policy.match(/- \/dev\/pts/g)).toHaveLength(1);
  });

  it("leaves Runtime Bridge routing to its attached Provider profile", () => {
    const policy = composeOpenShellInferencePolicy(
      "version: 1\n",
      "https://inference.example.com/v1",
      "hermes",
      undefined,
      "http://tali-agent-runtime-bridge.tp-abcdefghijklmnop.svc.cluster.local:8080",
    );

    expect(policy).toContain("version: 1\n");
    expect(policy).toContain("- /dev/pts");
    expect(policy).not.toContain("network_policies:");
  });

  it("allows only the runtime binary to post lifecycle telemetry to Control", () => {
    const policy = composeOpenShellInferencePolicy(
      "version: 1\n",
      "http://tali-litellm:4000/v1",
      "openclaw",
      "http://tali-control.tali.svc.cluster.local:38080/api/internal/run-events",
    );

    expect(policy).toContain("tali_run_telemetry:");
    expect(policy).toContain("host: tali-control.tali.svc.cluster.local");
    expect(policy).toContain("port: 38080");
    expect(policy).toContain("path: /usr/local/bin/node");
    expect(policy).not.toContain("/usr/bin/curl");
  });

  it("reads and parses OpenShell OCSF policy decisions", () => {
    expect(openShellAuditArguments(input.name).slice(-6)).toEqual([
      "logs",
      input.name,
      "--source",
      "sandbox",
      "--since",
      "24h",
    ]);
    const events = parseOpenShellAuditLog(
      "[1775014132.118] [sandbox] [OCSF ] [ocsf] NET:OPEN [INFO] ALLOWED /usr/bin/curl(58) -> api.github.com:443 [policy:github_api engine:opa]\n" +
      "[1775014132.690] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(64) -> httpbin.org:443 [policy:- engine:opa] [reason:no matching policy]\n" +
      "[1775014113.058] [sandbox] [INFO ] [openshell_sandbox] Starting sandbox\n",
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      category: "NET:OPEN",
      severity: "MED",
      decision: "DENIED",
    });
    expect(events[1]).toMatchObject({
      decision: "ALLOWED",
      policy: "github_api",
    });
  });

  it("only marks the runtime healthy after the NemoClaw gateway responds", () => {
    const args = openShellNemoClawProbeArguments(
      input.name,
      input.agentPlatform,
    );
    expect(args).toContain(input.name);
    expect(args.at(-1)).toContain("/usr/local/bin/nemoclaw-start");
    expect(args.at(-1)).toContain("/sandbox/.openclaw/openclaw.json");
    expect(args.at(-1)).toContain("127.0.0.1:18789/health");
  });

  it("opens only the Gateway-backed OpenClaw TUI", () => {
    const args = openShellTerminalArguments(input.name, input.agentPlatform);
    expect(args).toContain(input.name);
    expect(args).toContain("--tty");
    expect(args).toContain("--timeout");
    expect(args).toContain("TERM=xterm-256color");
    expect(args.at(-1)).toBe("exec openclaw tui");
    expect(args.at(-1)).not.toContain("--local");
    expect(args.at(-1)).not.toContain("/bin/bash -l");
  });

  it("launches the OpenClaw TUI through a NemoClaw exec PTY", () => {
    const args = nemoClawTerminalArguments(input.name, input.agentPlatform);
    expect(args.slice(0, 7)).toEqual([
      input.name,
      "exec",
      "--tty",
      "--stdin",
      "--timeout",
      "0",
      "--",
    ]);
    expect(args.at(-1)).toBe("exec openclaw tui");
  });

  it("uses the Hermes image, state path, health probe, and TUI adapter", () => {
    const hermesInput = { ...input, agentPlatform: "hermes" as const };
    const bridgeInput = {
      ...hermesInput,
      projectRuntimeBridgeToken: "tali_prc_v1.test-payload.test-signature",
    };
    const createArgs = openShellSandboxCreateArguments(
      bridgeInput,
      "/tmp/SOUL.md",
      "/tmp/tali-nemoclaw-start",
      "/tmp/openshell-policy.yaml",
      "/tmp/tali-run-telemetry.env",
      { workspace: "tp-abcdefghijklmnop" },
    );

    expect(createArgs).toContain(
      "ghcr.io/tasklattice/tali-nemoclaw-hermes-sandbox:dev",
    );
    expect(createArgs).toContain("/tmp/SOUL.md:/sandbox/.hermes/SOUL.md");
    expect(createArgs).toContain(openShellRuntimeBridgeProviderName(hermesInput.name));
    expect(createArgs.join(" ")).not.toContain("TALI_DURABLE_MEMORY_ENDPOINT");
    expect(createArgs).toContain(
      "/tmp/tali-run-telemetry.env:/tmp/tali-run-telemetry.env",
    );
    expect(
      openShellNemoClawProbeArguments(
        hermesInput.name,
        hermesInput.agentPlatform,
      ).at(-1),
    ).toContain("127.0.0.1:8642/health");
    expect(
      openShellTerminalArguments(
        hermesInput.name,
        hermesInput.agentPlatform,
      ).at(-1),
    ).toBe("exec hermes --tui");
    expect(
      nemoClawTerminalArguments(
        hermesInput.name,
        hermesInput.agentPlatform,
      ).at(-1),
    ).toBe("exec hermes --tui");

    const bootstrap = getAgentPlatformRuntime("hermes").bootstrapScript(
      "https://hermes.example.test",
      "18789",
      "http://inference.example.test/v1",
      "tali/provider/deepseek-chat",
      undefined,
      "http://tali-agent-runtime-bridge.tp-abcdefghijklmnop.svc.cluster.local:8080",
      hermesInput.instanceId,
      true,
      true,
    );
    expect(bootstrap).toContain("--a2a-registry-url");
    expect(bootstrap).toContain(
      '--a2a-registry-token "$TALI_PROJECT_RUNTIME_BRIDGE_TOKEN"',
    );
    expect(bootstrap).toContain(
      `coordinatorInstanceId=${hermesInput.instanceId}`,
    );
    expect(bootstrap).toContain("--vector-database-registry-url");
    expect(bootstrap).toContain(
      '--vector-database-registry-token "$TALI_PROJECT_RUNTIME_BRIDGE_TOKEN"',
    );
    expect(bootstrap).toContain("--durable-memory-provider tali_relay");
    expect(bootstrap).toContain("TALI_DURABLE_MEMORY_ENDPOINT");
    expect(bootstrap).not.toContain("tali_prc_v1.test-payload.test-signature");
    expect(bootstrap).toContain(
      'export TALI_DURABLE_MEMORY_TOKEN="$TALI_PROJECT_RUNTIME_BRIDGE_TOKEN"',
    );
    expect(bootstrap).not.toContain("\n+");

    const nativeBootstrap = getAgentPlatformRuntime("hermes").bootstrapScript(
      "https://hermes.example.test",
      "18789",
      "http://inference.example.test/v1",
      "tali/provider/deepseek-chat",
      { mode: "native", citations: "auto" },
      "http://tali-agent-runtime-bridge.tp-abcdefghijklmnop.svc.cluster.local:8080",
      hermesInput.instanceId,
      true,
      false,
    );
    expect(nativeBootstrap).toContain("--a2a-registry-url");
    expect(nativeBootstrap).toContain("--vector-database-registry-url");
    expect(nativeBootstrap).not.toContain("--durable-memory-provider tali_relay");
    expect(agentMemoryInstructions(
      { mode: "native", citations: "auto" },
      "hermes",
    )).toContain("Hermes Instance uses its built-in, Instance-scoped text memory");
  });

  it("uses the Deep Agents image, managed state path, TUI, and headless contract", () => {
    const deepAgentsInput = { ...input, agentPlatform: "deepagents" as const };
    const createArgs = openShellSandboxCreateArguments(
      deepAgentsInput,
      "/tmp/AGENTS.md",
      "/tmp/tali-nemoclaw-start",
      "/tmp/openshell-policy.yaml",
      "/tmp/tali-run-telemetry.env",
    );
    const runtime = getAgentPlatformRuntime("deepagents");
    const bootstrap = runtime.bootstrapScript(
      "http://unused.example.test",
      "18789",
      "http://inference.example.test/v1",
      "tali/provider/deepseek-chat",
    );

    expect(createArgs).toContain(
      "ghcr.io/tasklattice/tali-nemoclaw-deepagents-sandbox:dev",
    );
    expect(createArgs).toContain(
      "/tmp/AGENTS.md:/sandbox/.deepagents/agent/AGENTS.md",
    );
    expect(createArgs).not.toContain(
      "/tmp/tali-run-telemetry.env:/tmp/tali-run-telemetry.env",
    );
    expect(runtime.endpointKind).toBeUndefined();
    expect(runtime.headlessCommand).toBe("dcode -n");
    expect(runtime.healthProbe("18789")).toContain("dcode --version");
    expect(runtime.healthProbe("18789")).not.toContain("curl");
    expect(openShellTerminalArguments(
      deepAgentsInput.name,
      deepAgentsInput.agentPlatform,
    ).at(-1)).toBe("exec dcode");
    expect(nemoClawTerminalArguments(
      deepAgentsInput.name,
      deepAgentsInput.agentPlatform,
    ).at(-1)).toBe("exec dcode");
    expect(bootstrap).toContain(
      "/opt/nemoclaw-deepagents-code/generate-config.ts",
    );
    expect(bootstrap).toContain(
      'NEMOCLAW_UPSTREAM_ENDPOINT_URL="$upstream_endpoint"',
    );
    expect(bootstrap).toContain(
      'NEMOCLAW_INFERENCE_BASE_URL="$upstream_endpoint"',
    );
    expect(bootstrap).not.toContain(
      "NEMOCLAW_INFERENCE_BASE_URL=https://inference.local/v1",
    );
    expect(bootstrap).toContain("exec /usr/local/bin/nemoclaw-start");
  });

  it("normalizes only a sandbox-owned Hermes workspace mount", () => {
    const bootstrap = getAgentPlatformRuntime("hermes").bootstrapScript(
      "http://hermes.example.test",
      "18789",
      "http://inference.example.test/v1",
      "deepseek-chat",
    );

    expect(bootstrap).toContain("workspace_identity=\"$(stat -c '%u:%g' /sandbox)\"");
    expect(bootstrap).toContain('[ "$workspace_identity" != "$sandbox_identity" ]');
    expect(bootstrap).toContain("chmod 0770 /sandbox");
    expect(bootstrap).toContain("chmod g-s /sandbox");
    expect(bootstrap).toContain("chmod 3770 /sandbox/.hermes");
    expect(bootstrap).toContain("[bootstrap] Hermes identity");
    expect(bootstrap).toContain("bootstrap-hermes-config.py");
    expect(bootstrap).toContain("hermes-webui-auth-proxy.py");
    expect(bootstrap).not.toContain("export TALI_RUN_TELEMETRY_TOKEN=");
    expect(bootstrap).toContain("/tmp/tali-run-telemetry.env");
    expect(bootstrap).not.toContain("TALI_RUN_TELEMETRY_TOKEN_B64");
    expect(bootstrap).toContain("--listen-port \"$webui_public_port\"");
    expect(bootstrap).toContain('--parent-pid "$$"');
    expect(bootstrap).toContain('NEMOCLAW_DASHBOARD_PORT=$webui_upstream_port');
    expect(bootstrap).toContain("readonly webui_upstream_port=18790");
    expect(bootstrap).toContain(
      'exec env "NEMOCLAW_DASHBOARD_PORT=$webui_upstream_port"',
    );
    expect(bootstrap).not.toContain("hermes_runtime_pid");
    expect(bootstrap).not.toContain("cleanup_hermes_webui");
    expect(bootstrap).not.toContain("sed -i");
    expect(getAgentPlatformRuntime("hermes").healthProbe("18789")).toContain(
      "http://127.0.0.1:18790/",
    );
    expect(bootstrap.indexOf("chmod 0770 /sandbox")).toBeLessThan(
      bootstrap.indexOf("/usr/local/bin/nemoclaw-start"),
    );
  });

  it("bakes authenticated loopback health probes into the Hermes image", async () => {
    const dockerfile = await readFile(
      new URL("../../../infra/docker/Dockerfile.nemoclaw-hermes", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain("patch-hermes-dashboard-health-auth.py");
    expect(dockerfile).toContain("patch-hermes-nonroot-cron-drain.py");
    expect(dockerfile).toContain("hermes-run-telemetry/plugin.yaml");
    expect(dockerfile).toContain("hermes-run-telemetry/__init__.py");
    expect(dockerfile).toContain(
      "patch-hermes-dashboard-credential-placeholder.py",
    );
    expect(dockerfile).toContain("/opt/hermes/hermes_cli/web_server.py");
    expect(dockerfile).toContain(
      "/usr/local/lib/nemoclaw/seed-hermes-dashboard-config.py",
    );
    expect(dockerfile).toContain("/opt/hermes/gateway/drain_control.py");
    expect(dockerfile).toContain("python3 -m py_compile");
  });

  it("bootstraps native OpenClaw Memory without enabling semantic search", () => {
    const bootstrap = getAgentPlatformRuntime("openclaw").bootstrapScript(
      "http://openclaw.example.test",
      "18789",
      "http://inference.example.test/v1",
      "deepseek-chat",
      { mode: "native", citations: "auto" },
    );

    expect(bootstrap).toContain("MEMORY.md");
    expect(bootstrap).toContain('enabled: false');
    expect(bootstrap).toContain('backend: "builtin"');
    expect(agentMemoryInstructions({ mode: "native", citations: "auto" }))
      .toContain("Read MEMORY.md at the start of a new session");
  });

  it("enables the scoped Durable Memory plugin for OpenClaw without exposing a Bank id", () => {
    const bridge = "http://tali-agent-runtime-bridge.tp-abcdefghijklmnop.svc.cluster.local:8080";
    const bootstrap = getAgentPlatformRuntime("openclaw").bootstrapScript(
      "http://openclaw.example.test",
      "18789",
      "http://inference.example.test/v1",
      "deepseek-chat",
      { mode: "native", citations: "auto" },
      bridge,
      input.instanceId,
      true,
      true,
    );

    expect(bootstrap).toContain("/usr/local/lib/tali/openclaw-durable-memory");
    expect(bootstrap).toContain('pluginEntries["tali-durable-memory"]');
    expect(bootstrap).toContain("allowPromptInjection: true");
    expect(bootstrap).not.toContain("tali_prc_v1.test-payload.test-signature");
    expect(bootstrap).toContain(
      'export TALI_DURABLE_MEMORY_TOKEN="$TALI_PROJECT_RUNTIME_BRIDGE_TOKEN"',
    );
    expect(bootstrap).toContain(Buffer.from(
      `${bridge}/v1/memory/coordinators/${input.instanceId}`,
    ).toString("base64"));
    expect(bootstrap).not.toContain("bankId");
    expect(bootstrap).not.toContain("providerRef");
  });

  it("configures Hybrid Memory through the Instance LiteLLM endpoint", () => {
    const bootstrap = getAgentPlatformRuntime("openclaw").bootstrapScript(
      "http://openclaw.example.test",
      "18789",
      "http://inference.example.test/v1",
      "deepseek-chat",
      {
        mode: "hybrid",
        embeddingModel: "tali/provider-a/text-embedding-3-small",
        includeSessionTranscripts: true,
        citations: "auto",
        maxResults: 6,
        minScore: 0.35,
      },
    );

    expect(bootstrap).toContain('provider: "openai-compatible"');
    expect(bootstrap).toContain("OPENAI_API_KEY");
    expect(bootstrap).toContain('sources: memory.includeSessionTranscripts');
    expect(agentMemoryInstructions({
      mode: "hybrid",
      embeddingModel: "embedding-model",
      includeSessionTranscripts: true,
      citations: "auto",
      maxResults: 6,
      minScore: 0.35,
    })).toContain("Use memory_search before answering");
  });

  it("exposes the NemoClaw Web UI as a named OpenShell service", () => {
    expect(openShellWebUiServiceArguments(input.name, "expose").slice(-5)).toEqual([
      "service",
      "expose",
      input.name,
      "18789",
      "webui",
    ]);
    expect(openShellWebUiServiceArguments(input.name, "get").slice(-4)).toEqual([
      "service",
      "get",
      input.name,
      "webui",
    ]);
    expect(openShellWebUiServiceArguments(input.name, "delete").slice(-4)).toEqual([
      "service",
      "delete",
      input.name,
      "webui",
    ]);
  });

  it("extracts the browser endpoint from colored OpenShell output", () => {
    expect(
      parseOpenShellServiceUrl(
        "URL: \u001b[36mhttp://default--sandbox--webui.openshell.localhost:8080/\u001b[39m\n",
      ),
    ).toBe("http://default--sandbox--webui.openshell.localhost:8080/");
    expect(parseOpenShellServiceUrl("service endpoint not found")).toBeUndefined();
  });

  it("authorizes the routed origin and bootstraps dashboard authentication", () => {
    const endpoint =
      "http://default--tali-research-a1b2c3d4--webui.openshell.localhost:8080/";
    expect(openShellWebUiOrigin("tali-research-a1b2c3d4")).toBe(
      "http://default--tali-research-a1b2c3d4--webui.openshell.localhost:8080",
    );
    expect(openShellWebUiOriginEnsureArguments(input.name, endpoint)).toContain(
      "http://default--tali-research-a1b2c3d4--webui.openshell.localhost:8080",
    );
    expect(openShellWebUiOriginProbeArguments(input.name, endpoint)).toContain(
      "http://default--tali-research-a1b2c3d4--webui.openshell.localhost:8080",
    );
    expect(openShellWebUiTokenArguments(input.name).slice(-6)).toEqual([
      "--name",
      input.name,
      "--",
      "node",
      "-e",
      'const c=require("/sandbox/.openclaw/openclaw.json");process.stdout.write(c.gateway.auth.token)',
    ]);
    expect(tokenizedOpenClawUrl(endpoint, "secret value\n")).toBe(
      `${endpoint}#token=secret+value`,
    );
  });

  it("uses and validates the OpenShell workspace in routed origins", () => {
    vi.stubEnv("OPENSHELL_WORKSPACE", "team-a");
    expect(openShellWorkspace()).toBe("team-a");
    expect(openShellWebUiOrigin("sandbox-a")).toBe(
      "http://team-a--sandbox-a--webui.openshell.localhost:8080",
    );

    vi.stubEnv("OPENSHELL_WORKSPACE", "team--a");
    expect(() => openShellWorkspace()).toThrow("OPENSHELL_WORKSPACE");
    vi.unstubAllEnvs();
  });

  it("initializes a routed workspace through the bootstrapped default scope", () => {
    const target = {
      gatewayEndpoint:
        "http://openshell-tp-abcdefghijklmnop.tp-abcdefghijklmnop.svc.cluster.local:8080",
      serviceBaseUrl: "http://openshell.localhost:8080",
      workspace: "tp-abcdefghijklmnop",
    };
    expect(
      openShellWorkspaceAdminArguments([
        "workspace",
        "create",
        "--name",
        target.workspace,
      ], target),
    ).toEqual([
      "--gateway-endpoint",
      target.gatewayEndpoint,
      "--workspace",
      "default",
      "workspace",
      "create",
      "--name",
      target.workspace,
    ]);
  });

  it("issues a short-lived user-scoped Hermes dashboard access token", () => {
    const endpoint = "https://tali-hermes--webui.example.test/";
    const tokenized = new URL(tokenizedHermesDashboardUrl(
      endpoint,
      "a-safe-instance-secret-with-more-than-32-bytes",
      "local-admin@example.test",
      Date.parse("2026-08-13T00:00:00.000Z"),
      "one-time-nonce",
    ));
    const token = tokenized.searchParams.get("access_token");
    expect(token).toBeTruthy();
    const [encodedPayload, signature] = token!.split(".");
    const payload = JSON.parse(
      Buffer.from(encodedPayload!, "base64url").toString("utf8"),
    );
    expect(payload).toMatchObject({
      aud: "tali-hermes-dashboard",
      exp: 1786579500,
      iat: 1786579200,
      jti: "one-time-nonce",
      typ: "access",
    });
    expect(payload.sub).not.toContain("local-admin");
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(openShellHermesWebUiSecretArguments(input.name).at(-1)).toContain(
      "/tmp/tali-hermes-webui-secret",
    );
    expect(openShellHermesWebUiProbeArguments(input.name).at(-1)).toContain(
      "/__tali/health",
    );
    expect(openShellHermesWebUiProbeArguments(input.name).at(-1)).toContain(
      "http://127.0.0.1:18790/",
    );
  });

  it("round-trips bounded browser terminal resize messages", () => {
    expect(
      parseTerminalClientMessage(
        encodeTerminalResize({ cols: 120, rows: 36 }),
      ),
    ).toEqual({ type: "resize", cols: 120, rows: 36 });
    expect(parseTerminalClientMessage("plain terminal input")).toEqual({
      type: "input",
      data: "plain terminal input",
    });
    expect(parseTerminalClientMessage("\u0000TALI_RESIZE:120:36:1")).toEqual({
      type: "invalid-control",
    });
    expect(
      parseTerminalClientMessage(encodeTerminalResize({ cols: 2, rows: 1 })),
    ).toEqual({ type: "resize", cols: 2, rows: 1 });
    expect(
      parseTerminalClientMessage(encodeTerminalResize({ cols: 0, rows: 0 })),
    ).toEqual({ type: "invalid-control" });
  });
});
