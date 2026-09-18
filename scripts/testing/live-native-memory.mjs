#!/usr/bin/env node
// Isolated Kubernetes acceptance for the real Relay Runner and all three images.
// No embedding provider is installed. The local HTTP fixture rejects embeddings.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "yaml";

const context = process.env.KUBE_CONTEXT ?? "orbstack";
const namespace = `tali-native-${Date.now()}`;
const runnerImage = "ghcr.io/tasklattice/tali-openshell-runner:dev";
const token = "native-memory-acceptance-local-token";
const results = [];
const k = (...args) => execFileSync("kubectl", ["--context", context, "-n", namespace, ...args],
  { encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
const helm = (...args) => execFileSync("helm", ["--kube-context", context, "-n", namespace, ...args],
  { encoding: "utf8", timeout: 360_000 });
const apply = (object) => execFileSync("kubectl", ["--context", context, "-n", namespace, "apply", "-f", "-"],
  { input: JSON.stringify(object), encoding: "utf8" });
const cli = (...args) => k("exec", "native-runner", "--", "openshell",
  "--gateway-endpoint", `http://${namespace}-openshell:8080`, "--workspace", "default", ...args);
const shell = (name, command) => cli("sandbox", "exec", "--name", name, "--timeout", "90", "--", "bash", "-lc", command);
function request(path, method = "GET", payload) {
  const code = `const r=await fetch(process.argv[1],{method:process.argv[2],headers:{authorization:process.argv[3],"content-type":"application/json"},...(process.argv[4]?{body:process.argv[4]}:{})}); const t=await r.text(); if(!r.ok)throw Error(t); console.log(t);`;
  return JSON.parse(k("exec", "native-runner", "--", "node", "--input-type=module", "-e", code,
    `http://127.0.0.1:9090${path}`, method, `Bearer ${token}`, payload ? JSON.stringify(payload) : ""));
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fixtures = String.raw`
const http=require("node:http"); let embeddings=0, completions=0;
http.createServer(async(req,res)=>{
  let raw=""; for await(const c of req)raw+=c;
  const body=raw?JSON.parse(raw):{};
  res.setHeader("content-type","application/json");
  if(req.url.includes("embeddings")){embeddings++;res.statusCode=400;res.end(JSON.stringify({error:"No embedding model is configured"}));return;}
  if(req.url==="/stats"){res.end(JSON.stringify({embeddings,completions}));return;}
  if(req.url.endsWith("/models")){res.end(JSON.stringify({object:"list",data:[{id:"native-test-chat",object:"model"}]}));return;}
  if(req.url.endsWith("/chat/completions")){
    completions++;
    const message={role:"assistant",content:"NATIVE_MEMORY_READY"};
    if(body.stream){res.setHeader("content-type","text/event-stream");res.end('data: '+JSON.stringify({id:"chatcmpl-native",object:"chat.completion.chunk",created:1,model:body.model,choices:[{index:0,delta:message,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:"chatcmpl-native",object:"chat.completion.chunk",created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:"stop"}]})+'\n\ndata: [DONE]\n\n');return;}
    res.end(JSON.stringify({id:"chatcmpl-native",object:"chat.completion",created:1,model:body.model,choices:[{index:0,message,finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));return;
  }
  res.end(JSON.stringify({ok:true}));
}).listen(8080,"0.0.0.0");`;

// Reuse the cluster owner's controller; never install a competing controller.
const sandboxCrd = JSON.parse(k("get", "crd", "sandboxes.agents.x-k8s.io", "-o", "json"));
assert(sandboxCrd.spec.versions.some((version) => version.name === "v1beta1" && version.served),
  "Install Agent Sandbox v1.0.2 first: npm run helm:deploy:agent-sandbox");
k("create", "namespace", namespace);
let passed = false;
try {
  console.log(`[native-memory] Installing test Gateway in ${namespace}`);
  helm("upgrade", "--install", namespace, ".helm-dependencies/openshell",
    "--set", "image.tag=0.0.106", "--set", "supervisor.image.tag=0.0.106",
    "--set", "supervisor.sideloadMethod=init-container",
    "--set", "server.disableTls=true", "--set", "server.auth.allowUnauthenticatedUsers=true",
    "--set", "server.telemetryEnabled=false", "--set", "server.sandboxImagePullPolicy=IfNotPresent",
    "--set", "server.workspaceDefaultStorageSize=1Gi", "--set", "service.type=ClusterIP", "--wait", "--timeout", "5m");
  apply({ apiVersion: "v1", kind: "Pod", metadata: { name: "native-model", labels: { app: "native-model" } },
    spec: { containers: [{ name: "model", image: runnerImage, imagePullPolicy: "IfNotPresent",
      command: ["node", "-e", fixtures] }] } });
  apply({ apiVersion: "v1", kind: "Service", metadata: { name: "native-model" },
    spec: { selector: { app: "native-model" }, ports: [{ port: 8080, targetPort: 8080 }] } });
  apply({ apiVersion: "v1", kind: "Secret", metadata: { name: "native-runner-config" },
    stringData: { "runner.json": JSON.stringify({ schemaVersion: 1,
      server: { token, mode: "openshell-kubernetes" },
      openshell: { gatewayEndpoint: `http://${namespace}-openshell:8080`,
        sandbox: { cpu: "2", memory: "4Gi" }, startTimeoutMs: 300000 } }) } });
  apply({ apiVersion: "v1", kind: "Pod", metadata: { name: "native-runner" },
    spec: { volumes: [{ name: "config", secret: { secretName: "native-runner-config" } }],
      containers: [{ name: "runner", image: runnerImage, imagePullPolicy: "IfNotPresent",
        env: [{ name: "TALI_RUNNER_CONFIG", value: "/etc/tali-runner/runner.json" }],
        volumeMounts: [{ name: "config", mountPath: "/etc/tali-runner", readOnly: true }],
        readinessProbe: { httpGet: { path: "/health", port: 9090 }, initialDelaySeconds: 2 } }] } });
  k("wait", "pod/native-model", "pod/native-runner", "--for=condition=Ready", "--timeout=120s");
  const policy = parse(readFileSync("apps/control/server/runtime-policies/runtime-policy-catalog.yaml", "utf8")).basePolicy;
  const endpoint = `http://native-model.${namespace}.svc.cluster.local:8080`;
  for (const platform of ["hermes", "openclaw", "deepagents"]) {
    const name = `native-${platform}`;
    console.log(`[native-memory] Creating ${platform} with no embedding model or external memory`);
    request("/v1/sandboxes", "POST", {
      name, agentPlatform: platform, providerName: "Native acceptance", model: "native-test-chat",
      inferenceEndpoint: `${endpoint}/v1`, apiKey: "synthetic-native-memory-test-key",
      instanceId: randomUUID(), systemPrompt: "Use your native text memory for preferences. Answer clearly.",
      policyYaml: stringify({ ...policy, network_policies: {} }),
      memory: { mode: "native", citations: "auto" }, durableMemoryEnabled: false,
      runTelemetry: { endpoint: `${endpoint}/telemetry`, token: "native-memory-telemetry-test-token-32" },
    });
    let state;
    let stage;
    const deadline = Date.now() + 480_000;
    while (Date.now() < deadline) {
      state = request(`/v1/sandboxes/${name}?agentPlatform=${platform}`);
      if (state.provisioningStage !== stage) {
        stage = state.provisioningStage;
        console.log(`[native-memory] ${platform}: ${stage ?? state.phase}`);
      }
      if (state.phase === "READY") break;
      if (state.phase === "FAILED") throw Error(JSON.stringify(state));
      await delay(3000);
    }
    assert.equal(state.phase, "READY", JSON.stringify(state));
    const marker = `native-memory-${platform}-${Date.now()}`;
    const path = platform === "hermes" ? "/sandbox/.hermes/memories/MEMORY.md"
      : platform === "openclaw" ? "/sandbox/.openclaw/workspace/MEMORY.md"
        : "/sandbox/.deepagents/agent/AGENTS.md";
    if (platform === "hermes") {
      shell(name, `/opt/hermes/.venv/bin/python3 -c 'import yaml; c=yaml.safe_load(open("/sandbox/.hermes/config.yaml")); assert c["memory"]["memory_enabled"] and not c["memory"].get("provider"); from tools.memory_tool import MemoryStore; s=MemoryStore(); s.load_from_disk(); print(s.add("memory", "${marker}"))'`);
    } else {
      shell(name, `printf '\n${marker}\n' >> ${path}`);
      if (platform === "openclaw") shell(name, `node -e 'const c=require("/sandbox/.openclaw/openclaw.json"); if(c.agents.defaults.memorySearch.enabled!==false)process.exit(1)'`);
    }
    assert(shell(name, `cat ${path}`).includes(marker));
    const chat = platform === "hermes"
      ? 'hermes chat -q "Reply with NATIVE_MEMORY_READY."'
      : platform === "openclaw"
        ? 'openclaw agent --agent main --session-id native-acceptance --message "Reply with NATIVE_MEMORY_READY." --json'
        : 'dcode -n "Reply with NATIVE_MEMORY_READY." --quiet --no-stream --max-turns 2';
    assert(shell(name, chat).includes("NATIVE_MEMORY_READY"), `${platform} chat failed`);
    const podName = `default--${name}`;
    const pvcName = `workspace-${podName}`;
    const beforePod = k("get", "pod", podName, "-o", "jsonpath={.metadata.uid}");
    const beforePvc = k("get", "pvc", pvcName, "-o", "jsonpath={.metadata.uid}");
    cli("sandbox", "stop", name);
    k("wait", `pod/${podName}`, "--for=delete", "--timeout=120s");
    cli("sandbox", "start", name);
    k("wait", `sandbox/${podName}`, "--for=condition=Ready", "--timeout=120s");
    assert.notEqual(k("get", "pod", podName, "-o", "jsonpath={.metadata.uid}"), beforePod);
    assert.equal(k("get", "pvc", pvcName, "-o", "jsonpath={.metadata.uid}"), beforePvc);
    assert(shell(name, `cat ${path}`).includes(marker));
    request(`/v1/sandboxes/${name}?agentPlatform=${platform}`, "DELETE");
    k("wait", `sandbox/${podName}`, `pod/${podName}`, `pvc/${pvcName}`, "--for=delete", "--timeout=120s");
    results.push({ platform, creation: "READY", chat: "PASS (local model fixture)", nativeMemory: "persisted across stop/start", deletion: "PASS" });
    console.log(`[native-memory] PASS ${platform}`);
  }
  const stats = JSON.parse(k("exec", "native-runner", "--", "node", "-e",
    `fetch("${endpoint}/stats").then(r=>r.text()).then(console.log)`));
  assert.equal(stats.embeddings, 0);
  assert(stats.completions >= 3);
  passed = true;
  console.log(JSON.stringify({ result: "PASS", context, version: "v0.0.123", embeddingRequests: 0, completionRequests: stats.completions, results }, null, 2));
} finally {
  if (!passed) console.error(`Inspect the failed test namespace: ${namespace}`);
  if (passed || process.env.TALI_KEEP_FAILED_TEST !== "1") {
    try { helm("uninstall", namespace); } catch { /* Namespace owns the rest. */ }
    k("delete", "namespace", namespace, "--wait=false");
  }
}
