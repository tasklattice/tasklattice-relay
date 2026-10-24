import { execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseAllDocuments, stringify } from "yaml";
import { imagePlan } from "../ocp-runtime-image-plan.mjs";
import { parse as parseToml } from "smol-toml";
import { materializeBootstrapSecrets } from "./helm-bootstrap-fixture.mjs";

function render(settings = [], namespace = "control-images", args = []) {
  return parseAllDocuments(execFileSync("helm", ["template", "relay", "charts/tali-relay",
    "--namespace", namespace, "--kube-version", "1.29.0", ...args, ...settings.flatMap(s => ["--set", s])],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })).map(d => d.toJSON()).filter(Boolean);
}
const isPuller = (r) => r.metadata?.name?.endsWith("project-image-puller");
test("OpenShift grants only the Worker scoped image-puller binding authority", () => {
  const resources = render(["openshift.enabled=true"]);
  const role = resources.find(r => isPuller(r) && r.kind === "Role");
  const binding = resources.find(r => isPuller(r) && r.kind === "RoleBinding");
  assert.equal(role.metadata.namespace, "control-images");
  assert.deepEqual(role.rules, [
    { apiGroups: ["rbac.authorization.k8s.io"], resources: ["rolebindings"], verbs: ["get", "create", "patch"] },
    { apiGroups: ["rbac.authorization.k8s.io"], resources: ["clusterroles"], resourceNames: ["system:image-puller"], verbs: ["bind"] },
  ]);
  assert.equal(binding.metadata.namespace, "control-images");
  assert.equal(binding.roleRef.kind, "Role");
  assert.equal(binding.roleRef.name, role.metadata.name);
  assert.equal(binding.subjects.length, 1);
  const worker = resources.find(r => r.kind === "ServiceAccount" && r.metadata.name.endsWith("control-worker"));
  assert.deepEqual(binding.subjects[0], { kind: "ServiceAccount", name: worker.metadata.name, namespace: "control-images" });
  const sccBind = resources.filter(r => r.kind === "ClusterRole").flatMap(r => r.rules.filter(rule => rule.verbs.includes("bind")));
  assert.deepEqual(sccBind, [{ apiGroups:["rbac.authorization.k8s.io"], resources:["clusterroles"],
    resourceNames:["system:openshift:scc:privileged", "system:openshift:scc:anyuid"], verbs:["bind"] }]);
  const toml = resources.flatMap(r => Object.values(r.stringData ?? {})).find(s => s.includes("[worker.openshift]"));
  assert.match(toml, /\[worker.openshift\]\nenabled = true\nimageSourceNamespace = "control-images"/);
});
test("ordinary Kubernetes does not render OpenShift binding authority", () => {
  assert(!render().some(isPuller));
  assert(!render().some(r => r.rules?.some(rule => rule.verbs.includes("bind") || rule.resources.includes("securitycontextconstraints"))));
});

test("tenant SCC flag agrees between Worker config and RBAC, including old values upgrades", () => {
  for (const value of ["true", "false", "null"]) {
    const resources = render(["openshift.enabled=true", `openshift.manageTenantScc=${value}`]);
    const toml = resources.flatMap(r => Object.values(r.stringData ?? {})).find(s => s.includes("[worker.openshift]"));
    const expected = value !== "false";
    assert.equal(parseToml(toml).worker.openshift.manageTenantScc, expected);
    const worker = resources.find(r => r.kind === "ClusterRole" && r.metadata.name.includes("control-worker"));
    assert.equal(worker.rules.some(r => r.verbs.includes("bind") && r.resourceNames.includes("system:openshift:scc:privileged")), expected);
    assert(!resources.some(r => /Binding$/.test(r.kind) && r.roleRef.name === "system:openshift:scc:privileged"), "do not grant privileged to control-plane SAs");
  }
  assert.throws(() => render(["openshift.manageTenantScc=invalid"]), /must be a boolean/);
});

test("old reused values without new OpenShift settings render valid Worker TOML", () => {
  for (const enabled of [true, false]) {
    const resources = render([`openshift.enabled=${enabled}`, "openshift.imageSourceNamespace=null",
      "openshift.imageRegistryHost=null", "openshift.imagePullReadyTimeoutMs=null"]);
    const toml = resources.flatMap(r => Object.values(r.stringData ?? {})).find(s => s.includes("[worker.openshift]"));
    assert.deepEqual({ ...parseToml(toml).worker.openshift }, {
      enabled, imageSourceNamespace: "control-images", imagePullReadyTimeoutMs: 120000, manageTenantScc: true,
    });
    if (enabled) {
      // The default source must keep the existing Helm-managed RBAC names on upgrade.
      const oldNames = render(["openshift.enabled=true"]).filter(isPuller).map(r => r.metadata.name);
      assert.deepEqual(resources.filter(isPuller).map(r => r.metadata.name), oldNames);
    }
  }
});

test("OCP preparation adds scoped Worker SCC bind, SA create/get and Secret get; Kubernetes RBAC is unchanged", () => {
  const enabled = render(["openshift.enabled=true"]);
  const disabled = render();
  const workerRules = resources => resources.find(r => r.kind === "ClusterRole" && r.metadata.name.includes("control-worker")).rules;
  const ordinaryRules = workerRules(disabled).map(rule => JSON.stringify(rule));
  assert.deepEqual(workerRules(enabled).filter(rule => !ordinaryRules.includes(JSON.stringify(rule))), [
    {apiGroups:["rbac.authorization.k8s.io"],resources:["clusterroles"],resourceNames:["system:openshift:scc:privileged","system:openshift:scc:anyuid"],verbs:["bind"]},
    {apiGroups:[""],resources:["serviceaccounts"],verbs:["get","create"]},
    {apiGroups:[""],resources:["secrets"],verbs:["get"]},
  ]);
  const apiRole = resources => resources.find(r => r.kind === "ClusterRole" && r.metadata.name.includes("project-runtime-control"));
  assert.deepEqual(apiRole(enabled), apiRole(disabled));
  for (const role of enabled.filter(r => r.kind === "ClusterRole" || r.kind === "Role")) {
    assert(!role.rules.some(rule => rule.verbs.includes("escalate") || rule.verbs.includes("impersonate") || rule.resources.includes("securitycontextconstraints")));
  }
});

test("a separate image source keeps the Worker identity in the installation namespace", () => {
  const resources = render(["openshift.enabled=true", "openshift.imageSourceNamespace=shared-images", "openshift.imageRegistryHost=registry.apps.example"]);
  const role = resources.find(r => isPuller(r) && r.kind === "Role");
  const binding = resources.find(r => isPuller(r) && r.kind === "RoleBinding");
  assert.equal(role.metadata.namespace, "shared-images");
  assert.equal(binding.metadata.namespace, "shared-images");
  assert.equal(binding.subjects[0].namespace, "control-images");
  const toml = resources.flatMap(r => Object.values(r.stringData ?? {})).find(s => s.includes("[worker.openshift]"));
  assert.match(toml, /imageSourceNamespace = "shared-images"/);
  assert.match(toml, /imageRegistryHost = "registry.apps.example"/);
  assert.match(toml, /imagePullReadyTimeoutMs = 120000/);
  assert.match(toml, /sandboxImages = \[.*tali-nemoclaw-sandbox.*tali-nemoclaw-hermes-sandbox.*tali-nemoclaw-deepagents-sandbox/);
});
test("invalid source namespaces fail at render time", () => {
  assert.throws(() => render(["openshift.enabled=true", "openshift.imageSourceNamespace=invalid/name"]), /valid namespace/);
});

test("two installations can share an image source without overwriting Worker authority", () => {
  const settings = ["openshift.enabled=true", "openshift.imageSourceNamespace=shared-images"];
  const first = render(settings, "control-a").find(r => isPuller(r) && r.kind === "RoleBinding");
  const second = render(settings, "control-b").find(r => isPuller(r) && r.kind === "RoleBinding");
  assert.notEqual(first.metadata.name, second.metadata.name);
  assert.equal(first.subjects[0].namespace, "control-a");
  assert.equal(second.subjects[0].namespace, "control-b");
});

function runtimeConfiguration(resources) {
  const objects = materializeBootstrapSecrets(resources);
  const worker = parseToml(objects.find(r => r.stringData?.["worker.toml"]).stringData["worker.toml"]).worker;
  const runner = JSON.parse(objects.find(r => r.stringData?.["runner.json"]).stringData["runner.json"]);
  const gateway = worker.project_openshell;
  return {
    worker, runner,
    images: {
      gateway: `${gateway.gatewayImageRepository}:${gateway.gatewayImageTag}`,
      supervisor: `${gateway.supervisorImageRepository}:${gateway.supervisorImageTag}`,
      sandbox: gateway.sandboxImage,
      bridge: worker.project_runtime_bridge.image,
      expert: worker.expert_agent_runtime.image,
      ...runner.openshell.sandbox.images,
    },
  };
}

function assertSharedRuntime(resources, prefix, original) {
  const config = runtimeConfiguration(resources);
  assert.equal(Object.keys(config.images).length, 8);
  for (const [component, image] of Object.entries(config.images)) {
    assert.equal(image, `${prefix}/${original.images[component].split("/").at(-1)}`, component);
  }
  // Worker validates the exact images Runner will send when creating Sandboxes.
  assert.deepEqual([...config.worker.project_openshell.sandboxImages].sort(), Object.values(config.runner.openshell.sandbox.images).sort());
  return config;
}

test("OCP automatically shares every tenant image, including Gateway/certgen and Supervisor", () => {
  const ordinary = render();
  const ocp = render(["openshift.enabled=true", "openshift.runtimeImages.enabled=true"]);
  assertSharedRuntime(ocp, "image-registry.openshift-image-registry.svc:5000/control-images", runtimeConfiguration(ordinary));
  // Enabling tenant mirroring must not relocate control-plane or bootstrap images.
  const podImages = resources => resources.flatMap(r => {
    const spec = r.spec?.template?.spec;
    return [...(spec?.initContainers ?? []), ...(spec?.containers ?? [])].map(c => [r.metadata.name, c.name, c.image]);
  });
  assert.deepEqual(podImages(ocp), podImages(ordinary));
});

test("OCP shared images follow a custom registry and source namespace", () => {
  assertSharedRuntime(render(["openshift.enabled=true", "openshift.runtimeImages.enabled=true", "openshift.imageSourceNamespace=shared-images",
    "openshift.imageRegistryHost=registry.apps.example:5443"]),
  "registry.apps.example:5443/shared-images", runtimeConfiguration(render()));
});

test("OCP preserves custom ImageStream names, tags and digests across Worker and Runner", () => {
  const settings = [
    "global.imageRegistry=mirror.example:5000/deep/team",
    "images.control.repository=custom/control", "images.control.tag=release-7",
    "images.hermesSandbox.repository=mirror.example/team/custom-hermes", "images.hermesSandbox.useGlobalRegistry=false",
    "images.hermesSandbox.tag=v7@sha256:" + "a".repeat(64),
    "openshell.image.repository=mirror.example:5000/nested/custom-gateway", "openshell.image.tag=v8",
    "openshell.supervisor.image.repository=mirror.example:5000/nested/custom-supervisor", "openshell.supervisor.image.tag=v9",
    "openshell.server.sandboxImage=mirror.example/nested/custom-base@sha256:" + "b".repeat(64),
  ];
  const config = assertSharedRuntime(render([...settings, "openshift.enabled=true", "openshift.runtimeImages.enabled=true"]),
    "image-registry.openshift-image-registry.svc:5000/control-images", runtimeConfiguration(render(settings)));
  assert.match(config.images.hermes, /\/custom-hermes:v7@sha256:a{64}$/);
  assert.match(config.images.sandbox, /\/custom-base@sha256:b{64}$/);
});

test("ordinary Kubernetes preserves custom image URLs even when shared-source settings exist", () => {
  const settings = ["global.imageRegistry=mirror.example/team", "openshell.image.repository=other.example/gateway",
    "openshell.server.sandboxImage=other.example/base:custom"];
  const baseline = runtimeConfiguration(render(settings));
  const actual = runtimeConfiguration(render([...settings, "openshift.imageSourceNamespace=unused-source",
    "openshift.imageRegistryHost=unused.example", "openshift.runtimeImages.enabled=true"]));
  assert.deepEqual(actual.images, baseline.images);
  assert.deepEqual(actual.runner.openshell, baseline.runner.openshell);
});

test("OCP can retain explicit mixed-registry runtime images with a single opt-out", () => {
  const settings = ["global.imageRegistry=private.example/team", "openshell.image.repository=another.example/gateway"];
  assert.deepEqual(runtimeConfiguration(render([...settings, "openshift.enabled=true", "openshift.runtimeImages.enabled=false"])).images,
    runtimeConfiguration(render(settings)).images);
});

test("old upgrades preserve original URLs when runtimeImages is absent", () => {
  const settings = ["global.imageRegistry=private.example/team", "openshell.image.repository=other.example/gateway"];
  const original = runtimeConfiguration(render(settings));
  for (const missing of [[], ["openshift.runtimeImages=null"], ["openshift.runtimeImages.enabled=null"]]) {
    const upgraded = render([...settings, "openshift.enabled=true", ...missing], "control-images", ["--is-upgrade"]);
    assert.deepEqual(runtimeConfiguration(upgraded).images, original.images);
  }
});

test("shared OCP registry rejects schemes and paths before deploying tenant workloads", () => {
  for (const host of ["https://registry.example", "registry.example/source"]) {
    assert.throws(() => render(["openshift.enabled=true", "openshift.runtimeImages.enabled=true", `openshift.imageRegistryHost=${host}`]), /registry host/);
  }
});


test("OCP profile explicitly opts in; offline profile preserves external images on Kubernetes and OCP", () => {
  const args = ["-f", "charts/tali-relay/values-openshift.yaml"];
  assertSharedRuntime(render([], "control-images", args),
    "image-registry.openshift-image-registry.svc:5000/control-images", runtimeConfiguration(render()));
  for (const profiles of [["-f", "charts/tali-relay/values-airgap.yaml"], [...args, "-f", "charts/tali-relay/values-airgap.yaml"]]) {
    const config = runtimeConfiguration(render([], "control-images", profiles));
    for (const image of Object.values(config.images)) assert.match(image, /^registry\.airgap\.example\.com\//);
    assert.deepEqual([...config.worker.project_openshell.sandboxImages].sort(), Object.values(config.runner.openshell.sandbox.images).sort());
  }
});

test("unified OCP configuration refuses an external Worker or Runner to prevent split image sources", () => {
  for (const component of ["worker", "runner"]) {
    assert.throws(() => render(["openshift.enabled=true", "openshift.runtimeImages.enabled=true",
      `secrets.existingSecrets.${component}=external`]), /Chart-managed Worker and Runner/);
    assert.doesNotThrow(() => render(["openshift.enabled=true", `secrets.existingSecrets.${component}=external`]));
    assert.doesNotThrow(() => render(["openshift.runtimeImages.enabled=true", `secrets.existingSecrets.${component}=external`]));
  }
});

test("unified OCP mapping rejects invalid names and tags instead of rendering broken runtime images", () => {
  for (const setting of ["openshell.image.repository=registry.example/gateway:v1",
    "openshell.supervisor.image.repository=registry.example/supervisor@sha256:" + "a".repeat(64),
    "openshell.image.tag=", "openshell.supervisor.image.tag=bad:tag", "images.hermesSandbox.tag=v1:bad",
    "openshell.server.sandboxImage=registry.example/UPPER:v1", "openshell.server.sandboxImage=registry.example/base:",
    "images.hermesSandbox.repository=invalid_name", "images.hermesSandbox.repository=nested/"]) {
    assert.throws(() => render(["openshift.enabled=true", "openshift.runtimeImages.enabled=true", setting]),
      /Invalid ImageStream name|Invalid tag\/digest|must not include a tag or digest/);
  }
});

test("unified OCP mapping rejects collisions between unrelated upstream images", () => {
  const settings = ["openshift.enabled=true", "openshift.runtimeImages.enabled=true",
    "openshell.image.repository=vendor-a/runtime", "openshell.supervisor.image.repository=vendor-b/runtime"];
  assert.throws(() => render(settings), /mapping collision/);
  assert.doesNotThrow(() => render([...settings, "openshell.supervisor.image.tag=another-version"]));
  assert.doesNotThrow(() => render([...settings, "openshell.supervisor.image.repository=vendor-a/runtime"]));
});

test("an OCP image-source switch updates both rollout checksums, and opt-out restores URLs", () => {
  const settings = ["openshift.enabled=true", "openshift.runtimeImages.enabled=true"];
  const first = render(settings);
  const second = render([...settings, "openshift.imageSourceNamespace=next-images"]);
  for (const component of ["control-worker", "runner"]) {
    const annotations = resources => resources.find(r => r.kind === "Deployment" &&
      r.metadata.labels["app.kubernetes.io/component"] === component).spec.template.metadata.annotations;
    const checksum = component === "runner" ? "checksum/runner-secret" : "checksum/worker-config";
    assert.notEqual(annotations(first)[checksum], annotations(second)[checksum]);
  }
  assertSharedRuntime(second, "image-registry.openshift-image-registry.svc:5000/next-images", runtimeConfiguration(render()));
  assert.deepEqual(runtimeConfiguration(render([...settings, "openshift.runtimeImages.enabled=false"], "control-images", ["--is-upgrade"])).images,
    runtimeConfiguration(render()).images);
});


test("OCP import plan follows rendered tags/digests without exporting configuration credentials", () => {
  const settings = ["images.hermesSandbox.tag=v7@sha256:" + "a".repeat(64),
    "openshell.server.sandboxImage=mirror.example/base@sha256:" + "b".repeat(64)];
  const asYaml = resources => resources.map(r => stringify(r)).join("\n---\n");
  const source = asYaml(render(settings));
  const target = asYaml(render([...settings, "openshift.enabled=true", "openshift.runtimeImages.enabled=true"]));
  const plan = imagePlan(source, target);
  assert.equal(plan.images.length, 8);
  assert.deepEqual(plan.images.find(i => i.roles.includes("gateway")).roles, ["gateway", "certgen"]);
  assert.equal(plan.images.find(i => i.roles.includes("hermes")).tag, "v7");
  assert.equal(plan.images.find(i => i.roles.includes("sandbox")).tag, "relay-sha256-" + "b".repeat(64));
  assert.equal(plan.images.find(i => i.roles.includes("sandbox")).digest, "sha256:" + "b".repeat(64));
  assert(!JSON.stringify(plan).includes("__TALI_CREDENTIAL_"));
  assert.throws(() => imagePlan(source, source), /enable OCP/);
  const changed = asYaml(render([...settings, "openshift.enabled=true", "openshift.runtimeImages.enabled=true", "images.control.tag=changed"]));
  assert.throws(() => imagePlan(source, changed), /version or name differs/);
});
