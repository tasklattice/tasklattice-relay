import { type KubernetesObjectApi, PatchStrategy, type V1Namespace } from "@kubernetes/client-node";
import { getWorkerConfig } from "../config/worker-config";
import { namespaceOwner } from "./project-resource-ownership";

/** Equivalent to oc policy add-role-to-group system:image-puller
 * system:serviceaccounts:<tenant> -n <image-source>, with one GC-owned binding
 * per Project Namespace incarnation. No credentials are copied or generated.
 */
export async function reconcileProjectImagePuller(
  objects: Pick<KubernetesObjectApi, "read" | "patch">,
  namespace: V1Namespace,
  projectId: string,
): Promise<void> {
  const config = getWorkerConfig().openshift;
  if (!config.enabled) return;
  const source = config.imageSourceNamespace;
  if (!source) throw new Error("OpenShift image pulling requires imageSourceNamespace.");
  const owner = namespaceOwner(namespace, projectId);
  const name = `tali-image-puller-${owner.name}-${owner.uid}`;
  const desired = {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    metadata: {
      name, namespace: source,
      labels: { "app.kubernetes.io/managed-by": "tali", "tali.io/runtime-target": "true" },
      annotations: { "tali.io/project-id": projectId, "tali.io/project-namespace": owner.name },
      // Namespace is cluster-scoped: it can own a namespaced RoleBinding in
      // the image source namespace. Never use a cross-namespace SA owner.
      ownerReferences: [owner],
    },
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "system:image-puller" },
    subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: `system:serviceaccounts:${owner.name}` }],
  };
  try {
    try {
      const existing = await objects.read(desired);
      if (existing.metadata?.annotations?.["tali.io/project-id"] !== projectId
        || !existing.metadata.ownerReferences?.some((ref) => ref.kind === "Namespace" && ref.apiVersion === "v1" && ref.uid === owner.uid && ref.name === owner.name)) {
        throw new Error("Refusing to adopt a RoleBinding not owned by this Project Namespace.");
      }
    } catch (error) {
      if (Number((error as { code?: unknown; statusCode?: unknown })?.code
        ?? (error as { statusCode?: unknown })?.statusCode) !== 404) throw error;
    }
    await objects.patch(desired, undefined, undefined, "tali-project-image-puller", false, PatchStrategy.ServerSideApply);
  } catch (error) {
    const status = (error as { code?: unknown; statusCode?: unknown } | null)?.code
      ?? (error as { statusCode?: unknown } | null)?.statusCode;
    throw new Error(`OpenShift image pull authorization failed${status ? ` (HTTP ${status})` : ""}: RoleBinding ${source}/${name}, tenant=${owner.name}, role=system:image-puller. Check Worker RoleBinding create/patch and scoped bind permissions. ${error instanceof Error ? error.message : "Kubernetes API rejected the request."}`, { cause: error });
  }
}
