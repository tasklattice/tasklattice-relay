import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const buildScript = join(repositoryRoot, "scripts/build-nemoclaw-sandbox.sh");
const deepAgentsInferencePatchScript = join(
  repositoryRoot,
  "scripts/patch-nemoclaw-deepagents-provider-v2-inference.mjs",
);
const openClawWrapper = join(
  repositoryRoot,
  "infra/docker/Dockerfile.nemoclaw-openclaw",
);
const deepAgentsWrapper = join(
  repositoryRoot,
  "infra/docker/Dockerfile.nemoclaw-deepagents",
);
const upstreamManagedInferenceFunction = `def managed_inference_base_url() -> str:
    """Read and validate the root-owned inference route baked into the image."""
    path = _INFERENCE_BASE_URL_FILE
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("managed inference base URL file is missing or unsafe")
    try:
        metadata = path.stat()
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError("managed inference base URL file is unreadable") from exc
    if (
        metadata.st_uid != _MANAGED_FILE_OWNER_UID
        or stat.S_IMODE(metadata.st_mode) != 0o444
    ):
        raise RuntimeError("managed inference base URL file has unsafe ownership or mode")
    value = raw.rstrip("\\n")
    if not value or len(value) > 2048 or raw not in {value, f"{value}\\n"}:
        raise RuntimeError("managed inference base URL file has invalid contents")
    if value != value.strip() or any(ord(character) < 32 for character in value):
        raise RuntimeError("managed inference base URL file has invalid contents")
    parsed = urlparse(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("managed inference base URL is invalid")
    return value`;
const upstreamManagedRuntimeFixture = `import stat
import sys

${upstreamManagedInferenceFunction}
`;
const upstreamManagedConfigPatchFixture = `CONFIG_PATCH = r'''
def _get_provider_kwargs(provider: str, *, model_name: str | None = None):
    from deepagents_code._nemoclaw_managed import (
        managed_inference_base_url,
        managed_reasoning_effort,
    )
    kwargs = {
        "api_key": "nemoclaw-managed-inference",
        "base_url": managed_inference_base_url(),
    }
    return kwargs
'''
`;

async function executable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { encoding: "utf8", mode: 0o755 });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("NemoClaw sandbox image build", () => {
  it("refreshes the selected OpenClaw tag before applying the local wrapper", async () => {
    const root = await mkdtemp(join(tmpdir(), "tali-nemoclaw-build-"));
    temporaryDirectories.push(root);
    const bin = join(root, "bin");
    const log = join(root, "docker.log");
    await mkdir(bin);

    await executable(
      join(bin, "git"),
      `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "clone" ]; then
  target=""
  for argument in "$@"; do target="$argument"; done
  mkdir -p "$target/scripts" "$target/agents/hermes"
  touch "$target/Dockerfile" "$target/agents/hermes/Dockerfile"
  touch "$target/scripts/nemoclaw-start.sh"
fi
`,
    );
    await executable(join(bin, "node"), "#!/usr/bin/env bash\nexit 0\n");
    await executable(
      join(bin, "docker"),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$DOCKER_LOG"
exit 0
`,
    );

    const finalImage = "registry.example/tali-nemoclaw-sandbox:dev";
    const result = spawnSync("bash", [buildScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        TMPDIR: root,
        DOCKER_LOG: log,
        NEMOCLAW_AGENT_PLATFORM: "openclaw",
        NEMOCLAW_IMAGE: finalImage,
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const commands = (await readFile(log, "utf8")).trim().split("\n");
    const builds = commands.filter((line) => line.startsWith("build "));
    const upstreamImage = "tali-nemoclaw-openclaw-upstream:0.0.123";

    expect(commands[0]).toBe(
      "pull ghcr.io/nvidia/nemoclaw/sandbox-base:v0.0.123",
    );
    expect(builds).toHaveLength(2);
    expect(builds[0]).toMatch(/^build --pull --file .*\/Dockerfile /);
    expect(builds[0]).toContain(
      "--build-arg BASE_IMAGE=ghcr.io/nvidia/nemoclaw/sandbox-base:v0.0.123",
    );
    expect(builds[0]).toContain(`--tag ${upstreamImage}`);
    expect(builds[1]).toBe(
      `build --file ${openClawWrapper} --build-arg BASE_IMAGE=${upstreamImage} --tag ${finalImage} ${repositoryRoot}`,
    );
  });

  it("rejects release image output outside the GitHub Actions release workflow", () => {
    const result = spawnSync("bash", [buildScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "false",
        GITHUB_ACTIONS: "false",
        NEMOCLAW_BUILD_OUTPUT: "ci-push",
      },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "Release image builds are only supported by the GitHub Actions release workflow.",
    );
  });

  it("rejects non-development final tags in local builds", () => {
    const result = spawnSync("bash", [buildScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        NEMOCLAW_BUILD_OUTPUT: "local",
        NEMOCLAW_IMAGE: "registry.example/tali-nemoclaw-sandbox:1.2.3",
      },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "Local Sandbox builds must use a :dev final image tag",
    );
  });

  it("streams CI release images through Buildx without loading them into Docker", async () => {
    const root = await mkdtemp(join(tmpdir(), "tali-nemoclaw-push-"));
    temporaryDirectories.push(root);
    const bin = join(root, "bin");
    const log = join(root, "docker.log");
    await mkdir(bin);

    await executable(
      join(bin, "git"),
      `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "clone" ]; then
  target=""
  for argument in "$@"; do target="$argument"; done
  mkdir -p "$target/scripts" "$target/agents/hermes"
  touch "$target/Dockerfile" "$target/agents/hermes/Dockerfile"
  touch "$target/scripts/nemoclaw-start.sh"
fi
`,
    );
    await executable(join(bin, "node"), "#!/usr/bin/env bash\nexit 0\n");
    await executable(
      join(bin, "docker"),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$DOCKER_LOG"
exit 0
`,
    );

    const finalImage = "registry.example/tali-nemoclaw-sandbox:1.2.3-arm64";
    const upstreamImage =
      "registry.example/tali-nemoclaw-sandbox:build-upstream-abc123-arm64";
    const result = spawnSync("bash", [buildScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        TMPDIR: root,
        DOCKER_LOG: log,
        CI: "true",
        GITHUB_ACTIONS: "true",
        GITHUB_REF_NAME: "v1.2.3",
        GITHUB_REF_TYPE: "tag",
        GITHUB_WORKFLOW_REF:
          "tasklattice/tasklattice-relay/.github/workflows/release.yml@refs/tags/v1.2.3",
        DOCKER_DEFAULT_PLATFORM: "linux/arm64",
        NEMOCLAW_AGENT_PLATFORM: "openclaw",
        NEMOCLAW_BUILD_OUTPUT: "ci-push",
        NEMOCLAW_IMAGE: finalImage,
        NEMOCLAW_UPSTREAM_IMAGE: upstreamImage,
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const commands = (await readFile(log, "utf8")).trim().split("\n");
    const builds = commands.filter((line) => line.startsWith("buildx build "));

    expect(commands[0]).toMatch(/^buildx imagetools inspect /);
    expect(builds).toHaveLength(2);
    expect(builds[0]).toContain("--platform linux/arm64 --push --pull");
    expect(builds[0]).toContain(`--tag ${upstreamImage}`);
    expect(builds[1]).toBe(
      `buildx build --platform linux/arm64 --push --file ${openClawWrapper} --build-arg BASE_IMAGE=${upstreamImage} --tag ${finalImage} ${repositoryRoot}`,
    );
    expect(commands.some((line) => line.startsWith("push "))).toBe(false);
  });

  it("builds the pinned Deep Agents Code source and local wrapper", async () => {
    const root = await mkdtemp(join(tmpdir(), "tali-deepagents-build-"));
    temporaryDirectories.push(root);
    const bin = join(root, "bin");
    const log = join(root, "docker.log");
    const startFixture = join(root, "deepagents-start.sh");
    const runtimeFixture = join(root, "managed-dcode-runtime.py");
    const configPatchFixture = join(root, "patch-managed-deepagents-code.py");
    await mkdir(bin);
    await writeFile(startFixture, "#!/usr/bin/env bash\nexec dcode\n", "utf8");
    await writeFile(runtimeFixture, upstreamManagedRuntimeFixture, "utf8");
    await writeFile(configPatchFixture, upstreamManagedConfigPatchFixture, "utf8");

    await executable(
      join(bin, "git"),
      `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "clone" ]; then
  target=""
  for argument in "$@"; do target="$argument"; done
  mkdir -p "$target/agents/langchain-deepagents-code"
  touch "$target/agents/langchain-deepagents-code/Dockerfile"
  touch "$target/agents/langchain-deepagents-code/Dockerfile.base"
  cp "$DEEPAGENTS_START_FIXTURE" "$target/agents/langchain-deepagents-code/start.sh"
  cp "$DEEPAGENTS_RUNTIME_FIXTURE" "$target/agents/langchain-deepagents-code/managed-dcode-runtime.py"
  cp "$DEEPAGENTS_CONFIG_PATCH_FIXTURE" "$target/agents/langchain-deepagents-code/patch-managed-deepagents-code.py"
fi
`,
    );
    await executable(
      join(bin, "docker"),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$DOCKER_LOG"
exit 0
`,
    );

    const finalImage = "registry.example/tali-nemoclaw-deepagents:dev";
    const result = spawnSync("bash", [buildScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        TMPDIR: root,
        DOCKER_LOG: log,
        DEEPAGENTS_START_FIXTURE: startFixture,
        DEEPAGENTS_RUNTIME_FIXTURE: runtimeFixture,
        DEEPAGENTS_CONFIG_PATCH_FIXTURE: configPatchFixture,
        NEMOCLAW_AGENT_PLATFORM: "deepagents",
        NEMOCLAW_DEEPAGENTS_IMAGE: finalImage,
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const commands = (await readFile(log, "utf8")).trim().split("\n");
    const builds = commands.filter((line) => line.startsWith("build "));
    const upstreamImage = "tali-nemoclaw-deepagents-upstream:0.0.123";

    expect(commands[0]).toBe(
      "pull ghcr.io/nvidia/nemoclaw/langchain-deepagents-code-sandbox-base:v0.0.123",
    );
    expect(builds).toHaveLength(2);
    expect(builds[0]).toMatch(
      /^build --pull --file .*\/agents\/langchain-deepagents-code\/Dockerfile /,
    );
    expect(builds[0]).toContain(
      "--build-arg BASE_IMAGE=ghcr.io/nvidia/nemoclaw/langchain-deepagents-code-sandbox-base:v0.0.123",
    );
    expect(builds[0]).toContain(`--tag ${upstreamImage}`);
    expect(builds[1]).toBe(
      `build --file ${deepAgentsWrapper} --build-arg BASE_IMAGE=${upstreamImage} --tag ${finalImage} ${repositoryRoot}`,
    );
  });
});

describe("NemoClaw Deep Agents Provider v2 inference patch", () => {
  it("uses the sandbox-local endpoint only with an endpoint-bound OpenShell credential", async () => {
    const root = await mkdtemp(join(tmpdir(), "tali-deepagents-inference-patch-"));
    temporaryDirectories.push(root);
    const target = join(root, "managed-dcode-runtime.py");
    const configPatch = join(root, "patch-managed-deepagents-code.py");
    await writeFile(target, upstreamManagedRuntimeFixture, "utf8");
    await writeFile(configPatch, upstreamManagedConfigPatchFixture, "utf8");

    const result = spawnSync(
      process.execPath,
      [deepAgentsInferencePatchScript, target, configPatch],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    const patched = await readFile(target, "utf8");
    expect(patched).toContain("import tomllib");
    expect(patched).toContain("def managed_inference_api_key()");
    expect(patched).toContain("def _tali_openshell_inference_base_url()");
    expect(patched).toContain('if not os.environ.get("OPENSHELL_SANDBOX")');
    expect(patched).toContain("OpenShell 0.0.106 exports the sandbox name");
    expect(patched).toContain(
      '_is_openshell_placeholder_for_name(credential_name, credential)',
    );
    expect(patched).toContain('Path("/sandbox/.deepagents/config.toml")');
    expect(patched).toContain("config_mode = stat.S_IMODE(before.st_mode)");
    expect(patched).toContain("config_mode not in {0o600, 0o660}");
    expect(patched).toContain(
      'document["models"]["providers"]["openai"]["base_url"]',
    );
    expect(patched).toContain("path = _INFERENCE_BASE_URL_FILE");
    expect(patched).toContain(
      '_is_openshell_placeholder_for_name(legacy_name, legacy_credential)',
    );
    const patchedConfig = await readFile(configPatch, "utf8");
    expect(patchedConfig).toContain("managed_inference_api_key,");
    expect(patchedConfig).toContain(
      '"api_key": managed_inference_api_key(),',
    );

    const syntax = spawnSync(
      "python3",
      ["-m", "py_compile", target, configPatch],
      { encoding: "utf8" },
    );
    expect(syntax.status, syntax.stderr).toBe(0);
  });

  it("fails closed on upstream drift and duplicate compatibility patches", async () => {
    const root = await mkdtemp(join(tmpdir(), "tali-deepagents-inference-drift-"));
    temporaryDirectories.push(root);
    const drifted = join(root, "drifted.py");
    const driftedConfig = join(root, "drifted-config.py");
    const validConfig = join(root, "valid-config.py");
    const patched = join(root, "patched.py");
    const patchedConfig = join(root, "patched-config.py");
    await writeFile(
      drifted,
      upstreamManagedRuntimeFixture.replace("0o444", "0o440"),
      "utf8",
    );
    await writeFile(validConfig, upstreamManagedConfigPatchFixture, "utf8");
    await writeFile(
      driftedConfig,
      upstreamManagedConfigPatchFixture.replace(
        '"api_key": "nemoclaw-managed-inference"',
        '"api_key": "upstream-drift"',
      ),
      "utf8",
    );
    await writeFile(patched, upstreamManagedRuntimeFixture, "utf8");
    await writeFile(patchedConfig, upstreamManagedConfigPatchFixture, "utf8");

    const driftResult = spawnSync(
      process.execPath,
      [deepAgentsInferencePatchScript, drifted, validConfig],
      { encoding: "utf8" },
    );
    expect(driftResult.status).not.toBe(0);
    expect(driftResult.stderr).toContain(
      "expected one import anchor and one managed inference function, found 1 and 0",
    );

    const configDriftResult = spawnSync(
      process.execPath,
      [deepAgentsInferencePatchScript, patched, driftedConfig],
      { encoding: "utf8" },
    );
    expect(configDriftResult.status).not.toBe(0);
    expect(configDriftResult.stderr).toContain(
      "expected one DCode config import and credential anchor, found 1 and 0",
    );

    expect(
      spawnSync(
        process.execPath,
        [deepAgentsInferencePatchScript, patched, patchedConfig],
        { encoding: "utf8" },
      ).status,
    ).toBe(0);
    const duplicateResult = spawnSync(
      process.execPath,
      [deepAgentsInferencePatchScript, patched, patchedConfig],
      { encoding: "utf8" },
    );
    expect(duplicateResult.status).not.toBe(0);
    expect(duplicateResult.stderr).toContain(
      "Provider v2 inference compatibility path is already present",
    );
  });
});
