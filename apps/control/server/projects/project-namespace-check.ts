import { CoreV1Api, KubeConfig, createConfiguration, type V1Namespace } from "@kubernetes/client-node";
import type { ProjectNamespaceCheck } from "@tali/contracts";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";
import { projectNameLabel } from "../kubernetes/project-namespace-client";
import { projectRuntimeNamespace } from "./project-runtime-identity";

async function readNamespace(name: string): Promise<V1Namespace> {
  if (!process.env.KUBERNETES_SERVICE_HOST) {
    throw new Error("The Kubernetes in-cluster API is unavailable.");
  }
  const kube = new KubeConfig();
  kube.loadFromCluster();
  return kube.makeApiClient(CoreV1Api).readNamespace({ name }, {
    middlewareMergeStrategy: "append",
    middleware: createConfiguration({ promiseMiddleware: [{ pre: async (context) => {
      context.setSignal(AbortSignal.timeout(10_000));
      return context;
    }, post: async (context) => context }] }).middleware,
  });
}

/** Observes the live Namespace. Never creates resources or changes recorded readiness. */
export class ProjectNamespaceCheckService {
  constructor(
    private readonly db: PrismaClient = prisma(),
    private readonly read: (name: string) => Promise<V1Namespace> = readNamespace,
  ) {}

  async check(projectId: string): Promise<ProjectNamespaceCheck> {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: { name: true, deletedAt: true, runtimeTarget: true },
    });
    if (!project || project.deletedAt) throw new Error("Project not found or being deleted.");
    const runtime = (await loadPlatformRuntimeConfiguration(this.db)).runtimeNamespaces;
    const namespace = projectRuntimeNamespace(projectId);
    const checks: ProjectNamespaceCheck["checks"] = [];
    const add = (id: string, label: string, passed: boolean, message: string) => {
      checks.push({ id, label, status: passed ? "passed" : "failed", message });
    };
    const result = (): ProjectNamespaceCheck => ({
      checkedAt: new Date().toISOString(), namespace, clusterId: runtime.clusterId,
      healthy: checks.every((check) => check.status === "passed"), checks,
    });
    add("enabled", "Runtime namespaces", runtime.enabled,
      runtime.enabled ? "Project runtime namespaces are enabled." : "Enable runtime namespaces in Platform Settings.");
    const target = project.runtimeTarget;
    const matches = !!target && target.namespace === namespace && target.clusterId === runtime.clusterId;
    add("target", "Namespace mapping", matches, !target
      ? "No runtime target is recorded. Reinitialize this Project to create it."
      : matches ? `Expected Namespace ${namespace} in cluster ${runtime.clusterId}.`
        : `Recorded target ${target.clusterId}/${target.namespace} does not match ${runtime.clusterId}/${namespace}.`);
    // Do not query an unrelated cluster or Namespace when the mapping is inconsistent.
    if (!runtime.enabled || (target && !matches)) return result();

    let observed: V1Namespace;
    try {
      observed = await this.read(namespace);
    } catch (error) {
      const code = error && typeof error === "object"
        ? Number((error as { code?: unknown; statusCode?: unknown }).code
          ?? (error as { statusCode?: unknown }).statusCode) : undefined;
      checks.push({
        id: "namespace", label: "Live Namespace", status: code === 404 ? "failed" : "unavailable",
        message: code === 404 ? `Namespace ${namespace} is missing. Reinitialize this Project to recreate it.`
          : code === 403 ? "Control does not have permission to read the Namespace. Check its Kubernetes RBAC."
            : "Unable to read the Namespace from Kubernetes. Check API connectivity and Control permissions, then check again.",
      });
      return result();
    }
    add("namespace", "Live Namespace", observed.metadata?.name === namespace,
      `Kubernetes returned Namespace ${observed.metadata?.name ?? "unknown"}.`);
    const owner = observed.metadata?.annotations?.["tali.io/project-id"];
    add("owner", "Project ownership", owner === projectId,
      owner === projectId ? "The Namespace belongs to this Project."
        : "The Namespace owner does not match this Project. Relay will refuse to adopt it.");
    const active = observed.status?.phase === "Active" && !observed.metadata?.deletionTimestamp;
    add("phase", "Namespace phase", active, observed.metadata?.deletionTimestamp
      ? "The Namespace is terminating. Wait for deletion to finish before reinitializing."
      : `Namespace phase: ${observed.status?.phase ?? "unknown"}.`);
    const labels = observed.metadata?.labels;
    const metadataMatches = labels?.["app.kubernetes.io/managed-by"] === "tali"
      && labels?.["app.kubernetes.io/part-of"] === "tali"
      && labels?.["tali.io/runtime-target"] === "true"
      && labels?.["tali.io/project-name"] === projectNameLabel(project.name)
      && observed.metadata?.annotations?.["tali.io/project-name"] === project.name;
    add("metadata", "Relay metadata", metadataMatches, metadataMatches
      ? "Project name and Relay management labels match."
      : "Project name or Relay management labels differ. Reinitialization can repair metadata on an owned Namespace.");
    return result();
  }
}
