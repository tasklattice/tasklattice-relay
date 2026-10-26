#!/usr/bin/env node
// Helm post-renderer: annotate root workload resources, not Pod templates.
import { readFileSync } from "node:fs";
import { parseAllDocuments, stringify } from "yaml";
const owner = JSON.parse(process.argv[2]);
const gatewayName = process.argv[3] ?? `openshell-${owner.name}`;
if (owner.apiVersion !== "v1" || owner.kind !== "Namespace" || !owner.uid || !owner.name
  || owner.controller !== false || owner.blockOwnerDeletion !== false) {
  throw new Error("A verified Project Namespace owner is required.");
}
const namespacedKinds = new Set(["StatefulSet", "Deployment", "DaemonSet", "Service", "Secret",
  "ConfigMap", "ServiceAccount", "Role", "RoleBinding", "Job", "NetworkPolicy", "PersistentVolumeClaim", "PodDisruptionBudget"]);
const clusterKinds = new Set(["ClusterRole", "ClusterRoleBinding"]);
const documents = parseAllDocuments(readFileSync(0, "utf8"));
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
  process.stdout.write(`---\n${stringify(resource)}`);
}
