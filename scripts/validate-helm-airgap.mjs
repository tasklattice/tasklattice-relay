#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";

const releaseName = "tali-relay";
const releaseNamespace = "tali-airgap-validation";
const chartPath = process.env.TALI_CHART_PATH ?? "charts/tali-relay";
const expectedRegistry = "registry.airgap.example.com/";
const expectedPullSecret = "airgap-registry";
const expectedOpenShellVersion = process.env.OPENSHELL_VERSION ?? "0.0.106";
const expectedNemoClawVersion = process.env.NEMOCLAW_VERSION ?? "v0.0.114";
const forbiddenRegistries = [
  "docker.io/",
  "ghcr.io/",
  "quay.io/",
  "registry.k8s.io/",
];
let extractedChartRoot;
let valuesRoot = "charts/tali-relay";

if (chartPath.endsWith(".tgz")) {
  extractedChartRoot = mkdtempSync(
    join(tmpdir(), "tali-airgap-validation-"),
  );
  execFileSync("tar", ["-xzf", chartPath, "-C", extractedChartRoot]);
  valuesRoot = join(extractedChartRoot, "tali-relay");

  for (const requiredPath of [
    "Chart.lock",
    "values-openshift.yaml",
    "values-airgap.yaml",
    "charts/agent-sandbox/Chart.yaml",
    "charts/agent-sandbox/LICENSE",
    "charts/agent-sandbox/crds/agents.x-k8s.io_sandboxes.yaml",
    "charts/openshell/Chart.yaml",
  ]) {
    if (!existsSync(join(valuesRoot, requiredPath))) {
      console.error(
        `Packaged Chart is missing required offline artifact: ${requiredPath}`,
      );
      process.exitCode = 1;
    }
  }
  if (process.exitCode) {
    rmSync(extractedChartRoot, { recursive: true, force: true });
    process.exit(process.exitCode);
  }
}

const rendered = execFileSync(
  "helm",
  [
    "template",
    releaseName,
    chartPath,
    "--namespace",
    releaseNamespace,
    "--kube-version",
    "1.29.0",
    "--include-crds",
    "--values",
    join(valuesRoot, "values-openshift.yaml"),
    "--values",
    join(valuesRoot, "values-airgap.yaml"),
    "--set-string",
    "control.publicUrl=https://tali.apps.airgap.example.com",
    "--set",
    "keycloak.enabled=true",
    "--set-string",
    "keycloak.publicUrl=https://keycloak.apps.airgap.example.com",
    "--set",
    "openshift.routes.keycloak.enabled=true",
    "--set",
    "exampleMcp.enabled=true",
  ],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      ALL_PROXY: "http://127.0.0.1:9",
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      NO_PROXY: "",
      all_proxy: "http://127.0.0.1:9",
      http_proxy: "http://127.0.0.1:9",
      https_proxy: "http://127.0.0.1:9",
      no_proxy: "",
    },
  },
);

const documents = parseAllDocuments(rendered);
const parseErrors = documents.flatMap((document) => document.errors);
if (parseErrors.length > 0) {
  console.error("Air-gap render contains invalid YAML:");
  for (const error of parseErrors) {
    console.error(`- ${error.message}`);
  }
  process.exit(1);
}

const objects = documents
  .map((document) => document.toJS())
  .filter((object) => object && typeof object === "object");
const violations = [];
let checkedContainers = 0;
const resourceIdentities = new Set();

const liteLLMDeployment = objects.find(
  (object) =>
    object.kind === "Deployment"
    && object.metadata?.labels?.["app.kubernetes.io/component"] === "litellm",
);
const liteLLMContainer = liteLLMDeployment?.spec?.template?.spec?.containers?.find(
  (container) => container.name === "litellm",
);
const liteLLMLocalCostMap = liteLLMContainer?.env?.find(
  (entry) => entry.name === "LITELLM_LOCAL_MODEL_COST_MAP",
)?.value;
const liteLLMWorkerArgumentIndex = liteLLMContainer?.args?.indexOf("--num_workers") ?? -1;
if (liteLLMLocalCostMap !== "True") {
  violations.push("Air-gap LiteLLM must use its image-bundled model cost map.");
}
if (
  liteLLMWorkerArgumentIndex < 0
  || liteLLMContainer.args[liteLLMWorkerArgumentIndex + 1] !== "1"
) {
  violations.push("Air-gap LiteLLM must default to one worker per Pod.");
}

for (const object of objects) {
  if (!object.apiVersion || !object.kind || !object.metadata?.name) {
    continue;
  }
  const identity = [
    object.apiVersion,
    object.kind,
    object.metadata.namespace ?? "",
    object.metadata.name,
  ].join("/");
  if (resourceIdentities.has(identity)) {
    violations.push(`Rendered manifests contain duplicate resource ${identity}.`);
  }
  resourceIdentities.add(identity);
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

for (const object of objects) {
  const template = podTemplateFor(object);
  if (!template) {
    continue;
  }

  const podSpec = object.kind === "Pod" ? object.spec : template.spec;
  const workload = `${object.kind}/${object.metadata?.name}`;
  const pullSecretNames = (podSpec?.imagePullSecrets ?? []).map(
    (secret) => secret.name,
  );
  if (!pullSecretNames.includes(expectedPullSecret)) {
    violations.push(
      `${workload} does not reference imagePullSecret/${expectedPullSecret}.`,
    );
  }

  for (const container of [
    ...(podSpec?.initContainers ?? []),
    ...(podSpec?.containers ?? []),
  ]) {
    checkedContainers += 1;
    if (!container.image?.startsWith(expectedRegistry)) {
      violations.push(
        `${workload} container/${container.name} uses non-mirrored image ${container.image}.`,
      );
    }
  }
}

for (const registry of forbiddenRegistries) {
  if (rendered.includes(registry)) {
    violations.push(`Rendered manifests still reference public registry ${registry}.`);
  }
}

const gatewayConfig = objects.find(
  (object) =>
    object.kind === "ConfigMap" &&
    object.metadata?.name === `${releaseName}-openshell-config`,
);
const gatewayToml = gatewayConfig?.data?.["gateway.toml"] ?? "";
for (const [label, expectedValue] of [
  [
    "mirrored default sandbox image",
    `"registry.airgap.example.com/third-party/nemoclaw-sandbox-base:${expectedNemoClawVersion}"`,
  ],
  [
    "mirrored supervisor image",
    `"registry.airgap.example.com/third-party/openshell-supervisor:${expectedOpenShellVersion}"`,
  ],
  [
    "sandbox image pull Secret",
    '["airgap-registry"]',
  ],
]) {
  if (!gatewayToml.includes(expectedValue)) {
    violations.push(`OpenShell gateway config is missing ${label}.`);
  }
}

for (const sandboxImage of [
  "registry.airgap.example.com/tali/tali-nemoclaw-sandbox:",
  "registry.airgap.example.com/tali/tali-nemoclaw-hermes-sandbox:",
  "registry.airgap.example.com/tali/tali-nemoclaw-deepagents-sandbox:",
]) {
  if (!rendered.includes(sandboxImage)) {
    violations.push(`Runner config is missing mirrored image ${sandboxImage}`);
  }
}

if (checkedContainers === 0) {
  violations.push("Air-gap render did not contain any Pod containers.");
}

if (violations.length > 0) {
  console.error("Air-gap Helm validation failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

if (extractedChartRoot) {
  rmSync(extractedChartRoot, { recursive: true, force: true });
}

console.log(
  `Validated ${checkedContainers} containers for disconnected rendering; ` +
    `all images use ${expectedRegistry} and all Pods reference ${expectedPullSecret}.`,
);
