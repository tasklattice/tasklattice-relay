import { createHash } from "node:crypto";
import type { KubernetesObject, V1Deployment, V1Secret, V1Service, V1PodSpec, V1ServiceAccount } from "@kubernetes/client-node";
import type { ProjectNamespaceCheck } from "@tali/contracts";
import { controlNetworkTarget, controlServiceEgress, PROJECT_RUNTIME_BRIDGE_NAME } from "../kubernetes/project-runtime-bridge-client";
import { signProjectRuntimeBridgeToken } from "../runtime-bridge/project-runtime-bridge-token";
import { instantiateIsolationInventory, type ProjectIsolationInventory } from "./project-isolation-inventory";

export type ProjectResourceReader = (resource: KubernetesObject) => Promise<KubernetesObject>;
type Check = ProjectNamespaceCheck["checks"][number];

// API defaults may add object fields; declarative lists remain complete sets.
// Policy/RBAC selectors and permissions use exact objects to catch broadening.
export function isolationFieldsMatch(actual: unknown, expected: unknown, exact = false, field = ""): boolean {
  if (Array.isArray(expected)) {
    if (actual === undefined && expected.length === 0) return true; // API omits empty lists.
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    if (["args", "command", "env", "envFrom", "initContainers"].includes(field)) {
      return expected.every((item, index) => isolationFieldsMatch(actual[index], item, exact));
    }
    const remaining = [...actual];
    return expected.every(item => {
      const index = remaining.findIndex(value => isolationFieldsMatch(value, item, exact));
      if (index < 0) return false;
      remaining.splice(index, 1);
      return true;
    });
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    const wanted = expected as Record<string, unknown>;
    const observed = actual as Record<string, unknown>;
    return (!exact || Object.keys(observed).length === Object.keys(wanted).length)
      && Object.entries(wanted).every(([key, value]) => isolationFieldsMatch(observed[key], value, exact, key));
  }
  return actual === expected;
}

function secretValue(secret: V1Secret, key: string): string {
  return secret.stringData?.[key] ?? Buffer.from(secret.data?.[key] ?? "", "base64").toString("utf8");
}

export async function checkProjectIsolation(
  input: { namespace: string; projectId: string; projectName: string; uid: string; controlUrl: string; runnerToken: string },
  inventory: ProjectIsolationInventory,
  read: ProjectResourceReader,
): Promise<Check[]> {
  const checks: Check[] = [];
  const expected = instantiateIsolationInventory(inventory, input);
  // Helm YAML uses `from`; client-node represents that API field as `_from`.
  for (const { resource } of expected.resources) {
    if (resource.kind !== "NetworkPolicy") continue;
    for (const rule of (resource.spec as { ingress?: Array<Record<string, unknown>> }).ingress ?? []) {
      if ("from" in rule) { rule._from = rule.from; delete rule.from; }
    }
  }
  const cache = new Map<string, Promise<KubernetesObject>>();
  const keyOf = (r: KubernetesObject) => `${r.apiVersion}/${r.kind}/${r.metadata?.namespace ?? "cluster"}/${r.metadata?.name}`;
  const observed = (r: KubernetesObject) => {
    const key = keyOf(r);
    if (!cache.has(key)) cache.set(key, read(r));
    return cache.get(key)!;
  };
  const errorCheck = (resource: KubernetesObject, error: unknown): Check => {
    const code = Number((error as { code?: unknown; statusCode?: unknown } | null)?.code
      ?? (error as { statusCode?: unknown } | null)?.statusCode);
    return { id: keyOf(resource), label: `${resource.kind}/${resource.metadata?.name}`,
      status: code === 404 ? "failed" : "unavailable",
      message: code === 404 ? "Resource is missing. Reinitialize this Project to repair its infrastructure."
        : code === 403 ? "Control cannot read this resource. Update its diagnostic RBAC and check again."
          : "Unable to read this resource. Check Kubernetes API connectivity and permissions." };
  };
  let controlService: V1Service | undefined;
  const bridgeEnabled = expected.resources.some(({ resource }) => resource.kind === "Deployment"
    && (resource as KubernetesObject).metadata?.name === PROJECT_RUNTIME_BRIDGE_NAME);
  const bridgeToken = bridgeEnabled && input.runnerToken ? signProjectRuntimeBridgeToken(input, input.runnerToken) : undefined;
  if (bridgeEnabled && !bridgeToken) checks.push({ id: "bridge-signing-key", label: "Bridge identity verification", status: "unavailable",
    message: "Control has no Bridge signing key configured. Restore its runtime configuration and check again." });
  if (bridgeEnabled) {
    let ref: KubernetesObject = { apiVersion: "v1", kind: "Service" };
    try {
      const target = controlNetworkTarget(input.controlUrl);
      ref = { ...ref, metadata: { name: target.serviceName, namespace: target.namespace } };
      controlService = await observed(ref) as V1Service;
      controlServiceEgress(input.controlUrl, controlService);
      checks.push({ id: "control-service", label: "Control Service target", status: "passed",
        message: `Using ${target.namespace}/${target.serviceName}:${target.port} and its complete Pod selector.` });
    } catch (error) {
      controlService = undefined;
      checks.push({ ...errorCheck(ref, error), id: "control-service",
        ...(error instanceof Error && error.message.startsWith("Control Service must")
          ? { status: "failed" as const, message: "Control Service does not match the configured URL, TCP port or Pod selector." } : {}) });
    }
  }
  const referenced = new Map<string, { resource: KubernetesObject; keys: Set<string> }>();
  function reference(kind: string, namespace: string, name: string, keys: string[] = []) {
    const resource = { apiVersion: "v1", kind, metadata: { namespace, name } };
    const key = keyOf(resource);
    if (!referenced.has(key)) referenced.set(key, { resource, keys: new Set() });
    for (const keyName of keys) referenced.get(key)!.keys.add(keyName);
  }
  const resources = await Promise.all(expected.resources.map(async ({ resource: raw, secretKeys }) => {
    const resource = raw as KubernetesObject & Record<string, unknown>;
    const isBridge = resource.metadata?.name === PROJECT_RUNTIME_BRIDGE_NAME;
    if (isBridge && resource.kind === "NetworkPolicy") {
      if (!controlService) return { id: keyOf(resource), label: "Bridge NetworkPolicy", status: "unavailable" as const,
        message: "Cannot validate Bridge egress until its Control Service target is verified." };
      (resource.spec as { egress: unknown[] }).egress[1] = controlServiceEgress(input.controlUrl, controlService);
    }
    if (isBridge && resource.kind === "Deployment") {
      const container = (resource as V1Deployment).spec!.template.spec!.containers[0]!;
      container.env!.find(item => item.name === "TALI_CONTROL_INTERNAL_URL")!.value = input.controlUrl;
    }
    let actual: KubernetesObject & Record<string, unknown>;
    try { actual = await observed(resource) as typeof actual; }
    catch (error) { return errorCheck(resource, error); }
    const failures: string[] = [];
    if (actual.metadata?.deletionTimestamp) failures.push("resource is terminating");
    if (!isolationFieldsMatch(actual.metadata, resource.metadata)) failures.push("ownership or metadata differs");
    for (const field of ["spec", "data", "type", "rules", "roleRef", "subjects"]) {
      if (!(field in resource)) continue;
      const exact = resource.kind === "NetworkPolicy" || ["rules", "roleRef", "subjects"].includes(field);
      if (!isolationFieldsMatch(actual[field], resource[field], exact)) failures.push(`${field} differs from deployed configuration`);
    }
    if (resource.kind === "Service" && !isolationFieldsMatch((actual as V1Service).spec?.selector, (resource as V1Service).spec?.selector, true)) {
      failures.push("Service Pod selector differs");
    }
    if (resource.kind === "Secret") {
      const secret = actual as V1Secret;
      if (!Object.keys(secret.data ?? secret.stringData ?? {}).length) failures.push("Secret is empty");
      if (secretKeys?.some(key => !secretValue(secret, key))) failures.push("required Secret keys are missing");
      if (isBridge && bridgeToken) {
        if (secretValue(secret, "project-token") !== bridgeToken) failures.push("Project Bridge identity differs");
      }
      if (resource.metadata?.name === "openshell-postgresql") {
        try {
          const uri = new URL(secretValue(secret, "uri"));
          const name = `openshell_${input.namespace.replaceAll("-", "_")}`;
          if (uri.username !== name || uri.pathname !== `/${name}`) failures.push("Gateway database identity is outside this Project");
        } catch { failures.push("Gateway database URI is invalid"); }
      }
    }
    if (resource.kind === "Deployment") {
      const deployment = actual as V1Deployment;
      const replicas = (resource as V1Deployment).spec?.replicas ?? 1;
      if (!deployment.metadata?.generation || deployment.status?.observedGeneration !== deployment.metadata.generation
        || (deployment.status.availableReplicas ?? 0) < replicas || (deployment.status.updatedReplicas ?? 0) < replicas) failures.push("Deployment is not available at its current generation");
      if (isBridge && bridgeToken) {
        if (deployment.spec?.template.metadata?.annotations?.["tali.io/project-runtime-token-checksum"] !== createHash("sha256").update(bridgeToken).digest("hex")) failures.push("Bridge token rollout checksum differs");
      }
      const pod = deployment.spec?.template.spec;
      if (pod) collectPodReferences(pod, resource.metadata!.namespace!, reference);
    }
    if (resource.kind === "ServiceAccount") {
      for (const secret of (actual as V1ServiceAccount).imagePullSecrets ?? []) if (secret.name) reference("Secret", resource.metadata!.namespace!, secret.name);
    }
    return { id: keyOf(resource), label: `${resource.kind}/${resource.metadata?.name}`,
      status: failures.length ? "failed" as const : "passed" as const,
      message: failures.length ? `${failures.join("; ")}. Reinitialize this Project after resolving ownership conflicts.`
        : "Present, owned as expected, and matches the deployed isolation configuration." };
  }));
  checks.push(...resources);
  // Credentials and ConfigMaps referenced by infrastructure are checked without
  // listing or evaluating any Agent workload or business resource.
  checks.push(...await Promise.all([...referenced.values()].map(async ({ resource, keys }): Promise<Check> => {
    try {
      const actual = await observed(resource) as V1Secret;
      const values = actual.data ?? actual.stringData ?? {};
      const passed = !actual.metadata?.deletionTimestamp && (resource.kind === "ServiceAccount"
        || (Object.keys(values).length > 0 && [...keys].every(key => !!values[key])));
      return { id: `reference:${keyOf(resource)}`, label: `Infrastructure dependency: ${resource.kind}/${resource.metadata?.name}`,
        status: passed ? "passed" : "failed", message: passed ? "Referenced resource and required keys exist."
          : "Referenced resource is empty, terminating, or missing required keys." };
    } catch (error) { return { ...errorCheck(resource, error), id: `reference:${keyOf(resource)}` }; }
  })));
  return checks;
}

function collectPodReferences(pod: V1PodSpec, namespace: string,
  reference: (kind: string, namespace: string, name: string, keys?: string[]) => void) {
  reference("ServiceAccount", namespace, pod.serviceAccountName ?? "default");
  for (const secret of pod.imagePullSecrets ?? []) if (secret.name) reference("Secret", namespace, secret.name);
  for (const container of [...pod.containers, ...(pod.initContainers ?? [])]) {
    for (const env of container.env ?? []) {
      for (const [kind, ref] of [["Secret", env.valueFrom?.secretKeyRef], ["ConfigMap", env.valueFrom?.configMapKeyRef]] as const) {
        if (ref?.name && !ref.optional) reference(kind, namespace, ref.name, [ref.key]);
      }
    }
    for (const env of container.envFrom ?? []) {
      if (env.secretRef?.name && !env.secretRef.optional) reference("Secret", namespace, env.secretRef.name);
      if (env.configMapRef?.name && !env.configMapRef.optional) reference("ConfigMap", namespace, env.configMapRef.name);
    }
  }
  for (const volume of pod.volumes ?? []) {
    if (volume.secret?.secretName && !volume.secret.optional) reference("Secret", namespace, volume.secret.secretName, volume.secret.items?.map(item => item.key));
    if (volume.configMap?.name && !volume.configMap.optional) reference("ConfigMap", namespace, volume.configMap.name, volume.configMap.items?.map(item => item.key));
    for (const source of volume.projected?.sources ?? []) {
      if (source.secret?.name && !source.secret.optional) reference("Secret", namespace, source.secret.name, source.secret.items?.map(item => item.key));
      if (source.configMap?.name && !source.configMap.optional) reference("ConfigMap", namespace, source.configMap.name, source.configMap.items?.map(item => item.key));
    }
  }
}
