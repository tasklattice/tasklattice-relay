#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parse as parseToml } from "smol-toml";
import { parseEnv } from "node:util";
import { RelayClient, eventually, exchangeDashboardSession, runHermesDashboardTurn,
  completedToolEvents, waitForInstanceModelAttribution } from "./live-hermes-e2e-lib.mjs";

assert.equal(process.env.TALI_LIVE_E2E, "1");
const namespace = "relay-initjob-test";
const release = "tali-relay";
const oldProject = "tp-3nrdwhtflu62o";
const oldAgent = "ti-2vw4mpoyh2ixh";
const file = "output/orbstack-upgrade-acceptance.json";
const privateDirectory = "/tmp/relay-orbstack-upgrade-private";
const k = (args, ns = namespace) => execFileSync("kubectl", ["--context", "orbstack", "-n", ns, ...args],
  { encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
const read = (kind, name, ns) => JSON.parse(k(["get", kind, name, "-o", "json"], ns));
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const credential = read("secret", `${release}-credentials`);
const password = Buffer.from(credential.data.initialPlatformAdministratorPassword, "base64").toString();
const imageReplacements = {
  "ghcr.io/tasklattice/tali-control:dev": "docker.io/library/relay-review-control:local",
  "ghcr.io/tasklattice/tali-openshell-runner:dev": "docker.io/library/relay-review-runner:local",
  "ghcr.io/tasklattice/tali-expert-agent-runtime:dev": "docker.io/library/relay-review-expert:local",
  "ghcr.io/tasklattice/demo-test:dev": "docker.io/library/relay-review-demo:local",
};
const client = new RelayClient("http://localhost:38180");
const save = () => writeFileSync(file, JSON.stringify(evidence, null, 2) + "\n");
let evidence = process.argv[2] === "baseline" ? { startedAt: new Date().toISOString(), published: false } : JSON.parse(readFileSync(file));
const projectContext = id => client.request("/api/v1/access-context", { method: "PUT", body: JSON.stringify({ level: "project", resourceId: id, roleId: "ROLE_PROJECT_ADMIN" }) });
const platformContext = () => client.request("/api/v1/access-context", { method: "PUT", body: JSON.stringify({ level: "platform", resourceId: null, roleId: "ROLE_PLATFORM_ADMIN" }) });
const call = (id, path, body, method = "POST") => client.project(id, path, { method, body: JSON.stringify(body) });
const items = value => Array.isArray(value) ? value : value.data ?? [];
async function snapshot() {
  const secrets = JSON.parse(k(["get", "secrets", "-o", "json"])).items
    .filter(s => s.metadata.name.startsWith(`${release}-`) && !s.metadata.name.includes("token"));
  const pod = read("pod", `${oldProject}--${oldAgent}`, oldProject);
  const pvc = read("pvc", `workspace-${oldProject}--${oldAgent}`, oldProject);
  const projects = items(await client.request("/api/v1/projects"));
  const namespaces = Object.fromEntries(projects.map(p => [p.id, read("namespace", p.id).metadata.uid]));
  return {
    secrets: Object.fromEntries(secrets.map(s => [s.metadata.name, { uid: s.metadata.uid, dataDigest: digest(Object.entries(s.data).sort()) }])),
    projects: projects.map(p => ({ id: p.id, name: p.name })), namespaces,
    agent: { id: oldAgent, projectId: oldProject, podUid: pod.metadata.uid, pvcUid: pvc.metadata.uid,
      phase: pod.status.phase, restartCounts: pod.status.containerStatuses.map(c => c.restartCount),
      imageIds: pod.status.containerStatuses.map(c => c.imageID) },
  };
}
async function existingChat() {
  await projectContext(oldProject);
  const details = await client.project(oldProject, `/instances/${oldAgent}`);
  const agent = details.instance ?? details;
  assert.equal(agent.status, "READY");
  const interaction = await client.project(oldProject, `/instances/${oldAgent}/interaction`);
  const dashboard = await exchangeDashboardSession(interaction.httpEndpoint.url);
  const marker = `UPGRADE-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  const turn = await runHermesDashboardTurn({ ...dashboard, timeoutMs: 240000, responseIncludes: [marker, "378"],
    prompt: `Call the connected MCP calculate_sum tool with left=137 and right=241. Then call MCP echo_message with message=${marker}. Use both real tools; do not simulate. Report both returned values. If unavailable, respond MCP_UNAVAILABLE and stop.` });
  for (const suffix of ["calculate_sum", "echo_message"]) {
    assert(completedToolEvents(turn.events).some(e => e.payload?.name?.endsWith(suffix) && !e.payload.result?.isError));
  }
  const routing = items(await client.project(oldProject, "/model-routings")).find(r => r.name === "OrbStack acceptance DeepSeek");
  assert(routing);
  evidence.existingAgentChat = { result: "PASS", tools: turn.tools, response: turn.response,
    attribution: await waitForInstanceModelAttribution({ instance: agent, routing, startedAt,
      projectRequest: (path, init) => client.project(oldProject, path, init), timeoutMs: 180000 }) };
  save(); console.log("PASS: existing Agent real DeepSeek conversation and authenticated MCP tools.");
}
try {
  await client.login("admin", password);
  if (process.argv[2] === "baseline") {
    evidence.before = await snapshot();
    mkdirSync(privateDirectory, { recursive: true, mode: 0o700 }); chmodSync(privateDirectory, 0o700);
    writeFileSync(`${privateDirectory}/component-secrets.json`, JSON.stringify(Object.fromEntries(
      Object.keys(evidence.before.secrets).map(name => [name, read("secret", name).data]))), { mode: 0o600 });
    writeFileSync(`${privateDirectory}/helm-values.json`, execFileSync("helm", ["--kube-context", "orbstack", "-n", namespace, "get", "values", release, "-o", "json"]), { mode: 0o600 });
    const dump = k(["exec", `${release}-postgresql-0`, "--", "pg_dumpall", "-U", "litellm"]);
    writeFileSync(`${privateDirectory}/postgres-before.sql.gz`, gzipSync(dump), { mode: 0o600 });
    evidence.backup = { directory: privateDirectory, createdAt: new Date().toISOString() };
    save(); console.log(`PASS: pre-upgrade login, ${evidence.before.projects.length} Projects, Secret/Agent fingerprints and private database backup.`);
  } else if (process.argv[2] === "verify") {
    const after = await snapshot();
    const beforeSecrets = JSON.parse(readFileSync(`${privateDirectory}/component-secrets.json`));
    for (const [name, before] of Object.entries(evidence.before.secrets)) {
      assert.equal(after.secrets[name].uid, before.uid, `Secret replaced: ${name}`);
      if (after.secrets[name].dataDigest === before.dataDigest) continue;
      assert.notEqual(name, `${release}-credentials`, "Credential source must not change");
      const actual = read("secret", name).data;
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(beforeSecrets[name]).sort());
      for (const [key, encoded] of Object.entries(beforeSecrets[name])) {
        let expected = Buffer.from(encoded, "base64").toString();
        for (const [oldImage, newImage] of Object.entries(imageReplacements)) expected = expected.replaceAll(oldImage, newImage);
        if (name === `${release}-worker-config` && key === "worker.toml") {
          const wanted = parseToml(expected);
          for (const section of ["project_runtime_bridge", "expert_agent_runtime"]) wanted.worker[section].imagePullPolicy = "Never";
          assert(digest(parseToml(Buffer.from(actual[key], "base64").toString())) === digest(wanted), `Unexpected Worker configuration change`);
        } else assert(Buffer.from(actual[key], "base64").toString() === expected, `Unexpected configuration/credential change in ${name}/${key}`);
      }
    }
    for (const before of evidence.before.projects) assert(after.projects.some(p => p.id === before.id && p.name === before.name));
    for (const [name, uid] of Object.entries(evidence.before.namespaces)) assert.equal(after.namespaces[name], uid);
    assert.deepEqual(after.agent, evidence.before.agent, "Existing Agent Pod/PVC/image or restart count changed");
    evidence.existingTenantReadiness = {};
    for (const project of evidence.before.projects) {
      await projectContext(project.id);
      const status = await client.project(project.id, "/initialization");
      assert.equal(status.status, "ready", `Existing tenant is not ready: ${project.id}`);
      evidence.existingTenantReadiness[project.id] = status.status;
    }
    evidence.after = after; evidence.administratorLogin = "PASS with original password"; save();
    if (evidence.existingAgentChat && evidence.newAgent?.result === "PASS") {
      evidence.runTelemetry = {};
      for (const [projectId, agentId] of [[oldProject, oldAgent], [evidence.newProject.id, evidence.newAgent.agentId]]) {
        await projectContext(projectId);
        evidence.runTelemetry[agentId] = await eventually(async () => {
          const overview = await client.project(projectId, "/overview");
          const activity = overview.agentActivity.find(item => item.agentId === agentId);
          return activity?.runs > 0 && activity.successRate === 1 ? activity : undefined;
        }, { description: "successful Agent run telemetry", timeoutMs: 60000, intervalMs: 2000 });
      }
      assert(evidence.platformSandboxSettingsRestored);
      evidence.result = "PASS"; evidence.completedAt = new Date().toISOString();
    }
    console.log("PASS: original administrator password, Secrets, tenants, and existing Agent Pod/PVC/image/restart counts preserved.");
  } else if (process.argv[2] === "old-chat") {
    await existingChat();
  } else if (process.argv[2] === "new-project") {
    await client.request("/api/v1/access-context", { method: "PUT", body: JSON.stringify({
      level: "department", resourceId: "dep1", roleId: "ROLE_DEPARTMENT_ADMIN",
    }) });
    if (!evidence.newProject) {
      evidence.newProject = await client.request("/api/v1/projects", { method: "POST", body: JSON.stringify({ departmentId: "dep1", name: "Upgrade acceptance 20261023", invitations: [] }) });
      save();
    }
    await projectContext(evidence.newProject.id);
    evidence.newProject.initialization = await eventually(async () => {
      const status = await client.project(evidence.newProject.id, "/initialization");
      return status.status === "ready" ? status : undefined;
    }, { description: "new Project namespace and Gateway initialization", timeoutMs: 600000, intervalMs: 3000 });
    evidence.newProject.namespaceUid = read("namespace", evidence.newProject.id).metadata.uid;
    save(); console.log(`PASS: new Project ${evidence.newProject.id} initialized with its own namespace.`);
  } else if (process.argv[2] === "new-chat") {
    assert(evidence.newProject?.id);
    await platformContext();
    const settings = await client.request("/api/v1/platform/settings");
    const original = Object.fromEntries(["runtimeImages", "sandbox", "runtimePolicy", "enabledProviderKinds"].map(key => [key, settings[key]]));
    writeFileSync(`${privateDirectory}/platform-settings-before.json`, JSON.stringify(original), { mode: 0o600 });
    const key = parseEnv(readFileSync(".env", "utf8")).DEEPSEEK_API_KEY;
    assert(key, "Local DeepSeek credential is unavailable");
    try {
      await client.request("/api/v1/platform/settings", { method: "PUT", body: JSON.stringify({ ...original, sandbox: { cpu: "500m", memory: "1Gi" } }) });
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["scripts/testing/live-hermes-chat-tools.mjs"], { stdio: "inherit", env: {
          ...process.env, TALI_BASE_URL: client.baseUrl.href, TALI_LIVE_E2E_PROJECT_ID: evidence.newProject.id,
          TALI_VALIDATION_USERNAME: "admin", TALI_VALIDATION_PASSWORD: password, DEEPSEEK_API_KEY: key,
          TALI_LIVE_MODEL_ID: "deepseek-flash", TALI_LIVE_EVIDENCE_PATH: "output/orbstack-upgrade-new-agent.json",
        } });
        child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(Error(`New Project Agent acceptance exited ${code}`)));
      });
      evidence.newAgent = JSON.parse(readFileSync("output/orbstack-upgrade-new-agent.json"));
      save();
    } finally {
      await client.request("/api/v1/platform/settings", { method: "PUT", body: JSON.stringify(original) });
      const restored = await client.request("/api/v1/platform/settings");
      assert.deepEqual(restored.sandbox, original.sandbox);
      evidence.platformSandboxSettingsRestored = true; save();
    }
    console.log("PASS: new tenant real DeepSeek chat/tools and platform defaults restored.");
  } else throw Error("Expected baseline, verify, old-chat, new-project or new-chat");
  delete evidence.lastFailure;
  save();
} catch (error) {
  evidence.lastFailure = { phase: process.argv[2], message: error.message.replaceAll(password, "[redacted]") };
  save(); console.error(evidence.lastFailure.message); process.exitCode = 1;
}
