#!/usr/bin/env node
// Helm post-renderer: annotate root workload resources, not Pod templates.
import { readFileSync } from "node:fs";
import { parseAllDocuments, stringify } from "yaml";
const owner = JSON.parse(process.argv[2]);
const gatewayName = process.argv[3] ?? `openshell-${owner.name}`;
const control = process.argv[4] ? JSON.parse(process.argv[4]) : undefined;
if (control && (![control.namespace, control.release].every(value => typeof value === "string" && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value)))) {
  throw new Error("A valid Control namespace and release are required for Gateway isolation.");
}
if (owner.apiVersion !== "v1" || owner.kind !== "Namespace" || !owner.uid || !owner.name
  || owner.controller !== false || owner.blockOwnerDeletion !== false) {
  throw new Error("A verified Project Namespace owner is required.");
}
const namespacedKinds = new Set(["StatefulSet", "Deployment", "DaemonSet", "Service", "Secret",
  "ConfigMap", "ServiceAccount", "Role", "RoleBinding", "Job", "NetworkPolicy", "PersistentVolumeClaim", "PodDisruptionBudget"]);
const clusterKinds = new Set(["ClusterRole", "ClusterRoleBinding"]);
const documents = parseAllDocuments(readFileSync(0, "utf8"));
let gatewaySelector;
for (const document of documents) {
  if (document.errors.length) throw document.errors[0];
  const resource = document.toJSON();
  if (!resource) continue;
  if (!namespacedKinds.has(resource.kind) && !clusterKinds.has(resource.kind)) throw new Error(`Unexpected Project chart resource: ${resource.kind}`);
  resource.metadata ??= {};
  if (namespacedKinds.has(resource.kind)) {
    resource.metadata.namespace ??= owner.name;
    if (resource.metadata.namespace !== owner.name) throw new Error("Project chart contains a foreign Namespace resource.");
  } else if (resource.metadata.namespace || !resource.metadata.name?.startsWith(`${gatewayName}-`)) {
    throw new Error("Project chart contains shared or foreign cluster RBAC.");
  }
  if (!resource.metadata.ownerReferences?.length) resource.metadata.ownerReferences = [owner];
  if (["Deployment", "StatefulSet"].includes(resource.kind) && resource.metadata.name === gatewayName) gatewaySelector = resource.spec.selector.matchLabels;
  process.stdout.write(`---\n${stringify(resource)}`);
}
if (control) {
  if (!gatewaySelector) throw new Error("Gateway workload selector is required for isolation.");
  const policy = { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy",
    metadata: { name: `${gatewayName}-ingress`, namespace: owner.name, ownerReferences: [owner] },
    spec: { podSelector: { matchLabels: gatewaySelector }, policyTypes: ["Ingress"], ingress: [{
      from: [
        { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": control.namespace } },
          podSelector: { matchLabels: { "app.kubernetes.io/instance": control.release },
            matchExpressions: [{ key: "app.kubernetes.io/component", operator: "In", values: ["runner", "control-worker"] }] } },
        { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": owner.name } },
          // The Sandbox controller stamps this label on actual Supervisor Pods.
          // openshell.ai/managed-by belongs to the Sandbox CR, not its Pod.
          podSelector: { matchExpressions: [{ key: "agents.x-k8s.io/sandbox-name-hash", operator: "Exists" }] } },
      ], ports: [{ protocol: "TCP", port: 8080 }] }] } };
  process.stdout.write(`---\n${stringify(policy)}`);
}
