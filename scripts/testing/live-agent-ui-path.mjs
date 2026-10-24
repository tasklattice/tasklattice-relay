#!/usr/bin/env node
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { RelayClient } from './live-hermes-e2e-lib.mjs';

// This test uses existing local/test instances and never prints credentials.
if (process.env.TALI_LIVE_E2E !== '1') throw new Error('Set TALI_LIVE_E2E=1 for live Agent UI acceptance.');
const baseUrl = process.env.TALI_CONTROL_URL;
const projectId = process.env.TALI_UI_PROJECT_ID;
if (!baseUrl || !projectId) throw new Error('TALI_CONTROL_URL and TALI_UI_PROJECT_ID are required.');
const client = new RelayClient(baseUrl);
await client.login(process.env.TALI_UI_USERNAME, process.env.TALI_UI_PASSWORD);
const origin = client.baseUrl.origin;
const contexts = await client.request('/api/v1/access-context');
const selected = contexts.options.find(x => x.level === 'project' && x.resourceId === projectId && x.roleId === (process.env.TALI_UI_ROLE ?? 'ROLE_PROJECT_ADMIN'));
assert(selected, 'An existing assigned project role is required.');
await client.request('/api/v1/access-context', { method: 'PUT', headers: { origin }, body: JSON.stringify({ level: selected.level, resourceId: selected.resourceId, roleId: selected.roleId }) });
const instances = (await client.project(projectId, '/instances')).data;
const evidence = [];
const sockets = [];
const capabilities = [];

async function expectStatus(path, status, init = {}) {
  const response = await client.rawRequest(path, init);
  await response.body?.cancel();
  assert.equal(response.status, status, 'Unexpected HTTP boundary result.');
}
function connect(path) {
  const url = new URL(path, baseUrl); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, { headers: { origin: 'null' }, handshakeTimeout: 15_000 });
  sockets.push(socket);
  return socket;
}
function waitForMessage(socket, accept) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Agent WebSocket response timed out.')), 30_000);
    const fail = () => finish(new Error('Agent WebSocket failed.'));
    const onMessage = raw => { try { if (accept(raw.toString())) finish(); } catch (error) { finish(error); } };
    const finish = error => { clearTimeout(timer); socket.off('error', fail); socket.off('close', fail); socket.off('message', onMessage); error ? reject(error) : resolve(); };
    socket.on('message', onMessage); socket.on('error', fail); socket.on('close', fail);
  });
}

try {
  await expectStatus('/api/v1/access-context', 403, { headers: { origin: 'null' } });
  for (const platform of ['hermes', 'openclaw']) {
    const instance = instances.find(x => x.agentPlatform === platform && x.status === 'READY');
    assert(instance, `A Ready ${platform} instance is required.`);
    const publicPath = `/${projectId}/${instance.id}/ui/`;
    const anonymous = await fetch(new URL(publicPath, baseUrl));
    assert.equal(anonymous.status, 401); await anonymous.body?.cancel();
    const withoutSlash = await fetch(new URL(publicPath.slice(0, -1), baseUrl));
    assert.equal(withoutSlash.status, 401); await withoutSlash.body?.cancel();
    const page = await client.rawRequest(publicPath);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /^sandbox /);
    assert(!page.headers.get('content-security-policy').includes('allow-same-origin'));
    const html = await page.text();
    assert(!html.includes('<iframe'), 'Native UI must not use a wrapper iframe.');
    assert.match(html, platform === 'hermes' ? /Hermes Agent/ : /OpenClaw Control/);
    const capability = html.match(/<base href="(\/_agent-ui\/([\da-f-]{36})\/([\w-]{43})\/)"/);
    assert(capability, 'Native document did not receive its bounded content route.');
    const contentPath = capability[1]; capabilities.push(contentPath);
    const malformed = contentPath.replace(capability[3], 'z'.repeat(43));
    const bad = await fetch(new URL(malformed, baseUrl)); assert.equal(bad.status, 401); await bad.body?.cancel();
    const endpoint = `/api/v1/projects/${projectId}/instances/${instance.id}/web-ui-sessions`;
    await expectStatus(endpoint, 403, { method: 'POST', headers: { origin: 'https://invalid.example', 'content-type': 'application/json' }, body: '{}' });
    const interaction = await client.project(projectId, `/instances/${instance.id}/interaction`);
    assert.equal(interaction.httpEndpoint.url, publicPath);
    assert(!JSON.stringify(interaction).includes('#token'));
    const apiPath = platform === 'hermes' ? 'api/sessions?limit=1' : '';
    const api = await fetch(new URL(contentPath + apiPath, baseUrl), { headers: { origin: 'null' } });
    assert.equal(api.status, 200); await api.body?.cancel();
    let socket;
    if (platform === 'openclaw') {
      socket = connect(contentPath);
      await waitForMessage(socket, text => {
        const frame = JSON.parse(text);
        if (frame.event === 'connect.challenge') socket.send(JSON.stringify({ type: 'req', id: 'connect-check', method: 'connect', params: { auth: { token: 'untrusted-browser' }, scopes: ['operator.admin'] } }));
        if (frame.id === 'connect-check') {
          assert.equal(frame.ok, true, 'OpenClaw protocol handshake rejected.');
          assert(!frame.payload.auth?.deviceToken);
          assert(!frame.payload.auth?.scopes?.includes('operator.admin'));
          socket.send(JSON.stringify({ type: 'req', id: 'health-check', method: 'health', params: {} }));
        }
        if (frame.id === 'health-check') { assert.equal(frame.ok, true); return true; }
      });
    } else {
      assert.match(html, /__HERMES_SESSION_TOKEN__\s*=\s*"relay-managed"/);
      socket = connect(contentPath + 'api/pty?channel=relay-ui-acceptance&token=relay-managed');
      let output = '';
      await waitForMessage(socket, text => { output += text; return /Hermes|starting agent|Session:/i.test(output); });
    }
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Revoked WebSocket remained open.')), 15_000);
      socket.once('close', () => { clearTimeout(timer); resolve(); });
    });
    const revokedAt = Date.now();
    const revoke = await fetch(new URL(contentPath + '_relay/session', baseUrl), { method: 'DELETE', headers: { origin: 'null' } });
    assert.equal(revoke.status, 204);
    const denied = await fetch(new URL(contentPath, baseUrl)); assert.equal(denied.status, 401); await denied.body?.cancel();
    await closed;
    evidence.push({ platform, instanceId: instance.id, publicPath, nativeDocument: 'PASS', httpApi: 'PASS', websocket: 'PASS', revokedConnectionMs: Date.now() - revokedAt });
  }
  console.log(JSON.stringify({ result: 'PASS', checks: ['anonymous denied', 'opaque-origin Control access denied', 'cross-origin session creation denied', 'tampered capability denied', 'upstream tokens withheld', 'revocation closes HTTP and WS'], evidence }, null, 2));
} finally {
  for (const socket of sockets) socket.terminate();
  for (const path of capabilities) await fetch(new URL(path + '_relay/session', baseUrl), { method: 'DELETE', headers: { origin: 'null' } }).then(r => r.body?.cancel()).catch(() => {});
  await client.rawRequest('/api/auth/sign-out', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' }).then(r => r.body?.cancel()).catch(() => {});
}
