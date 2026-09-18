#!/usr/bin/env node
// Isolated container checks; never changes a Kubernetes workload or database.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseAllDocuments } from "yaml";

const directory = mkdtempSync(resolve(tmpdir(), "relay-component-config-"));
chmodSync(directory, 0o755);
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", ...options });
function docker(image, mounts, script, args = []) {
  const output = run("docker", ["run", "--rm", "-i", "--network", "none", ...args,
    ...mounts.flatMap(([source, target, writable]) => ["-v", `${source}:${target}${writable ? "" : ":ro"}`]),
    "--entrypoint", "python", image, "-"], { input: script });
  process.stdout.write(output);
}
try {
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${directory}/server.key`,
    "-out", `${directory}/ca.crt`, "-subj", "/CN=localhost", "-days", "1", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  chmodSync(`${directory}/server.key`, 0o644); // ephemeral test-only key, deleted below
  const { readFileSync } = await import("node:fs");
  const manifests = parseAllDocuments(run("helm", ["template", "config-test", "charts/tali-relay",
    "--kube-version", "1.29.0", "--set", "fullnameOverride=config-test", "--set-string", `litellm.caCertificateBase64=${readFileSync(`${directory}/ca.crt`).toString("base64")}`]))
    .map((document) => document.toJSON());
  const workload = (component) => manifests.find((object) => object.kind === "Deployment"
    && object.metadata?.labels?.["app.kubernetes.io/component"] === component).spec.template.spec;
  const secret = Object.assign({}, ...manifests.filter((object) => object.kind === "Secret").map((object) => object.stringData ?? {}));
  const lite = workload("litellm");
  const caInit = lite.initContainers.find((container) => container.name === "build-ca-bundle");
  writeFileSync(`${directory}/build-ca.py`, caInit.args[0]);
  mkdirSync(`${directory}/bundle`, { mode: 0o777 });
  chmodSync(`${directory}/bundle`, 0o777);
  docker(process.env.LITELLM_TEST_IMAGE ?? lite.containers[0].image,
    [[directory, "/etc/tali-ca"], [`${directory}/bundle`, "/var/run/tali-ca", true]], `
import asyncio, http.server, os, runpy, ssl, threading
import certifi
base = ssl.create_default_context(cafile=certifi.where()).get_ca_certs(binary_form=True)
runpy.run_path('/etc/tali-ca/build-ca.py')
path = '/var/run/tali-ca/ca-bundle.pem'
merged = ssl.create_default_context(cafile=path).get_ca_certs(binary_form=True)
assert set(base).issubset(set(merged)), 'public roots were lost'
assert len(merged) > len(base), 'custom root was not added'
os.environ.update(SSL_CERT_FILE=path, REQUESTS_CA_BUNDLE=path, CURL_CA_BUNDLE=path)
from litellm.llms.custom_httpx.http_handler import get_ssl_verify
assert get_ssl_verify() == path
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'trusted')
    def log_message(self, *args): pass
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain('/etc/tali-ca/ca.crt', '/etc/tali-ca/server.key')
server.socket = context.wrap_socket(server.socket, server_side=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
url = 'https://localhost:' + str(server.server_port)
import httpx, requests, aiohttp
try:
    httpx.get(url, verify=ssl.create_default_context(cafile=certifi.where()))
    raise AssertionError('untrusted root unexpectedly accepted')
except httpx.ConnectError: pass
assert httpx.get(url).text == 'trusted'
assert requests.get(url).text == 'trusted'
async def check():
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response: assert await response.text() == 'trusted'
asyncio.run(check())
server.shutdown()
print('LiteLLM: private CA TLS handshake passed; public roots preserved')
`, ["--user", "65532:65532", "--read-only", "--tmpfs", "/tmp"]);

  mkdirSync(`${directory}/invalid`);
  writeFileSync(`${directory}/invalid/ca.crt`, "-----BEGIN CERTIFICATE-----\nnot-a-certificate\n-----END CERTIFICATE-----\n");
  docker(process.env.LITELLM_TEST_IMAGE ?? lite.containers[0].image,
    [[directory, "/checks"], [`${directory}/invalid`, "/etc/tali-ca"]], `
import runpy, ssl
try:
    runpy.run_path('/checks/build-ca.py')
    raise AssertionError('malformed certificate accepted')
except ssl.SSLError:
    print('LiteLLM: malformed X.509 rejected before application startup')
`, ["--user", "65532:65532", "--read-only", "--tmpfs", "/tmp"]);

  const hindsight = workload("hindsight-api");
  writeFileSync(`${directory}/config.json`, secret["hindsight-config.json"]);
  const launcher = manifests.find((object) => object.kind === "ConfigMap"
    && object.data?.["entrypoint.py"]).data["entrypoint.py"];
  writeFileSync(`${directory}/entrypoint.py`, launcher);
  for (const role of ["api", "worker", "migration"]) {
    docker(hindsight.containers[0].image, [[directory, "/etc/hindsight"]], `
import json, os, runpy, sys
from unittest.mock import patch
config = json.load(open('/etc/hindsight/config.json'))
sys.argv = ['entrypoint.py', '${role}']
with patch('os.execvp') as execute:
    runpy.run_path('/etc/hindsight/entrypoint.py')
    command = execute.call_args.args[1]
    assert command[0] == 'hindsight-${role === 'migration' ? 'admin' : role}'
    if '${role}' == 'migration':
        assert command[1:] == ['run-db-migration', '--schema', 'hindsight', '--embedding-dimension', '1536']
from hindsight_api.config import HindsightConfig
settings = HindsightConfig.from_env()
assert settings.database_url == config['common']['HINDSIGHT_API_DATABASE_URL']
assert settings.database_schema == 'hindsight'
assert settings.llm_base_url == 'http://127.0.0.1:4010/v1'
assert settings.embeddings_openai_dimensions == 1536
assert settings.run_migrations_on_startup is False
print('Hindsight ${role}: rendered file consumed by upstream settings')
`, ["--user", "1000:1000", "--read-only", "--tmpfs", "/tmp"]);
  }
  const docling = workload("docling");
  const doclingFile = manifests.find((object) => object.kind === "ConfigMap"
    && object.metadata.name === "config-test-docling-config").data["config.yaml"];
  writeFileSync(`${directory}/docling.yaml`, doclingFile);
  mkdirSync(`${directory}/models`, { mode: 0o777 });
  chmodSync(`${directory}/models`, 0o777);
  const seed = docling.initContainers.find((container) => container.name === "seed-models");
  run("docker", ["run", "--rm", "--network", "none", "--user", "1001:1001",
    "-v", `${directory}/models:/var/lib/docling/models`, "--entrypoint", seed.command[0], seed.image,
    ...seed.command.slice(1), ...seed.args]);
  docker(docling.containers[0].image, [[directory, "/etc/docling"], [`${directory}/models`, "/var/lib/docling/models"]], `
import os
# The chart unsets the image's baked-in override before invoking the native CLI.
os.environ.pop('DOCLING_SERVE_ARTIFACTS_PATH', None)
os.environ['DOCLING_SERVE_CONFIG_FILE'] = '/etc/docling/docling.yaml'
from docling_serve.settings import docling_serve_settings as settings
assert settings.max_file_size == 26214400
assert str(settings.artifacts_path) == '/var/lib/docling/models/artifacts'
assert settings.eng_loc_num_workers == 1
from pathlib import Path
assert Path('/opt/app-root/src/.cache/docling/models').is_dir(), 'image model seed path missing'
assert any(settings.artifacts_path.iterdir()), 'model volume was not populated'
print('Docling: native YAML settings and bundled model source verified')
`, ["--user", "1001:1001", "--read-only", "--tmpfs", "/tmp"]);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
