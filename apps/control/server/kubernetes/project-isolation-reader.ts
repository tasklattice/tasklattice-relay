import { PatchStrategy, type KubernetesObjectApi, type V1Namespace } from "@kubernetes/client-node";
import { getWorkerConfig } from "../config/worker-config";
import { namespaceOwner } from "./project-resource-ownership";

/** Grant Control diagnostic reads of tenant Secrets, never Worker/configuration Secrets. */
export function projectIsolationReaderResources(namespace: V1Namespace, projectId: string) {
  const config = getWorkerConfig().resource_ownership;
  if (!config.controlNamespace || !config.controlServiceAccount) return [];
  const owner = namespaceOwner(namespace, projectId);
  const metadata = { name: "tali-project-isolation-reader", namespace: owner.name,
    annotations: { "tali.io/project-id": projectId },
    labels: { "app.kubernetes.io/managed-by": "tali", "tali.io/runtime-target": "true" }, ownerReferences: [owner] };
  return [
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "Role", metadata,
      rules: [{ apiGroups: [""], resources: ["secrets"], verbs: ["get"] }] },
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "RoleBinding", metadata,
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: metadata.name },
      subjects: [{ kind: "ServiceAccount", name: config.controlServiceAccount, namespace: config.controlNamespace }] },
  ];
}

export async function reconcileProjectIsolationReader(
  objects: Pick<KubernetesObjectApi, "read" | "patch">, namespace: V1Namespace, projectId: string,
) {
  const resources = projectIsolationReaderResources(namespace, projectId);
  for (const resource of resources) {
    try {
      const existing = await objects.read(resource);
      if (existing.metadata?.deletionTimestamp || existing.metadata?.annotations?.["tali.io/project-id"] !== projectId
        || !existing.metadata.ownerReferences?.some(ref => ref.apiVersion === "v1" && ref.kind === "Namespace"
          && ref.uid === namespace.metadata?.uid && ref.name === namespace.metadata?.name)) {
        throw new Error("Refusing to adopt foreign or terminating Project diagnostic RBAC.");
      }
    } catch (error) {
      if (Number((error as { code?: unknown; statusCode?: unknown }).code ?? (error as { statusCode?: unknown }).statusCode) !== 404) throw error;
    }
  }
  for (const resource of resources) await objects.patch(resource, undefined, undefined, "tali-project-isolation-reader", false, PatchStrategy.ServerSideApply);
}
