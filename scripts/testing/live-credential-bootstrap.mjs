#!/usr/bin/env node
// Run only against an explicitly authorized disposable deployment.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { parseAllDocuments } from "yaml";

assert.equal(process.env.TALI_LIVE_E2E, "1", "Set TALI_LIVE_E2E=1 for the disposable deployment test.");
const context = process.env.KUBE_CONTEXT;
const namespace = process.env.HELM_NAMESPACE;
const release = process.env.HELM_RELEASE_NAME;
assert(context && namespace && release, "KUBE_CONTEXT, HELM_NAMESPACE and HELM_RELEASE_NAME are required.");
const args = ["--context", context, "--namespace", namespace];
const kubectl = (extra, input) => execFileSync("kubectl", [...args, ...extra], {
  encoding: "utf8", input, timeout: 270000, stdio: ["pipe", "pipe", "pipe"],
});
const hooks = parseAllDocuments(execFileSync("helm", ["--kube-context", context, "--namespace", namespace,
  "get", "hooks", release], {encoding:"utf8"})).map(document => document.toJSON()).filter(Boolean);
const config = hooks.find(object => object.data?.["bootstrap-secrets.mjs"]);
assert(config, "Release has no credential bootstrap hook.");
const spec = JSON.parse(config.data["spec.json"]);
assert.equal(spec.namespace, namespace);
const job = hooks.find(object => object.kind === "Job" && object.metadata.name === config.metadata.name);
const account = `system:serviceaccount:${namespace}:${job.spec.template.spec.serviceAccountName}`;
const readSecret = name => JSON.parse(kubectl(["get", "secret", name, "-o", "json"]));
const digest = secret => createHash("sha256").update(JSON.stringify(Object.entries(secret.data).sort())).digest("hex");
const names = [spec.credentialSecret, ...spec.outputs.map(output => output.name)];
const before = Object.fromEntries(names.map(name => { const secret = readSecret(name); return [name, {uid:secret.metadata.uid, digest:digest(secret)}]; }));
assert.equal(readSecret(spec.credentialSecret).immutable, true);

for (const [verb, resource, expected] of [
  ["get", `secret/${spec.credentialSecret}`, true],
  ["patch", `secret/${spec.credentialSecret}`, false],
  ["delete", `secret/${spec.credentialSecret}`, false],
  ["list", "secrets", false],
  ["get", "secret/unrelated-secret", false],
  ["create", "secrets", true],
  ["patch", `secret/${spec.outputs[0].name}`, true],
]) {
  const result = spawnSync("kubectl", [...args, "auth", "can-i", verb, resource, "--as", account], {encoding:"utf8"});
  assert.equal(result.stdout.trim(), expected ? "yes" : "no", `Unexpected RBAC for ${verb} ${resource}`);
}
console.log("PASS: bootstrap SA permissions match the intended scope");

const created = [];
function start(suffix) {
  const copy = structuredClone(job);
  copy.metadata = {name:`${release}-bootstrap-check-${process.pid}-${suffix}`, namespace};
  copy.spec.ttlSecondsAfterFinished = 600;
  kubectl(["create", "-f", "-"], JSON.stringify(copy));
  created.push(copy.metadata.name);
  return copy.metadata.name;
}
function wait(name) {
  kubectl(["wait", "--for=condition=complete", `job/${name}`, "--timeout=240s"]);
  assert.equal(kubectl(["logs", `job/${name}`]).trim(), "Credential initialization complete; existing credentials retained.");
}
try {
  const first = start("a"); const second = start("b");
  wait(first); wait(second);
  for (const name of names) {
    const secret = readSecret(name);
    assert.equal(secret.metadata.uid, before[name].uid);
    assert.equal(digest(secret), before[name].digest);
  }
  console.log("PASS: two simultaneous real Jobs retain all credentials and Secret identities");

  // The running Example MCP process retains its injected value while this
  // disposable Secret is restored from the retained source.
  const recover = spec.outputs.find(output => output.name.endsWith("example-mcp-auth"));
  assert(recover, "Enable exampleMcp for the recovery check.");
  kubectl(["delete", "secret", recover.name]);
  wait(start("recover"));
  assert.notEqual(readSecret(recover.name).metadata.uid, before[recover.name].uid);
  for (const name of names) assert.equal(digest(readSecret(name)), before[name].digest);
  console.log("PASS: a missing component Secret is recreated using the original credentials");
} finally {
  for (const name of created) kubectl(["delete", "job", name, "--ignore-not-found=true"]);
}
for (const name of names) {
  const secret = readSecret(name);
  assert.equal(digest(secret), before[name].digest);
  assert.deepEqual(secret.metadata.ownerReferences.map(owner => owner.kind), ["Namespace"]);
}
console.log("PASS: deleting initialization Jobs preserves every generated Secret");
