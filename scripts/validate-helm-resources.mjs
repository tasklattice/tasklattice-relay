#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseAllDocuments } from "yaml";

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
  "control.publicUrl=http://192.0.2.10",
  "--set",
  "keycloak.enabled=true",
  "--set-string",
  "keycloak.publicUrl=http://192.0.2.11:8080",
  "--set",
  "exampleMcp.enabled=true",
]);

const objects = parseObjects(rendered);

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
  throw new Error("LiteLLM must not mount a custom CA when caCertificate is empty.");
}

const customCaCertificate = "TEST PRIVATE CA CERTIFICATE";
const customCaObjects = parseObjects(
  renderChart([
    "--set-string",
    `litellm.caCertificate=${customCaCertificate}`,
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
  (mount) => mount.name === "litellm-ca",
);
if (
  customCaSecret?.stringData?.["ca.crt"] !== customCaCertificate
  || customCaSecret?.metadata?.annotations?.["argocd.argoproj.io/sync-wave"] !== "10"
  || customCaVolume?.secret?.secretName !== `${releaseName}-litellm-ca`
  || customCaVolume?.secret?.items?.[0]?.key !== "ca.crt"
  || customCaVolume?.secret?.items?.[0]?.path !== "ca.crt"
  || customCaMount?.mountPath !== "/etc/ssl/certs"
  || customCaMount?.readOnly !== true
  || envValue(customCaContainer, "SSL_CERT_FILE")
  || envValue(customCaContainer, "REQUESTS_CA_BUNDLE")
  || !customCaDeployment?.spec?.template?.metadata?.annotations?.["checksum/litellm-ca"]
) {
  throw new Error("LiteLLM custom CA Secret, mount, or rollout checksum is invalid.");
}

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
const arbitraryOpenShellService = arbitraryReleaseObjects.find(
  (object) =>
    object.kind === "Service"
    && object.metadata?.labels?.["app.kubernetes.io/name"] === "openshell",
);
const arbitraryRunner = arbitraryReleaseObjects.find(
  (object) =>
    object.kind === "Deployment"
    && object.metadata?.labels?.["app.kubernetes.io/component"] === "runner",
);
const arbitraryGatewayEndpoint = arbitraryRunner?.spec?.template?.spec?.containers
  ?.find((container) => container.name === "runner")
  ?.env?.find((entry) => entry.name === "OPENSHELL_GATEWAY_ENDPOINT")?.value;
const expectedArbitraryGatewayEndpoint = arbitraryOpenShellService
  ? `http://${arbitraryOpenShellService.metadata.name}.${arbitraryReleaseNamespace}.svc.cluster.local:8080`
  : undefined;
if (
  !expectedArbitraryGatewayEndpoint
  || arbitraryGatewayEndpoint !== expectedArbitraryGatewayEndpoint
) {
  throw new Error(
    "The Runner OpenShell endpoint must resolve to the dependency-owned Service for arbitrary Helm release names.",
  );
}

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
  ["Secret", `${releaseName}-secrets`, "10"],
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
const hindsightEnv = hindsightApiContainer?.env ?? [];
const hindsightEnvValue = (name) => hindsightEnv.find((entry) => entry.name === name)?.value;
const hindsightEnvSecretKey = (name) => hindsightEnv.find((entry) => entry.name === name)
  ?.valueFrom?.secretKeyRef?.key;
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
for (const [name, key] of [
  ["HINDSIGHT_API_DATABASE_URL", "hindsight-database-url"],
  ["HINDSIGHT_API_MIGRATION_DATABASE_URL", "hindsight-database-url"],
  ["HINDSIGHT_API_TENANT_API_KEY", "hindsight-api-key"],
  ["HINDSIGHT_API_LLM_API_KEY", "hindsight-router-token"],
  ["HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY", "hindsight-router-token"],
]) {
  if (hindsightEnvSecretKey(name) !== key) {
    throw new Error(`Hindsight API ${name} must come from Secret key ${key}.`);
  }
}
if (hindsightEnv.some((entry) => entry.valueFrom?.secretKeyRef?.key === "litellm-master-key")) {
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
  || routerEnv.find((entry) => entry.name === "TALI_HINDSIGHT_ROUTER_TOKEN")
    ?.valueFrom?.secretKeyRef?.key !== "hindsight-router-token"
  || routerEnv.find((entry) => entry.name === "TALI_HINDSIGHT_CONTROL_TOKEN")
    ?.valueFrom?.secretKeyRef?.key !== "hindsight-router-token"
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
  || !migrationContainer?.command?.join(" ").includes("hindsight-admin run-db-migration")
  || !migrationContainer?.command?.join(" ").includes("--embedding-dimension")
) {
  throw new Error("The Hindsight migration Job must run the pinned provider's dimension-aware migration command.");
}
if (
  !bootstrapContainer?.command?.join(" ").includes("CREATE ROLE %I")
  || !bootstrapContainer?.command?.join(" ").includes("CREATE DATABASE %I")
  || !bootstrapContainer?.command?.join(" ").includes("CREATE SCHEMA IF NOT EXISTS hindsight")
) {
  throw new Error("The migration bootstrap must create the dedicated Hindsight role, database, and schema.");
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
  JSON.stringify(hindsightWorkerContainer?.command) !== JSON.stringify(["hindsight-worker"])
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
  externalWorkerApi.spec?.template?.spec?.containers?.find((container) => container.name === "api")
    ?.env?.find((entry) => entry.name === "HINDSIGHT_API_WORKER_ENABLED")?.value !== "false"
) {
  throw new Error("Enabling the external Hindsight worker must disable the API's embedded worker.");
}

for (const [kind, name] of [
  ["StatefulSet", `${releaseName}-openshell`],
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

for (const [kind, expectedWeight] of [
  ["ServiceAccount", "-30"],
  ["Role", "-30"],
  ["RoleBinding", "-30"],
  ["Job", "-20"],
]) {
  const annotations = requireObject(
    kind,
    `${releaseName}-openshell-certgen`,
  ).metadata?.annotations;
  if (
    annotations?.["helm.sh/hook"] !== "pre-install,pre-upgrade" ||
    annotations?.["helm.sh/hook-weight"] !== expectedWeight
  ) {
    throw new Error(
      `${kind}/${releaseName}-openshell-certgen must preserve its upstream Helm hook and weight ${expectedWeight}.`,
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
    object.metadata?.name === `${releaseName}-secrets`,
);
const localControlToml = localSecret?.stringData?.["control.toml"] ?? "";
if (!/^public_url\s*=\s*"http:\/\/localhost:38080"$/m.test(localControlToml)) {
  throw new Error(
    "Control bootstrap must render Better Auth's canonical server.public_url.",
  );
}
if (/\[(?:runner|litellm|runtime_namespaces)\]|internal_url\s*=|^enabled\s*=/m.test(localControlToml)) {
  throw new Error(
    "Runtime connectivity and policy must not be rendered into control.toml.",
  );
}
const localControl = localObjects.find(
  (object) =>
    object.kind === "Deployment"
    && object.metadata?.name === `${releaseName}-control`,
);
const localControlEnv = localControl?.spec?.template?.spec?.containers
  ?.find((container) => container.name === "control")?.env ?? [];
if (
  localControlEnv.find((entry) => entry.name === "TALI_HINDSIGHT_URL")?.value
    !== `http://${releaseName}-hindsight-api.${releaseNamespace}.svc.cluster.local:8888`
  || localControlEnv.find((entry) => entry.name === "TALI_HINDSIGHT_API_KEY")
    ?.valueFrom?.secretKeyRef?.key !== "hindsight-api-key"
  || localControlEnv.find((entry) => entry.name === "TALI_HINDSIGHT_ROUTER_TOKEN")
    ?.valueFrom?.secretKeyRef?.key !== "hindsight-router-token"
  || localControlEnv.find((entry) => entry.name === "TALI_HINDSIGHT_EMBEDDING_DIMENSIONS")?.value
    !== "1536"
) {
  throw new Error("Control must use the internal Hindsight Service, root credential, and Project Router contract.");
}
for (const key of [
  "metrics-token",
  "hindsight-database-password",
  "hindsight-database-url",
  "hindsight-api-key",
  "hindsight-router-token",
]) {
  if (localSecret?.stringData?.[key] == null) {
    throw new Error(`The generated release Secret is missing ${key}.`);
  }
}
for (const [name, value] of [
  ["TALI_BOOTSTRAP_INTERNAL_URL", `http://${releaseName}-control.${releaseNamespace}.svc.cluster.local:38080`],
  ["TALI_BOOTSTRAP_RUNNER_URL", `http://${releaseName}-runner:9090`],
  ["TALI_BOOTSTRAP_LITELLM_URL", `http://${releaseName}-litellm.${releaseNamespace}.svc.cluster.local:4000`],
  ["TALI_BOOTSTRAP_RUNTIME_NAMESPACES_ENABLED", "true"],
  ["TALI_BOOTSTRAP_RUNTIME_CLUSTER_ID", "in-cluster"],
  ["TALI_DURABLE_MEMORY_ENABLED", "true"],
]) {
  if (localControlEnv.find((entry) => entry.name === name)?.value !== value) {
    throw new Error(`${name} must seed the initial Platform infrastructure setting.`);
  }
}
for (const [name, key] of [
  ["TALI_BOOTSTRAP_RUNNER_TOKEN", "runner-token"],
  ["TALI_BOOTSTRAP_LITELLM_MASTER_KEY", "litellm-master-key"],
  ["TALI_METRICS_TOKEN", "metrics-token"],
]) {
  if (
    localControlEnv.find((entry) => entry.name === name)?.valueFrom
      ?.secretKeyRef?.key !== key
  ) {
    throw new Error(`${name} must seed Platform settings from the component Secret.`);
  }
}

const gradualMemoryObjects = parseObjects(renderChart([
  "--set", "features.durableMemory.enabled=false",
  "--set-string", "features.durableMemory.projectAllowlist[0]=project-canary",
]));
const gradualMemoryControl = requireComponentObject(
  gradualMemoryObjects,
  "Deployment",
  "control",
);
const gradualMemoryEnv = gradualMemoryControl.spec?.template?.spec?.containers
  ?.find((container) => container.name === "control")?.env ?? [];
if (
  gradualMemoryEnv.find((entry) => entry.name === "TALI_DURABLE_MEMORY_ENABLED")?.value
    !== "false"
  || gradualMemoryEnv.find((entry) => entry.name === "TALI_DURABLE_MEMORY_PROJECTS")?.value
    !== "project-canary"
) {
  throw new Error("Durable Memory must support environment disablement and Project canary rollout.");
}

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
if (
  controlWorkerEnv.find((entry) => entry.name === "TALI_METRICS_TOKEN")
    ?.valueFrom?.secretKeyRef?.key !== "metrics-token"
) {
  throw new Error("The Control Worker metrics endpoint must use the metrics token Secret.");
}
if (
  controlWorkerEnv.find((entry) => entry.name === "TALI_HINDSIGHT_URL")?.value
    !== `http://${releaseName}-hindsight-api.${releaseNamespace}.svc.cluster.local:8888`
  || controlWorkerEnv.find((entry) => entry.name === "TALI_HINDSIGHT_API_KEY")
    ?.valueFrom?.secretKeyRef?.key !== "hindsight-api-key"
) {
  throw new Error("The Control Worker must use the internal Hindsight Service and Secret-backed credential.");
}
if (
  controlWorkerEnv.find((entry) => entry.name === "DOCLING_BASE_URL")?.value
  !== `http://${releaseName}-docling:5001`
) {
  throw new Error(
    "The Control Worker must use the bundled Docling Service when Docling is enabled.",
  );
}

const docling = requireObject("Deployment", `${releaseName}-docling`);
const doclingEnv = docling.spec?.template?.spec?.containers
  ?.find((container) => container.name === "docling")?.env ?? [];
if (
  doclingEnv.find((entry) => entry.name === "DOCLING_SERVE_MAX_FILE_SIZE")
    ?.value !== "26214400"
) {
  throw new Error(
    "The Docling file-size limit must render as a decimal integer string.",
  );
}

const runtimeControlRole = requireObject(
  "ClusterRole",
  runtimeControlClusterRoleName,
);
if (
  JSON.stringify(runtimeControlRole.rules) !== JSON.stringify([
    {
      apiGroups: [""],
      resources: ["namespaces"],
      verbs: ["get", "create", "patch"],
    },
    {
      apiGroups: [""],
      resources: ["services"],
      verbs: ["get", "create", "patch", "delete"],
    },
    {
      apiGroups: [""],
      resources: ["pods"],
      verbs: ["get", "list"],
    },
    {
      apiGroups: [""],
      resources: ["pods/log"],
      verbs: ["get"],
    },
    {
      apiGroups: ["apps"],
      resources: ["deployments"],
      verbs: ["get", "create", "patch", "delete"],
    },
  ])
) {
  throw new Error(
    "The Control Plane must be limited to Project Namespace metadata, managed Agent workloads, and read-only Pod logs.",
  );
}

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

const runtimeDisabledObjects = parseObjects(
  renderChart(["--set", "projectRuntimeNamespaces.enabled=false"]),
);
for (const [kind, name] of [
  ["ClusterRole", runtimeControlClusterRoleName],
  ["ClusterRoleBinding", runtimeControlClusterRoleName],
  ["ServiceAccount", controlWorkerName],
  ["ClusterRole", controlWorkerClusterRoleName],
  ["ClusterRoleBinding", controlWorkerClusterRoleName],
]) {
  if (
    !runtimeDisabledObjects.some(
      (object) => object.kind === kind && object.metadata?.name === name,
    )
  ) {
    throw new Error(
      `${kind}/${name} must remain available so Platform validation can enable Runtime Namespaces online.`,
    );
  }
}
const runtimeDisabledControlWorker = runtimeDisabledObjects.find(
  (object) =>
    object.kind === "Deployment" &&
    object.metadata?.name === controlWorkerName,
);
if (
  runtimeDisabledControlWorker?.spec?.template?.spec?.serviceAccountName !==
    controlWorkerName ||
  runtimeDisabledControlWorker?.spec?.template?.spec
    ?.automountServiceAccountToken !== true
) {
  throw new Error(
    "The Control Worker must retain its dedicated identity when Runtime Namespaces are disabled in the initial Platform setting.",
  );
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
  ])
) {
  throw new Error(
    "The Control Worker identity must be limited to Project Namespaces and version-pinned Expert Agent Runtime resources.",
  );
}

const localControlService = localObjects.find(
  (object) =>
    object.kind === "Service" &&
    object.metadata?.name === `${releaseName}-control`,
);
if (localControlService?.spec?.type !== "LoadBalancer") {
  throw new Error(
    "The Control Service must render as LoadBalancer with the canonical control.publicUrl.",
  );
}

const localWithPublicUrlObjects = parseObjects(
  renderChart([
    "--set",
    "control.service.type=LoadBalancer",
    "--set-string",
    "control.publicUrl=http://198.51.100.20",
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
      } change when only control.publicUrl changes.`,
    );
  }
}

const missingOidcPublicUrlResult = spawnSync(
  "helm",
  templateArguments([
    "--set-string",
    "control.publicUrl=",
  ]),
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
if (
  missingOidcPublicUrlResult.status === 0 ||
  !missingOidcPublicUrlResult.stderr.includes(
    "control.publicUrl is required for Better Auth",
  )
) {
  throw new Error(
    "The Chart must require control.publicUrl for authentication callbacks and invitation links.",
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
