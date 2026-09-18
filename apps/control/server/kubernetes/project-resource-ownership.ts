import { getWorkerConfig } from "../config/worker-config";
import {
  CoreV1Api, KubeConfig, KubernetesObjectApi, PatchStrategy,
  type KubernetesObject, type V1Namespace, type V1OwnerReference, type V1StatefulSet,
} from "@kubernetes/client-node";
import { projectRuntimeNamespaceSchema } from "@tali/contracts";

export function namespaceOwner(namespace: V1Namespace, projectId: string): V1OwnerReference {
  const metadata = namespace.metadata;
  if (!metadata?.uid || !metadata.name || metadata.deletionTimestamp
    || metadata.annotations?.["tali.io/project-id"] !== projectId) {
    throw new Error("Project Namespace ownership is missing, mismatched, or being deleted.");
  }
  projectRuntimeNamespaceSchema.parse(metadata.name);
  return { apiVersion: "v1", kind: "Namespace", name: metadata.name,
    uid: metadata.uid, controller: false, blockOwnerDeletion: false };
}

export async function readProjectNamespaceOwner(namespace: string, projectId: string) {
  if (!getWorkerConfig().resource_ownership.enabled) return undefined;
  projectRuntimeNamespaceSchema.parse(namespace);
  const config = new KubeConfig();
  config.loadFromCluster();
  return namespaceOwner(await config.makeApiClient(CoreV1Api).readNamespace({ name: namespace }), projectId);
}

export function withNamespaceOwner<T extends KubernetesObject>(resource: T, owner?: V1OwnerReference): T {
  if (!owner || resource.metadata?.ownerReferences?.length) return resource;
  if (resource.metadata?.namespace !== owner.name) {
    throw new Error("Refusing to attach a resource outside its Project Namespace.");
  }
  return { ...resource, metadata: { ...resource.metadata, ownerReferences: [owner] } };
}

// OpenShell creates the Sandbox through its API. Attach its project parent as
// soon as Control observes it; never change the Pod/PVC's controller-owned refs.
export async function reconcileSandboxOwnership(namespace: string, projectId: string, sandboxName: string) {
  const owner = await readProjectNamespaceOwner(namespace, projectId);
  if (!owner) return;
  const config = new KubeConfig();
  config.loadFromCluster();
  const objects = KubernetesObjectApi.makeApiClient(config);
  await reconcileSandboxResources(objects, owner, sandboxName);
}

export async function reconcileSandboxResources(
  objects: Pick<KubernetesObjectApi, "list" | "read" | "patch">,
  owner: V1OwnerReference, sandboxName: string,
) {
  const namespace = owner.name;
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(sandboxName) || sandboxName.length > 63) {
    throw new Error("Invalid OpenShell Sandbox name for resource ownership.");
  }
  // CLI --label values are stored by OpenShell, not propagated to CR metadata.
  // The Gateway's own workspace/name labels identify the observed Sandbox.
  const resources = await objects.list("agents.x-k8s.io/v1beta1", "Sandbox", namespace,
    undefined, undefined, undefined, undefined,
    `openshell.ai/managed-by=openshell,openshell.ai/sandbox-workspace=${namespace},openshell.ai/sandbox-name=${sandboxName}`);
  for (const resource of resources.items) {
    if (resource.metadata?.deletionTimestamp || resource.metadata?.ownerReferences?.length) continue;
    await attachObservedNamespaceOwner(objects, resource, owner);
  }
  for (const resource of resources.items) {
    if (!resource.metadata?.deletionTimestamp && resource.metadata?.name) {
      await attachNamedNamespaceOwner(objects, "v1", "PersistentVolumeClaim", namespace,
        `workspace-${resource.metadata.name}`, owner);
    }
  }
}

export async function attachObservedNamespaceOwner(
  objects: Pick<KubernetesObjectApi, "patch">, resource: KubernetesObject, owner: V1OwnerReference,
) {
  const metadata = resource.metadata;
  if (metadata?.deletionTimestamp || metadata?.ownerReferences?.length) return;
  if (!resource.apiVersion || !resource.kind || !metadata?.name || !metadata.resourceVersion) {
    throw new Error("Observed resource has no identity or resourceVersion.");
  }
  if (metadata.namespace !== owner.name) throw new Error("Observed resource is outside the Project Namespace.");
  await objects.patch({ apiVersion: resource.apiVersion, kind: resource.kind,
    metadata: { name: metadata.name, namespace: owner.name,
      resourceVersion: metadata.resourceVersion, ownerReferences: [owner] } },
  undefined, undefined, "tali-project-ownership", undefined, PatchStrategy.MergePatch);
}

async function attachNamedNamespaceOwner(objects: Pick<KubernetesObjectApi, "read" | "patch">,
  apiVersion: string, kind: string, namespace: string, name: string, owner: V1OwnerReference) {
  try {
    const resource = await objects.read({ apiVersion, kind, metadata: { namespace, name } });
    await attachObservedNamespaceOwner(objects, resource, owner);
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
  }
}

export async function reconcileGatewayResources(objects: Pick<KubernetesObjectApi, "read" | "patch">,
  owner: V1OwnerReference, name: string) {
  const statefulSet = await objects.read<V1StatefulSet>({ apiVersion: "apps/v1", kind: "StatefulSet",
    metadata: { namespace: owner.name, name } });
  // volumeClaimTemplates are immutable on existing Gateways. Patch the actual
  // PVC metadata after installation instead of changing those templates.
  for (const template of statefulSet.spec?.volumeClaimTemplates ?? []) {
    if (!template.metadata?.name) continue;
    const start = statefulSet.spec?.ordinals?.start ?? 0;
    for (let ordinal = start; ordinal < start + (statefulSet.spec?.replicas ?? 1); ordinal++) {
      await attachNamedNamespaceOwner(objects, "v1", "PersistentVolumeClaim", owner.name,
        `${template.metadata.name}-${name}-${ordinal}`, owner);
    }
  }
  // Helm 3 excludes hooks from post-rendering. These names come from the pinned
  // Project chart and its fixed provisioner values, including certgen outputs.
  for (const [apiVersion, kind, resourceName] of [
    ["v1", "ServiceAccount", `${name}-certgen`],
    ["rbac.authorization.k8s.io/v1", "Role", `${name}-certgen`],
    ["rbac.authorization.k8s.io/v1", "RoleBinding", `${name}-certgen`],
    ["v1", "Secret", `${name}-jwt-keys`],
    ["v1", "Secret", "openshell-server-tls"],
    ["v1", "Secret", "openshell-client-tls"],
  ] as const) {
    await attachNamedNamespaceOwner(objects, apiVersion, kind, owner.name, resourceName, owner);
  }
}

export async function reconcileGatewayOwnership(owner: V1OwnerReference, name: string) {
  const config = new KubeConfig();
  config.loadFromCluster();
  await reconcileGatewayResources(KubernetesObjectApi.makeApiClient(config), owner, name);
}

export function projectArgoAnnotations(namespace: string, configuration: { sourceTrackingId?: string; installationId?: string } = getWorkerConfig().resource_ownership): Record<string, string> {
  const source = configuration.sourceTrackingId?.trim();
  if (!source) return {};
  // Copy a real, existing tracked root's ID verbatim. A non-self-referencing ID
  // is visible in annotation tracking mode but is neither compared nor pruned.
  if (!/^[^:\s]+:[^:\s]*\/[^:\s]+:[^:\s]*\/[^:\s]+$/.test(source)
    || source.endsWith(`:/Namespace:/${namespace}`)) {
    throw new Error("Project Argo CD source tracking ID must reference an existing resource other than this Namespace.");
  }
  return {
    "argocd.argoproj.io/tracking-id": source,
    "argocd.argoproj.io/sync-options": "Prune=false,Delete=false",
    ...(configuration.installationId?.trim()
      ? { "argocd.argoproj.io/installation-id": configuration.installationId.trim() } : {}),
  };
}
