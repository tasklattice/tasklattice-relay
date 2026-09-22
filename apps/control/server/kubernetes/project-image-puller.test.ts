import { afterEach, describe, expect, it, vi } from "vitest";
import { type KubernetesObjectApi, PatchStrategy } from "@kubernetes/client-node";
import { getWorkerConfig, setWorkerConfigForTests } from "../config/worker-config";
import { reconcileProjectImagePuller } from "./project-image-puller";

const tenant = { apiVersion: "v1", kind: "Namespace", metadata: {
  name: "tp-abcdefghijklm", uid: "namespace-uid", annotations: { "tali.io/project-id": "project-a" },
} };
function setup() {
  getWorkerConfig().openshift = { enabled: true, imageSourceNamespace: "tali" };
  const objects = { read: vi.fn().mockRejectedValue({ code: 404 }), patch: vi.fn().mockResolvedValue({}) };
  const reconcile = (namespace = tenant) => reconcileProjectImagePuller(objects as unknown as Pick<KubernetesObjectApi, "read" | "patch">, namespace, "project-a");
  return { objects, reconcile };
}
afterEach(() => setWorkerConfigForTests());
describe("Project OpenShift image pull authorization", () => {
  it("does nothing outside OpenShift", async () => {
    const { objects, reconcile } = setup();
    getWorkerConfig().openshift.enabled = false;
    await reconcile();
    expect(objects.read).not.toHaveBeenCalled();
    expect(objects.patch).not.toHaveBeenCalled();
  });
  it("creates a source-namespace binding for only the tenant SA group and reconciles idempotently", async () => {
    const { objects, reconcile } = setup();
    await reconcile();
    const binding = objects.patch.mock.calls[0]![0];
    expect(binding).toMatchObject({
      kind: "RoleBinding", metadata: { namespace: "tali", name: "tali-image-puller-tp-abcdefghijklm-namespace-uid",
        ownerReferences: [{ apiVersion: "v1", kind: "Namespace", name: tenant.metadata.name, uid: tenant.metadata.uid,
          controller: false, blockOwnerDeletion: false }] },
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "system:image-puller" },
      subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: `system:serviceaccounts:${tenant.metadata.name}` }],
    });
    expect(objects.patch.mock.calls[0]!.slice(1)).toEqual([undefined, undefined, "tali-project-image-puller", false, PatchStrategy.ServerSideApply]);
    objects.read.mockResolvedValue(binding);
    await reconcile();
    expect(objects.patch.mock.calls[1]![0]).toEqual(binding);
  });
  it("uses distinct names and owner UIDs after namespace recreation", async () => {
    const { objects, reconcile } = setup();
    await reconcile();
    await reconcile({ ...tenant, metadata: { ...tenant.metadata, uid: "new-uid" } });
    expect(objects.patch.mock.calls[0]![0].metadata.name).not.toBe(objects.patch.mock.calls[1]![0].metadata.name);
    expect(objects.patch.mock.calls[1]![0].metadata.ownerReferences[0].uid).toBe("new-uid");
  });
  it("refuses foreign or terminating tenant namespaces", async () => {
    const { objects, reconcile } = setup();
    await expect(reconcile({ ...tenant, metadata: { ...tenant.metadata, annotations: { "tali.io/project-id": "other" } } })).rejects.toThrow("ownership");
    await expect(reconcileProjectImagePuller(objects as never, { ...tenant, metadata: { ...tenant.metadata, deletionTimestamp: new Date() } }, "project-a")).rejects.toThrow("being deleted");
    expect(objects.patch).not.toHaveBeenCalled();
  });
  it("refuses to adopt a foreign binding", async () => {
    const { objects, reconcile } = setup();
    objects.read.mockResolvedValue({ metadata: { annotations: { "tali.io/project-id": "other" } } });
    await expect(reconcile()).rejects.toThrow("Refusing to adopt");
    expect(objects.patch).not.toHaveBeenCalled();
  });
  it("reports the source and tenant when authorization is forbidden", async () => {
    const { objects, reconcile } = setup();
    objects.patch.mockRejectedValue({ code: 403 });
    await expect(reconcile()).rejects.toThrow(/OpenShift image pull authorization failed \(HTTP 403\): RoleBinding tali\/.*tenant=tp-abcdefghijklm/);
  });
});
