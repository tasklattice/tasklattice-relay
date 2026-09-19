import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { deleteDevelopmentRelease, helmReleaseListArgs, selectTenantNamespaces, selectVolumes } from "../lib/delete-development-release.mjs";

test("release inventory flags are supported by the installed Helm CLI", context => {
  const result = spawnSync("helm", ["list", "--help"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") return context.skip("Helm is not installed");
  assert.equal(result.status, 0, result.stderr);
  const supported = new Set(result.stdout.match(/--[a-z][a-z-]*/g));
  for (const flag of helmReleaseListArgs.filter(arg => arg.startsWith("--"))) {
    assert(supported.has(flag), `Installed Helm does not support ${flag}`);
  }
});

const scope = { context: "test-context", namespace: "tali", release: "tali-relay", timeout: "3m" };
const tenant = (name = "tp-v3i65n4c7jslo", annotations = {}) => ({ apiVersion: "v1", kind: "Namespace", metadata: {
  name, uid: `uid-${name}`, labels: { "app.kubernetes.io/managed-by": "tali", "app.kubernetes.io/part-of": "tali", "tali.io/runtime-target": "true" },
  annotations: { "tali.io/project-id": "proj1", ...annotations },
} });
const coreResource = (kind, name, component, release = "tali-relay") => ({ apiVersion: "v1", kind, metadata: {
  name, namespace: "tali", uid: `uid-${name}`, labels: { "app.kubernetes.io/instance": release, "app.kubernetes.io/component": component },
} });
const volume = (name, namespace, claimName, annotations = {}) => ({ apiVersion: "v1", kind: "PersistentVolume", metadata: {
  name, resourceVersion: "7", annotations,
}, spec: { persistentVolumeReclaimPolicy: "Retain", claimRef: { namespace, name: claimName, uid: `uid-${claimName}` } } });

test("legacy Relay tenant discovery excludes the shared namespace, unmarked and foreign tenants", () => {
  const valid = tenant();
  const foreign = tenant("tp-abcdefghijklm", { "tali.io/control-release": "other", "tali.io/control-namespace": "other" });
  assert.deepEqual(selectTenantNamespaces([valid, tenant("tali"), tenant("kube-system"), foreign,
    { ...tenant("tp-bcdefghijklmn"), metadata: { name: "tp-bcdefghijklmn" } }], [], scope), [valid]);
  assert.throws(() => selectTenantNamespaces([valid], [{ namespace: "other", release: "other" }], scope), /Cannot determine/);
  const scoped = tenant(undefined, { "tali.io/control-release": scope.release, "tali.io/control-namespace": scope.namespace });
  assert.deepEqual(selectTenantNamespaces([scoped, foreign], [{ namespace: "other", release: "other" }], scope), [scoped]);
});

test("volume cleanup selects tenant storage, owned claims and released dev PG volumes only", () => {
  const claim = coreResource("PersistentVolumeClaim", "custom-postgres-data", "postgresql");
  const own = volume("own", "tali", claim.metadata.name);
  const tenantVolume = volume("tenant", tenant().metadata.name, "workspace-agent");
  const orphan = volume("orphan", "tali", "data-tali-relay-postgresql-0");
  const retry = volume("retry", "deleted-namespace", "old", { "tali.io/cleanup-release": "tali-relay", "tali.io/cleanup-namespace": "tali" });
  const foreign = volume("guard", "tali", "data-tali-guard-postgresql-0");
  assert.deepEqual(selectVolumes([own, tenantVolume, orphan, retry, foreign], [claim], [tenant()], scope), [own, tenantVolume, orphan, retry]);
});

function fixture({ releasePresent = true, failWait = false } = {}) {
  const calls = [];
  const first = tenant();
  const late = tenant("tp-abcdefghijklm");
  let namespaceReads = 0;
  const deployments = [coreResource("Deployment", "tali-relay-control", "control"),
    coreResource("Deployment", "tali-relay-control-worker", "control-worker"),
    coreResource("Deployment", "tali-relay-runner", "runner"),
    coreResource("Deployment", "tali-guard-controller", "controller", "tali-guard")];
  const claims = [coreResource("PersistentVolumeClaim", "data-tali-relay-postgresql-0", "postgresql"),
    coreResource("PersistentVolumeClaim", "data-tali-guard-postgresql-0", "postgresql", "tali-guard")];
  const volumes = [volume("pv-relay", "tali", claims[0].metadata.name),
    volume("pv-tenant", first.metadata.name, "openshell-data-old-0"),
    volume("pv-guard", "tali", claims[1].metadata.name)];
  const secrets = [coreResource("Secret", "tali-relay-control-config", "control"),
    coreResource("Secret", "tali-guard-config", "controller", "tali-guard"),
    { kind: "Secret", metadata: { name: "tali-relay-example-mcp-github", namespace: "tali" } }];
  const rbac = [
    { kind: "ClusterRole", metadata: { name: "openshell-project-role", ownerReferences: [{ kind: "Namespace", uid: first.metadata.uid }] } },
    { kind: "ClusterRoleBinding", metadata: { name: "orphan-project-binding", annotations: { "meta.helm.sh/release-namespace": first.metadata.name } } },
    { kind: "ClusterRole", metadata: { name: "relay-role", annotations: { "meta.helm.sh/release-name": scope.release, "meta.helm.sh/release-namespace": scope.namespace } } },
    { kind: "ClusterRole", metadata: { name: "guard-role", annotations: { "meta.helm.sh/release-name": "guard", "meta.helm.sh/release-namespace": scope.namespace } } },
  ];
  const execute = (command, fullArgs) => {
    assert.equal(fullArgs[1], scope.context);
    const args = fullArgs.slice(2);
    calls.push({ command, args });
    if (command === "helm" && args[0] === "list") {
      assert.deepEqual(args, ["list", "--all-namespaces", "--deployed", "--failed", "--pending",
        "--uninstalled", "--superseded", "--uninstalling", "--max", "10000", "-o", "json"]);
      return JSON.stringify([
      ...(releasePresent ? [{ name: scope.release, namespace: scope.namespace, chart: "tali-relay-0.1.0" }] : []),
      { name: "openshell", namespace: first.metadata.name, chart: "openshell-0.0.106" },
      { name: "guard", namespace: "tali", chart: "tali-guard-0.1.0" },
      ]);
    }
    if (command === "kubectl" && args[0] === "get") {
      if (args[1] === "deployments") return JSON.stringify({ items: deployments });
      if (args[1] === "namespaces") return JSON.stringify({ items: ++namespaceReads === 1 ? [first] : [first, late] });
      if (args[1] === "pods") return JSON.stringify({ items: [{ metadata: { name: `old-${args.at(-3).split("=").at(-1)}` } }] });
      if (args[1] === "persistentvolumes") return JSON.stringify({ items: volumes });
      if (args[1] === "clusterroles,clusterrolebindings") return JSON.stringify({ items: rbac });
      if (args[1] === "crd") return "customresourcedefinition.apiextensions.k8s.io/sandboxes.agents.x-k8s.io";
      if (args[1].startsWith("deployments,")) return JSON.stringify({ items: [...claims, ...secrets] });
      throw new Error(`Unexpected get: ${args.join(" ")}`);
    }
    if (failWait && args[0] === "wait" && args[2].startsWith("pod/")) throw new Error("old Worker still running");
    return "";
  };
  return { calls, execute, first, late };
}

test("full dev deletion waits for Workers, cleans tenants before the controller, and retains tali and Guard", () => {
  const { calls, execute, first, late } = fixture();
  deleteDevelopmentRelease(scope, execute, () => {});
  const at = predicate => calls.findIndex(predicate);
  const deleted = calls.filter(({ args }) => args[0] === "delete");
  const stopped = calls.filter(({ args }) => args[0] === "scale").map(({ args }) => args[2]);
  assert.deepEqual(stopped, ["tali-relay-control", "tali-relay-control-worker", "tali-relay-runner"]);
  const podWait = at(({ args }) => args[0] === "wait" && args[2].startsWith("pod/"));
  const sandboxDelete = at(({ args }) => args[0] === "delete" && args[1] === "sandboxes.agents.x-k8s.io");
  const gatewayDelete = at(({ command, args }) => command === "helm" && args[0] === "uninstall" && args[1] === "openshell");
  const mainDelete = at(({ command, args }) => command === "helm" && args[0] === "uninstall" && args[1] === scope.release);
  assert(podWait >= 0 && podWait < sandboxDelete && sandboxDelete < gatewayDelete && gatewayDelete < mainDelete);
  for (const name of [first.metadata.name, late.metadata.name]) {
    const index = at(({ args }) => args[0] === "delete" && args[1] === "Namespace" && args[2] === name);
    assert(index > gatewayDelete && index < mainDelete);
  }
  assert(deleted.some(({ args }) => args[2] === "data-tali-relay-postgresql-0"));
  assert(deleted.some(({ args }) => args[2] === "tali-relay-control-config"));
  assert(deleted.some(({ args }) => args[2] === "tali-relay-example-mcp-github"));
  assert(deleted.some(({ args }) => args[2] === "orphan-project-binding"));
  assert(!deleted.some(({ args }) => args[1] === "Namespace" && args[2] === "tali"));
  assert(!deleted.some(({ args }) => args[1] === "crd" || args[2]?.includes("guard")));
  for (const call of calls.filter(({ args }) => args[0] === "patch")) {
    assert.notEqual(call.args[2], "pv-guard");
    assert.equal(JSON.parse(call.args.at(-1)).spec.persistentVolumeReclaimPolicy, "Delete");
  }
  assert(calls.some(({ args }) => args[0] === "wait" && args[2] === "persistentvolume/pv-tenant"));
  assert(!calls.some(({ args }) => args.includes("--force")));
});

test("cleanup still removes tenant releases and leftovers when the main Helm release is already absent", () => {
  const { execute, calls } = fixture({ releasePresent: false });
  deleteDevelopmentRelease(scope, execute, () => {});
  assert(!calls.some(({ command, args }) => command === "helm" && args[0] === "uninstall" && args[1] === scope.release));
  assert(calls.some(({ args }) => args[0] === "delete" && args[2] === "tali-relay-control-config"));
});

test("a Worker shutdown timeout stops cleanup before deleting tenant resources", () => {
  const { execute, calls } = fixture({ failWait: true });
  assert.throws(() => deleteDevelopmentRelease(scope, execute, () => {}), /old Worker still running/);
  assert(!calls.some(({ args }) => ["delete", "uninstall", "patch"].includes(args[0])));
});
