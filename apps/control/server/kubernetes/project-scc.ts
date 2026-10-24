import { type KubernetesObjectApi, PatchStrategy, type V1Namespace, type V1RoleBinding } from "@kubernetes/client-node";
import { getWorkerConfig } from "../config/worker-config";
import { projectPullServiceAccounts } from "./project-image-pull-readiness";
import { namespaceOwner } from "./project-resource-ownership";

export function projectSccBindings(namespace: V1Namespace, projectId: string) {
  const config = getWorkerConfig();
  if (!config.openshift.enabled || config.openshift.manageTenantScc === false) return [];
  const owner = namespaceOwner(namespace, projectId);
  const grants = new Map<string, string[]>();
  const anyuid: string[] = [];
  if (config.project_openshell.enabled) {
    const accounts = projectPullServiceAccounts(`${config.project_openshell.serviceNamePrefix}${owner.name}`);
    // The pinned OpenShell combined supervisor needs SYS_ADMIN, NET_ADMIN,
    // SYS_PTRACE and SYSLOG. Gateway/certgen do not need privileged SCC.
    grants.set("privileged", [accounts.sandbox]);
    anyuid.push(accounts.gateway, accounts.certgen);
  }
  if (config.project_runtime_bridge.enabled || config.expert_agent_runtime.enabled) anyuid.push("default");
  if (anyuid.length) grants.set("anyuid", anyuid);

  return [...grants].map(([scc, accounts]) => ({
    apiVersion: "rbac.authorization.k8s.io/v1", kind: "RoleBinding",
    metadata: {
      name: `tali-project-scc-${scc}`, namespace: owner.name,
      labels: { "app.kubernetes.io/managed-by": "tali", "tali.io/runtime-target": "true" },
      annotations: { "tali.io/project-id": projectId },
      ownerReferences: [owner],
    },
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: `system:openshift:scc:${scc}` },
    subjects: accounts.map(name => ({ kind: "ServiceAccount", name, namespace: owner.name })),
  }));
}

/** Authorize the actual tenant identities before Gateway hooks or runtime Pods.
 * Keep the bindings independent of the tenant Helm release: recovery may uninstall
 * that release, but must not remove the permissions needed to reinstall it.
 */
export async function reconcileProjectScc(
  objects: Pick<KubernetesObjectApi, "read" | "patch">,
  namespace: V1Namespace,
  projectId: string,
  assertCurrent?: () => Promise<void>,
): Promise<void> {
  const desired = projectSccBindings(namespace, projectId);
  if (!desired.length) return;
  const owner = namespaceOwner(namespace, projectId);
  // Check all existing identities before applying any grant. Never adopt an
  // operator-owned binding or delete/recreate an immutable roleRef.
  for (const binding of desired) {
    await assertCurrent?.();
    try {
      const existing = await objects.read(binding) as V1RoleBinding;
      if (existing.metadata?.deletionTimestamp
        || existing.metadata?.annotations?.["tali.io/project-id"] !== projectId
        || !existing.metadata.ownerReferences?.some(ref => ref.kind === "Namespace" && ref.apiVersion === "v1"
          && ref.uid === owner.uid && ref.name === owner.name)
        || existing.roleRef?.kind !== binding.roleRef.kind
        || existing.roleRef?.apiGroup !== binding.roleRef.apiGroup
        || existing.roleRef?.name !== binding.roleRef.name) {
        throw new Error(`Refusing to replace foreign, terminating or incompatible SCC RoleBinding ${owner.name}/${binding.metadata!.name}.`);
      }
    } catch (error) {
      if (status(error) !== 404) throw authorizationError(binding, error);
    }
  }
  for (const binding of desired) {
    await assertCurrent?.();
    try {
      await objects.patch(binding, undefined, undefined, "tali-project-scc", false, PatchStrategy.ServerSideApply);
    } catch (error) {
      throw authorizationError(binding, error);
    }
  }
}

function status(error: unknown): number {
  const value = error as { code?: unknown; statusCode?: unknown } | null;
  return Number(value?.code ?? value?.statusCode);
}

function authorizationError(binding: V1RoleBinding, error: unknown): Error {
  const code = status(error);
  return new Error(`OpenShift SCC authorization failed${code ? ` (HTTP ${code})` : ""}: RoleBinding ${binding.metadata!.namespace}/${binding.metadata!.name}, role=${binding.roleRef.name}. Check Worker RoleBinding create/patch and SCC ClusterRole bind permissions. ${error instanceof Error ? error.message : "Kubernetes API rejected the request."}`, { cause: error });
}
