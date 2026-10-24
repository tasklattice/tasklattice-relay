import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";
import { parse as parseToml } from "smol-toml";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KubernetesObject, V1Deployment, V1NetworkPolicy, V1Service } from "@kubernetes/client-node";
import { ObjectSerializer } from "@kubernetes/client-node/dist/serializer.js";
import { materializeBootstrapSecrets } from "../../../../scripts/testing/helm-bootstrap-fixture.mjs";
import { createTestPrisma } from "../test/prisma";
import { developmentControlConfig, setControlConfigForTests } from "../config/control-config";
import { setWorkerConfigForTests } from "../config/worker-config";
import { ensurePlatformRuntimeSettings, loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";
import { KubernetesProjectRuntimeBridgeClient, controlServiceEgress } from "./project-runtime-bridge-client";

const chart = fileURLToPath(new URL("../../../../charts/tali-relay", import.meta.url));
function render(port: number, namespace = "control-plane", release = "relay-one", name = "custom-control") {
  const objects = materializeBootstrapSecrets(parseAllDocuments(execFileSync("helm", [
    "template", release, chart, "--namespace", namespace, "--kube-version", "1.29.0",
    "--set", `control.service.port=${port}`, "--set", `fullnameOverride=${name}`,
  ], { encoding: "utf8" })).map(doc => doc.toJSON())) as Array<KubernetesObject & { stringData?: Record<string, string> }>;
  const server = parseToml(objects.find(r => r.stringData?.["control.toml"])!.stringData!["control.toml"]!).server as {
    internal_url: string; internal_url_managed: boolean;
  };
  const config = developmentControlConfig();
  Object.assign(config.server, server);
  setControlConfigForTests(config);
  const service = objects.find(r => r.kind === "Service" && r.metadata?.name === `${name}-control`) as V1Service;
  service.metadata!.namespace = namespace; // API default when Helm applies a namespaced manifest.
  return service;
}

afterEach(() => { setControlConfigForTests(undefined); setWorkerConfigForTests(); vi.restoreAllMocks(); });

describe("Bridge deployment configuration upgrades", () => {
  it("moves an existing Bridge and its exact Service policy from 38180 to 80 after Values change", async () => {
    let service = render(38180);
    const db = createTestPrisma();
    try {
      await ensurePlatformRuntimeSettings(db);
      const storedUrl = (await loadPlatformRuntimeConfiguration(db)).controlInternalUrl;
      const applied = new Map<string, KubernetesObject>();
      const objects = { read: vi.fn(async () => service), patch: vi.fn(async (resource: KubernetesObject) => {
        applied.set(resource.kind!, structuredClone(resource)); return resource;
      }) };
      const apps = { readNamespacedDeployment: vi.fn(async () => ({ metadata: { generation: 2 }, status: { observedGeneration: 2, availableReplicas: 1 } })) };
      const client = new KubernetesProjectRuntimeBridgeClient({ enabled: true, image: "control:test", revision: "test",
        imagePullPolicy: "IfNotPresent", imagePullSecrets: [], resources: {} }, objects as never, apps as never);
      const base = { namespace: "tp-abcdefghijklm", projectId: "project", projectName: "Project", token: "synthetic-project-token" };
      await client.reconcile({ ...base, controlUrl: storedUrl });
      for (const [port, namespace, release, name] of [[80, "control-plane", "relay-one", "custom-control"], [18080, "new-control-plane", "relay-two", "renamed"]] as const) {
        service = render(port, namespace, release, name);
        await ensurePlatformRuntimeSettings(db);
        const current = await loadPlatformRuntimeConfiguration(db);
        // A persisted bootstrap value must not hide a Values upgrade.
        expect((await db.platformSettingsRecord.findUniqueOrThrow({ where: { id: "platform" } })).controlInternalUrl).toBe(storedUrl);
        expect(current.controlInternalUrl).toBe(`http://${name}-control.${namespace}.svc.cluster.local:${port}`);
        await client.reconcile({ ...base, controlUrl: current.controlInternalUrl });
        const deployment = applied.get("Deployment") as V1Deployment;
        expect(deployment.spec?.template.spec?.containers[0]?.env).toContainEqual({ name: "TALI_CONTROL_INTERNAL_URL", value: current.controlInternalUrl });
        const policy = applied.get("NetworkPolicy") as V1NetworkPolicy;
        // Exercise the actual client serializer, which maps `_from` to API `from`.
        expect(ObjectSerializer.serialize(policy, "V1NetworkPolicy").spec.ingress).toEqual([
          { from: [{ podSelector: {} }], ports: [{ port: 8080, protocol: "TCP" }] },
        ]);
        expect(policy.spec?.egress?.[1]).toEqual({
          to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": namespace } }, podSelector: { matchLabels: service.spec!.selector } }],
          ports: [{ port, protocol: "TCP" }, { port: "http", protocol: "TCP" }],
        });
        expect(policy.spec?.egress?.[1]?.to?.[0]?.podSelector?.matchLabels?.["app.kubernetes.io/instance"]).toBe(release);
        expect(objects.read).toHaveBeenLastCalledWith({ apiVersion: "v1", kind: "Service", metadata: { name: `${name}-control`, namespace } });
      }
    } finally { await db.$disconnect(); }
  });

  it("uses the actual Service targetPort and fails closed for missing selectors or mismatched ports", () => {
    const service = render(80);
    const url = "http://custom-control-control.control-plane.svc.cluster.local:80";
    service.spec!.ports![0]!.targetPort = 9091;
    expect(controlServiceEgress(url, service).ports).toEqual([{ port: 80, protocol: "TCP" }, { port: 9091, protocol: "TCP" }]);
    expect(() => controlServiceEgress(url.replace(":80", ":81"), service)).toThrow("Control Service must match");
    service.spec!.selector = {};
    expect(() => controlServiceEgress(url, service)).toThrow("Pod selector");
  });
});
