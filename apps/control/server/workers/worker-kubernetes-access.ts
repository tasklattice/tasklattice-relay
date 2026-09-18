import { AuthorizationV1Api, KubeConfig } from "@kubernetes/client-node";

const runtimeNamespacePermissions = [
  { group: "", resource: "namespaces", verb: "get" },
  { group: "", resource: "namespaces", verb: "create" },
  { group: "", resource: "namespaces", verb: "patch" },
  { group: "", resource: "services", verb: "get" },
  { group: "", resource: "services", verb: "create" },
  { group: "", resource: "services", verb: "patch" },
  { group: "", resource: "services", verb: "delete" },
  { group: "", resource: "pods", verb: "get" },
  { group: "", resource: "pods", verb: "list" },
  { group: "apps", resource: "deployments", verb: "get" },
  { group: "apps", resource: "deployments", verb: "create" },
  { group: "apps", resource: "deployments", verb: "patch" },
  { group: "apps", resource: "deployments", verb: "delete" },
] as const;

export async function verifyRuntimeNamespaceAccess(): Promise<void> {
  if (!process.env.KUBERNETES_SERVICE_HOST) {
    throw new Error(
      "Runtime Namespaces cannot be enabled because the Kubernetes in-cluster API is unavailable.",
    );
  }
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromCluster();
  const authorization = kubeConfig.makeApiClient(AuthorizationV1Api);
  const reviews = await Promise.all(runtimeNamespacePermissions.map(
    (attributes) => authorization.createSelfSubjectAccessReview({
      body: {
        apiVersion: "authorization.k8s.io/v1",
        kind: "SelfSubjectAccessReview",
        spec: { resourceAttributes: attributes },
      },
    }),
  ));
  const denied = reviews.flatMap((review, index) =>
    review.status?.allowed ? [] : [runtimeNamespacePermissions[index]!]
  );
  if (denied.length) {
    throw new Error(
      `Worker ServiceAccount is missing Kubernetes access: ${denied
        .map(({ group, resource, verb }) => `${verb} ${group ? `${group}/` : ""}${resource}`)
        .join(", ")}.`,
    );
  }
}

