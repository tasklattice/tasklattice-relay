#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseAllDocuments } from "yaml";

const chart = parseAllDocuments(readFileSync("charts/tali-relay/Chart.yaml", "utf8"))[0].toJS();
assert(!chart.dependencies.some((dependency) => dependency.name === "openshell"),
  "OpenShell is a Worker image asset, not a Relay Helm dependency");

function render(...args) {
  return parseAllDocuments(execFileSync("helm", [
    "template", "sandbox-validation", "charts/tali-relay", "--namespace", "tali-validation",
    "--include-crds", "--kube-version", "1.35.0", ...args,
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }))
    .map((doc) => { assert.equal(doc.errors.length, 0); return doc.toJS(); }).filter(Boolean);
}
function sandboxObjects(objects) {
  return objects.filter((o) => o.metadata?.name?.includes("agent-sandbox") ||
    (o.kind === "CustomResourceDefinition" && o.spec?.group?.endsWith("agents.x-k8s.io")));
}
const bundled = sandboxObjects(render());
const controller = bundled.find((o) => o.kind === "Deployment");
assert.equal(controller.spec.template.spec.containers[0].image,
  "registry.k8s.io/agent-sandbox/agent-sandbox-controller:v1.0.2");
assert.equal(controller.metadata.namespace, "tali-validation");
assert(!controller.spec.template.spec.containers[0].args.some((arg) => arg.includes("webhook")));
const crds = bundled.filter((o) => o.kind === "CustomResourceDefinition");
assert.equal(crds.length, 4);
for (const crd of crds) {
  assert.deepEqual(crd.spec.versions.map(({ name, served, storage }) => ({ name, served, storage })),
    [{ name: "v1beta1", served: true, storage: true }]);
  assert.notEqual(crd.spec.conversion?.strategy, "Webhook");
}
assert(!bundled.some((o) => o.metadata.name.includes("webhook")));
assert.equal(sandboxObjects(render("--values", "charts/tali-relay/values-uat.yaml")).length, 0,
  "UAT must exclude the controller, CRDs, RBAC, and metrics service");
assert.equal(sandboxObjects(render("--set", "agentSandbox.enabled=false")).length, 0);
assert(sandboxObjects(render("--values", "charts/tali-relay/values-dev.yaml"))
  .some((o) => o.kind === "Deployment"));
const configured = sandboxObjects(render("--set", "agentSandbox.controller.extensions=true",
  "--set", "agentSandbox.controller.leaderElect=false",
  "--set", "agentSandbox.imagePullSecrets[0].name=private-registry",
  "--set", "agentSandbox.metrics.serviceMonitor.enabled=true",
  "--set", "agentSandbox.metrics.prometheusRule.enabled=true"));
const pod = configured.find((o) => o.kind === "Deployment").spec.template.spec;
assert.deepEqual(pod.imagePullSecrets, [{ name: "private-registry" }]);
assert(pod.containers[0].args.includes("--leader-elect=false"));
assert(pod.containers[0].args.includes("--extensions=true"));
assert(configured.some((o) => o.kind === "ServiceMonitor"));
assert(configured.some((o) => o.kind === "PrometheusRule"));
console.log("Agent Sandbox v1.0.2: bundled/external ownership, v1beta1 CRDs, flags, monitoring, and image credentials passed.");
