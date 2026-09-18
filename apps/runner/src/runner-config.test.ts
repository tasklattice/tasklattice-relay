import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseAllDocuments } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRunnerConfig, setRunnerConfigForTests } from "./runner-config.js";

const directory = mkdtempSync(resolve(tmpdir(), "runner-config-"));
afterEach(() => { setRunnerConfigForTests(); vi.unstubAllEnvs(); });
process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
function load(config: unknown) {
  const path = resolve(directory, "runner.json");
  writeFileSync(path, JSON.stringify(config));
  vi.stubEnv("TALI_RUNNER_CONFIG", path);
  vi.stubEnv("NODE_ENV", "production");
  return getRunnerConfig();
}
describe("Runner file contract", () => {
  it("requires a file in production and rejects unknown deployment fields", () => {
    vi.stubEnv("TALI_RUNNER_CONFIG", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getRunnerConfig()).toThrow("TALI_RUNNER_CONFIG");
    expect(() => load({ openshell: { gatewayImage: "unused" } })).toThrow("Invalid Runner configuration");
  });
  it("consumes the Helm file and ignores old business env overrides", () => {
    const output = execFileSync("helm", ["template", "runner-test", "../../charts/tali-relay",
      "--kube-version", "1.29.0", "-f", "../../charts/tali-relay/values-dev.yaml"], { encoding: "utf8" });
    const objects = parseAllDocuments(output).map((doc) => doc.toJSON());
    const secret = objects.find((o) => o.stringData?.["runner.json"]);
    vi.stubEnv("NEMOCLAW_RUNNER_TOKEN", "ignored");
    vi.stubEnv("OPENSHELL_SANDBOX_CPU", "99");
    const config = load(JSON.parse(secret.stringData["runner.json"]));
    expect(config.server.token).not.toBe("ignored");
    expect(config.openshell.sandbox.cpu).toBe("1");
    expect(config.openshell.startTimeoutMs).toBe(600000);
    expect(config.openshell.projectTargetRouting).toBe(true);
    expect(config.openshell.serviceProxy.enabled).toBe(true);
  });
});
