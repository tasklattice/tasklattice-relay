import type { KubernetesObject, V1Deployment, V1Secret, V1Namespace } from "@kubernetes/client-node";
import { parseAllDocuments, stringify } from "yaml";
import { getWorkerConfig } from "../config/worker-config";
import { effectiveControlInternalUrl } from "../platform/platform-runtime-config";
import { projectRuntimeBridgeResources } from "../kubernetes/project-runtime-bridge-client";
import { defaultCommandRunner, projectOpenShellGatewayValues, type CommandRunner } from "../kubernetes/project-openshell-gateway-client";
import { projectImagePullerBinding } from "../kubernetes/project-image-puller";
import { projectSccBindings } from "../kubernetes/project-scc";
import { projectIsolationReaderResources } from "../kubernetes/project-isolation-reader";
import {
  ISOLATION_NAMESPACE, ISOLATION_NAMESPACE_UID, ISOLATION_PROJECT_ID, ISOLATION_PROJECT_NAME,
  type ProjectIsolationInventory,
} from "../projects/project-isolation-inventory";

let cached: { key: string; inventory: Promise<ProjectIsolationInventory> } | undefined;

export async function buildProjectIsolationInventory(
  controlUrl: string,
  run: CommandRunner = defaultCommandRunner,
): Promise<ProjectIsolationInventory> {
  const config = getWorkerConfig();
  const namespace = ISOLATION_NAMESPACE;
  const input = { namespace, projectId: ISOLATION_PROJECT_ID, projectName: ISOLATION_PROJECT_NAME };
  const owner = { apiVersion: "v1", kind: "Namespace", name: namespace, uid: ISOLATION_NAMESPACE_UID,
    controller: false, blockOwnerDeletion: false };
  const ns: V1Namespace = { metadata: { name: namespace, uid: owner.uid, annotations: { "tali.io/project-id": input.projectId } } };
  const inventory: ProjectIsolationInventory = { controlUrl, resources: [] };
  function add(object: KubernetesObject, owned = config.resource_ownership.enabled) {
    const resource = structuredClone(object) as KubernetesObject & Record<string, unknown>;
    if (owned) resource.metadata = { ...resource.metadata, ownerReferences: [owner] };
    // Hooks are transient; their durable accounts, grants and output Secrets are checked.
    if (resource.kind === "Job" && resource.metadata?.annotations?.["helm.sh/hook-delete-policy"]?.includes("hook-succeeded")) return;
    let secretKeys: string[] | undefined;
    if (resource.kind === "Secret") {
      const secret = resource as V1Secret;
      secretKeys = [...new Set([...Object.keys(secret.data ?? {}), ...Object.keys(secret.stringData ?? {})])];
      delete resource.data;
      delete resource.stringData;
    }
    if (resource.kind === "Deployment") {
      const pod = (resource as V1Deployment).spec?.template;
      // Checksums depend on tenant identity or generated credentials. Validate
      // the referenced data and Bridge token separately against the live Secret.
      for (const key of Object.keys(pod?.metadata?.annotations ?? {})) {
        if (key.includes("checksum")) delete pod!.metadata!.annotations![key];
      }
      // OCP adds per-ServiceAccount pull credentials at runtime.
      if (config.openshift.enabled && pod?.spec) delete pod.spec.imagePullSecrets;
    }
    inventory.resources.push({ resource, ...(secretKeys ? { secretKeys } : {}) });
  }
  if (config.project_runtime_bridge.enabled) {
    for (const resource of projectRuntimeBridgeResources({ ...input, controlUrl, token: "inventory-placeholder" }, config.project_runtime_bridge)) add(resource);
    add({ apiVersion: "v1", kind: "ServiceAccount", metadata: { name: "default", namespace } }, false);
  }
  if (config.project_openshell.enabled) {
    const gateway = config.project_openshell;
    const values = projectOpenShellGatewayValues(input, gateway, { secretName: "openshell-postgresql", checksum: "inventory-placeholder" },
      config.openshift.enabled ? { gatewaySecrets: [], certgenSecrets: [], sandboxSecrets: [] } : undefined);
    const rendered = await run({ command: gateway.helmBin,
      args: ["template", gateway.releaseName, gateway.chart, "--namespace", namespace,
        "--kube-version", "1.29.0", "--api-versions", "agents.x-k8s.io/v1beta1/Sandbox", "--values", "-"],
      stdin: stringify(values), timeoutMs: 15_000 });
    if (rendered.exitCode !== 0) throw new Error("Unable to render the deployed Project Gateway chart for isolation checks.");
    for (const document of parseAllDocuments(rendered.stdout)) {
      if (document.errors.length) throw new Error("Invalid Project Gateway chart output.");
      const resource = document.toJSON() as KubernetesObject | null;
      if (!resource) continue;
      if (!resource.kind?.startsWith("Cluster")) resource.metadata = { ...resource.metadata, namespace };
      add(resource);
    }
    for (const [name, keys] of [
      ["openshell-postgresql", ["uri"]],
      [`${gateway.serviceNamePrefix}${namespace}-jwt-keys`, []],
      ["openshell-server-tls", ["ca.crt", "tls.crt", "tls.key"]],
      ["openshell-client-tls", ["ca.crt", "tls.crt", "tls.key"]],
    ] as const) {
      add({ apiVersion: "v1", kind: "Secret", metadata: { name, namespace },
        data: Object.fromEntries(keys.map(key => [key, "placeholder"])) } as V1Secret);
    }
    if (config.openshift.enabled) add({ apiVersion: "v1", kind: "ServiceAccount", metadata: { name: `${gateway.serviceNamePrefix}${namespace}-certgen`, namespace } });
  }
  const imagePuller = projectImagePullerBinding(ns, input.projectId);
  if (imagePuller) add(imagePuller, true);
  for (const binding of projectSccBindings(ns, input.projectId)) add(binding, true);
  for (const resource of projectIsolationReaderResources(ns, input.projectId)) add(resource, true);
  return inventory;
}

export async function reportedProjectIsolationInventory(controlUrl = effectiveControlInternalUrl()): Promise<ProjectIsolationInventory> {
  const config = getWorkerConfig();
  const key = JSON.stringify([controlUrl, config.project_openshell, config.project_runtime_bridge,
    config.expert_agent_runtime.enabled, config.openshift, config.resource_ownership]);
  if (cached?.key !== key) cached = { key, inventory: buildProjectIsolationInventory(controlUrl) };
  try { return await cached.inventory; }
  catch {
    cached = undefined;
    return { controlUrl, resources: [], unavailable: "Worker could not build the deployed isolation inventory. Check the packaged Gateway chart and Worker configuration." };
  }
}
