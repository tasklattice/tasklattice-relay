import { execFileSync, spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseAllDocuments, stringify } from "yaml";
import { resolve } from "node:path";

const owner = { apiVersion: "v1", kind: "Namespace", name: "tp-abcdefghijklmnop",
  uid: "namespace-uid", controller: false, blockOwnerDeletion: false };
const script = resolve("scripts/project-openshell-owner.mjs");
function render(input) {
  return parseAllDocuments(execFileSync(process.execPath, [script, JSON.stringify(owner)],
    { input, encoding: "utf8" })).map(d => d.toJSON()).filter(Boolean);
}
test("a configured Gateway name also scopes dedicated cluster RBAC", () => {
  const gateway = `gateway-${owner.name}`;
  const raw = execFileSync("helm", ["template", "openshell", ".helm-dependencies/openshell",
    "--namespace", owner.name, "--set", `fullnameOverride=${gateway}`], { encoding: "utf8" });
  const output = execFileSync(process.execPath, [script, JSON.stringify(owner), gateway], { input: raw, encoding: "utf8" });
  const role = parseAllDocuments(output).map(d => d.toJSON()).find(r => r?.kind === "ClusterRole");
  assert.deepEqual(role.metadata.ownerReferences, [owner]);
});
test("the real OpenShell chart gets project parents while Pod templates retain controller ownership", () => {
  const raw = execFileSync("helm", ["template", "openshell", ".helm-dependencies/openshell",
    "--namespace", owner.name, "--set", `fullnameOverride=openshell-${owner.name}`], { encoding: "utf8" });
  const resources = render(raw);
  assert(resources.length > 10);
  for (const resource of resources) {
    assert.deepEqual(resource.metadata.ownerReferences, [owner]);
    if (resource.kind.startsWith("ClusterRole")) assert.equal(resource.metadata.namespace, undefined);
    else assert.equal(resource.metadata.namespace, owner.name);
    assert.equal(resource.spec?.template?.metadata?.ownerReferences, undefined);
  }
  for (const [kind, weight] of [["ServiceAccount", "-30"], ["Role", "-30"], ["RoleBinding", "-30"], ["Job", "-20"]]) {
    const hook = resources.find(r => r.kind === kind && r.metadata.name === `openshell-${owner.name}-certgen`);
    assert.equal(hook.metadata.annotations["helm.sh/hook"], "pre-install,pre-upgrade");
    assert.equal(hook.metadata.annotations["helm.sh/hook-weight"], weight);
    assert.equal(hook.metadata.annotations["argocd.argoproj.io/hook"], undefined);
  }
  const claims = resources.find(r => r.kind === "StatefulSet").spec.volumeClaimTemplates;
  assert.equal(claims[0].metadata.ownerReferences, undefined, "existing immutable claim templates must remain unchanged");
});
test("existing owners are preserved verbatim", () => {
  const existing = { ...owner, kind: "Deployment", uid: "controller-uid", controller: true };
  const [resource] = render(stringify({ apiVersion: "v1", kind: "Service",
    metadata: { name: "service", namespace: owner.name, ownerReferences: [existing] } }));
  assert.deepEqual(resource.metadata.ownerReferences, [existing]);
});
for (const resource of [
  { apiVersion: "v1", kind: "Service", metadata: { name: "foreign", namespace: "tali" } },
  { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: { name: "shared-role" } },
  { apiVersion: "apiextensions.k8s.io/v1", kind: "CustomResourceDefinition", metadata: { name: "shared-crd" } },
]) test(`rejects adoption of ${resource.kind}/${resource.metadata.name}`, () => {
  const result = spawnSync(process.execPath, [script, JSON.stringify(owner)],
    { input: stringify(resource), encoding: "utf8" });
  assert.notEqual(result.status, 0);
});
