import { execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseAllDocuments } from "yaml";

function render(settings = []) {
  return parseAllDocuments(execFileSync("helm", ["template", "relay", "charts/tali-relay",
    "--namespace", "control-images", "--kube-version", "1.29.0", ...settings.flatMap(s => ["--set", s])],
  { encoding: "utf8" })).map(d => d.toJSON()).filter(Boolean);
}
const isPuller = (r) => r.metadata?.name?.endsWith("project-image-puller");
test("OpenShift grants only the Worker scoped image-puller binding authority", () => {
  const resources = render(["openshift.enabled=true"]);
  const role = resources.find(r => isPuller(r) && r.kind === "Role");
  const binding = resources.find(r => isPuller(r) && r.kind === "RoleBinding");
  assert.equal(role.metadata.namespace, "control-images");
  assert.deepEqual(role.rules, [
    { apiGroups: ["rbac.authorization.k8s.io"], resources: ["rolebindings"], verbs: ["get", "create", "patch"] },
    { apiGroups: ["rbac.authorization.k8s.io"], resources: ["clusterroles"], resourceNames: ["system:image-puller"], verbs: ["bind"] },
  ]);
  assert.equal(binding.metadata.namespace, "control-images");
  assert.equal(binding.roleRef.kind, "Role");
  assert.equal(binding.roleRef.name, role.metadata.name);
  assert.equal(binding.subjects.length, 1);
  const worker = resources.find(r => r.kind === "ServiceAccount" && r.metadata.name.endsWith("control-worker"));
  assert.deepEqual(binding.subjects[0], { kind: "ServiceAccount", name: worker.metadata.name, namespace: "control-images" });
  assert(!resources.some(r => r.kind === "ClusterRole" && r.rules?.some(rule => rule.verbs.includes("bind"))));
  const toml = resources.flatMap(r => Object.values(r.stringData ?? {})).find(s => s.includes("[worker.openshift]"));
  assert.match(toml, /\[worker.openshift\]\nenabled = true\nimageSourceNamespace = "control-images"/);
});
test("ordinary Kubernetes does not render OpenShift binding authority", () => {
  assert(!render().some(isPuller));
});
