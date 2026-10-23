#!/usr/bin/env node
// Exercise the shipped script, TLS API transport and mount layout without a cluster.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";

const run = (command, args, options = {}) => execFileSync(command, args,
  { encoding: "utf8", timeout: 300000, ...options });
const directory = mkdtempSync(join(tmpdir(), "relay-credential-test-"));
try {
  chmodSync(directory, 0o755);
  for (const name of ["bootstrap", "serviceaccount"]) mkdirSync(join(directory, name), { mode: 0o755 });
  const objects = parseAllDocuments(run("helm", ["template", "relay", "charts/tali-relay", "--namespace", "tali",
    "--kube-version", "1.29.0"])).map(document => document.toJSON());
  const config = objects.find(object => object?.data?.["bootstrap-secrets.mjs"]);
  mkdirSync(join(directory, "bootstrap/..revision"), { mode: 0o755 });
  symlinkSync("..revision", join(directory, "bootstrap/..data"));
  for (const [name, value] of Object.entries(config.data)) {
    writeFileSync(join(directory, "bootstrap/..revision", name), value, { mode: 0o644 });
    symlinkSync(`..data/${name}`, join(directory, "bootstrap", name));
  }
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(directory, "server.key"),
    "-out", join(directory, "serviceaccount/ca.crt"), "-subj", "/CN=127.0.0.1", "-days", "1",
    "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  // Ephemeral test-only key and token; neither can access an actual cluster.
  chmodSync(join(directory, "server.key"), 0o644);
  writeFileSync(join(directory, "serviceaccount/token"), "isolated-test-token", { mode: 0o644 });
  writeFileSync(join(directory, "run.mjs"), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { spawn } from 'node:child_process';
const spec = JSON.parse(readFileSync('/app/scripts/credential-bootstrap/spec.json'));
const secrets = new Map(); let writes = 0;
const server = https.createServer({ key:readFileSync('/checks/server.key'), cert:readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt') }, (req, res) => {
  const reply = (status, body = {}) => { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(body)); };
  if (req.headers.authorization !== 'Bearer isolated-test-token') return reply(401);
  let input = '';
  req.on('data', chunk => input += chunk);
  req.on('end', () => {
    const base = '/api/v1/namespaces/tali';
    if (req.method === 'GET' && req.url === base) return reply(200, {metadata:{name:'tali',uid:'test-namespace'}});
    if (!req.url.startsWith(base + '/secrets')) return reply(403);
    const body = input ? JSON.parse(input) : {};
    const name = req.method === 'POST' ? body.metadata.name : decodeURIComponent(req.url.split('/').at(-1));
    if (req.method === 'GET') return secrets.has(name) ? reply(200,secrets.get(name)) : reply(404);
    if (req.method !== 'POST' || req.url !== base + '/secrets') return reply(403);
    if (secrets.has(name)) return reply(409);
    body.data = Object.fromEntries(Object.entries(body.stringData).map(([k,v]) => [k,Buffer.from(v).toString('base64')]));
    delete body.stringData; body.metadata.resourceVersion = String(++writes);
    secrets.set(name,body); reply(201,body);
  });
});
await new Promise(resolve => server.listen(8443,'127.0.0.1',resolve));
const initialize = () => new Promise((resolve,reject) => {
  const child = spawn(process.execPath, ['/app/scripts/credential-bootstrap/bootstrap-secrets.mjs','/app/scripts/credential-bootstrap/spec.json'],
    {env:{...process.env,KUBERNETES_SERVICE_HOST:'127.0.0.1',KUBERNETES_SERVICE_PORT_HTTPS:'8443'}});
  let stdout = '', stderr = '';
  child.stdout.on('data',chunk => stdout += chunk); child.stderr.on('data',chunk => stderr += chunk);
  child.on('error',reject);
  child.on('exit',code => {
    try { assert.equal(code,0,stderr); assert.equal(stderr,''); assert.equal(stdout,'Credential initialization complete; existing credentials retained.\\n'); resolve(); }
    catch (error) { reject(error); }
  });
});
try {
  await initialize(); const before = JSON.stringify([...secrets]); const firstWrites = writes;
  assert.equal(secrets.get(spec.credentialSecret).immutable,true);
  assert.equal(firstWrites,spec.outputs.length + 1);
  await initialize(); assert.equal(writes,firstWrites); assert.equal(JSON.stringify([...secrets]),before);
  console.log('Bootstrap Node ' + process.versions.node + ', UID ' + process.getuid() + ': TLS, mount layout, generation and reentry passed');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
`, { mode: 0o644 });
  for (const identity of ["10001:10001", "1000880000:0"]) {
    process.stdout.write(run("docker", ["run", "--rm", "--network", "none", "--user", identity,
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "-v", `${directory}:/checks:ro`,
      "-v", `${directory}/bootstrap:/app/scripts/credential-bootstrap:ro`,
      "-v", `${directory}/serviceaccount:/var/run/secrets/kubernetes.io/serviceaccount:ro`,
      "-v", `${realpathSync("node_modules/smol-toml")}:/app/node_modules/smol-toml:ro`,
      "--entrypoint", "node", "node:22-bookworm-slim", "/checks/run.mjs"]));
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
