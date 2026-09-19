// Isolated local acceptance. Reuses the installed Agent Sandbox controller.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { CoreV1Api, KubeConfig, KubernetesObjectApi } from "@kubernetes/client-node";
import { HelmProjectOpenShellGatewayClient, type CommandInput } from "../../apps/control/server/kubernetes/project-openshell-gateway-client.ts";
import { projectNamespaceResource } from "../../apps/control/server/kubernetes/project-namespace-client.ts";
import { namespaceOwner, reconcileSandboxResources, reconcileGatewayResources, withNamespaceOwner } from "../../apps/control/server/kubernetes/project-resource-ownership.ts";
import { PostgresProjectOpenShellDatabase } from "../../apps/control/server/kubernetes/project-openshell-database.ts";
import { developmentWorkerConfig, setWorkerConfigForTests } from "../../apps/control/server/config/worker-config.ts";

const exec = promisify(execFile);
const context = process.env.KUBE_CONTEXT ?? "orbstack";
const databaseUrl = process.env.E2E_OPENSHELL_DATABASE_URL;
if (!databaseUrl) throw new Error("Set E2E_OPENSHELL_DATABASE_URL to a test PostgreSQL server reachable from both this process and Project Pods.");
const namespace = `tp-${[...randomBytes(13)].map(b => "abcdefghijklmnopqrstuvwxyz234567"[b % 32]).join("")}`;
const projectId = randomUUID();
const target = { namespace, projectId, projectName: "Resource ownership acceptance" };
const configuration = new KubeConfig();
configuration.loadFromDefault();
configuration.setCurrentContext(context);
const core = configuration.makeApiClient(CoreV1Api);
const objects = KubernetesObjectApi.makeApiClient(configuration);
const k = async (...args: string[]) => (await exec("kubectl", ["--context", context, "-n", namespace, ...args], { timeout: 180_000 })).stdout;
const gateway = `openshell-${namespace}`;
const cli = (...args: string[]) => k("exec", "ownership-client", "--", "openshell",
  "--gateway-endpoint", `http://${gateway}:8080`, "--workspace", namespace, ...args);
const worker = developmentWorkerConfig();
worker.project_openshell.ownerRenderer = resolve("scripts/project-openshell-owner.mjs");
// An illustrative source: no Argo installation or Application is modified.
worker.resource_ownership.sourceTrackingId = "tali:/Namespace:/tali";
setWorkerConfigForTests(worker);
await core.createNamespace({ body: projectNamespaceResource(target) });
const owner = namespaceOwner(await core.readNamespace({ name: namespace }), projectId);
const run = async (input: CommandInput) => {
  const { spawn } = await import("node:child_process");
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolveRun, reject) => {
    const child = spawn(input.command, ["--kube-context", context, ...input.args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), input.timeoutMs);
    child.stdout.on("data", b => { stdout += b; });
    child.stderr.on("data", b => { stderr += b; });
    child.on("error", reject);
    child.on("close", code => { clearTimeout(timer); resolveRun({ exitCode: code ?? 1, stdout, stderr }); });
    child.stdin.end(input.stdin);
  });
};
const client = new HelmProjectOpenShellGatewayClient({
  enabled: true, chart: resolve(".helm-dependencies/openshell"), releaseName: "openshell",
  gatewayResources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1", memory: "1Gi" } },
  gatewayImageRepository: "ghcr.io/nvidia/openshell/gateway", gatewayImageTag: "0.0.106",
  supervisorImageRepository: "ghcr.io/nvidia/openshell/supervisor", supervisorImageTag: "0.0.106",
  supervisorImagePullPolicy: "IfNotPresent",
  imagePullSecrets: [], imagePullPolicy: "IfNotPresent", sandboxImagePullSecrets: [],
  sandboxImage: "ghcr.io/nvidia/nemoclaw/sandbox-base:v0.0.123", sandboxImagePullPolicy: "IfNotPresent",
  serviceNamePrefix: "openshell-", workspaceDefaultStorageSize: "1Gi",
}, run, async () => owner, (owner, name) => reconcileGatewayResources(objects, owner, name),
new PostgresProjectOpenShellDatabase(() => databaseUrl, () => core));
try {
  console.log(`[ownership] Installing isolated Project Gateway in ${namespace}`);
  await client.reconcile(target);
  // Reconciliation must preserve the Deployment and database credentials.
  await client.reconcile(target);
  for (const [apiVersion, kind, name] of [
    ["apps/v1", "Deployment", gateway], ["v1", "Service", gateway],
    ["v1", "Secret", "openshell-postgresql"],
    ["v1", "ServiceAccount", `${gateway}-certgen`],
    ["rbac.authorization.k8s.io/v1", "Role", `${gateway}-certgen`],
    ["rbac.authorization.k8s.io/v1", "RoleBinding", `${gateway}-certgen`],
    ["v1", "Secret", `${gateway}-jwt-keys`],
  ]) {
    const resource = await objects.read({ apiVersion, kind, metadata: { namespace, name } });
    assert(resource.metadata?.ownerReferences?.some(ref => ref.uid === owner.uid), `${kind} is missing its Namespace owner: ${JSON.stringify(resource.metadata?.ownerReferences)}`);
  }
  const pods = await core.listNamespacedPod({ namespace, labelSelector: "app.kubernetes.io/name=openshell,app.kubernetes.io/instance=openshell" });
  const gatewayPod = pods.items.find(p => p.status?.phase === "Running" && !p.metadata?.deletionTimestamp);
  assert.equal(gatewayPod?.metadata?.ownerReferences?.[0]?.kind, "ReplicaSet");
  assert.equal((await core.listNamespacedPersistentVolumeClaim({ namespace })).items.length, 0);
  await core.createNamespacedPod({ namespace, body: withNamespaceOwner({ apiVersion: "v1", kind: "Pod",
    metadata: { namespace, name: "ownership-client" }, spec: { containers: [{ name: "cli",
      image: "ghcr.io/tasklattice/tali-openshell-runner:dev", imagePullPolicy: "IfNotPresent", command: ["sleep", "1200"] }] } }, owner) });
  await k("wait", "pod/ownership-client", "--for=condition=Ready", "--timeout=120s");
  for (let attempt = 0; ; attempt++) {
    try { await k("exec", "ownership-client", "--", "openshell", "--gateway-endpoint",
      `http://${gateway}:8080`, "--workspace", "default", "workspace", "list", "-o", "json"); break; }
    catch (error) {
      if (attempt >= 14) throw error;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 2000));
    }
  }
  await k("exec", "ownership-client", "--", "openshell", "--gateway-endpoint",
    `http://${gateway}:8080`, "--workspace", "default", "workspace", "create", "--name", namespace);
  await cli("sandbox", "create", "--name", "ownership-check", "--from", "ghcr.io/nvidia/nemoclaw/sandbox-base:v0.0.123",
    "--label", `tali.io/instance-id=${projectId}`, "--cpu", "500m", "--memory", "1Gi",
    "--no-tty", "--no-auto-providers", "--", "sh", "-c", "echo ownership-ready > /sandbox/marker");
  const sandboxName = `${namespace}--ownership-check`;
  await k("wait", `sandbox/${sandboxName}`, "--for=condition=Ready", "--timeout=120s");
  await reconcileSandboxResources(objects, owner, "ownership-check");
  await reconcileSandboxResources(objects, owner, "ownership-check");
  const sandbox = await objects.read({ apiVersion: "agents.x-k8s.io/v1beta1", kind: "Sandbox",
    metadata: { namespace, name: sandboxName } });
  assert(sandbox.metadata?.ownerReferences?.some(ref => ref.uid === owner.uid));
  const workspacePvc = await core.readNamespacedPersistentVolumeClaim({ namespace, name: `workspace-${sandboxName}` });
  assert(workspacePvc.metadata?.ownerReferences?.some(ref => ref.kind === "Sandbox"
    && ref.uid === sandbox.metadata?.uid && ref.controller === true), "preserve the workspace's native Sandbox owner");
  const sandboxPod = await core.readNamespacedPod({ namespace, name: sandboxName });
  assert.equal(sandboxPod.metadata?.ownerReferences?.[0]?.kind, "Sandbox");
  const pvcUid = (await core.readNamespacedPersistentVolumeClaim({ namespace, name: `workspace-${sandboxName}` })).metadata?.uid;
  await cli("sandbox", "stop", "ownership-check");
  await k("wait", `pod/${sandboxName}`, "--for=delete", "--timeout=120s");
  assert.equal((await core.readNamespacedPersistentVolumeClaim({ namespace, name: `workspace-${sandboxName}` })).metadata?.uid, pvcUid);
  await cli("sandbox", "delete", "ownership-check");
  await k("wait", `sandbox/${sandboxName}`, `pvc/workspace-${sandboxName}`, "--for=delete", "--timeout=120s");
  assert.equal((await core.readNamespace({ name: namespace })).metadata?.uid, owner.uid);
  console.log(JSON.stringify({ result: "PASS", context, namespace,
    checks: ["Gateway, database Secret and certgen resources -> Namespace", "Gateway Pod -> ReplicaSet", "no Gateway PVC", "Sandbox -> Namespace",
      "Agent Pod and workspace PVC -> Sandbox", "idempotent reconciliation", "workspace retained on stop", "business deletion unchanged"] }, null, 2));
} finally {
  await client.delete(namespace).catch(error => console.error(error.message));
  await core.deleteNamespace({ name: namespace });
}
