import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { parseAllDocuments, parse as parseYaml } from "yaml";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseToml } from "smol-toml";
import { bootstrap, credentialKeys, humanLoginPasswordKeys, generateCredentials, renderOutput } from "../credential-bootstrap/bootstrap-secrets.mjs";

function render(args = []) {
  return parseAllDocuments(execFileSync("helm", ["template", "relay", "charts/tali-relay", "--namespace", "tali",
    "--kube-version", "1.29.0", "--set", "fullnameOverride=relay", ...args], {encoding:"utf8",stdio:["ignore","pipe","pipe"]})).map(d => d.toJSON()).filter(Boolean);
}
const objects = render(["--set", "keycloak.enabled=true", "--set", "keycloak.publicUrl=https://sso.example.test", "--set", "exampleMcp.enabled=true"]);
const spec = JSON.parse(objects.find(o => o.kind === "ConfigMap" && o.data?.["spec.json"]).data["spec.json"]);

test("a projected ConfigMap symlink executes the CLI instead of silently exiting", () => {
  const directory = mkdtempSync(join(tmpdir(), "relay-bootstrap-entry-"));
  try {
    const entry = join(directory, "bootstrap.mjs");
    symlinkSync(realpathSync("scripts/credential-bootstrap/bootstrap-secrets.mjs"), entry);
    const result = spawnSync(process.execPath, [entry, join(directory, "missing-spec.json")], {encoding:"utf8"});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing-spec.json/);
  } finally { rmSync(directory, {recursive:true, force:true}); }
});

function server() {
  const secrets = new Map();
  const writes = [];
  let revision = 0;
  const request = async (method, path, body) => {
    if (path === "/api/v1/namespaces/tali") return {status:200,body:{metadata:{name:"tali",uid:"namespace-uid"}}};
    const name = method === "POST" ? body.metadata.name : decodeURIComponent(path.split("/").at(-1));
    if (method === "GET") return secrets.has(name) ? {status:200,body:structuredClone(secrets.get(name))} : {status:404,body:{}};
    if (method === "POST" && secrets.has(name)) return {status:409,body:{}};
    if (method === "PATCH" && body.metadata.resourceVersion !== secrets.get(name)?.metadata.resourceVersion) return {status:409,body:{}};
    const value = method === "POST" ? structuredClone(body) : {...structuredClone(secrets.get(name)), data:{...secrets.get(name).data}};
    if (method === "PATCH") value.metadata.annotations = { ...value.metadata.annotations, ...body.metadata.annotations };
    value.data ??= {};
    for (const [key, text] of Object.entries(body.stringData)) value.data[key] = Buffer.from(text).toString("base64");
    delete value.stringData;
    value.metadata.resourceVersion = String(++revision);
    secrets.set(name, value); writes.push({method,name});
    return {status:method === "POST" ? 201 : 200,body:structuredClone(value)};
  };
  const data = name => Object.fromEntries(Object.entries(secrets.get(name).data).map(([k,v]) => [k,Buffer.from(v,"base64").toString()]));
  return {request,secrets,writes,data};
}

test("fresh initialization uses password only for human logins and reruns perform no writes", async () => {
  const s = server(); await bootstrap(s.request, spec);
  const root = s.data(spec.credentialSecret);
  for (const key of humanLoginPasswordKeys) assert.equal(root[key], "password");
  const machineKeys = credentialKeys.filter(key => !humanLoginPasswordKeys.includes(key));
  assert.equal(new Set(machineKeys.map(key => root[key])).size, machineKeys.length);
  for (const key of machineKeys) assert(root[key].length >= 64);
  const independent = generateCredentials(spec);
  for (const key of machineKeys) assert.notEqual(root[key], independent[key], `${key} must not have a deterministic default`);
  const config = parseToml(s.data("relay-control-config")["control.toml"]);
  assert.equal(config.database.url, s.data("relay-litellm-config")["database-url"]);
  assert.equal(new URL(config.database.url).password, s.data("relay-postgresql-config")["postgres-password"]);
  assert.equal(config.runner.token, JSON.parse(s.data("relay-runner-config")["runner.json"]).server.token);
  assert.equal(config.litellm.master_key, s.data("relay-litellm-config")["litellm-master-key"]);
  assert.equal(config.metrics.token, s.data("relay-metrics-config")["metrics-token"]);
  assert.equal(config.memory.routerToken, JSON.parse(s.data("relay-hindsight-config")["hindsight-config.json"]).router.controlToken);
  assert.equal(s.data("relay-example-mcp-auth")["auth-value"], `Username:${root.exampleMcpPassword}`);
  const snapshot = structuredClone([...s.secrets]); const count = s.writes.length;
  await bootstrap(s.request, spec);
  assert.deepEqual([...s.secrets], snapshot); assert.equal(s.writes.length,count);
});

test("local profile keeps account passwords repeatable across fresh installs and machine credentials stable on reruns", async () => {
  const devObjects = render(["-f", "charts/tali-relay/values-dev.yaml", "--set", "keycloak.enabled=true",
    "--set", "keycloak.publicUrl=http://keycloak.localhost:8180", "--set", "exampleMcp.enabled=true"]);
  const devSpec = JSON.parse(devObjects.find(o => o.data?.["spec.json"]).data["spec.json"]);
  assert.equal(devSpec.developmentMode, undefined);
  const first = server(), second = server();
  await bootstrap(first.request, devSpec);
  await bootstrap(second.request, devSpec);
  const initial = first.data(devSpec.credentialSecret), recreated = second.data(devSpec.credentialSecret);
  for (const key of humanLoginPasswordKeys) {
    assert.equal(initial[key], "password", key);
    assert.equal(recreated[key], "password", key);
  }
  for (const key of credentialKeys.filter(key => !humanLoginPasswordKeys.includes(key))) {
    assert(initial[key].length >= 64, key);
    assert.notEqual(initial[key], recreated[key], key);
  }
  assert.equal(parseToml(first.data("relay-control-config")["control.toml"]).auth.local.initial_platform_administrator_password, "password");
  assert.equal(first.data("relay-litellm-config")["litellm-ui-password"], "password");
  assert.equal(first.data("relay-keycloak-config")["keycloak-admin-password"], "password");
  assert.equal(first.data("relay-keycloak-config")["keycloak-test-user-password"], "password");
  assert.equal(first.data("relay-example-mcp-auth")["auth-value"], `Username:${initial.exampleMcpPassword}`);
  assert.equal(new URL(initial.databaseUrl).password, initial.postgresPassword);
  assert.equal(new URL(initial.hindsightDatabaseUrl).password, initial.hindsightDatabasePassword);
  const before = structuredClone([...first.secrets]), writes = first.writes.length;
  await bootstrap(first.request, devSpec);
  assert.deepEqual([...first.secrets], before);
  assert.equal(first.writes.length, writes);
});

for (const profile of [undefined, "random", "local-development"]) {
  test(`existing ${profile ?? "unlabelled"} credentials survive the new default`, async () => {
    const s = server();
    const legacy = generateCredentials(spec);
    for (const key of humanLoginPasswordKeys) legacy[key] = `existing-${key}`;
    // Older development installs used fixed DB/service passwords. Preserve them
    // on upgrade; changing the generation policy must not rotate a live store.
    if (profile === "local-development") {
      for (const key of ["postgresPassword", "hindsightDatabasePassword", "exampleMcpPassword"]) legacy[key] = "password";
    }
    for (const [key, passwordKey] of [["databaseUrl", "postgresPassword"], ["adminUrl", "postgresPassword"], ["hindsightDatabaseUrl", "hindsightDatabasePassword"]]) {
      const url = new URL(legacy[key]); url.password = legacy[passwordKey]; legacy[key] = url.toString();
    }
    await bootstrap(async (method, path, body) => {
      if (method === "POST" && body.metadata.name === spec.credentialSecret) {
        body.stringData = legacy;
        if (profile) body.metadata.annotations["tali.io/credential-profile"] = profile;
        else delete body.metadata.annotations["tali.io/credential-profile"];
      }
      return s.request(method, path, body);
    }, spec);
    const before = structuredClone([...s.secrets]), writes = s.writes.length;
    await bootstrap(s.request, spec);
    assert.deepEqual(s.data(spec.credentialSecret), legacy);
    assert.deepEqual([...s.secrets], before);
    assert.equal(s.writes.length, writes);
  });
}

test("every Helm profile uses the same initial passwords even with retained legacy values", () => {
  for (const profile of ["values.yaml", "values-dev.yaml", "values-uat.yaml", "values-openshift.yaml", "values-airgap.yaml"]) {
    for (const legacyMode of [false, true]) {
      const rendered = render(["-f", `charts/tali-relay/${profile}`, "--set-string", "control.publicUrls[0]=https://relay.example.test",
        "--set", `credentialBootstrap.developmentMode=${legacyMode}`]);
      const configured = JSON.parse(rendered.find(o => o.data?.["spec.json"]).data["spec.json"]);
      assert.equal(configured.developmentMode, undefined);
      const credentials = generateCredentials(configured);
      for (const key of ["initialPlatformAdministratorPassword", "litellmUiPassword", "keycloakAdminPassword", "keycloakTestUserPassword"]) {
        assert.equal(credentials[key], "password", `${profile}/${key}`);
      }
      const independent = generateCredentials(configured);
      for (const key of ["postgresPassword", "hindsightDatabasePassword", "exampleMcpPassword", "authSecret", "runnerToken",
        "litellmMasterKey", "litellmSaltKey", "keycloakClientSecret", "hindsightApiKey", "hindsightRouterToken", "metricsToken"]) {
        assert(credentials[key].length >= 64, `${profile}/${key}`);
        assert.notEqual(credentials[key], independent[key], `${profile}/${key} must be generated independently`);
      }
    }
  }
});

test("configuration upgrades and rollbacks change settings without rotating credentials", async () => {
  const s = server(); await bootstrap(s.request,spec);
  const original = s.data(spec.credentialSecret);
  const next = structuredClone(spec);
  next.outputs.find(o => o.name === "relay-control-config").fields["control.toml"] =
    next.outputs.find(o => o.name === "relay-control-config").fields["control.toml"].replace("admin@tasklattice.local", "operator@example.test");
  await bootstrap(s.request,next);
  assert.deepEqual(s.data(spec.credentialSecret),original);
  assert.equal(parseToml(s.data("relay-control-config")["control.toml"]).auth.local.initial_platform_administrator_email,"operator@example.test");
  await bootstrap(s.request, spec);
  assert.deepEqual(s.data(spec.credentialSecret), original);
  assert.equal(parseToml(s.data("relay-control-config")["control.toml"]).auth.local.initial_platform_administrator_email, "admin@tasklattice.local");
});

test("a partial initialization resumes with the original credential store", async () => {
  const s = server(); let failed = false;
  await assert.rejects(bootstrap(async (...args) => {
    if (args[0] === "POST" && args[2]?.metadata.name === "relay-runner-config") { failed=true; return {status:503,body:{}}; }
    return s.request(...args);
  },spec), /Cannot create/);
  assert(failed); const original = s.data(spec.credentialSecret);
  await bootstrap(s.request,spec); assert.deepEqual(s.data(spec.credentialSecret),original);
});

test("configuration updates retry resource-version conflicts without replacing the store", async () => {
  const s = server(); await bootstrap(s.request, spec);
  const original = s.data(spec.credentialSecret);
  const next = structuredClone(spec);
  next.outputs.find(o => o.name === "relay-control-config").fields["control.toml"] += '\n# updated configuration\n';
  // A meaningful field change survives parsing and forces an output patch.
  next.outputs.find(o => o.name === "relay-control-config").fields["control.toml"] =
    next.outputs.find(o => o.name === "relay-control-config").fields["control.toml"].replace("admin@tasklattice.local", "retry@example.test");
  let conflicts = 0;
  await bootstrap(async (...args) => {
    if (args[0] === "PATCH" && conflicts++ === 0) return {status:409,body:{}};
    return s.request(...args);
  }, next);
  assert.equal(conflicts, 2);
  assert.deepEqual(s.data(spec.credentialSecret), original);
  assert.equal(parseToml(s.data("relay-control-config")["control.toml"]).auth.local.initial_platform_administrator_email, "retry@example.test");
});

test("simultaneous initializations converge on one winning credential store", async () => {
  const s = server(); await Promise.all([bootstrap(s.request,spec),bootstrap(s.request,spec)]);
  assert.equal(s.writes.filter(w => w.name===spec.credentialSecret && w.method==="POST").length,1);
  assert.equal(parseToml(s.data("relay-control-config")["control.toml"]).auth.secret,s.data(spec.credentialSecret).authSecret);
});

test("an initializer finishing during the missing-store check is reused", async () => {
  const s = server(); let raced = false;
  await bootstrap(async (...args) => {
    const result = await s.request(...args);
    if (!raced && args[0] === "GET" && args[1].endsWith(`/secrets/${spec.credentialSecret}`)) {
      raced = true;
      await bootstrap(s.request, spec);
    }
    return result;
  }, spec);
  assert(raced);
  assert.equal(s.writes.length, spec.outputs.length + 1);
});

test("missing, corrupt, and foreign stores cannot reset existing credentials", async () => {
  const s = server(); await bootstrap(s.request,spec);
  const store = s.secrets.get(spec.credentialSecret);
  delete store.data.postgresPassword;
  await assert.rejects(bootstrap(s.request,spec), /incomplete/);
  store.metadata.labels["tali.io/release"]="foreign";
  await assert.rejects(bootstrap(s.request,spec), /foreign/);
  s.secrets.delete(spec.credentialSecret);
  const count = s.writes.length;
  await assert.rejects(bootstrap(s.request,spec), /store is missing/);
  assert.equal(s.writes.length,count);
});

test("managed credentials are immutable and Secrets survive Job deletion by owning only the Namespace", async () => {
  const s = server(); await bootstrap(s.request, spec);
  assert.equal(s.secrets.get(spec.credentialSecret).immutable, true);
  for (const secret of s.secrets.values()) {
    assert.deepEqual(secret.metadata.ownerReferences, [{apiVersion:"v1", kind:"Namespace", name:"tali", uid:"namespace-uid", controller:false, blockOwnerDeletion:false}]);
    assert.equal(secret.metadata.annotations["helm.sh/resource-policy"], "keep");
    assert.equal(secret.metadata.annotations["argocd.argoproj.io/sync-options"], "Prune=false,Delete=false");
    assert(!secret.metadata.annotations["helm.sh/hook"]);
  }
  s.secrets.delete("relay-runner-config");
  await bootstrap(s.request, spec);
  assert.equal(JSON.parse(s.data("relay-runner-config")["runner.json"]).server.token, s.data(spec.credentialSecret).runnerToken);
});

test("external credential replacement cannot silently rotate any component", async () => {
  const s = server(); await bootstrap(s.request, spec);
  const root = s.secrets.get(spec.credentialSecret);
  root.data = Object.fromEntries(Object.entries(generateCredentials(spec)).map(([k,v]) => [k, Buffer.from(v).toString("base64")]));
  const before = structuredClone([...s.secrets]); const writes = s.writes.length;
  await assert.rejects(bootstrap(s.request, {...spec, externalCredentials:true}), /refusing to rotate/);
  assert.deepEqual([...s.secrets], before);
  assert.equal(s.writes.length, writes);
});

test("terminating external stores and inaccessible Namespaces fail before writes", async () => {
  const s = server(); await bootstrap(s.request, spec);
  s.secrets.get(spec.credentialSecret).metadata.deletionTimestamp = "2026-01-01T00:00:00Z";
  const writes = s.writes.length;
  await assert.rejects(bootstrap(s.request, {...spec, externalCredentials:true}), /terminating/);
  assert.equal(s.writes.length, writes);
  await assert.rejects(bootstrap(async () => ({status:403, body:{message:"private server response"}}), spec), /Cannot verify/);
});

test("late output ownership errors are detected before earlier configurations are updated", async () => {
  const s = server(); await bootstrap(s.request, spec);
  s.secrets.get("relay-example-mcp-auth").metadata.ownerReferences[0].uid = "foreign-namespace";
  const next = structuredClone(spec);
  next.outputs[0].fields["control.toml"] = next.outputs[0].fields["control.toml"].replace("admin@tasklattice.local", "new@example.test");
  const before = structuredClone([...s.secrets]); const writes = s.writes.length;
  await assert.rejects(bootstrap(s.request, next), /foreign/);
  assert.deepEqual([...s.secrets], before);
  assert.equal(s.writes.length, writes);
});

test("reentry restores output retention annotations without changing credentials", async () => {
  const s = server(); await bootstrap(s.request, spec);
  const original = s.data("relay-control-config");
  delete s.secrets.get("relay-control-config").metadata.annotations["argocd.argoproj.io/sync-options"];
  await bootstrap(s.request, spec);
  assert.deepEqual(s.data("relay-control-config"), original);
  assert.equal(s.secrets.get("relay-control-config").metadata.annotations["argocd.argoproj.io/sync-options"], "Prune=false,Delete=false");
});

test("a foreign Secret winning a create race is not adopted or patched", async () => {
  const s = server(); let raced = false;
  await assert.rejects(bootstrap(async (...args) => {
    if (!raced && args[0] === "POST" && args[2].metadata.name === "relay-control-config") {
      raced = true;
      const foreign = structuredClone(args[2]); foreign.metadata.labels["tali.io/release"] = "another-release";
      await s.request("POST", args[1], foreign);
      return {status:409, body:{}};
    }
    return s.request(...args);
  }, spec), /foreign/);
  assert(raced);
  assert(!s.writes.some(write => write.method === "PATCH"));
});

test("foreign outputs are rejected and external credential stores are read-only", async () => {
  const s = server(); await bootstrap(s.request,spec);
  s.secrets.get(spec.credentialSecret).metadata.labels={};
  const external = {...spec,externalCredentials:true};
  const count = s.writes.length; await bootstrap(s.request,external); assert.equal(s.writes.length,count);
  s.secrets.get("relay-postgresql-config").metadata.ownerReferences[0].uid="old-namespace";
  await assert.rejects(bootstrap(s.request,external), /foreign/);
});

test("credential stores cannot alias writable output Secrets", async () => {
  assert.throws(() => render(["--set", "credentialBootstrap.existingSecret=relay-control-config"]), /must not name/);
  assert.throws(() => render(["--set", `fullnameOverride=${"a".repeat(62)}`, "--set", "credentialBootstrap.existingSecret=external-store"]), /must be distinct/);
  const s = server();
  await assert.rejects(bootstrap(s.request, {...spec, credentialSecret: spec.outputs[0].name}), /must be distinct/);
  assert.equal(s.writes.length, 0);
});

test("TOML and JSON substitutions escape quotes, backslashes and newlines", () => {
  const credentials=generateCredentials(spec); credentials.authSecret='a"b\\c\nnext';
  const output = renderOutput({fields:{a:'[auth]\nsecret="__TALI_CREDENTIAL_authSecret__"',b:'{"token":"__TALI_CREDENTIAL_authSecret__"}'},formats:{a:"toml",b:"json"}},credentials);
  assert.equal(parseToml(output.a).auth.secret,credentials.authSecret);
  assert.equal(JSON.parse(output.b).token,credentials.authSecret);
});

test("Chart stores references/templates only and rejects removed inline settings", () => {
  const values = parseYaml(readFileSync("charts/tali-relay/values.yaml","utf8"));
  assert.equal(values.secrets, undefined);
  assert(!("password" in values.exampleMcp.auth));
  assert(!objects.some(o => o.kind === "Secret" && o.metadata.name !== "relay-worker-config"));
  for (const setting of ["secrets.postgresPassword=unsafe", "secrets.authSecret=unsafe", "exampleMcp.auth.password=unsafe"]) {
    assert.throws(() => render(["--set-string",setting]), /removed/);
  }
});

test("all component configurations use the bootstrap credential store", () => {
  for (const component of ["control", "worker", "runner", "postgresql", "litellm", "hindsight", "metrics", "keycloak", "exampleMcp"]) {
    assert.throws(() => render(["--set-string", `secrets.existingSecrets.${component}=external`]),
      /component Secrets are generated from one credentialBootstrap store/);
  }
});

test("bootstrap hooks precede workloads, have scoped RBAC and no dependency on generated Secrets", () => {
  const job=objects.find(o => o.kind === "Job" && o.metadata.name === "relay-credential-bootstrap");
  assert.equal(job.metadata.annotations["helm.sh/hook"],"pre-install,pre-upgrade,pre-rollback");
  assert.equal(job.spec.template.spec.securityContext.runAsNonRoot,true);
  assert.equal(job.spec.template.spec.automountServiceAccountToken,true);
  assert.equal(objects.find(o => o.kind === "ServiceAccount" && o.metadata.name === job.metadata.name).automountServiceAccountToken,false);
  assert(job.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem);
  assert(!job.spec.template.spec.volumes.some(v => v.secret));
  const role=objects.find(o => o.kind === "Role" && o.metadata.name===job.metadata.name);
  assert(role.rules.every(r => r.resources.length===1 && r.resources[0]==="secrets" && !r.verbs.includes("delete") && !r.verbs.includes("list")));
  assert(!role.rules.find(r => r.verbs.includes("patch")).resourceNames.includes(spec.credentialSecret));
  const cluster=objects.find(o => o.kind === "ClusterRole" && o.metadata.name.startsWith(job.metadata.name));
  assert.deepEqual(cluster.rules,[{apiGroups:[""],resources:["namespaces"],verbs:["get"],resourceNames:["tali"]}]);
});

test("rendered bootstrap RBAC permits every requested API operation and no root updates", async () => {
  const role = objects.find(o => o.kind === "Role" && o.metadata.name === "relay-credential-bootstrap");
  const cluster = objects.find(o => o.kind === "ClusterRole" && o.metadata.name.startsWith("relay-credential-bootstrap"));
  const s = server();
  const checkedRequest = async (method, path, body) => {
    const parts = path.split("/");
    const namespaceRead = parts.length === 5;
    const rules = namespaceRead ? cluster.rules : role.rules;
    const resource = namespaceRead ? "namespaces" : "secrets";
    const name = method === "POST" ? undefined : decodeURIComponent(parts.at(-1));
    const verb = {GET:"get", POST:"create", PATCH:"patch"}[method];
    assert(rules.some(rule => rule.resources.includes(resource) && rule.verbs.includes(verb)
      && (!rule.resourceNames || rule.resourceNames.includes(name))), `RBAC denied ${verb} ${resource}/${name}`);
    return s.request(method, path, body);
  };
  await bootstrap(checkedRequest, spec);
  const next = structuredClone(spec);
  next.outputs[0].fields["control.toml"] = next.outputs[0].fields["control.toml"].replace("admin@tasklattice.local", "rbac@example.test");
  await bootstrap(checkedRequest, next);
});

test("Kubernetes and OCP bootstrap pods need no fixed UID or SCC grant", () => {
  for (const args of [[], ["--set", "openshift.enabled=true"], ["--set", "openshift.enabled=true", "--set", "global.imageRegistry=image-registry.openshift-image-registry.svc:5000/tali", "--set", "global.imagePullSecrets[0].name=existing-pull"]]) {
    const resources = render(args);
    const pod = resources.find(o => o.kind === "Job" && o.metadata.name === "relay-credential-bootstrap").spec.template.spec;
    assert.equal(pod.securityContext.runAsUser, undefined);
    assert.equal(pod.securityContext.fsGroup, undefined);
    assert.equal(pod.securityContext.seccompProfile.type, "RuntimeDefault");
    assert.deepEqual(pod.containers[0].securityContext.capabilities.drop, ["ALL"]);
    assert.equal(pod.containers[0].securityContext.allowPrivilegeEscalation, false);
    if (args.length > 2) assert.deepEqual(pod.imagePullSecrets, [{name:"existing-pull"}]);
  }
  // An external registry with a similar prefix must not be mistaken for OCP.
  assert.doesNotThrow(() => render(["--set", "openshift.enabled=true", "--set", "global.imageRegistry=image-registry.openshift-image-registry.svc.example.test/team"]));
});

const internalBootstrapArgs = ["--set", "openshift.enabled=true", "--set", "global.imageRegistry=image-registry.openshift-image-registry.svc:5000/control-images"];
const bootstrapJob = resources => resources.find(o => o.kind === "Job" && o.metadata.name === "relay-credential-bootstrap");
const bootstrapPullBinding = resources => resources.find(o => o.kind === "RoleBinding" && o.roleRef.name === "system:image-puller");

test("OCP internal bootstrap automatically prepares authentication before the Job with or without runtime image remapping", () => {
  for (const extra of [[], ["--set", "openshift.runtimeImages.enabled=true"]]) {
    const ocp = render([...internalBootstrapArgs, "--set", "openshift.imageSourceNamespace=runtime-images", ...extra]);
    const job = bootstrapJob(ocp);
    const sa = ocp.find(o => o.kind === "ServiceAccount" && o.metadata.name === job.spec.template.spec.serviceAccountName);
    const pull = bootstrapPullBinding(ocp);
    const secret = sa.metadata.annotations["openshift.io/internal-registry-pull-secret-ref"];
    assert.deepEqual(job.spec.template.spec.imagePullSecrets, [{name:secret}]);
    assert(!ocp.some(o => o.kind === "Secret" && o.metadata.name === secret), "OCP owns token generation and rotation");
    assert.notEqual(sa.metadata.name, job.metadata.name, "do not reuse the legacy recreated hook SA");
    assert.equal(sa.automountServiceAccountToken, false);
    assert.equal(sa.metadata.namespace, "tali");
    assert.equal(sa.metadata.annotations["helm.sh/hook"], "pre-install,pre-upgrade");
    assert.equal(sa.metadata.annotations["helm.sh/hook-delete-policy"], "hook-failed");
    assert.equal(sa.metadata.annotations["helm.sh/resource-policy"], "keep");
    assert.equal(pull.metadata.namespace, "control-images", "use the bootstrap image source, not runtime source");
    assert.deepEqual(pull.subjects, [{kind:"ServiceAccount", name:sa.metadata.name, namespace:"tali"}]);
    assert.equal(pull.roleRef.kind, "ClusterRole");
    assert.equal(pull.metadata.annotations["helm.sh/hook"], "pre-install,pre-upgrade,pre-rollback");
    assert(+sa.metadata.annotations["helm.sh/hook-weight"] < +pull.metadata.annotations["helm.sh/hook-weight"]);
    assert(+pull.metadata.annotations["helm.sh/hook-weight"] < +job.metadata.annotations["helm.sh/hook-weight"]);
    for (const binding of ocp.filter(o => ["RoleBinding", "ClusterRoleBinding"].includes(o.kind) && o.metadata.annotations?.["helm.sh/hook"])) {
      assert.equal(binding.subjects[0].name, sa.metadata.name);
    }
  }
});

test("OCP explicit SA and pull Secrets keep their authentication configuration and receive source pull permission", () => {
  const ocp=render([...internalBootstrapArgs,"--set","credentialBootstrap.serviceAccountName=prepared-bootstrap"]);
  const job=ocp.find(o => o.kind==="Job" && o.metadata.name==="relay-credential-bootstrap");
  assert.equal(job.spec.template.spec.serviceAccountName,"prepared-bootstrap");
  assert(!ocp.some(o => o.kind==="ServiceAccount" && o.metadata.name==="prepared-bootstrap"));
  assert.equal(job.spec.template.spec.imagePullSecrets, undefined);
  assert.equal(bootstrapPullBinding(ocp).subjects[0].name, "prepared-bootstrap");
  const explicit = render([...internalBootstrapArgs, "--set", "global.imagePullSecrets[0].name=site-pull"]);
  assert.deepEqual(bootstrapJob(explicit).spec.template.spec.imagePullSecrets, [{name:"site-pull"}]);
  assert.equal(bootstrapPullBinding(explicit).subjects[0].name, "relay-credential-bootstrap");
  assert(!explicit.some(o => o.metadata.annotations?.["openshift.io/internal-registry-pull-secret-ref"]));
});

test("bootstrap internal registry detection handles cluster DNS, custom routes, global opt-out and namespace validation", () => {
  for (const host of ["image-registry.openshift-image-registry.svc.cluster.local:5000", "registry.apps.example.test"]) {
    const resources = render([...internalBootstrapArgs, "--set", `openshift.imageRegistryHost=${host}`,
      "--set", "images.control.useGlobalRegistry=false", "--set", `images.control.repository=${host}/offline-images/custom-control`, "--set", "images.control.tag=release-1"]);
    assert.equal(bootstrapPullBinding(resources).metadata.namespace, "offline-images");
    assert.equal(bootstrapJob(resources).spec.template.spec.containers[0].image, `${host}/offline-images/custom-control:release-1`);
  }
  for (const namespace of ["bad.namespace", "Uppercase", "a".repeat(64)]) {
    assert.throws(() => render([...internalBootstrapArgs, "--set", `global.imageRegistry=image-registry.openshift-image-registry.svc:5000/${namespace}`]), /source namespace must be a DNS label/);
  }
  assert.throws(() => render([...internalBootstrapArgs, "--set", "images.control.repository=nested/control"]), /must have the form/);
  for (const args of [[], [...internalBootstrapArgs, "--set", "openshift.enabled=false"],
    [...internalBootstrapArgs, "--set", "images.control.useGlobalRegistry=false", "--set", "images.control.repository=private.example.test/team/control"],
    [...internalBootstrapArgs, "--set", "global.imageRegistry=image-registry.openshift-image-registry.svc.example.test/team"]]) {
    const resources = render(args);
    assert.equal(bootstrapPullBinding(resources), undefined);
    assert.equal(bootstrapJob(resources).spec.template.spec.serviceAccountName, "relay-credential-bootstrap");
    assert.equal(bootstrapJob(resources).spec.template.spec.imagePullSecrets, undefined);
  }
});

test("OCP bootstrap identities stay bounded and source bindings are distinct across release namespaces", () => {
  const a = render(internalBootstrapArgs);
  const b = render([...internalBootstrapArgs, "--namespace", "other-control"]);
  assert.notEqual(bootstrapPullBinding(a).metadata.name, bootstrapPullBinding(b).metadata.name);
  const long = render([...internalBootstrapArgs, "--set", `fullnameOverride=${"x".repeat(35)}`]);
  const sa = long.find(o => o.kind === "ServiceAccount" && o.metadata.annotations?.["openshift.io/internal-registry-pull-secret-ref"]);
  assert(sa.metadata.name.length <= 63);
  assert(sa.metadata.annotations["openshift.io/internal-registry-pull-secret-ref"].length <= 63);
});

test("server rendering reuses the OCP SA without recreating it, and rejects foreign or terminating identities", async () => {
  const initial = render(internalBootstrapArgs);
  const name = bootstrapJob(initial).spec.template.spec.serviceAccountName;
  let existing = {...structuredClone(initial.find(o => o.kind === "ServiceAccount" && o.metadata.name === name))};
  existing.metadata.uid = "preserved-sa-uid";
  let forbidden = false;
  const requests = [];
  const api = createServer((req, res) => {
    const path = req.url.split("?")[0]; requests.push(`${req.method} ${path}`);
    res.setHeader("Content-Type", "application/json");
    if (forbidden && path.endsWith(`/serviceaccounts/${name}`)) {
      res.statusCode = 403;
      res.end(JSON.stringify({kind:"Status", apiVersion:"v1", status:"Failure", reason:"Forbidden", message:"serviceaccount lookup forbidden", code:403}));
      return;
    }
    const bodies = {
      "/version": {major:"1", minor:"29", gitVersion:"v1.29.0"},
      "/api": {kind:"APIVersions", apiVersion:"v1", versions:["v1"]},
      "/apis": {kind:"APIGroupList", apiVersion:"v1", groups:[]},
      "/api/v1": {kind:"APIResourceList", apiVersion:"v1", groupVersion:"v1", resources:[{name:"serviceaccounts", singularName:"serviceaccount", namespaced:true, kind:"ServiceAccount", verbs:["get"]}]},
      [`/api/v1/namespaces/tali/serviceaccounts/${name}`]: existing,
    };
    const body = bodies[path];
    if (!body) res.statusCode = 404;
    res.end(JSON.stringify(body ?? {kind:"Status", apiVersion:"v1", status:"Failure", reason:"NotFound", code:404}));
  });
  const directory = mkdtempSync(join(tmpdir(), "relay-bootstrap-lookup-"));
  try {
    await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
    const config = join(directory, "kubeconfig.json");
    writeFileSync(config, JSON.stringify({apiVersion:"v1", kind:"Config", clusters:[{name:"test", cluster:{server:`http://127.0.0.1:${api.address().port}`}}], contexts:[{name:"test", context:{cluster:"test", namespace:"tali", user:"test"}}], "current-context":"test", users:[{name:"test", user:{}}]}), {mode:0o600});
    // Exercise the real bootstrap template with server-side lookup, without unrelated
    // business workloads that would require a complete Kubernetes discovery server.
    const chart = join(directory, "chart");
    mkdirSync(join(chart, "templates"), {recursive:true});
    writeFileSync(join(chart, "Chart.yaml"), "apiVersion: v2\nname: bootstrap-lookup-test\nversion: 0.0.0\nappVersion: dev\n");
    cpSync("charts/tali-relay/values.yaml", join(chart, "values.yaml"));
    cpSync("charts/tali-relay/files", join(chart, "files"), {recursive:true});
    for (const file of ["_helpers.tpl", "_bootstrap.tpl", "credential-bootstrap.yaml"]) cpSync(`charts/tali-relay/templates/${file}`, join(chart, "templates", file));
    const args = ["template", "relay", chart, "--namespace", "tali", "--set", "fullnameOverride=relay", "--kube-version", "1.29.0", "--dry-run=server", "--disable-openapi-validation", "--kubeconfig", config, ...internalBootstrapArgs];
    const run = () => promisify(execFile)("helm", args, {maxBuffer:8*1024*1024});
    const reused = parseAllDocuments((await run()).stdout).map(d => d.toJSON()).filter(Boolean);
    assert(!reused.some(o => o.kind === "ServiceAccount" && o.metadata.name === name));
    assert.equal(bootstrapJob(reused).spec.template.spec.serviceAccountName, name);
    assert.deepEqual(bootstrapJob(reused).spec.template.spec.imagePullSecrets, bootstrapJob(initial).spec.template.spec.imagePullSecrets);
    existing.metadata.deletionTimestamp = "2026-01-01T00:00:00Z";
    await assert.rejects(run(), /refusing to replace/);
    delete existing.metadata.deletionTimestamp;
    existing.metadata.annotations["meta.helm.sh/release-name"] = "foreign";
    await assert.rejects(run(), /refusing to replace/);
    existing.metadata.annotations["meta.helm.sh/release-name"] = "relay";
    existing.metadata.annotations["openshift.io/internal-registry-pull-secret-ref"] = "unexpected";
    await assert.rejects(run(), /refusing to replace/);
    existing = undefined;
    const recovered = parseAllDocuments((await run()).stdout).map(d => d.toJSON()).filter(Boolean);
    assert(recovered.some(o => o.kind === "ServiceAccount" && o.metadata.name === name), "retry after missing SA creates it");
    forbidden = true;
    await assert.rejects(run(), /forbidden/i, "inaccessible SA must not be mistaken for absent");
    assert(requests.some(r => r.endsWith(`/serviceaccounts/${name}`)));
    assert(requests.every(r => r.startsWith("GET ")), "Helm rendering must never mutate the cluster");
  } finally {
    await new Promise(resolve => api.close(resolve));
    rmSync(directory, {recursive:true, force:true});
  }
});

test("local login reads generated credentials without a fixed fallback or logging them", () => {
  const sample="test-generated-credential";
  const result=execFileSync("bash",["-c",`
    set -euo pipefail
    source scripts/lib/dev-control-api.sh
    control_origin=https://relay.example.test
    cookie_file=/tmp/not-used-by-mock
    kubectl() { printf '%s' "$MOCK_SECRETS"; }
    curl() {
      local body; body=$(cat)
      [[ $(jq -r .password <<< "$body") == "$EXPECTED_CREDENTIAL" ]] || return 1
      printf '{}'
    }
    dev_control_login
  `],{encoding:"utf8",env:{...process.env,CONTROL_LOCAL_ADMIN_PASSWORD:"",
    MOCK_SECRETS:JSON.stringify({items:[{data:{initialPlatformAdministratorPassword:Buffer.from(sample).toString("base64")}}]}),
    EXPECTED_CREDENTIAL:sample}});
  assert.equal(result,"");
});

test("local login accepts an explicit current credential without reading Kubernetes", () => {
  const result=execFileSync("bash",["-c",`
    set -euo pipefail
    source scripts/lib/dev-control-api.sh
    control_origin=https://relay.example.test
    cookie_file=/tmp/not-used-by-mock
    kubectl() { echo 'unexpected Kubernetes call' >&2; return 1; }
    curl() { jq -e '.password=="explicit-test-credential"' >/dev/null || return 1; printf '{}'; }
    dev_control_login
  `],{encoding:"utf8",env:{...process.env,CONTROL_LOCAL_ADMIN_PASSWORD:"explicit-test-credential"}});
  assert.equal(result,"");
});

test("OCP image migration and rollback update Runner with Worker without rotating credentials", async () => {
  const s = server();
  const baselineResources = render(["--set", "openshift.enabled=true"]);
  const migratedResources = render(["--set", "openshift.enabled=true", "--set", "openshift.runtimeImages.enabled=true"]);
  const bootstrapSpec = resources => JSON.parse(resources.find(r => r.data?.["spec.json"]).data["spec.json"]);
  const baselineSpec = bootstrapSpec(baselineResources);
  await bootstrap(s.request, baselineSpec);
  const originalCredentials = s.data(baselineSpec.credentialSecret);
  const originalRunner = JSON.parse(s.data("relay-runner-config")["runner.json"]);
  await bootstrap(s.request, bootstrapSpec(migratedResources));
  const worker = parseToml(migratedResources.find(r => r.stringData?.["worker.toml"]).stringData["worker.toml"]).worker;
  const migratedRunner = JSON.parse(s.data("relay-runner-config")["runner.json"]);
  assert.deepEqual(Object.values(migratedRunner.openshell.sandbox.images).sort(), [...worker.project_openshell.sandboxImages].sort());
  for (const image of worker.project_openshell.sandboxImages) assert.match(image, /^image-registry\.openshift-image-registry\.svc:5000\/tali\//);
  assert.equal(migratedRunner.server.token, originalRunner.server.token);
  assert.deepEqual(s.data(baselineSpec.credentialSecret), originalCredentials);
  await bootstrap(s.request, baselineSpec);
  assert.deepEqual(JSON.parse(s.data("relay-runner-config")["runner.json"]), originalRunner);
  assert.deepEqual(s.data(baselineSpec.credentialSecret), originalCredentials);
});
