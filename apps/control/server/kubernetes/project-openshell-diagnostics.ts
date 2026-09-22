import { AppsV1Api, BatchV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { PromiseMiddlewareWrapper } from "@kubernetes/client-node/dist/gen/middleware.js";

export interface GatewayDiagnostic {
  kind: string;
  name?: string | undefined;
  uid?: string | undefined;
  createdAt?: Date | undefined;
  details: unknown;
  jobDeadlineExceeded?: boolean | undefined;
}
export type GatewayDiagnosticReader = (namespace: string) => Promise<GatewayDiagnostic[]>;

// Only allowlisted status fields: never serialize specs, Secrets, env, logs or
// free-form API messages (which can contain credentials supplied by workloads).
export const readGatewayDiagnostics: GatewayDiagnosticReader = async (namespace) => {
  const config = new KubeConfig();
  config.loadFromDefault();
  const core = config.makeApiClient(CoreV1Api);
  const apps = config.makeApiClient(AppsV1Api);
  const batch = config.makeApiClient(BatchV1Api);
  const options = { middleware: [new PromiseMiddlewareWrapper({
    pre: async (context) => { context.setSignal(AbortSignal.timeout(5000)); return context; },
    post: async (context) => context,
  })] };
  const identity = (kind: string, metadata?: { name?: string; uid?: string; creationTimestamp?: Date }) => ({
    kind, name: metadata?.name, uid: metadata?.uid, createdAt: metadata?.creationTimestamp,
  });
  const conditions = (items?: Array<{ type: string; status: string; reason?: string }>) =>
    items?.map(({ type, status, reason }) => ({ type, status, reason }));
  const results = await Promise.allSettled([
    core.listNamespacedPod({ namespace, limit: 100 }, options).then(({ items }) => items.map((pod) => ({
      ...identity("Pod", pod.metadata), details: {
        owners: pod.metadata?.ownerReferences?.map(({ kind, name, uid }) => ({ kind, name, uid })),
        node: pod.spec?.nodeName, phase: pod.status?.phase, conditions: conditions(pod.status?.conditions),
        containers: [...pod.status?.initContainerStatuses ?? [], ...pod.status?.containerStatuses ?? []].map((c) => ({
          name: c.name, ready: c.ready, restarts: c.restartCount,
          waitingReason: c.state?.waiting?.reason,
          terminatedReason: c.state?.terminated?.reason, exitCode: c.state?.terminated?.exitCode,
          previousReason: c.lastState?.terminated?.reason, previousExitCode: c.lastState?.terminated?.exitCode,
        })),
      },
    }))),
    batch.listNamespacedJob({ namespace, limit: 100 }, options).then(({ items }) => items.map((job) => ({
      ...identity("Job", job.metadata),
      jobDeadlineExceeded: job.status?.conditions?.some((c) => c.type === "Failed" && c.status === "True" && c.reason === "DeadlineExceeded"),
      details: { conditions: conditions(job.status?.conditions), startTime: job.status?.startTime,
        completionTime: job.status?.completionTime, active: job.status?.active, succeeded: job.status?.succeeded, failed: job.status?.failed },
    }))),
    apps.listNamespacedDeployment({ namespace, limit: 100 }, options).then(({ items }) => items.map((d) => ({
      ...identity("Deployment", d.metadata), details: { desired: d.spec?.replicas, ready: d.status?.readyReplicas,
        available: d.status?.availableReplicas, conditions: conditions(d.status?.conditions) },
    }))),
    core.listNamespacedPersistentVolumeClaim({ namespace, limit: 100 }, options).then(({ items }) => items.map((pvc) => ({
      ...identity("PersistentVolumeClaim", pvc.metadata), details: { phase: pvc.status?.phase, conditions: conditions(pvc.status?.conditions) },
    }))),
    core.listNamespacedEvent({ namespace, limit: 100, fieldSelector: "type=Warning" }, options).then(({ items }) => items.map((event) => ({
      ...identity("Event", event.metadata), details: { resource: event.involvedObject, reason: event.reason,
        count: event.count, firstTimestamp: event.firstTimestamp, lastTimestamp: event.lastTimestamp },
    }))),
  ]);
  return results.flatMap((result, index): GatewayDiagnostic[] => result.status === "fulfilled" ? result.value : [{
    kind: "DiagnosticUnavailable", name: ["pods", "jobs", "deployments", "pvcs", "events"][index],
    details: "Collection failed (check API connectivity and Worker RBAC).",
  }]);
};

export function startGatewayDiagnostics(namespace: string, attemptId: string, reader: GatewayDiagnosticReader, certgenName: string) {
  const startedAt = new Date();
  const snapshots = new Map<string, unknown>();
  let stopped = false;
  let deadlineExceeded = false;
  let timer: NodeJS.Timeout | undefined;
  const collect = async () => {
    try {
      for (const resource of await reader(namespace)) {
        // A retained Job from an earlier retry must not classify this attempt.
        if (resource.kind === "Job" && resource.name === certgenName && resource.jobDeadlineExceeded
          && resource.createdAt && new Date(resource.createdAt) >= startedAt) deadlineExceeded = true;
        const key = `${resource.kind}/${resource.uid ?? resource.name}`;
        const snapshot = { observedAt: new Date().toISOString(), ...resource };
        if (JSON.stringify((snapshots.get(key) as { resource?: unknown } | undefined)?.resource) !== JSON.stringify(resource)) {
          console.info(JSON.stringify({ event: "openshell.install.resource", namespace, attemptId, ...snapshot }));
        }
        snapshots.delete(key);
        snapshots.set(key, { ...snapshot, resource });
        if (snapshots.size > 80) snapshots.delete(snapshots.keys().next().value!);
      }
    } catch {
      snapshots.set("collector", { kind: "DiagnosticUnavailable", details: "Unable to collect Kubernetes status." });
    }
  };
  let pending = collect();
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => { pending = collect(); void pending.then(schedule); }, 2000);
    timer.unref();
  };
  void pending.then(schedule);
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await pending;
    await collect();
    return { deadlineExceeded, snapshots: [...snapshots.values()].map((s) => {
      const { resource: _resource, ...snapshot } = s as Record<string, unknown>;
      return snapshot;
    }) };
  };
}
