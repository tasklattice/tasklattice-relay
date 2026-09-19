#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseAllDocuments, parse as parseYaml } from "yaml";
import { parse as parseToml } from "smol-toml";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

function releaseSecret(collection) { return Object.assign({}, ...collection.filter((o) => o.kind === "Secret").map((o) => o.stringData ?? {})); }
function workerConfig(collection) { return parseToml(releaseSecret(collection)["worker.toml"]).worker; }
function controlConfig(collection) { return parseToml(releaseSecret(collection)["control.toml"]); }
function hindsightConfig(collection) { return JSON.parse(releaseSecret(collection)["hindsight-config.json"]); }

const releaseName = "tali-relay";
const releaseNamespace = "tali-resource-validation";
const chartPath = "charts/tali-relay";
const runtimeControlName = `${releaseName}-project-runtime-control`;
const controlWorkerName = `${releaseName}-control-worker`;
function scopedClusterRoleName(name) {
  return `${name.slice(0, 48).replace(/-$/, "")}-${createHash("sha256")
    .update(`${releaseNamespace}/${name}`)
    .digest("hex")
    .slice(0, 12)}`;
}
const runtimeControlClusterRoleName = scopedClusterRoleName(
  runtimeControlName,
);
const controlWorkerClusterRoleName = scopedClusterRoleName(controlWorkerName);
const requiredResources = [
  ["requests", "cpu"],
  ["requests", "memory"],
  ["limits", "cpu"],
  ["limits", "memory"],
];

// The Control chart installs no Gateway; runtime resources belong to Projects.
const defaults = parseObjects(execFileSync("helm", ["template", releaseName, chartPath,
  "--namespace", releaseNamespace, "--kube-version", "1.29.0"], { encoding: "utf8" }));
if (defaults.some((o) => o.kind === "StatefulSet" && o.metadata?.labels?.["app.kubernetes.io/name"] === "openshell")) {
  throw new Error("Default Control Plane must not contain a shared OpenShell Gateway.");
}
// Exercise the smoke script's actual values: Kind has no LoadBalancer controller.
const smokeResources = parseObjects(execFileSync("bash", ["scripts/helm-kind-smoke.sh", "render"], {
  encoding: "utf8",
  env: {
    ...process.env,
    HELM_CHART_PATH: chartPath,
    HELM_DEPENDENCIES_PREPARED: "true",
    HELM_RELEASE_NAME: releaseName,
    HELM_NAMESPACE: releaseNamespace,
  },
}));
const smokeServices = smokeResources.filter((resource) => resource.kind === "Service");
const pendingLoadBalancers = smokeServices.filter((service) => service.spec?.type === "LoadBalancer");
if (pendingLoadBalancers.length) {
  throw new Error(`Kind smoke Services cannot require external load balancers: ${pendingLoadBalancers.map((service) => service.metadata.name).join(", ")}`);
}
const smokeProxy = smokeServices.find((service) => service.metadata?.name.endsWith("-runner-openshell-services"));
if (smokeProxy?.spec?.type !== "ClusterIP" || !smokeProxy.spec.ports?.length) {
  throw new Error("Kind smoke must keep the Runner OpenShell proxy enabled as a ClusterIP Service.");
}
function runnerConfig(collection) { return JSON.parse(releaseSecret(collection)["runner.json"]); }
assert.equal(runnerConfig(defaults).openshell.projectTargetRouting, true);
assert.equal(runnerConfig(defaults).openshell.gatewayEndpoint, undefined);
const runnerEnv = defaults.find((o) => o.kind === "Deployment" && o.metadata.labels["app.kubernetes.io/component"] === "runner").spec.template.spec.containers[0].env;
assert.deepEqual(runnerEnv, [{ name: "TALI_RUNNER_CONFIG", value: "/etc/tali-runner/runner.json" }]);
const defaultConfig = controlConfig(defaults);
assert.equal(workerConfig(defaults).project_openshell.enabled, true);
assert.equal(workerConfig(defaults).resource_ownership.enabled, true);
const argoTrackingId = "relay:apps/Deployment:tali/relay-control";
const argoConfigured = parseObjects(renderChart([
  "--set-string", `projectRuntimeNamespaces.argocd.sourceTrackingId=${argoTrackingId}`,
  "--set-string", "projectRuntimeNamespaces.argocd.installationId=internal",
]));
assert.equal(workerConfig(argoConfigured).resource_ownership.sourceTrackingId, argoTrackingId);
assert.equal(workerConfig(argoConfigured).resource_ownership.installationId, "internal");

function templateArguments(extraArguments = []) {
  return [
    "template",
    releaseName,
    chartPath,
    "--namespace",
    releaseNamespace,
    "--kube-version",
    "1.29.0",
    "--include-crds",
    ...extraArguments,
  ];
}

function renderChart(extraArguments = []) {
  return execFileSync("helm", templateArguments(extraArguments), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const externalComponents = ["control", "worker", "runner", "postgresql", "litellm", "hindsight", "metrics"];
const externalObjects = parseObjects(renderChart(externalComponents.flatMap((component) => [
  "--set-string", `secrets.existingSecrets.${component}=external-${component}`,
]).concat(["--set", "monitoring.serviceMonitor.enabled=true"])));
for (const component of externalComponents) {
  assert(!externalObjects.some((o) => o.kind === "Secret"
    && o.metadata?.name === `${releaseName}-${component}-config`), `${component} must honor its external Secret`);
  assert(JSON.stringify(externalObjects).includes(`external-${component}`), `${component} external Secret must be referenced`);
}
for (const object of defaults) {
  const spec = object.spec?.template?.spec;
  if (!spec) continue;
  const refs = [
    ...(spec.volumes ?? []).filter((v) => v.secret).map((v) => ({ name: v.secret.secretName, keys: (v.secret.items ?? []).map((i) => i.key) })),
    ...[...(spec.containers ?? []), ...(spec.initContainers ?? [])].flatMap((c) => (c.env ?? [])
      .filter((e) => e.valueFrom?.secretKeyRef).map((e) => ({ name: e.valueFrom.secretKeyRef.name, keys: [e.valueFrom.secretKeyRef.key] }))),
  ];
  for (const ref of refs) {
    const secret = defaults.find((o) => o.kind === "Secret" && o.metadata?.name === ref.name);
    assert(secret, `${object.metadata.name} references missing Secret ${ref.name}`);
    for (const key of ref.keys) assert(key in (secret.stringData ?? {}) || key in (secret.data ?? {}), `${ref.name} is missing ${key}`);
  }
}

function renderNamedChart(name, namespace, extraArguments = []) {
  return execFileSync(
    "helm",
    [
      "template",
      name,
      chartPath,
      "--namespace",
      namespace,
      "--kube-version",
      "1.29.0",
      "--include-crds",
      ...extraArguments,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function parseObjects(rendered) {
  return parseAllDocuments(rendered, { uniqueKeys: false })
    .map((document) => {
      if (document.errors.length > 0) {
        throw document.errors[0];
      }
      return document.toJS();
    })
    .filter((object) => object && typeof object === "object");
}

const rendered = renderChart([
  "--set-string",
  "control.publicUrls[0]=http://192.0.2.10",
  "--set-string",
  "control.publicUrls[1]=https://relay.example.com",
  "--set",
  "keycloak.enabled=true",
  "--set-string",
  "keycloak.publicUrl=http://192.0.2.11:8080",
  "--set",
  "exampleMcp.enabled=true",
]);

const objects = parseObjects(rendered);
const realm = JSON.parse(objects.find((object) => object.kind === "ConfigMap"
  && object.metadata?.name === `${releaseName}-keycloak-realm`).data["tali-realm.json"]);
const relayClient = realm.clients.find((client) => client.clientId === "tali-control-plane");
assert.deepEqual(relayClient.webOrigins, ["http://192.0.2.10", "https://relay.example.com"]);
assert.deepEqual(relayClient.redirectUris, relayClient.webOrigins.map((origin) => `${origin}/api/auth/callback/corporate-sso`));
assert.equal(relayClient.attributes["post.logout.redirect.uris"], relayClient.webOrigins.map((origin) => `${origin}/login`).join("##"));

function litellmContainerFrom(collection) {
  return collection
    .find(
      (object) =>
        object.kind === "Deployment"
        && object.metadata?.labels?.["app.kubernetes.io/component"] === "litellm",
    )
    ?.spec?.template?.spec?.containers?.find(
      (container) => container.name === "litellm",
    );
}

function litellmDeploymentFrom(collection) {
  return collection.find(
    (object) =>
      object.kind === "Deployment"
      && object.metadata?.labels?.["app.kubernetes.io/component"] === "litellm",
  );
}

function envValue(container, name) {
  return container?.env?.find((entry) => entry.name === name)?.value;
}

const defaultLiteLLMContainer = litellmContainerFrom(objects);
const defaultWorkerArgumentIndex = defaultLiteLLMContainer?.args?.indexOf("--num_workers") ?? -1;
if (
  defaultWorkerArgumentIndex < 0
  || defaultLiteLLMContainer.args[defaultWorkerArgumentIndex + 1] !== "1"
) {
  throw new Error("LiteLLM must default to one worker per Pod.");
}
if (envValue(defaultLiteLLMContainer, "LITELLM_LOCAL_MODEL_COST_MAP") !== "True") {
  throw new Error("LiteLLM must default to the model cost map bundled in its image.");
}
if (
  objects.some(
    (object) =>
      object.kind === "Secret"
      && object.metadata?.name === `${releaseName}-litellm-ca`,
  )
) {
  throw new Error("LiteLLM must not mount a custom CA when caCertificateBase64 is empty.");
}

const customCaCertificate = readFileSync("scripts/testing/fixtures/helm-test-ca.pem", "utf8");
const customCaObjects = parseObjects(
  renderChart([
    "--set-string",
    `litellm.caCertificateBase64=${Buffer.from(customCaCertificate).toString("base64")}`,
  ]),
);
const customCaSecret = customCaObjects.find(
  (object) =>
    object.kind === "Secret"
    && object.metadata?.name === `${releaseName}-litellm-ca`,
);
const customCaDeployment = litellmDeploymentFrom(customCaObjects);
const customCaContainer = litellmContainerFrom(customCaObjects);
const customCaVolume = customCaDeployment?.spec?.template?.spec?.volumes?.find(
  (volume) => volume.name === "litellm-ca",
);
const customCaMount = customCaContainer?.volumeMounts?.find(
  (mount) => mount.name === "litellm-ca-bundle",
);
if (
  Buffer.from(customCaSecret?.data?.["ca.crt"] ?? "", "base64").toString() !== customCaCertificate
  || customCaSecret?.metadata?.annotations?.["argocd.argoproj.io/sync-wave"] !== "10"
  || customCaVolume?.secret?.secretName !== `${releaseName}-litellm-ca`
  || customCaVolume?.secret?.items?.[0]?.key !== "ca.crt"
  || customCaVolume?.secret?.items?.[0]?.path !== "ca.crt"
  || customCaMount?.mountPath !== "/var/run/tali-ca"
  || customCaMount?.readOnly !== true
  || envValue(customCaContainer, "SSL_CERT_FILE") !== "/var/run/tali-ca/ca-bundle.pem"
  || envValue(customCaContainer, "REQUESTS_CA_BUNDLE") !== "/var/run/tali-ca/ca-bundle.pem"
  || !customCaDeployment?.spec?.template?.metadata?.annotations?.["checksum/litellm-ca"]
) {
  throw new Error("LiteLLM custom CA Secret, mount, or rollout checksum is invalid.");
}

for (const [flag, message] of [
  ["litellm.caCertificateBase64=not-base64", "valid Base64 containing PEM"],
  ["litellm.caCertificateBase64=aGVsbG8=", "valid Base64 containing PEM"],
  ["litellm.caCertificate=old-contract", "was removed"],
  ["secrets.existingSecret=old-contract", "was removed"],
  ["runner.extraEnv[0].name=OPENSHELL_GATEWAY_IMAGE", "was removed"],
  ["docling.replicaCount=2", "require ReadWriteMany"],
  ["control.worker.enabled=false", "Control Worker is required"],
  ["openshell.server.disableTls=false", "tenant TLS/auth are not configurable"],
]) {
  const invalid = spawnSync("helm", templateArguments(["--set", flag]), { encoding: "utf8" });
  assert.notEqual(invalid.status, 0, `${flag} must be rejected`);
  assert(invalid.stderr.includes(message), `${flag}: expected ${message}`);
}
const wrappedCa = parseObjects(renderChart(["--set-string",
  `litellm.caCertificateBase64=${Buffer.from(customCaCertificate).toString("base64").match(/.{1,64}/g).join("\n")}`]));
assert.equal(Buffer.from(wrappedCa.find((o) => o.metadata?.name === `${releaseName}-litellm-ca`).data["ca.crt"], "base64").toString(), customCaCertificate);
assert(!customCaContainer.volumeMounts.some((mount) => mount.mountPath === "/etc/ssl/certs"));
assert.equal(customCaDeployment.spec.template.spec.initContainers[0].name, "build-ca-bundle");
const externalModels = parseObjects(renderChart(["--set", "docling.persistence.existingClaim=shared-models"]));
assert(!externalModels.some((o) => o.kind === "PersistentVolumeClaim" && o.metadata.name === `${releaseName}-docling-models`));
assert.equal(externalModels.find((o) => o.kind === "Deployment" && o.metadata.name === `${releaseName}-docling`)
  .spec.template.spec.volumes.find((volume) => volume.name === "models").persistentVolumeClaim.claimName, "shared-models");

const connectedLiteLLMContainer = litellmContainerFrom(
  parseObjects(
    renderChart([
      "--set",
      "litellm.workers=3",
      "--set",
      "litellm.localModelCostMap=false",
    ]),
  ),
);
const connectedWorkerArgumentIndex = connectedLiteLLMContainer?.args?.indexOf("--num_workers") ?? -1;
if (
  connectedWorkerArgumentIndex < 0
  || connectedLiteLLMContainer.args[connectedWorkerArgumentIndex + 1] !== "3"
  || envValue(connectedLiteLLMContainer, "LITELLM_LOCAL_MODEL_COST_MAP") !== "False"
) {
  throw new Error("LiteLLM worker and remote cost-map overrides must remain configurable.");
}

const arbitraryReleaseName = "tali-release-023";
const arbitraryReleaseNamespace = "tali-arbitrary-release-validation";
const arbitraryReleaseObjects = parseObjects(
  renderNamedChart(arbitraryReleaseName, arbitraryReleaseNamespace),
);
const arbitraryRunner = arbitraryReleaseObjects.find(
  (object) => object.kind === "Deployment"
    && object.metadata?.labels?.["app.kubernetes.io/component"] === "runner",
)?.spec.template.spec.containers.find((container) => container.name === "runner");
assert.equal(runnerConfig(arbitraryReleaseObjects).openshell.gatewayEndpointTemplate,
  "http://openshell-{namespace}.{namespace}.svc.cluster.local:8080");

for (const kind of ["Deployment", "ServiceAccount"]) {
  if (
    objects.some(
      (object) =>
        object.kind === kind && object.metadata?.name === runtimeControlName,
    )
  ) {
    throw new Error(
      `${kind}/${runtimeControlName} must not be rendered; Project Namespace creation runs synchronously in Control.`,
    );
  }
}

const syncWaveAnnotation = "argocd.argoproj.io/sync-wave";

function requireObject(kind, name) {
  const object = objects.find(
    (candidate) =>
      candidate.kind === kind && candidate.metadata?.name === name,
  );
  if (!object) {
    throw new Error(`${kind}/${name} was not rendered.`);
  }
  return object;
}

function assertSyncWave(kind, name, expectedWave) {
  const actualWave = requireObject(kind, name).metadata?.annotations?.[
    syncWaveAnnotation
  ];
  if (actualWave !== expectedWave) {
    throw new Error(
      `${kind}/${name} must use Argo CD sync wave ${expectedWave}; got ${actualWave ?? "the default wave"}.`,
    );
  }
}

for (const [kind, name, wave] of [
  ["LimitRange", `${releaseName}-container-resources`, "-10"],
  ["ServiceAccount", `${releaseName}-control`, "10"],
  ["ServiceAccount", `${releaseName}-runtime`, "10"],
  ["ServiceAccount", controlWorkerName, "10"],
  ["ServiceAccount", `${releaseName}-hindsight`, "10"],
  ["ClusterRole", runtimeControlClusterRoleName, "10"],
  ["ClusterRoleBinding", runtimeControlClusterRoleName, "10"],
  ["ClusterRole", controlWorkerClusterRoleName, "10"],
  ["ClusterRoleBinding", controlWorkerClusterRoleName, "10"],
  ["Role", `${releaseName}-control-managed-secrets`, "10"],
  ["RoleBinding", `${releaseName}-control-managed-secrets`, "10"],
    ["Secret", `${releaseName}-control-config`, "10"],
  ["Secret", `${releaseName}-runner-config`, "10"],
  ["Secret", `${releaseName}-postgresql-config`, "10"],
  ["Secret", `${releaseName}-litellm-config`, "10"],
  ["Secret", `${releaseName}-hindsight-config`, "10"],
  ["Secret", `${releaseName}-metrics-config`, "10"],
  ["Secret", `${releaseName}-keycloak-config`, "10"],
  ["Secret", `${releaseName}-example-mcp-auth`, "10"],
  ["ConfigMap", `${releaseName}-keycloak-realm`, "10"],
  ["Service", `${releaseName}-postgresql`, "10"],
  ["Service", `${releaseName}-litellm`, "10"],
  ["Service", `${releaseName}-keycloak`, "10"],
  ["Service", `${releaseName}-control`, "10"],
  ["Service", `${releaseName}-runner`, "10"],
  ["Service", `${releaseName}-example-mcp`, "10"],
  ["Service", `${releaseName}-docling`, "10"],
  ["Service", `${releaseName}-hindsight-api`, "10"],
  ["PersistentVolumeClaim", `${releaseName}-docling-models`, "10"],
  ["StatefulSet", `${releaseName}-postgresql`, "20"],
  ["Deployment", `${releaseName}-litellm`, "30"],
  ["Deployment", `${releaseName}-keycloak`, "30"],
  ["Deployment", `${releaseName}-control`, "40"],
  ["Deployment", controlWorkerName, "40"],
  ["Deployment", `${releaseName}-runner`, "40"],
  ["Deployment", `${releaseName}-example-mcp`, "40"],
  ["Deployment", `${releaseName}-docling`, "30"],
  ["Deployment", `${releaseName}-hindsight-api`, "40"],
]) {
  assertSyncWave(kind, name, wave);
}

function requireComponentObject(collection, kind, component) {
  const object = collection.find(
    (candidate) =>
      candidate.kind === kind
      && candidate.metadata?.labels?.["app.kubernetes.io/component"] === component,
  );
  if (!object) {
    throw new Error(`${kind} with component=${component} was not rendered.`);
  }
  return object;
}

const hindsightImage = "ghcr.io/vectorize-io/hindsight-api:0.9.2-slim@sha256:7635a15739361dbdf221ba796ad25a813f876144fe113022eea8e26cb6ee75e7";
const hindsightApi = requireObject("Deployment", `${releaseName}-hindsight-api`);
const hindsightApiPodSpec = hindsightApi.spec?.template?.spec;
const hindsightApiContainer = hindsightApiPodSpec?.containers?.find(
  (container) => container.name === "api",
);
const hindsightRouterContainer = hindsightApiPodSpec?.containers?.find(
  (container) => container.name === "project-router",
);
const hindsightFile = hindsightConfig(objects);
const hindsightEnvValue = (name) => ({ ...hindsightFile.common, ...hindsightFile.api })[name];
if (hindsightApiContainer?.image !== hindsightImage) {
  throw new Error("The Hindsight API image must remain pinned to the reviewed 0.9.2 multi-arch digest.");
}
if (
  hindsightApiPodSpec?.serviceAccountName !== `${releaseName}-hindsight`
  || hindsightApiPodSpec?.automountServiceAccountToken !== false
) {
  throw new Error("Hindsight must use its tokenless dedicated ServiceAccount.");
}
if (
  hindsightApiContainer?.readinessProbe?.httpGet?.path !== "/health"
  || hindsightApiContainer?.livenessProbe?.httpGet?.path !== "/health/live"
) {
  throw new Error("Hindsight API must expose database-aware readiness and process liveness probes.");
}
if (hindsightApiContainer?.securityContext?.readOnlyRootFilesystem !== true) {
  throw new Error("Hindsight API must use a read-only root filesystem.");
}
for (const [name, value] of [
  ["LITELLM_LOCAL_MODEL_COST_MAP", "True"],
  ["HINDSIGHT_API_DATABASE_SCHEMA", "hindsight"],
  ["HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP", "false"],
  ["HINDSIGHT_API_MCP_ENABLED", "false"],
  ["HINDSIGHT_API_LLM_TRACE_ENABLED", "false"],
  ["HINDSIGHT_API_LLM_DEBUG_DUMP_4XX", "false"],
  ["HINDSIGHT_API_METRICS_INCLUDE_BANK_ID", "false"],
  ["HINDSIGHT_API_METRICS_BACKLOG_ENABLED", "true"],
  ["HINDSIGHT_API_LLM_PROVIDER", "openai"],
  ["HINDSIGHT_API_LLM_BASE_URL", "http://127.0.0.1:4010/v1"],
  ["HINDSIGHT_API_LLM_SEND_BANK_AS_USER", "true"],
  ["HINDSIGHT_API_EMBEDDINGS_PROVIDER", "openai"],
  ["HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL", "http://127.0.0.1:4010/v1"],
  ["HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL", "hindsight-embedding"],
  ["HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS", "1536"],
  ["HINDSIGHT_API_RERANKER_PROVIDER", "rrf"],
  ["HINDSIGHT_API_WORKER_ENABLED", "true"],
]) {
  if (hindsightEnvValue(name) !== value) {
    throw new Error(`Hindsight API must set ${name}=${value}.`);
  }
}
assert.equal(hindsightEnvValue("HINDSIGHT_API_DATABASE_URL"), hindsightEnvValue("HINDSIGHT_API_MIGRATION_DATABASE_URL"));
assert.equal(hindsightEnvValue("HINDSIGHT_API_TENANT_API_KEY"), controlConfig(objects).memory.apiKey);
for (const key of ["HINDSIGHT_API_LLM_API_KEY", "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY"]) {
  assert.equal(hindsightEnvValue(key), controlConfig(objects).memory.routerToken);
}
if (Object.values(hindsightFile.common).includes(releaseSecret(objects)["litellm-master-key"])) {
  throw new Error("Hindsight must never receive the LiteLLM master key.");
}
const controlImage = requireObject("Deployment", `${releaseName}-control`)
  .spec?.template?.spec?.containers?.find((container) => container.name === "control")?.image;
const routerEnv = hindsightRouterContainer?.env ?? [];
if (
  hindsightRouterContainer?.image !== controlImage
  || JSON.stringify(hindsightRouterContainer?.command)
    !== JSON.stringify(["node", "apps/control/.output/hindsight-router/hindsight-router.mjs"])
  || hindsightRouterContainer?.readinessProbe?.httpGet?.path !== "/health"
  || hindsightRouterContainer?.livenessProbe?.httpGet?.path !== "/health/live"
  || hindsightRouterContainer?.securityContext?.readOnlyRootFilesystem !== true
  || routerEnv.find((entry) => entry.name === "TALI_HINDSIGHT_LOCAL_HEALTH_URL")?.value
    !== "http://127.0.0.1:8888/health"
  || routerEnv.find((entry) => entry.name === "TALI_HINDSIGHT_CONFIG")?.value !== "/etc/hindsight/config.json"
  || hindsightFile.router.routerToken !== controlConfig(objects).memory.routerToken
  || hindsightFile.router.controlToken !== controlConfig(objects).memory.routerToken
) {
  throw new Error("Hindsight must use the hardened localhost Project Router sidecar.");
}
const hindsightService = requireObject("Service", `${releaseName}-hindsight-api`);
if (hindsightService.spec?.type !== "ClusterIP") {
  throw new Error("Hindsight API must remain an internal ClusterIP Service.");
}
const hindsightNetworkPolicy = requireComponentObject(objects, "NetworkPolicy", "hindsight-api");
const projectRouterEgress = hindsightNetworkPolicy.spec?.egress?.find((rule) =>
  rule.to?.some((peer) =>
    peer.podSelector?.matchLabels?.["app.kubernetes.io/component"] === "control"
  )
);
if (!projectRouterEgress?.ports?.some((port) => port.protocol === "TCP" && port.port === 8080)) {
  throw new Error("The Hindsight Project Router must reach Control's post-DNAT Pod port.");
}
requireObject("PodDisruptionBudget", `${releaseName}-hindsight-api`);

const hindsightLauncher = requireObject("ConfigMap", `${releaseName}-hindsight-launcher`);
assert.deepEqual(Object.keys(hindsightLauncher.metadata).sort(), ["annotations", "labels", "name"]);
for (const [key, file] of [["bootstrap.py", "hindsight-bootstrap.py"], ["entrypoint.py", "hindsight-entrypoint.py"]]) {
  assert.equal(hindsightLauncher.data[key].trim(), readFileSync(`${chartPath}/files/${file}`, "utf8").trim(),
    `Hindsight launcher ${key} must be stored under ConfigMap.data`);
}

const hindsightMigration = requireComponentObject(objects, "Job", "hindsight-migration");
if (hindsightMigration.metadata?.annotations?.[syncWaveAnnotation] !== "20") {
  throw new Error("The Hindsight migration Job must run in the database sync wave.");
}
if (hindsightMigration.metadata?.annotations?.["helm.sh/hook"] != null) {
  throw new Error("The Hindsight migration Job must use normal Job semantics instead of a Helm hook.");
}
if (hindsightMigration.spec?.ttlSecondsAfterFinished !== 3600) {
  throw new Error("The completed Hindsight migration Job must outlive Helm's wait window.");
}
const migrationPodSpec = hindsightMigration.spec?.template?.spec;
const migrationContainer = migrationPodSpec?.containers?.find(
  (container) => container.name === "migrate",
);
const bootstrapContainer = migrationPodSpec?.initContainers?.find(
  (container) => container.name === "bootstrap-hindsight-database",
);
if (
  migrationContainer?.image !== hindsightImage
  || JSON.stringify(migrationContainer?.command) !== JSON.stringify(["python", "/etc/hindsight-launcher/entrypoint.py", "migration"])
  || hindsightFile.migration.embeddingDimensions !== 1536
) {
  throw new Error("The Hindsight migration Job must run the pinned provider's dimension-aware migration command.");
}
assert.equal(bootstrapContainer.image, migrationContainer.image);
assert.deepEqual(bootstrapContainer.command, ["python", "/etc/hindsight-launcher/bootstrap.py"]);
for (const component of ["control", "control-worker", "docling", "litellm"]) {
  const pod = requireObject("Deployment", `${releaseName}-${component}`).spec.template.spec;
  const business = pod.containers.find((c) => c.name === component);
  for (const init of pod.initContainers ?? []) assert.equal(init.image, business.image, `${component}/${init.name} must reuse its business image`);
}
requireComponentObject(objects, "NetworkPolicy", "hindsight-migration");

const invalidHindsightIdentity = spawnSync(
  "helm",
  templateArguments([
    "--set-string",
    "hindsight.database.schema=unsafe-schema",
  ]),
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
if (
  invalidHindsightIdentity.status === 0
  || !invalidHindsightIdentity.stderr.includes(
    "hindsight.database.schema must be a lowercase PostgreSQL identifier",
  )
) {
  throw new Error("The Chart must reject unsafe Hindsight database identifiers.");
}

if (objects.some(
  (object) => object.kind === "StatefulSet"
    && object.metadata?.labels?.["app.kubernetes.io/component"] === "hindsight-worker",
)) {
  throw new Error("The separate Hindsight worker must remain disabled until load testing justifies it.");
}
const hindsightWorkerObjects = parseObjects(renderChart([
  "--set", "hindsight.worker.enabled=true",
]));
const hindsightWorker = requireComponentObject(
  hindsightWorkerObjects,
  "StatefulSet",
  "hindsight-worker",
);
const hindsightWorkerContainer = hindsightWorker.spec?.template?.spec?.containers?.find(
  (container) => container.name === "worker",
);
const hindsightWorkerRouter = hindsightWorker.spec?.template?.spec?.containers?.find(
  (container) => container.name === "project-router",
);
const workerId = hindsightWorkerContainer?.env?.find(
  (entry) => entry.name === "HINDSIGHT_API_WORKER_ID",
);
if (
  JSON.stringify(hindsightWorkerContainer?.command) !== JSON.stringify(["python", "/etc/hindsight-launcher/entrypoint.py", "worker"])
  || workerId?.valueFrom?.fieldRef?.fieldPath !== "metadata.name"
  || hindsightWorkerContainer?.readinessProbe?.httpGet?.path !== "/health"
  || hindsightWorkerContainer?.livenessProbe?.httpGet?.path !== "/health/live"
  || hindsightWorkerContainer?.securityContext?.readOnlyRootFilesystem !== true
  || hindsightWorkerRouter?.env?.find((entry) => entry.name === "TALI_HINDSIGHT_LOCAL_HEALTH_URL")?.value
    !== "http://127.0.0.1:8889/health"
) {
  throw new Error("The optional Hindsight worker must use stable identity, health probes, its Project Router, and a read-only root filesystem.");
}
const externalWorkerApi = requireComponentObject(
  hindsightWorkerObjects,
  "Deployment",
  "hindsight-api",
);
if (
  hindsightConfig(hindsightWorkerObjects).api.HINDSIGHT_API_WORKER_ENABLED !== "false"
) {
  throw new Error("Enabling the external Hindsight worker must disable the API's embedded worker.");
}

for (const [kind, name] of [
  ["Deployment", "agent-sandbox-controller"],
]) {
  const dependencyWave = requireObject(kind, name).metadata?.annotations?.[
    syncWaveAnnotation
  ];
  if (dependencyWave != null) {
    throw new Error(
      `${kind}/${name} is dependency-owned and must stay at Argo CD's default sync wave 0.`,
    );
  }
}

for (const object of objects) {
  if (object.metadata?.annotations?.["argocd.argoproj.io/hook"] != null) {
    throw new Error(
      `${object.kind}/${object.metadata?.name} must not replace upstream Helm hook annotations with Argo CD hooks.`,
    );
  }
}

for (const [deploymentName, expectedInitContainers] of [
  [
    `${releaseName}-control`,
    [
      [
        "migrate-control-database",
        [
          "/app/node_modules/.bin/prisma",
          "migrate",
          "deploy",
          "--config",
          "prisma.config.ts",
        ],
      ],
      ["seed-built-in-skills", ["node", "prisma/seed-built-in-skills.mjs"]],
    ],
  ],
  [
    controlWorkerName,
    [
      [
        "migrate-control-database",
        [
          "/app/node_modules/.bin/prisma",
          "migrate",
          "deploy",
          "--config",
          "prisma.config.ts",
        ],
      ],
    ],
  ],
]) {
  const deployment = objects.find(
    (object) =>
      object.kind === "Deployment" && object.metadata?.name === deploymentName,
  );
  if (!deployment) {
    throw new Error(`Deployment/${deploymentName} was not rendered.`);
  }

  for (const [initContainerName, expectedCommand] of expectedInitContainers) {
    const initContainer = deployment.spec?.template?.spec?.initContainers?.find(
      (container) => container.name === initContainerName,
    );
    if (!initContainer) {
      throw new Error(
        `Deployment/${deploymentName} is missing initContainer/${initContainerName}.`,
      );
    }
    if (initContainer.workingDir !== "/app/apps/control") {
      throw new Error(
        `Deployment/${deploymentName} initContainer/${initContainerName} must run from /app/apps/control.`,
      );
    }
    if (
      JSON.stringify(initContainer.command) !== JSON.stringify(expectedCommand)
    ) {
      throw new Error(
        `Deployment/${deploymentName} initContainer/${initContainerName} must run without npm.`,
      );
    }
    for (const [name, value] of [
      ["HOME", "/tmp"],
      ["XDG_CACHE_HOME", "/tmp/.cache"],
    ]) {
      const actualValue = initContainer.env?.find(
        (environmentVariable) => environmentVariable.name === name,
      )?.value;
      if (actualValue !== value) {
        throw new Error(
          `Deployment/${deploymentName} initContainer/${initContainerName} must set ${name}=${value}.`,
        );
      }
    }
  }
}

const localObjects = parseObjects(
  renderChart(["--set", "control.service.type=LoadBalancer"]),
);
const localSecret = localObjects.find(
  (object) =>
    object.kind === "Secret" &&
    object.metadata?.name === `${releaseName}-control-config`,
);
const localControlToml = localSecret?.stringData?.["control.toml"] ?? "";
const localConfig = controlConfig(localObjects);
assert.deepEqual(localConfig.server.public_urls, ["http://localhost:38080"]);
assert.equal(localConfig.server.trust_proxy_headers, false);
assert.equal(localConfig.server.internal_url, `http://${releaseName}-control.${releaseNamespace}.svc.cluster.local:38080`);
assert.equal(localConfig.runner.url, `http://${releaseName}-runner:9090`);
assert.equal(localConfig.litellm.url, `http://${releaseName}-litellm.${releaseNamespace}.svc.cluster.local:4000`);
assert.equal(localConfig.runtime_namespaces.enabled, true);
assert.equal(localConfig.runtime_namespaces.cluster_id, "in-cluster");
const localControl = localObjects.find(
  (object) =>
    object.kind === "Deployment"
    && object.metadata?.name === `${releaseName}-control`,
);
const localControlEnv = localControl?.spec?.template?.spec?.containers
  ?.find((container) => container.name === "control")?.env ?? [];
assert.equal(localConfig.memory.baseUrl, `http://${releaseName}-hindsight-api.${releaseNamespace}.svc.cluster.local:8888`);
assert.equal(localConfig.memory.apiKey, hindsightConfig(localObjects).common.HINDSIGHT_API_TENANT_API_KEY);
assert.equal(localConfig.memory.routerToken, hindsightConfig(localObjects).router.routerToken);
assert.equal(localConfig.memory.embeddingDimensions, 1536);
assert.equal(localConfig.memory.enabled, true);
assert.equal(localConfig.runner.token, runnerConfig(localObjects).server.token);
assert.equal(localConfig.litellm.master_key, releaseSecret(localObjects)["litellm-master-key"]);
assert.equal(localConfig.metrics.token, releaseSecret(localObjects)["metrics-token"]);
assert.deepEqual(Object.keys(localSecret.stringData), ["control.toml"]);
assert(!localObjects.some((o) => o.kind === "Secret" && o.metadata.name === `${releaseName}-secrets`));
assert(!localControlEnv.some((entry) => /^(TALI_BOOTSTRAP|PROJECT_|EXPERT_|TALI_HINDSIGHT|TALI_DURABLE)/.test(entry.name)));

const gradualMemoryObjects = parseObjects(renderChart([
  "--set", "features.durableMemory.enabled=false",
  "--set-string", "features.durableMemory.projectAllowlist[0]=project-canary",
]));
assert.equal(controlConfig(gradualMemoryObjects).memory.enabled, false);
assert.deepEqual(controlConfig(gradualMemoryObjects).memory.projectAllowlist, ["project-canary"]);
const withoutHindsight = parseObjects(renderChart(["--set", "hindsight.enabled=false"]));
assert.equal(controlConfig(withoutHindsight).memory.enabled, false);

const monitoredObjects = parseObjects(renderChart([
  "--set", "monitoring.serviceMonitor.enabled=true",
  "--set", "monitoring.prometheusRule.enabled=true",
]));
const relayMemoryMonitor = requireComponentObject(
  monitoredObjects,
  "ServiceMonitor",
  "memory",
);
const relayMetricsEndpoint = relayMemoryMonitor.spec?.endpoints?.[0];
if (
  relayMetricsEndpoint?.path !== "/api/metrics"
  || relayMetricsEndpoint?.authorization?.credentials?.key !== "metrics-token"
) {
  throw new Error("Relay Memory metrics must be scraped with the Secret-backed bearer token.");
}
const hindsightMonitor = requireComponentObject(
  monitoredObjects,
  "ServiceMonitor",
  "hindsight",
);
if (hindsightMonitor.spec?.endpoints?.[0]?.path !== "/metrics") {
  throw new Error("Hindsight's private Prometheus endpoint must be included in monitoring.");
}
const monitoredHindsightPolicy = requireComponentObject(
  monitoredObjects,
  "NetworkPolicy",
  "hindsight-api",
);
const monitoringPeer = monitoredHindsightPolicy.spec?.ingress
  ?.flatMap((rule) => rule.from ?? [])
  .find((peer) =>
    peer.namespaceSelector?.matchLabels?.["kubernetes.io/metadata.name"] === "monitoring"
    && peer.podSelector?.matchLabels?.["app.kubernetes.io/name"] === "prometheus"
  );
if (!monitoringPeer) {
  throw new Error("Hindsight metrics ingress must be limited to the configured Prometheus identity.");
}
const workerMemoryMonitor = requireComponentObject(
  monitoredObjects,
  "ServiceMonitor",
  "control-worker",
);
if (
  workerMemoryMonitor.spec?.endpoints?.[0]?.path !== "/metrics"
  || workerMemoryMonitor.spec?.endpoints?.[0]?.authorization?.credentials?.key
    !== "metrics-token"
) {
  throw new Error("Control Worker retain metrics must use the Secret-backed bearer token.");
}
const memoryRules = requireComponentObject(
  monitoredObjects,
  "PrometheusRule",
  "memory",
);
const alertNames = new Set(
  memoryRules.spec?.groups?.flatMap((group) => group.rules ?? [])
    .map((rule) => rule.alert)
    .filter(Boolean),
);
for (const alert of [
  "TaliMemoryOutboxBacklog",
  "TaliMemoryProviderUnavailable",
  "TaliMemoryRecallFailureRate",
  "TaliMemoryRetainFailureRate",
  "TaliMemoryDeletionFailure",
  "HindsightAsyncOperationFailure",
]) {
  if (!alertNames.has(alert)) {
    throw new Error(`Memory PrometheusRule is missing ${alert}.`);
  }
}

const controlWorker = requireObject(
  "Deployment",
  controlWorkerName,
);
if (
  controlWorker.spec?.template?.spec?.serviceAccountName !==
    controlWorkerName ||
  controlWorker.spec?.template?.spec?.automountServiceAccountToken !== true
) {
  throw new Error(
    "The Control Worker must use its dedicated identity for asynchronous control-plane tasks.",
  );
}

const controlWorkerEnv = controlWorker.spec?.template?.spec?.containers
  ?.find((container) => container.name === "control-worker")?.env ?? [];
assert.equal(controlWorkerEnv.find((entry) => entry.name === "TALI_CONFIG")?.value, "/etc/tali/control.toml");
assert.equal(workerConfig(localObjects).docling.baseUrl, `http://${releaseName}-docling:5001`);
for (const component of ["control", "control-worker"]) {
  const deployment = requireObject("Deployment", `${releaseName}-${component}`);
  assert.equal(deployment.spec.template.spec.volumes.find((volume) => volume.name === "control-config").secret.items[0].key, "control.toml");
  assert.equal(deployment.spec.template.metadata.annotations["checksum/control-config"], requireObject("Deployment", `${releaseName}-control`).spec.template.metadata.annotations["checksum/control-config"]);
}
const docling = requireObject("Deployment", `${releaseName}-docling`);
const doclingSettings = parseYaml(requireObject("ConfigMap", `${releaseName}-docling-config`).data["config.yaml"]);
assert.equal(doclingSettings.max_file_size, 26214400);
assert.equal(doclingSettings.artifacts_path, "/var/lib/docling/models/artifacts");
assert.equal(docling.spec.strategy.type, "Recreate");
assert.equal(docling.spec.template.spec.securityContext.fsGroup, 1001);
assert.equal(docling.spec.template.spec.automountServiceAccountToken, false);

const gatewayInstallerRules = [
  { apiGroups: [""], resources: ["configmaps", "persistentvolumeclaims", "secrets", "serviceaccounts", "services"], verbs: ["get", "list", "watch", "create", "update", "patch", "delete"] },
  { apiGroups: [""], resources: ["events", "pods"], verbs: ["get", "list", "watch"] },
  { apiGroups: [""], resources: ["nodes"], verbs: ["get", "list", "watch"] },
  { apiGroups: ["authentication.k8s.io"], resources: ["tokenreviews"], verbs: ["create"] },
  { apiGroups: ["agents.x-k8s.io"], resources: ["sandboxes", "sandboxes/status"], verbs: ["get", "list", "watch", "create", "update", "patch", "delete"] },
  { apiGroups: ["apps"], resources: ["deployments", "replicasets", "statefulsets"], verbs: ["get", "list", "watch", "create", "update", "patch", "delete"] },
  { apiGroups: ["networking.k8s.io"], resources: ["networkpolicies"], verbs: ["get", "list", "watch", "create", "update", "patch", "delete"] },
  { apiGroups: ["batch"], resources: ["jobs"], verbs: ["get", "list", "watch", "create", "update", "patch", "delete"] },
  { apiGroups: ["rbac.authorization.k8s.io"], resources: ["roles", "rolebindings", "clusterroles", "clusterrolebindings"], verbs: ["get", "list", "watch", "create", "update", "patch", "delete"] },
];

const runtimeControlRole = requireObject(
  "ClusterRole",
  runtimeControlClusterRoleName,
);
assert(runtimeControlRole.rules.every((rule) => rule.verbs.every((verb) => ["get", "list", "watch"].includes(verb))), "Control must have read-only Kubernetes access");
assert(!runtimeControlRole.rules.some((rule) => rule.resources.includes("secrets")), "Control must not read Worker Secrets");
assert(!controlConfig(defaults).worker, "Control must not contain Worker configuration");
const apiPod = requireComponentObject(defaults, "Deployment", "control").spec.template.spec;
assert(!apiPod.volumes.some((v) => v.name === "worker-config"), "Worker config must not be mounted in Control");

const runtimeControlBinding = requireObject(
  "ClusterRoleBinding",
  runtimeControlClusterRoleName,
);
if (
  !runtimeControlBinding.subjects?.some(
    (subject) =>
      subject.kind === "ServiceAccount" &&
      subject.name === `${releaseName}-control` &&
      subject.namespace === releaseNamespace,
  )
) {
  throw new Error(
    "Synchronous Project Namespace provisioning must be bound to the Control ServiceAccount.",
  );
}

for (const [setting, message] of [
  ["openshell.enabled=true", "OpenShell is installed only in Project Namespaces"],
  ["projectOpenShell.enabled=false", "Project Gateways are required"],
  ["runner.projectTargetRouting.enabled=false", "Project routing is required"],
  ["projectRuntimeNamespaces.enabled=false", "Project Namespaces are required"],
]) {
  const result = spawnSync("helm", templateArguments(["--set", setting]), { encoding: "utf8" });
  if (result.status === 0 || !result.stderr.includes(message)) {
    throw new Error(`Unsupported topology must fail explicitly: ${setting}`);
  }
}

const controlWorkerRole = requireObject(
  "ClusterRole",
  controlWorkerClusterRoleName,
);
if (
  JSON.stringify(controlWorkerRole.rules) !== JSON.stringify([
    {
      apiGroups: [""],
      resources: ["namespaces"],
      verbs: ["get", "create", "patch", "delete"],
    },
    {
      apiGroups: [""],
      resources: ["configmaps", "secrets", "services"],
      verbs: ["get", "create", "patch", "delete"],
    },
    {
      apiGroups: ["apps"],
      resources: ["deployments"],
      verbs: ["get", "create", "patch", "delete"],
    },
    {
      apiGroups: ["networking.k8s.io"],
      resources: ["networkpolicies"],
      verbs: ["get", "create", "patch", "delete"],
    },
    ...gatewayInstallerRules,
  ])
) {
  throw new Error(
    "Control Worker must use the reviewed Project cleanup, runtime and Gateway installer permissions.",
  );
}

const localControlService = localObjects.find(
  (object) =>
    object.kind === "Service" &&
    object.metadata?.name === `${releaseName}-control`,
);
if (localControlService?.spec?.type !== "LoadBalancer") {
  throw new Error(
    "The Control Service must render as LoadBalancer with the allowed control.publicUrls.",
  );
}

const localWithPublicUrlObjects = parseObjects(
  renderChart([
    "--set",
    "control.service.type=LoadBalancer",
    "--set-string",
    "control.publicUrls[0]=http://198.51.100.20",
  ]),
);

function podAnnotations(collection, kind, name) {
  return (
    collection.find(
      (object) =>
        object.kind === kind && object.metadata?.name === name,
    )?.spec?.template?.metadata?.annotations ?? {}
  );
}

const checksumComparisons = [
  ["Deployment", `${releaseName}-runner`, "checksum/runner-secret", false],
  ["Deployment", `${releaseName}-litellm`, "checksum/litellm-secret", false],
  [
    "StatefulSet",
    `${releaseName}-postgresql`,
    "checksum/postgresql-secret",
    false,
  ],
  [
    "Deployment",
    `${releaseName}-control`,
    "checksum/control-config",
    true,
  ],
];
for (const [kind, name, annotation, shouldChange] of checksumComparisons) {
  const before = podAnnotations(localObjects, kind, name)[annotation];
  const after = podAnnotations(localWithPublicUrlObjects, kind, name)[annotation];
  if (!before || !after) {
    throw new Error(`${kind}/${name} is missing ${annotation}.`);
  }
  if ((before !== after) !== shouldChange) {
    throw new Error(
      `${kind}/${name} ${annotation} ${
        shouldChange ? "must" : "must not"
      } change when only control.publicUrls changes.`,
    );
  }
}

const missingOidcPublicUrlResult = spawnSync(
  "helm",
  templateArguments([
    "--set-string",
    "control.publicUrls=",
  ]),
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
if (
  missingOidcPublicUrlResult.status === 0 ||
  !missingOidcPublicUrlResult.stderr.includes(
    "control.publicUrls must contain at least one allowed origin",
  )
) {
  throw new Error(
    "The Chart must require control.publicUrls for authentication origin validation.",
  );
}

const namespaceDefaults = new Map();
for (const object of objects) {
  if (object.kind !== "LimitRange") {
    continue;
  }

  const namespace = object.metadata?.namespace ?? releaseNamespace;
  const containerLimit = object.spec?.limits?.find(
    (limit) => limit.type === "Container",
  );
  if (!containerLimit) {
    continue;
  }

  namespaceDefaults.set(namespace, {
    requests: containerLimit.defaultRequest ?? {},
    limits: containerLimit.default ?? {},
  });
}

const releaseDefaults = namespaceDefaults.get(releaseNamespace);
const missingReleaseDefaults = requiredResources.filter(
  ([resourceType, resourceName]) =>
    releaseDefaults?.[resourceType]?.[resourceName] == null,
);
if (missingReleaseDefaults.length > 0) {
  throw new Error(
    "The release namespace must define Container LimitRange defaults for " +
      missingReleaseDefaults
        .map(([resourceType, resourceName]) => `${resourceType}.${resourceName}`)
        .join(", ") +
      " so dynamically injected sandbox containers are admitted with resources.",
  );
}

function podTemplateFor(object) {
  switch (object.kind) {
    case "Pod":
      return object;
    case "Deployment":
    case "StatefulSet":
    case "DaemonSet":
    case "Job":
    case "ReplicaSet":
      return object.spec?.template;
    case "CronJob":
      return object.spec?.jobTemplate?.spec?.template;
    default:
      return undefined;
  }
}

const violations = [];
let checkedContainers = 0;
let defaultedContainers = 0;
const defaultedContainerNames = [];

for (const object of objects) {
  const template = podTemplateFor(object);
  if (!template) {
    continue;
  }

  const namespace = object.metadata?.namespace ?? releaseNamespace;
  const defaults = namespaceDefaults.get(namespace);
  const hookNames = (
    object.metadata?.annotations?.["helm.sh/hook"] ?? ""
  ).split(",");
  const isPreInstallHook = hookNames.includes("pre-install");
  const podSpec = object.kind === "Pod" ? object.spec : template.spec;
  const containerGroups = [
    ["initContainers", podSpec?.initContainers ?? []],
    ["containers", podSpec?.containers ?? []],
  ];

  for (const [groupName, containers] of containerGroups) {
    for (const container of containers) {
      checkedContainers += 1;
      let usedDefaults = false;

      for (const [resourceType, resourceName] of requiredResources) {
        if (container.resources?.[resourceType]?.[resourceName] != null) {
          continue;
        }
        if (
          !isPreInstallHook &&
          defaults?.[resourceType]?.[resourceName] != null
        ) {
          usedDefaults = true;
          continue;
        }

        violations.push(
          `${object.kind}/${object.metadata?.name} ${groupName}/${container.name} ` +
            `in namespace ${namespace} is missing resources.${resourceType}.${resourceName}`,
        );
      }

      if (usedDefaults) {
        defaultedContainers += 1;
        defaultedContainerNames.push(
          `${object.kind}/${object.metadata?.name} ${groupName}/${container.name}`,
        );
      }
    }
  }
}

if (checkedContainers === 0) {
  throw new Error("The rendered chart did not contain any Pod containers.");
}

if (violations.length > 0) {
  console.error("Helm resource validation failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(
  `Validated ${checkedContainers} rendered containers; ` +
    `${defaultedContainers} rely on namespace LimitRange admission defaults.`,
);
for (const containerName of defaultedContainerNames) {
  console.log(`- ${containerName}`);
}
