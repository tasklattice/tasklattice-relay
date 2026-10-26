import { ObjectSerializer } from "@kubernetes/client-node/dist/serializer.js";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { KubernetesObject, V1Deployment, V1Secret, V1Service } from "@kubernetes/client-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { developmentWorkerConfig, setWorkerConfigForTests } from "../config/worker-config";
import { buildProjectIsolationInventory } from "../workers/project-isolation-inventory";
import { instantiateIsolationInventory, type ProjectIsolationInventory } from "./project-isolation-inventory";
import { checkProjectIsolation } from "./project-isolation-check";
import { PROJECT_RUNTIME_BRIDGE_NAME } from "../kubernetes/project-runtime-bridge-client";
import { signProjectRuntimeBridgeToken } from "../runtime-bridge/project-runtime-bridge-token";

const input = { namespace: "tp-abcdefghijklm", projectId: "tp-abcdefghijklm", projectName: 'Project "A"', uid: "tenant-uid",
  controlUrl: "http://relay-control.control-plane.svc.cluster.local:80", runnerToken: "synthetic-runner-token" };
const gateway = `openshell-${input.namespace}`;
const service: V1Service = { apiVersion: "v1", kind: "Service", metadata: { namespace: "control-plane", name: "relay-control" },
  spec: { selector: { "app.kubernetes.io/component": "control", "app.kubernetes.io/instance": "relay", "app.kubernetes.io/name": "custom-relay" },
    ports: [{ port: 80, targetPort: "http" }] } };
const key = (r: KubernetesObject) => `${r.kind}/${r.metadata?.namespace ?? "cluster"}/${r.metadata?.name}`;
let inventory: ProjectIsolationInventory;
let live: Map<string, KubernetesObject>;
let read: ReturnType<typeof vi.fn<(r: KubernetesObject) => Promise<KubernetesObject>>>;

async function fixture(openshift = false) {
  const config = developmentWorkerConfig();
  Object.assign(config.project_runtime_bridge, { enabled: true, image: "example/control:test" });
  Object.assign(config.project_openshell, { enabled: true, chart: fileURLToPath(new URL("../../../../dist/worker-charts/openshell.tgz", import.meta.url)),
    gatewayImageRepository: "example/gateway", gatewayImageTag: "test", supervisorImageRepository: "example/supervisor", supervisorImageTag: "test", sandboxImage: "example/sandbox:test" });
  Object.assign(config.resource_ownership, { enabled: true, controlRelease: "relay", controlNamespace: "control-plane", controlServiceAccount: "control-sa" });
  config.openshift = { enabled: openshift, imageSourceNamespace: "images", manageTenantScc: true };
  setWorkerConfigForTests(config);
  inventory = await buildProjectIsolationInventory(input.controlUrl);
  live = new Map();
  const token = signProjectRuntimeBridgeToken(input, input.runnerToken);
  for (const entry of instantiateIsolationInventory(inventory, input).resources) {
    let resource = structuredClone(entry.resource) as KubernetesObject;
    if (resource.kind === "Secret") {
      (resource as V1Secret).data = Object.fromEntries((entry.secretKeys?.length ? entry.secretKeys : ["generated-key"])
        .map(name => [name, Buffer.from("synthetic-secret").toString("base64")]));
      if (resource.metadata?.name === PROJECT_RUNTIME_BRIDGE_NAME) (resource as V1Secret).data!["project-token"] = Buffer.from(token).toString("base64");
      if (resource.metadata?.name === "openshell-postgresql") (resource as V1Secret).data!.uri = Buffer.from(
        `postgresql://openshell_${input.namespace.replaceAll("-", "_")}:synthetic@db/openshell_${input.namespace.replaceAll("-", "_")}`,
      ).toString("base64");
    }
    if (resource.kind === "Deployment") {
      resource.metadata!.generation = 2;
      const deployment = resource as V1Deployment;
      deployment.status = { observedGeneration: 2, availableReplicas: 1, updatedReplicas: 1 };
      if (resource.metadata?.name === PROJECT_RUNTIME_BRIDGE_NAME) {
        deployment.spec!.template.metadata!.annotations!["tali.io/project-runtime-token-checksum"] = createHash("sha256").update(token).digest("hex");
      }
      if (!deployment.spec!.template.spec!.imagePullSecrets?.length) delete deployment.spec!.template.spec!.imagePullSecrets;
    }
    if (resource.kind === "NetworkPolicy") resource = ObjectSerializer.deserialize(resource, "V1NetworkPolicy");
    live.set(key(resource), resource);
  }
  live.set(key(service), service);
  read = vi.fn(async ref => {
    const resource = live.get(key(ref));
    if (!resource) throw { code: 404 };
    return structuredClone(resource);
  });
}
beforeEach(async () => fixture());
afterEach(() => setWorkerConfigForTests());
const check = () => checkProjectIsolation(input, inventory, read);

describe("Project isolation live checks", () => {
  it("covers the deployed Gateway chart, Bridge, scoped diagnostic RBAC and Secret dependencies without reading Agents", async () => {
    const checks = await check();
    expect(checks.filter(c => c.status !== "passed")).toEqual([]);
    for (const [kind, name] of [["NetworkPolicy", `${gateway}-sandbox-ssh`], ["Role", `${gateway}-sandbox`],
      ["ClusterRoleBinding", `${gateway}-node-reader`], ["Secret", "openshell-postgresql"], ["Secret", `${gateway}-jwt-keys`],
      ["ServiceAccount", `${gateway}-sandbox`], ["RoleBinding", "tali-project-isolation-reader"]]) {
      expect(checks.some(c => c.label === `${kind}/${name}`)).toBe(true);
    }
    expect(read.mock.calls.every(([r]) => !["Pod", "Sandbox", "PersistentVolumeClaim"].includes(r.kind!))).toBe(true);
    expect(JSON.stringify(inventory)).not.toContain("synthetic-secret");
    expect(JSON.stringify(checks)).not.toContain("synthetic-secret");
  });

  it.each([["NetworkPolicy", `${gateway}-sandbox-ssh`], ["Deployment", PROJECT_RUNTIME_BRIDGE_NAME], ["Role", `${gateway}-sandbox`], ["Secret", `${gateway}-jwt-keys`],
    ["ServiceAccount", `${gateway}-sandbox`], ["RoleBinding", "tali-project-isolation-reader"]])("detects missing %s/%s and passes after repair", async (kind, name) => {
    const id = `${kind}/${input.namespace}/${name}`;
    const resource = live.get(id)!;
    live.delete(id);
    expect((await check()).find(c => c.label === `${kind}/${name}`)?.status).toBe("failed");
    live.set(id, resource);
    expect((await check()).filter(c => c.status !== "passed")).toEqual([]);
  });

  it("detects stale Bridge URLs and overbroad RBAC", async () => {
    const deployment = live.get(`Deployment/${input.namespace}/${PROJECT_RUNTIME_BRIDGE_NAME}`) as V1Deployment;
    deployment.spec!.template.spec!.containers[0]!.env!.find(e => e.name === "TALI_CONTROL_INTERNAL_URL")!.value = "http://stale-control:38080";
    const role = live.get(`Role/${input.namespace}/${gateway}-sandbox`) as KubernetesObject & { rules: Array<{ verbs: string[] }> };
    role.rules[0]!.verbs.push("deletecollection");
    const failed = (await check()).filter(c => c.status === "failed").map(c => c.label);
    expect(failed).toEqual(expect.arrayContaining([`Deployment/${PROJECT_RUNTIME_BRIDGE_NAME}`, `Role/${gateway}-sandbox`]));
    expect(read.mock.calls.filter(([r]) => r.kind === "NetworkPolicy").map(([r]) => r.metadata?.name))
      .toEqual([`${gateway}-sandbox-ssh`]);
  });

  it("reports permissions separately from missing resources and never leaks Secret values", async () => {
    read.mockImplementation(async ref => {
      if (ref.kind === "Secret") throw { code: 403, body: "synthetic-secret" };
      return structuredClone(live.get(key(ref))!);
    });
    const checks = await check();
    expect(checks.find(c => c.label === `Secret/${PROJECT_RUNTIME_BRIDGE_NAME}`)?.status).toBe("unavailable");
    expect(checks.find(c => c.label === `Service/${PROJECT_RUNTIME_BRIDGE_NAME}`)?.status).toBe("passed");
    expect(JSON.stringify(checks)).not.toContain("synthetic-secret");
  });

  it("checks OCP image-source authorization and SCC subject ownership", async () => {
    await fixture(true);
    expect((await check()).filter(c => c.status !== "passed")).toEqual([]);
    const imageBinding = [...live.values()].find(r => r.kind === "RoleBinding" && r.metadata?.namespace === "images")!;
    live.delete(key(imageBinding));
    const scc = live.get(`RoleBinding/${input.namespace}/tali-project-scc-privileged`)!;
    scc.metadata!.ownerReferences![0]!.uid = "another-namespace";
    expect((await check()).filter(c => c.status === "failed").map(c => c.label)).toEqual(expect.arrayContaining([
      `RoleBinding/${imageBinding.metadata!.name}`, "RoleBinding/tali-project-scc-privileged",
    ]));
  });

  it("rejects stale Deployment readiness and a Bridge identity from another Project", async () => {
    const deployment = live.get(`Deployment/${input.namespace}/${gateway}`) as V1Deployment;
    deployment.status!.observedGeneration = 1;
    const secret = live.get(`Secret/${input.namespace}/${PROJECT_RUNTIME_BRIDGE_NAME}`) as V1Secret;
    secret.data!["project-token"] = Buffer.from("another-project-token").toString("base64");
    const checks = await check();
    expect(checks.find(c => c.label === `Deployment/${gateway}`)?.status).toBe("failed");
    expect(checks.find(c => c.label === `Secret/${PROJECT_RUNTIME_BRIDGE_NAME}`)?.status).toBe("failed");
    expect(JSON.stringify(checks)).not.toContain("another-project-token");
  });

  it("substitutes legacy Project IDs independently of their derived Namespace", () => {
    const legacy = instantiateIsolationInventory(inventory, { ...input, projectId: "individual" });
    const deployment = legacy.resources.find(({ resource }) => resource.kind === "Deployment"
      && (resource as KubernetesObject).metadata?.name === gateway)!.resource as V1Deployment;
    expect(deployment.spec!.template.metadata!.annotations!["tali.io/project-id"]).toBe("individual");
    expect(deployment.metadata!.namespace).toBe(input.namespace);
  });

  it("reports an unavailable signing key without discarding other diagnostic results", async () => {
    const checks = await checkProjectIsolation({ ...input, runnerToken: "" }, inventory, read);
    expect(checks.find(c => c.id === "bridge-signing-key")?.status).toBe("unavailable");
    expect(checks.find(c => c.label === `Service/${gateway}`)?.status).toBe("passed");
  });
});
