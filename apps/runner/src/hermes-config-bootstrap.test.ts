import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const temporaryDirectories: string[] = [];
const bootstrap = resolve(
  import.meta.dirname,
  "../../../scripts/bootstrap-hermes-config.py",
);
const mcpHash = "a".repeat(64);
const managedCredentialPlaceholder =
  "openshell:resolve:env:v123456_OPENAI_API_KEY";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Hermes config bootstrap", () => {
  it("enables the bundled Run telemetry plugin", () => {
    const program = `
import importlib.util
import json
import sys
spec = importlib.util.spec_from_file_location("tali_bootstrap", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
document = {
  "plugins": {"enabled": ["existing"], "disabled": ["tali-run-telemetry", "other"]},
}
module.enable_run_telemetry(document)
print(json.dumps(document))
`;
    const result = spawnSync("python3", ["-c", program, bootstrap], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      plugins: {
        enabled: ["existing", "tali-run-telemetry"],
        disabled: ["other"],
      },
    });
  });

  it("selects Relay's scoped MemoryProvider without persisting Runtime credentials", () => {
    const program = `
import importlib.util
import json
import sys
spec = importlib.util.spec_from_file_location("tali_bootstrap", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
document = {"memory": {"existing": True}}
module.configure_durable_memory(document, "tali_relay")
print(json.dumps(document))
`;
    const result = spawnSync("python3", ["-c", program, bootstrap], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      memory: { existing: true, provider: "tali_relay" },
    });
    expect(result.stdout).not.toContain("token");
    expect(result.stdout).not.toContain("bank");
  });

  it("persists only the validated Durable Memory endpoint in the managed environment", () => {
    const program = `
import importlib.util
import sys
spec = importlib.util.spec_from_file_location("tali_bootstrap", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
endpoint = "http://runtime-bridge.project.svc.cluster.local:8080/v1/memory/coordinators/agent-a"
module.validate_durable_memory_endpoint(endpoint)
print(module.set_environment_value(b"HERMES_HOME=/sandbox/.hermes\\n", "TALI_DURABLE_MEMORY_ENDPOINT", endpoint).decode(), end="")
`;
    const result = spawnSync("python3", ["-c", program, bootstrap], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("HERMES_HOME=/sandbox/.hermes");
    expect(result.stdout).toContain(
      "TALI_DURABLE_MEMORY_ENDPOINT=http://runtime-bridge.project.svc.cluster.local:8080/v1/memory/coordinators/agent-a",
    );
    expect(result.stdout).not.toContain("TOKEN=");
  });

  it("enables the pinned Relay A2A plugin and Kanban for Bridge peers", () => {
    const program = `
import importlib.util
import json
import sys
spec = importlib.util.spec_from_file_location("tali_bootstrap", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
document = {
  "toolsets": ["hermes-cli"],
  "plugins": {"enabled": ["existing"], "disabled": ["tali-a2a", "other"]},
}
registry = {"a2a_agents": {
  "reviewer": {
    "url": "http://runtime-bridge.project.svc.cluster.local/v1/a2a/coordinators/hermes/agents/reviewer",
    "timeout": 30,
    "capabilities": ["review"],
  },
}}
module.configure_a2a(
  document,
  "http://runtime-bridge.project.svc.cluster.local/v1/hermes/a2a-agents",
  "coordinator-token",
  registry,
)
print(json.dumps(document))
`;
    const result = spawnSync("python3", ["-c", program, bootstrap], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const document = JSON.parse(result.stdout) as Record<string, any>;
    expect(document.toolsets).toEqual(["hermes-cli", "kanban", "a2a"]);
    expect(document.plugins.enabled).toEqual(["existing", "tali-a2a"]);
    expect(document.plugins.disabled).toEqual(["other"]);
    expect(document.gateway?.platforms?.a2a).toBeUndefined();
    expect(document.a2a_agents).toBeUndefined();
    expect(document.a2a_registry).toEqual({
      url: "http://runtime-bridge.project.svc.cluster.local/v1/hermes/a2a-agents",
      timeout: 10,
      auth: { type: "bearer", token: "coordinator-token" },
    });
  });

  it("enables dynamic Project Vector Database tools without storing a catalog snapshot", () => {
    const program = `
import importlib.util
import json
import sys
spec = importlib.util.spec_from_file_location("tali_bootstrap", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
document = {
  "toolsets": ["hermes-cli"],
  "plugins": {"enabled": ["existing"], "disabled": ["tali-vector-database", "other"]},
}
registry = {"vector_databases": {
  "papers": {
    "name": "Research Papers",
    "description": "Project-scoped research papers.",
    "top_k": 8,
    "url": "http://runtime-bridge.project.svc.cluster.local/v1/hermes/vector-databases/papers/search?coordinatorInstanceId=hermes",
  },
}}
module.configure_vector_databases(
  document,
  "http://runtime-bridge.project.svc.cluster.local/v1/hermes/vector-databases?coordinatorInstanceId=hermes",
  "coordinator-token",
  registry,
)
print(json.dumps(document))
`;
    const result = spawnSync("python3", ["-c", program, bootstrap], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const document = JSON.parse(result.stdout) as Record<string, any>;
    expect(document.toolsets).toEqual(["hermes-cli", "vector-database"]);
    expect(document.plugins.enabled).toEqual([
      "existing",
      "tali-vector-database",
    ]);
    expect(document.plugins.disabled).toEqual(["other"]);
    expect(document.vector_databases).toBeUndefined();
    expect(document.vector_database_registry).toEqual({
      url: "http://runtime-bridge.project.svc.cluster.local/v1/hermes/vector-databases?coordinatorInstanceId=hermes",
      timeout: 10,
      auth: { type: "bearer", token: "coordinator-token" },
    });
  });

  it("routes through the custom provider with OpenShell's runtime credential placeholder", async () => {
    const root = await mkdtemp(join(tmpdir(), "tali-hermes-config-"));
    temporaryDirectories.push(root);
    const state = join(root, ".hermes");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(state));
    const config = join(state, "config.yaml");
    const environment = join(state, ".env");
    const anchor = join(state, ".config-hash");
    const builder = join(root, "mcp-digest.py");
    const guard = join(root, "guard.py");
    const initial = `# Managed by NemoClaw
_nemoclaw_upstream:
  provider: deepseek
  provider_key: deepseek
  model: deepseek-chat
model:
  default: deepseek-chat
  provider: custom
  base_url: "https://inference.local/v1"
  api_key: image-template-only
providers:
  deepseek:
    name: deepseek
    api: "https://inference.local/v1"
    api_key: image-template-only
custom_providers:
  -
    name: deepseek
    base_url: "https://inference.local/v1"
    api_key: image-template-only
`;
    const env = "HERMES_HOME=/sandbox/.hermes\n";
    await writeFile(config, initial);
    await writeFile(environment, env);
    await writeFile(builder, `print("${mcpHash}")\n`);
    await writeFile(guard, "# test guard\n");
    await writeFile(
      anchor,
      `${digest(initial)}  ${config}\n${digest(env)}  ${environment}\n# nemoclaw-hermes-mcp-state-v1 intended=${mcpHash} applied=${mcpHash}\n`,
    );

    const args = [
      bootstrap,
      "--config",
      config,
      "--hash-file",
      anchor,
      "--endpoint",
      "http://tali-litellm:4000/v1",
      "--model",
      "tali/provider/deepseek-v4-pro",
      "--template-endpoint",
      "https://inference.local/v1",
      "--template-model",
      "deepseek-chat",
      "--durable-memory-provider",
      "tali_relay",
      "--durable-memory-endpoint",
      "http://runtime-bridge.project.svc.cluster.local:8080/v1/memory/coordinators/agent-a",
      "--mcp-digest-builder",
      builder,
      "--runtime-config-guard",
      guard,
    ];
    const first = spawnSync("python3", args, {
      encoding: "utf8",
      env: { ...process.env, OPENAI_API_KEY: managedCredentialPlaceholder },
    });
    expect(first.status, first.stderr).toBe(0);
    const migrated = await readFile(config, "utf8");
    const document = parse(migrated) as Record<string, any>;
    expect(document.model.provider).toBe("custom");
    expect(document.model.api_key).toBe(managedCredentialPlaceholder);
    expect(document.providers.deepseek.api_key).toBe(managedCredentialPlaceholder);
    expect(document.custom_providers[0].api_key).toBe(managedCredentialPlaceholder);
    expect(document.plugins.enabled).toContain("tali-run-telemetry");
    expect(document.memory.provider).toBe("tali_relay");
    const migratedEnvironment = await readFile(environment, "utf8");
    expect(migratedEnvironment).toContain(
      "TALI_DURABLE_MEMORY_ENDPOINT=http://runtime-bridge.project.svc.cluster.local:8080/v1/memory/coordinators/agent-a",
    );
    expect(migratedEnvironment).not.toContain("TALI_DURABLE_MEMORY_TOKEN");
    expect(migratedEnvironment).not.toContain("TALI_PROJECT_RUNTIME_BRIDGE_TOKEN");

    const rotatedPlaceholder =
      "openshell:resolve:env:v123457_OPENAI_API_KEY";
    const second = spawnSync("python3", args, {
      encoding: "utf8",
      env: { ...process.env, OPENAI_API_KEY: rotatedPlaceholder },
    });
    expect(second.status, second.stderr).toBe(0);
    const rerun = await readFile(config, "utf8");
    const rotated = parse(rerun) as Record<string, any>;
    expect(rotated.model.api_key).toBe(rotatedPlaceholder);
    expect(rotated.providers.deepseek.api_key).toBe(rotatedPlaceholder);
    expect(rotated.custom_providers[0].api_key).toBe(rotatedPlaceholder);
    expect(await readFile(environment, "utf8")).toBe(migratedEnvironment);
    expect(await readFile(anchor, "utf8")).toContain(
      `${digest(rerun)}  ${config}`,
    );
  });

  it.each([
    ["missing", undefined],
    ["literal secret", "sk-live-secret"],
    ["unversioned placeholder", "openshell:resolve:env:OPENAI_API_KEY"],
  ])("fails closed for a %s model credential", async (_name, credential) => {
    const root = await mkdtemp(join(tmpdir(), "tali-hermes-config-"));
    temporaryDirectories.push(root);
    const state = join(root, ".hermes");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(state));
    const config = join(state, "config.yaml");
    const environment = join(state, ".env");
    const anchor = join(state, ".config-hash");
    const builder = join(root, "mcp-digest.py");
    const guard = join(root, "guard.py");
    const initial = `_nemoclaw_upstream:\n  provider: deepseek\nmodel:\n  default: deepseek-chat\n  provider: deepseek\n  base_url: https://inference.local/v1\n  api_key: image-template-only\nproviders:\n  deepseek:\n    api_key: image-template-only\ncustom_providers:\n  - name: deepseek\n    api_key: image-template-only\n`;
    const env = "HERMES_HOME=/sandbox/.hermes\n";
    await writeFile(config, initial);
    await writeFile(environment, env);
    await writeFile(builder, `print("${mcpHash}")\n`);
    await writeFile(guard, "# test guard\n");
    await writeFile(
      anchor,
      `${digest(initial)}  ${config}\n${digest(env)}  ${environment}\n# nemoclaw-hermes-mcp-state-v1 intended=${mcpHash} applied=${mcpHash}\n`,
    );
    const childEnvironment = { ...process.env };
    if (credential === undefined) delete childEnvironment.OPENAI_API_KEY;
    else childEnvironment.OPENAI_API_KEY = credential;
    const result = spawnSync("python3", [
      bootstrap,
      "--config", config,
      "--hash-file", anchor,
      "--endpoint", "http://tali-litellm:4000/v1",
      "--model", "tali/provider/deepseek-v4-pro",
      "--template-endpoint", "https://inference.local/v1",
      "--template-model", "deepseek-chat",
      "--mcp-digest-builder", builder,
      "--runtime-config-guard", guard,
    ], { encoding: "utf8", env: childEnvironment });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Hermes requires an OpenShell-managed OPENAI_API_KEY placeholder",
    );
    expect(await readFile(config, "utf8")).toBe(initial);
  });
});
