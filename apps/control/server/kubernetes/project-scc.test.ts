import { afterEach, expect, it, vi } from "vitest";
import { type KubernetesObjectApi, type V1Namespace, type V1RoleBinding, PatchStrategy } from "@kubernetes/client-node";
import { getWorkerConfig, setWorkerConfigForTests } from "../config/worker-config";
import { reconcileProjectScc } from "./project-scc";

const tenant: V1Namespace = { apiVersion: "v1", kind: "Namespace", metadata: {
  name: "tp-abcdefghijklm", uid: "tenant-uid", annotations: { "tali.io/project-id": "project-a" },
} };
function setup() {
  const config = getWorkerConfig();
  // Simulate an upgraded Worker reading older configuration without the new flag.
  config.openshift = { enabled: true, imageSourceNamespace: "images" };
  config.project_openshell.enabled = true;
  config.project_openshell.serviceNamePrefix = "custom-";
  config.project_runtime_bridge.enabled = true;
  config.expert_agent_runtime.enabled = true;
  const stored = new Map<string, V1RoleBinding>();
  const objects = {
    read: vi.fn(async (object: V1RoleBinding) => {
      const found = stored.get(object.metadata!.name!);
      if (!found) throw { code: 404 };
      return structuredClone(found);
    }),
    patch: vi.fn(async (object: V1RoleBinding, ..._args: unknown[]) => {
      stored.set(object.metadata!.name!, structuredClone(object));
      return object;
    }),
  };
  const reconcile = (namespace = tenant, fence?: () => Promise<void>) =>
    reconcileProjectScc(objects as unknown as Pick<KubernetesObjectApi, "read" | "patch">, namespace, "project-a", fence);
  return { config, stored, objects, reconcile };
}
afterEach(() => setWorkerConfigForTests());

it("grants SCCs in the tenant to exact workload SAs, before those SAs exist", async () => {
  const { stored, objects, reconcile } = setup();
  await reconcile();
  const sandbox = stored.get("tali-project-scc-privileged")!;
  expect(sandbox).toMatchObject({
    kind: "RoleBinding", metadata: { namespace: tenant.metadata!.name,
      ownerReferences: [{ apiVersion: "v1", kind: "Namespace", name: tenant.metadata!.name, uid: "tenant-uid" }] },
    roleRef: { kind: "ClusterRole", name: "system:openshift:scc:privileged" },
    subjects: [{ kind: "ServiceAccount", name: "custom-tp-abcdefghijklm-sandbox", namespace: tenant.metadata!.name }],
  });
  expect(stored.get("tali-project-scc-anyuid")!.subjects!.map(s => s.name)).toEqual([
    "custom-tp-abcdefghijklm", "custom-tp-abcdefghijklm-certgen", "default",
  ]);
  for (const binding of stored.values()) {
    expect(binding.metadata!.namespace).not.toBe("images");
    expect(binding.subjects!.every(s => s.kind === "ServiceAccount")).toBe(true);
    expect(binding.metadata!.ownerReferences![0]).toMatchObject({ controller: false, blockOwnerDeletion: false });
  }
  expect(objects.patch.mock.calls[0]!.slice(1)).toEqual([undefined, undefined, "tali-project-scc", false, PatchStrategy.ServerSideApply]);
});

it("upgrades missing grants, repairs a missing binding, and converges after concurrent/repeated reconcile", async () => {
  const { stored, objects, reconcile } = setup();
  await Promise.all([reconcile(), reconcile()]);
  const snapshot = structuredClone([...stored]);
  await reconcile();
  expect([...stored]).toEqual(snapshot);
  stored.delete("tali-project-scc-anyuid");
  await reconcile();
  expect([...stored]).toEqual(snapshot);
  // No ServiceAccount, Secret, Pod or PVC mutations; existing workloads keep identities/data.
  expect(objects.patch.mock.calls.every(([object]) => object.kind === "RoleBinding")).toBe(true);
});

it("resumes after a partially successful grant without recreating resources", async () => {
  const { objects, stored, reconcile } = setup();
  const patch = objects.patch.getMockImplementation()!;
  let failed = false;
  objects.patch.mockImplementation(async (binding, ...args) => {
    if (!failed && binding.metadata!.name === "tali-project-scc-anyuid") { failed = true; throw { code: 503 }; }
    return patch(binding, ...args);
  });
  await expect(reconcile()).rejects.toThrow("HTTP 503");
  expect(stored.size).toBe(1);
  await reconcile();
  expect(stored.size).toBe(2);
});

it.each(["kubernetes", "platform-managed"])("does not query or mutate SCCs in %s mode", async mode => {
  const { config, objects, reconcile } = setup();
  if (mode === "kubernetes") config.openshift.enabled = false;
  else config.openshift.manageTenantScc = false;
  await reconcile();
  expect(objects.read).not.toHaveBeenCalled();
  expect(objects.patch).not.toHaveBeenCalled();
});

it("does not grant disabled runtimes access and uses the same truncated Sandbox identity as the chart", async () => {
  const { config, stored, reconcile } = setup();
  config.project_runtime_bridge.enabled = false;
  config.expert_agent_runtime.enabled = false;
  config.project_openshell.serviceNamePrefix = "a".repeat(45);
  await reconcile();
  const name = `${config.project_openshell.serviceNamePrefix}${tenant.metadata!.name}`;
  expect(stored.get("tali-project-scc-privileged")!.subjects![0]!.name).toBe(`${name}-sandbox`.slice(0, 63).replace(/-$/, ""));
  expect(stored.get("tali-project-scc-anyuid")!.subjects!.map(s => s.name)).not.toContain("default");
  config.project_openshell.enabled = false;
  stored.clear();
  await reconcile();
  expect(stored.size).toBe(0);
});

it("rejects a truncated Sandbox identity colliding with Gateway before granting privileges", async () => {
  const { config, objects, reconcile } = setup();
  config.project_openshell.serviceNamePrefix = "a".repeat(47);
  await expect(reconcile()).rejects.toThrow("ServiceAccounts would collide");
  expect(objects.read).not.toHaveBeenCalled();
  expect(objects.patch).not.toHaveBeenCalled();
});

it.each(["foreign-project", "foreign-uid", "wrong-role", "terminating"])("rejects %s bindings before any mutation", async mode => {
  const { stored, objects, reconcile } = setup();
  await reconcile();
  const binding = stored.get("tali-project-scc-anyuid")!;
  if (mode === "foreign-project") binding.metadata!.annotations!["tali.io/project-id"] = "other";
  if (mode === "foreign-uid") binding.metadata!.ownerReferences![0]!.uid = "other-uid";
  if (mode === "wrong-role") binding.roleRef.name = "cluster-admin";
  if (mode === "terminating") binding.metadata!.deletionTimestamp = new Date();
  objects.patch.mockClear();
  await expect(reconcile()).rejects.toThrow("Refusing to replace");
  expect(objects.patch).not.toHaveBeenCalled();
});

it("rejects foreign/terminating namespaces and stops when the initialization lease is lost", async () => {
  const { objects, reconcile } = setup();
  await expect(reconcile({ ...tenant, metadata: { ...tenant.metadata, annotations: { "tali.io/project-id": "other" } } })).rejects.toThrow("ownership");
  await expect(reconcile({ ...tenant, metadata: { ...tenant.metadata, deletionTimestamp: new Date() } })).rejects.toThrow("being deleted");
  const fence = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValue(new Error("lease lost"));
  await expect(reconcile(tenant, fence)).rejects.toThrow("lease lost");
  expect(objects.patch).not.toHaveBeenCalled();
});

it("reports missing Worker bind authority and does not swallow admission errors", async () => {
  const { objects, reconcile } = setup();
  objects.patch.mockRejectedValue({ code: 403 });
  await expect(reconcile()).rejects.toThrow(/HTTP 403.*tp-abcdefghijklm.*system:openshift:scc:privileged.*bind permissions/);
});
