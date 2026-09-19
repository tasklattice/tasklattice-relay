import { describe, expect, it, vi } from "vitest";
import { PatchStrategy, type KubernetesObject } from "@kubernetes/client-node";
import { attachObservedNamespaceOwner, namespaceOwner, projectArgoAnnotations, reconcileSandboxResources, withNamespaceOwner } from "./project-resource-ownership";

const namespace = "tp-abcdefghijklm";
const owner = namespaceOwner({ metadata: { name: namespace, uid: "namespace-uid",
  annotations: { "tali.io/project-id": "project-a" } } }, "project-a");

describe("Project resource ownership", () => {
  it("uses the verified Namespace UID without claiming controller ownership", () => {
    expect(owner).toEqual({ apiVersion: "v1", kind: "Namespace", name: namespace,
      uid: "namespace-uid", controller: false, blockOwnerDeletion: false });
  });
  it.each([
    { name: namespace },
    { name: namespace, uid: "uid", annotations: { "tali.io/project-id": "another-project" } },
    { name: namespace, uid: "uid", annotations: { "tali.io/project-id": "project-a" }, deletionTimestamp: new Date() },
  ])("refuses missing, foreign, or deleting Namespace identity", (metadata) => {
    expect(() => namespaceOwner({ metadata }, "project-a")).toThrow();
  });
  it("adds ownership to roots, preserves existing parents, and never modifies Pod templates", () => {
    const root = { kind: "Deployment", metadata: { name: "runtime", namespace },
      spec: { template: { metadata: { labels: { app: "runtime" } } } } };
    const owned = withNamespaceOwner(root, owner);
    expect(owned.metadata).toMatchObject({ ownerReferences: [owner] });
    expect(owned.spec.template).toBe(root.spec.template);
    const child = { metadata: { namespace, ownerReferences: [{ apiVersion: "v1", kind: "Sandbox", name: "agent", uid: "sandbox-uid" }] } };
    expect(withNamespaceOwner(child, owner)).toBe(child);
    expect(() => withNamespaceOwner({ metadata: { namespace: "tali" } }, owner)).toThrow("outside");
  });
  it("patches only missing metadata using a concurrency precondition", async () => {
    const patch = vi.fn(async () => ({}));
    const resource: KubernetesObject = { apiVersion: "agents.x-k8s.io/v1beta1", kind: "Sandbox",
      metadata: { name: "agent", namespace, resourceVersion: "17" } };
    await attachObservedNamespaceOwner({ patch } as never, resource, owner);
    expect(patch).toHaveBeenCalledWith({ apiVersion: resource.apiVersion, kind: resource.kind,
      metadata: { ...resource.metadata, ownerReferences: [owner] } },
    undefined, undefined, "tali-project-ownership", undefined, PatchStrategy.MergePatch);
    patch.mockClear();
    await attachObservedNamespaceOwner({ patch } as never, withNamespaceOwner(resource, owner), owner);
    expect(patch).not.toHaveBeenCalled();
  });
  it("does not claim an Argo application by default", () => {
    expect(projectArgoAnnotations(namespace, {})).toEqual({});
  });
  it("finds OpenShell CRs by native workspace/name labels and preserves controller-owned storage", async () => {
    const sandbox = { apiVersion: "agents.x-k8s.io/v1beta1", kind: "Sandbox",
      metadata: { namespace, name: `${namespace}--agent`, uid: "sandbox-uid", resourceVersion: "21" } };
    const list = vi.fn(async () => ({ items: [sandbox] }));
    const read = vi.fn(async () => ({ apiVersion: "v1", kind: "PersistentVolumeClaim",
      metadata: { namespace, name: `workspace-${namespace}--agent`, resourceVersion: "22",
        ownerReferences: [{ apiVersion: sandbox.apiVersion, kind: "Sandbox", name: sandbox.metadata.name,
          uid: "sandbox-uid", controller: true }] } }));
    const patch = vi.fn(async () => ({}));
    await reconcileSandboxResources({ list, read, patch } as never, owner, "agent");
    expect(list).toHaveBeenCalledWith("agents.x-k8s.io/v1beta1", "Sandbox", namespace,
      undefined, undefined, undefined, undefined,
      `openshell.ai/managed-by=openshell,openshell.ai/sandbox-workspace=${namespace},openshell.ai/sandbox-name=agent`);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "Sandbox" })]));
  });
  it("copies a non-self tracking reference with deletion protection", () => {
    expect(projectArgoAnnotations(namespace, {
      sourceTrackingId: "tali:/Namespace:/tali",
      installationId: "uat",
    })).toEqual({
      "argocd.argoproj.io/tracking-id": "tali:/Namespace:/tali",
      "argocd.argoproj.io/installation-id": "uat",
      "argocd.argoproj.io/sync-options": "Prune=false,Delete=false",
    });
  });
  it.each(["app", `tali:/Namespace:/${namespace}`])("rejects a malformed or self-referencing tracking ID", (source) => {
    expect(() => projectArgoAnnotations(namespace, { sourceTrackingId: source })).toThrow();
  });
});
