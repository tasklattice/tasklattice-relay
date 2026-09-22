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
