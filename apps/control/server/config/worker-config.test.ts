import { execFileSync } from "node:child_process";
import { parseAllDocuments } from "yaml";
import { validateWorkerImageSources } from "../kubernetes/project-image-pull-readiness";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { developmentWorkerConfig, getWorkerConfig, setWorkerConfigForTests } from "./worker-config";

const directories: string[] = [];
afterEach(() => {
  setWorkerConfigForTests();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function configure(settings: string, section = "project_openshell") {
  const directory = mkdtempSync(join(tmpdir(), "relay-worker-config-"));
  directories.push(directory);
  const path = join(directory, "worker.toml");
  writeFileSync(path, `[worker.${section}]\n${settings}\n`);
  vi.stubEnv("TALI_WORKER_CONFIG", path);
  setWorkerConfigForTests();
}
describe("OpenShift image source configuration", () => {
  it("requires an explicit valid source when enabled", () => {
    configure("enabled = true", "openshift");
    expect(() => getWorkerConfig()).toThrow("requires imageSourceNamespace");
    configure('enabled = true\nimageSourceNamespace = "tali"', "openshift");
    expect(getWorkerConfig().openshift).toEqual({ enabled: true, imageSourceNamespace: "tali" });
    configure('enabled = true\nimageSourceNamespace = "INVALID/source"', "openshift");
    expect(() => getWorkerConfig()).toThrow("Invalid Worker configuration");
  });
});

describe("OpenShell timeout configuration", () => {
  it("defaults to 300/600/2100 seconds", () => {
    expect(developmentWorkerConfig().project_openshell).toMatchObject({
      certgenActiveDeadlineSeconds: 300, helmTimeoutSeconds: 600, helmProcessTimeoutSeconds: 2100,
    });
  });
  it("accepts custom phase budgets", () => {
    configure("certgenActiveDeadlineSeconds = 420\nhelmTimeoutSeconds = 900\nhelmProcessTimeoutSeconds = 3000");
    expect(getWorkerConfig().project_openshell.helmProcessTimeoutSeconds).toBe(3000);
  });
  it.each([
    ["certgenActiveDeadlineSeconds = 0", "Invalid Worker configuration"],
    ["certgenActiveDeadlineSeconds = 600", "must exceed"],
    ["helmProcessTimeoutSeconds = 330", "three Helm phases"],
  ])("rejects invalid budgets: %s", (settings, message) => {
    configure(settings);
    expect(() => getWorkerConfig()).toThrow(message);
  });
});

it("accepts optional registry routes/readiness budget without changing old Worker config", () => {
  configure('enabled = true\nimageSourceNamespace = "images"\nimageRegistryHost = "registry.apps.example:5000"\nimagePullReadyTimeoutMs = 30000', "openshift");
  expect(getWorkerConfig().openshift).toMatchObject({ imageRegistryHost: "registry.apps.example:5000", imagePullReadyTimeoutMs: 30000 });
  configure('enabled = true\nimageSourceNamespace = "images"\nimagePullReadyTimeoutMs = 0', "openshift");
  expect(() => getWorkerConfig()).toThrow("Invalid Worker configuration");
});

// Exercise the generated TOML through the real Worker parser and preflight,
// rather than maintaining a second hand-written runtime configuration fixture.
it.each([
  [true, "", ""],
  [true, "shared-images", "registry.apps.example:5443"],
  [false, "", ""],
])("accepts Helm tenant images (OCP=%s source=%s registry=%s)", (enabled, source, registry) => {
  const rendered = execFileSync("helm", ["template", "relay", "charts/tali-relay", "--namespace", "control-images", "--kube-version", "1.29.0",
    "--set", "openshift.runtimeImages.enabled=true", "--set", `openshift.enabled=${enabled}`, "--set", `openshift.imageSourceNamespace=${source}`,
    "--set", `openshift.imageRegistryHost=${registry}`], {
    cwd: join(import.meta.dirname, "../../../.."), encoding: "utf8",
  });
  const resources = parseAllDocuments(rendered).map(document => document.toJSON());
  const toml = resources.find(resource => resource?.stringData?.["worker.toml"]).stringData["worker.toml"];
  const directory = mkdtempSync(join(tmpdir(), "relay-worker-chart-"));
  directories.push(directory);
  const path = join(directory, "worker.toml");
  writeFileSync(path, toml);
  vi.stubEnv("TALI_WORKER_CONFIG", path);
  setWorkerConfigForTests();
  const config = getWorkerConfig();
  expect(() => validateWorkerImageSources(config)).not.toThrow();
  if (enabled) {
    const prefix = `${registry || "image-registry.openshift-image-registry.svc:5000"}/${source || "control-images"}/`;
    for (const image of [config.project_openshell.gatewayImageRepository, config.project_openshell.supervisorImageRepository,
      config.project_openshell.sandboxImage, ...(config.project_openshell.sandboxImages ?? []),
      config.project_runtime_bridge.image, config.expert_agent_runtime.image]) {
      expect(image.startsWith(prefix)).toBe(true);
    }
  } else {
    expect(config.project_openshell.gatewayImageRepository).toBe("ghcr.io/nvidia/openshell/gateway");
    expect(config.project_openshell.supervisorImageRepository).toBe("ghcr.io/nvidia/openshell/supervisor");
  }
});
