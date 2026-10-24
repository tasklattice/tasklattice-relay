// Execute inside the OpenShell sandbox, not via kubectl exec: exercise its
// credential substitution and effective network policy as the native Agent.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile("/sandbox/.hindsight/coding-agent.json", "utf8"));
const otherInstance = process.argv[2];
assert(otherInstance && otherInstance !== config.bankId);
const otherProject = process.argv[3];
const foreignMarker = process.argv[4];
assert(/^tp-[a-z0-9]+$/.test(otherProject ?? ""));
assert(foreignMarker);
const bank = `/v1/default/banks/${config.bankId}`;
async function check(name, path, expected, options = {}) {
  const response = await fetch(config.apiUrl + path, {
    ...options,
    headers: { authorization: `Bearer ${config.apiToken}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  assert(expected.includes(response.status), `${name}: unexpected HTTP ${response.status}`);
  const body = await response.text();
  console.log(`${name}: HTTP ${response.status}`);
  return body;
}
const version = JSON.parse(await check("own version", "/version", [200]));
assert.equal(version.api_version, "1.1.0");
await check("strict document filter", bank + "/documents?tags=source%3Agit&tags_match=all_strict", [200]);
await check("other Instance Bank denied", `/v1/default/banks/${otherInstance}/documents`, [403, 404]);
await check("Bank query override denied", bank + "/documents?bank_id=other", [403, 404]);
await check("Bank administration denied", bank + "/config", [403, 404], { method: "PATCH", body: "{}" });
const otherCoordinator = config.apiUrl.replace(`/coordinators/${config.bankId}`, `/coordinators/${otherInstance}`);
const crossed = await fetch(otherCoordinator + "/version", {
  headers: { authorization: `Bearer ${config.apiToken}` }, signal: AbortSignal.timeout(15_000),
});
assert([401, 403, 404].includes(crossed.status));
console.log(`other coordinator denied: HTTP ${crossed.status}`);
const recall = JSON.parse(await check("own scoped recall", bank + "/memories/recall", [200], {
  method: "POST", body: JSON.stringify({ query: "acceptance launch codename", budget: "low", max_tokens: 1024 }),
}));
assert(!(recall.results ?? []).some(item => (item.text ?? "").includes(foreignMarker)), "Foreign Bank fact leaked");
console.log("other Bank canary absent from own recall");
const otherProjectUrl = new URL(config.apiUrl);
otherProjectUrl.hostname = `tali-agent-runtime-bridge.${otherProject}.svc.cluster.local`;
let projectDenied = false;
try {
  const response = await fetch(otherProjectUrl + "/version", {
    headers: { authorization: `Bearer ${config.apiToken}` }, signal: AbortSignal.timeout(8_000),
  });
  projectDenied = [401, 403, 404].includes(response.status);
  await response.body?.cancel();
} catch { projectDenied = true; }
assert(projectDenied, "Other Project bridge unexpectedly reachable");
console.log("other Project bridge: denied");
for (const registry of ["https://registry.npmjs.org/@vectorize-io/hindsight-coding-agents", "https://pypi.org/simple/"]) {
  let denied = false;
  try {
    const response = await fetch(registry, { signal: AbortSignal.timeout(8_000) });
    denied = response.status === 403;
    await response.body?.cancel();
  } catch { denied = true; }
  assert(denied, "Public package registry unexpectedly reachable");
  console.log(`${new URL(registry).hostname}: denied by sandbox network`);
}
