import type { KubernetesObject, V1Namespace } from "@kubernetes/client-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { developmentWorkerConfig, setWorkerConfigForTests } from "../config/worker-config";
import { projectIsolationReaderResources, reconcileProjectIsolationReader } from "./project-isolation-reader";

const namespace: V1Namespace = { metadata: { name: "tp-abcdefghijklm", uid: "tenant-uid", annotations: { "tali.io/project-id": "project" } } };
beforeEach(() => {
  const config = developmentWorkerConfig();
  Object.assign(config.resource_ownership, { controlNamespace: "control-plane", controlServiceAccount: "custom-control" });
  setWorkerConfigForTests(config);
});
afterEach(() => setWorkerConfigForTests());

describe("Project diagnostic access", () => {
  it("grants only get Secret inside the owned Namespace to the configured Control account and is repeatable", async () => {
    const live = new Map<string, KubernetesObject>();
    const objects = { read: vi.fn(async (resource: KubernetesObject) => {
      if (!live.has(resource.kind!)) throw { code: 404 };
      return live.get(resource.kind!)!;
    }), patch: vi.fn(async (resource: KubernetesObject) => { live.set(resource.kind!, resource); return resource; }) };
    await reconcileProjectIsolationReader(objects as never, namespace, "project");
    await reconcileProjectIsolationReader(objects as never, namespace, "project");
    expect(live.get("Role")).toMatchObject({ metadata: { namespace: namespace.metadata!.name, ownerReferences: [{ uid: "tenant-uid" }] },
      rules: [{ apiGroups: [""], resources: ["secrets"], verbs: ["get"] }] });
    expect(live.get("RoleBinding")).toMatchObject({ roleRef: { kind: "Role", name: "tali-project-isolation-reader" },
      subjects: [{ kind: "ServiceAccount", name: "custom-control", namespace: "control-plane" }] });
    expect(objects.patch).toHaveBeenCalledTimes(4);
  });

  it.each(["owner", "uid", "terminating"])("refuses foreign or terminating grants before any writes: %s", async reason => {
    const resources = projectIsolationReaderResources(namespace, "project");
    const binding = structuredClone(resources[1]!);
    if (reason === "owner") binding.metadata.annotations["tali.io/project-id"] = "other-project";
    if (reason === "uid") binding.metadata.ownerReferences[0]!.uid = "other-namespace";
    if (reason === "terminating") Object.assign(binding.metadata, { deletionTimestamp: new Date() });
    const objects = { read: vi.fn(async (r: KubernetesObject) => r.kind === "RoleBinding" ? binding : resources[0]), patch: vi.fn() };
    await expect(reconcileProjectIsolationReader(objects as never, namespace, "project")).rejects.toThrow("Refusing to adopt");
    expect(objects.patch).not.toHaveBeenCalled();
  });
});
