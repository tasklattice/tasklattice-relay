import {
  getWorkerConfig,
  setWorkerConfigForTests,
  developmentWorkerConfig,
} from "./worker-config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseAllDocuments } from "yaml";
import { stringify } from "smol-toml";
import {
  developmentControlConfig,
  getControlConfig,
  setControlConfigForTests,
} from "./control-config";
import { deploymentBootstrapRuntimeConfiguration } from "../platform/platform-runtime-config";
import { DoclingClient } from "../catalog/docling-client";
import { AgentGardenService } from "../agent-garden/agent-garden-service";
import { AgentGardenStore } from "../agent-garden/agent-garden-store";
import { createTestStore } from "../test/store";

const temporary = mkdtempSync(resolve(tmpdir(), "relay-config-"));
afterEach(() => {
  vi.unstubAllEnvs();
  setControlConfigForTests(undefined);
  setWorkerConfigForTests(undefined);
});
process.on("exit", () => rmSync(temporary, { recursive: true, force: true }));

function load(raw: string) {
  const path = resolve(temporary, "control.toml");
  writeFileSync(path, raw);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TALI_CONFIG", path);
  setControlConfigForTests(undefined);
  setWorkerConfigForTests(undefined);
  return getControlConfig();
}

function loadWorker(raw: string) {
  const path = resolve(temporary, "worker.toml");
  writeFileSync(path, raw);
  vi.stubEnv("TALI_WORKER_CONFIG", path);
  setWorkerConfigForTests();
  return getWorkerConfig();
}

describe("component configuration contract", () => {
  it("serves the Agent catalog in production without Worker configuration", async () => {
    const store = createTestStore();
    load(stringify(developmentControlConfig()));
    vi.stubEnv("TALI_WORKER_CONFIG", "");
    expect(() => getWorkerConfig()).toThrow("TALI_WORKER_CONFIG");
    expect(() => new DoclingClient()).not.toThrow();
    const service = new AgentGardenService(
      new AgentGardenStore(store.projectId, store.database()),
    );
    await expect(service.snapshot()).resolves.toHaveProperty("agents");
    expect(() =>
      load(stringify({ ...developmentControlConfig(), worker: {} })),
    ).toThrow("worker");
  });

  it("loads the actual Helm file with typed provisioning resources and shared Worker settings", () => {
    const manifests = parseAllDocuments(
      execFileSync(
        "helm",
        [
          "template",
          "config-test",
          "../../charts/tali-relay",
          "--namespace",
          "config-ns",
          "--set",
          "fullnameOverride=config-test",
          "--kube-version",
          "1.29.0",
          "--set",
          "control.worker.healthPort=9191",
          "--set",
          "openshell.supervisor.image.pullPolicy=Never",
          "--set",
          "hindsight.enabled=false",
          "--set-string",
          "features.durableMemory.projectAllowlist[0]=test-project",
        ],
        { encoding: "utf8" },
      ),
    ).map((doc) => doc.toJSON());
    const secret = manifests.find(
      (object) => object.stringData?.["control.toml"],
    );
    vi.stubEnv("TALI_BOOTSTRAP_INTERNAL_URL", "http://ignored-old-env");
    const config = load(secret.stringData["control.toml"]);
    expect(config).not.toHaveProperty("worker");
    const workerSecret = manifests.find(
      (object) => object.stringData?.["worker.toml"],
    );
    const worker = loadWorker(workerSecret.stringData["worker.toml"]);
    expect(worker.healthPort).toBe(9191);
    expect(worker.docling.baseUrl).toBe("http://config-test-docling:5001");
    expect(worker.project_openshell.supervisorImagePullPolicy).toBe("Never");
    expect(worker.project_openshell.gatewayResources).toHaveProperty(
      "requests.memory",
    );
    expect(config.memory.enabled).toBe(false);
    expect(deploymentBootstrapRuntimeConfiguration().controlInternalUrl).toBe(
      "http://config-test-control.config-ns.svc.cluster.local:38080",
    );
    for (const name of ["control", "control-worker"]) {
      const workload = manifests.find(
        (object) =>
          object.kind === "Deployment" &&
          object.metadata.labels["app.kubernetes.io/component"] === name,
      );
      expect(
        workload.spec.template.spec.volumes.find(
          (volume: { name: string }) => volume.name === "control-config",
        ).secret.items,
      ).toEqual([{ key: "control.toml", path: "control.toml" }]);
    }
  });

  it("round-trips quotes, newlines, dollar signs and backslashes in credentials", () => {
    const config = developmentControlConfig();
    config.memory.apiKey = 'quote" slash\\ dollar${UNEXPANDED}\nsecond line';
    expect(load(stringify(config)).memory.apiKey).toBe(config.memory.apiKey);
  });

  it("rejects unknown sections and invalid Worker ports", () => {
    expect(() =>
      load(stringify({ ...developmentControlConfig(), workre: {} })),
    ).toThrow("workre");
    const config = { worker: developmentWorkerConfig() };
    config.worker.healthPort = 0;
    expect(() => loadWorker(stringify(config))).toThrow("healthPort");
  });

  it("rejects incomplete runtime configuration before provisioning", () => {
    const config = { worker: developmentWorkerConfig() };
    config.worker.project_runtime_bridge.enabled = true;
    expect(() => loadWorker(stringify(config))).toThrow(
      "Enabled runtimes require an image",
    );
  });

  it("does not send parsing requests while Docling is disabled", async () => {
    const fetcher = vi.fn();
    const client = new DoclingClient("http://docling", "", fetcher, false);
    await expect(
      client.parse({
        bytes: new Uint8Array(),
        filename: "test.txt",
        mediaType: "text/plain",
      }),
    ).rejects.toThrow("Document parsing is disabled");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
