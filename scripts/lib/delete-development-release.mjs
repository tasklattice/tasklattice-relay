import { execFileSync } from "node:child_process";

const originRelease = "tali.io/control-release";
const originNamespace = "tali.io/control-namespace";
const cleanupRelease = "tali.io/cleanup-release";
const cleanupNamespace = "tali.io/cleanup-namespace";
const tenantName = /^(tp-[a-z2-7]{13,16}|tali-p-[a-f0-9]{32})$/;
const coreKinds = "deployments,statefulsets,daemonsets,jobs,cronjobs,pods,services,configmaps,secrets,serviceaccounts,roles,rolebindings,networkpolicies,persistentvolumeclaims,horizontalpodautoscalers,poddisruptionbudgets";

// Helm 4 removed --all; explicit status filters work with both Helm 3 and 4
// and retain failed/pending releases in the cleanup inventory.
export const helmReleaseListArgs = ["list", "--all-namespaces", "--deployed", "--failed",
  "--pending", "--uninstalled", "--superseded", "--uninstalling", "--max", "10000", "-o", "json"];

function belongsToRelease(resource, scope) {
  const { labels = {}, annotations = {} } = resource.metadata ?? {};
  if (annotations["meta.helm.sh/release-name"] || annotations["meta.helm.sh/release-namespace"]) {
    return annotations["meta.helm.sh/release-name"] === scope.release
      && annotations["meta.helm.sh/release-namespace"] === scope.namespace;
  }
  return labels["app.kubernetes.io/instance"] === scope.release;
}

export function selectTenantNamespaces(namespaces, installations, scope) {
  const hasOtherInstallation = installations.some(installation =>
    installation.namespace !== scope.namespace || installation.release !== scope.release);
  return namespaces.filter(resource => {
    const { name, labels = {}, annotations = {} } = resource.metadata;
    if (name === scope.namespace || name === "tali" || !tenantName.test(name)
      || labels["app.kubernetes.io/managed-by"] !== "tali"
      || labels["app.kubernetes.io/part-of"] !== "tali"
      || labels["tali.io/runtime-target"] !== "true"
      || !annotations["tali.io/project-id"]) return false;
    if (annotations[originRelease] || annotations[originNamespace]) {
      return annotations[originRelease] === scope.release && annotations[originNamespace] === scope.namespace;
    }
    if (hasOtherInstallation) {
      throw new Error(`Cannot determine which Relay installation owns legacy Namespace ${name}. Set its ${originRelease} and ${originNamespace} annotations before cleanup.`);
    }
    return true;
  });
}

export function selectVolumes(volumes, claims, tenants, scope) {
  const tenantNames = new Set(tenants.map(resource => resource.metadata.name));
  const claimIds = new Set(claims.filter(resource => belongsToRelease(resource, scope))
    .map(resource => resource.metadata.uid));
  return volumes.filter(volume => {
    const annotations = volume.metadata.annotations ?? {};
    if (annotations[cleanupRelease] || annotations[cleanupNamespace]) {
      return annotations[cleanupRelease] === scope.release && annotations[cleanupNamespace] === scope.namespace;
    }
    const claim = volume.spec?.claimRef;
    if (!claim) return false;
    if (tenantNames.has(claim.namespace)) return true;
    if (claim.namespace !== scope.namespace) return false;
    if (claim.uid && claimIds.has(claim.uid)) return true;
    // StatefulSet claims and released volumes from older default dev installs
    // can outlive both Helm and the PVC's labels.
    return claim.name === `data-${scope.release}-postgresql-0`
      || claim.name === `${scope.release}-docling-models`;
  });
}

/** All mutations are scoped to the selected release; never delete its Namespace. */
export function deleteDevelopmentRelease(scope, execute = runCommand, log = console.log) {
  const k = (...args) => execute("kubectl", ["--context", scope.context, ...args]);
  const h = (...args) => execute("helm", ["--kube-context", scope.context, ...args]);
  const get = (...args) => JSON.parse(k("get", ...args, "-o", "json"));
  const resources = () => get(coreKinds, "-n", scope.namespace).items;
  const isCore = resource => belongsToRelease(resource, scope)
    || (resource.kind === "Secret" && resource.metadata.name === `${scope.release}-example-mcp-github`);
  const remove = resource => {
    const args = ["delete", resource.kind, resource.metadata.name, "--ignore-not-found", "--wait=true", `--timeout=${scope.timeout}`];
    if (resource.metadata.namespace) args.push("-n", resource.metadata.namespace);
    k(...args);
  };
  const releases = JSON.parse(h(...helmReleaseListArgs));
  const deployments = get("deployments", "-A").items;
  const installations = [
    ...releases.filter(release => /^tali-relay-/.test(release.chart)).map(release => ({ namespace: release.namespace, release: release.name })),
    ...deployments.filter(resource => resource.metadata.labels?.["app.kubernetes.io/component"] === "control-worker")
      .map(resource => ({ namespace: resource.metadata.namespace, release: resource.metadata.labels?.["app.kubernetes.io/instance"] })),
  ];
  // Resolve ambiguous legacy ownership before stopping anything.
  selectTenantNamespaces(get("namespaces").items, installations, scope);
  log(`Removing Relay ${scope.namespace}/${scope.release}; retaining Namespace ${scope.namespace}.`);

  // Keep Agent Sandbox's controller running until its custom resources finish
  // deletion. Stop every process that could recreate tenant resources first.
  const producers = new Set(["control", "control-worker", "runner"]);
  const stopped = deployments.filter(resource => resource.metadata.namespace === scope.namespace
    && belongsToRelease(resource, scope) && producers.has(resource.metadata.labels?.["app.kubernetes.io/component"]));
  for (const deployment of stopped) {
    log(`Stopping ${deployment.metadata.name}`);
    k("scale", "deployment", deployment.metadata.name, "-n", scope.namespace, "--replicas=0");
  }
  for (const component of producers) {
    const selector = `app.kubernetes.io/instance=${scope.release},app.kubernetes.io/component=${component}`;
    const pods = get("pods", "-n", scope.namespace, "-l", selector).items;
    for (const pod of pods) k("wait", "--for=delete", `pod/${pod.metadata.name}`, "-n", scope.namespace, `--timeout=${scope.timeout}`);
  }

  // Re-read after all old Workers exited: a graceful shutdown may have finished
  // a reconciliation and created another Namespace since the initial snapshot.
  const tenants = selectTenantNamespaces(get("namespaces").items, installations, scope);
  const tenantNames = new Set(tenants.map(resource => resource.metadata.name));
  const core = resources().filter(isCore);
  const volumes = selectVolumes(get("persistentvolumes").items,
    core.filter(resource => resource.kind === "PersistentVolumeClaim"), tenants, scope);
  for (const volume of volumes) {
    // Retain must not leave data behind after a requested full dev reset. Let
    // the storage provisioner remove the backing volume rather than stripping
    // finalizers or just deleting a PV API object. Stamp ownership for retries.
    k("patch", "persistentvolume", volume.metadata.name, "--type=merge", "-p", JSON.stringify({
      metadata: { resourceVersion: volume.metadata.resourceVersion, annotations: {
        [cleanupRelease]: scope.release, [cleanupNamespace]: scope.namespace,
      } }, spec: { persistentVolumeReclaimPolicy: "Delete" },
    }));
  }

  const hasSandboxApi = Boolean(k("get", "crd", "sandboxes.agents.x-k8s.io", "--ignore-not-found", "-o", "name").trim());
  const tenantReleases = JSON.parse(h(...helmReleaseListArgs));
  for (const tenant of tenants) {
    const name = tenant.metadata.name;
    log(`Deleting Project resources in ${name}`);
    if (hasSandboxApi) k("delete", "sandboxes.agents.x-k8s.io", "--all", "-n", name,
      "--ignore-not-found", "--wait=true", `--timeout=${scope.timeout}`);
    for (const release of tenantReleases.filter(release => release.namespace === name)) {
      h("uninstall", release.name, "-n", name, "--wait", "--timeout", scope.timeout);
    }
  }

  const tenantUids = new Set(tenants.map(resource => resource.metadata.uid));
  const clusterResources = get("clusterroles,clusterrolebindings").items;
  for (const resource of clusterResources.filter(resource =>
    tenantNames.has(resource.metadata.annotations?.["meta.helm.sh/release-namespace"])
    || resource.metadata.ownerReferences?.some(owner => owner.kind === "Namespace" && tenantUids.has(owner.uid)))) {
    remove(resource);
  }
  for (const tenant of tenants) remove(tenant);

  if (releases.some(release => release.name === scope.release && release.namespace === scope.namespace)) {
    h("uninstall", scope.release, "-n", scope.namespace, "--wait", "--timeout", scope.timeout);
  }
  // Helm hooks and StatefulSet claims can outlive uninstall. Re-query for hooks
  // created during deletion too; never use `delete --all` in the shared namespace.
  const remaining = resources().filter(isCore);
  const claims = new Map(core.filter(resource => resource.kind === "PersistentVolumeClaim")
    .concat(remaining.filter(resource => resource.kind === "PersistentVolumeClaim"))
    .map(resource => [resource.metadata.name, resource]));
  for (const resource of remaining.filter(resource => resource.kind !== "PersistentVolumeClaim")) remove(resource);
  for (const claim of claims.values()) remove(claim);
  // A retained StatefulSet PVC may lack release labels entirely.
  for (const volume of volumes) {
    const claim = volume.spec?.claimRef;
    if (claim?.namespace === scope.namespace && !claims.has(claim.name)) {
      remove({ kind: "PersistentVolumeClaim", metadata: { name: claim.name, namespace: scope.namespace } });
    }
  }
  for (const resource of get("clusterroles,clusterrolebindings").items.filter(resource => belongsToRelease(resource, scope)
    && resource.metadata.annotations?.["meta.helm.sh/release-namespace"] === scope.namespace)) remove(resource);
  for (const volume of volumes) k("wait", "--for=delete", `persistentvolume/${volume.metadata.name}`, `--timeout=${scope.timeout}`);
  log(`Relay cleanup completed. Namespace ${scope.namespace}, unrelated releases and shared CRDs were retained.`);
}

function runCommand(command, args) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"] });
}
