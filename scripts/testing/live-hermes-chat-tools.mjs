#!/usr/bin/env node
// Real DeepSeek-only acceptance. Uses native memory and never provisions embeddings.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { RelayClient, eventually, exchangeDashboardSession, probeRelayTerminal,
  runHermesDashboardTurn, waitForInstanceModelAttribution } from './live-hermes-e2e-lib.mjs';

assert.equal(process.env.TALI_LIVE_E2E, '1', 'Explicit live model opt-in is required.');
const baseUrl = process.env.TALI_BASE_URL;
const projectId = process.env.TALI_LIVE_E2E_PROJECT_ID;
const modelId = process.env.TALI_LIVE_MODEL_ID ?? 'deepseek-flash';
assert(baseUrl && projectId && process.env.TALI_VALIDATION_PASSWORD && process.env.DEEPSEEK_API_KEY,
  'Provide base URL, Project ID, validation password and DeepSeek API key.');
const client = new RelayClient(baseUrl);
const items = value => Array.isArray(value) ? value : value?.data ?? [];
const call = (path, body, method = 'POST') => client.project(projectId, path, {method, body:JSON.stringify(body)});
const evidence = {projectId, provider:'deepseek', embeddingProvisioned:false, baseUrl};
const checkpoint = () => {
  if (process.env.TALI_LIVE_EVIDENCE_PATH) writeFileSync(process.env.TALI_LIVE_EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
};

async function main() {
  await client.login(process.env.TALI_VALIDATION_USERNAME ?? 'admin', process.env.TALI_VALIDATION_PASSWORD);
  await client.request('/api/v1/access-context', {method:'PUT', body:JSON.stringify({
    level:'project', resourceId:projectId, roleId:'ROLE_PROJECT_ADMIN',
  })});
  const connection = {provider:'deepseek', name:'OrbStack acceptance DeepSeek',
    config:{endpoint:'https://api.deepseek.com/v1'}, credentials:{apiKey:process.env.DEEPSEEK_API_KEY}};
  let provider = items(await client.project(projectId, '/providers')).find(p => p.name === connection.name);
  if (!provider) {
    const discovery = await call('/providers/discover', connection);
    const model = discovery.models.find(m => m.modelId === modelId);
    assert(model, `DeepSeek discovery models: ${discovery.models.map(m => m.modelId).join(', ')}`);
    provider = (await call('/providers', {connection, models:[{
      modelId:model.modelId, displayName:model.displayName, modelType:model.modelType,
      capabilities:model.capabilities, inputModalities:model.inputModalities, outputModalities:model.outputModalities,
    }], complianceDomain:'GLOBAL'})).account;
  }
  const model = items(await client.project(projectId, '/models')).find(m => m.providerAccountId === provider.id && m.modelId === modelId);
  assert.equal(model?.status, 'VALIDATED');
  let routing = items(await client.project(projectId, '/model-routings')).find(r => r.name === 'OrbStack acceptance DeepSeek');
  if (!routing) {
    const gateway = items(await client.project(projectId, '/inference-gateways'))[0];
    assert(gateway, 'No inference Gateway exists.');
    routing = await call('/model-routings', {
      name:'OrbStack acceptance DeepSeek', gatewayId:gateway.id,
      routingPolicy:{version:1, mode:'SINGLE', modelDeploymentId:model.id, fallbackModelDeploymentIds:[], retries:0},
      complianceDomain:'GLOBAL', isDefault:true, keyPolicy:{perInstance:true, rotationDays:30},
      auditPolicy:{controlPlane:true, requestLogs:true, capturePrompts:false},
    });
  }
  assert.equal(routing.status, 'READY');
  assert.equal(routing.routingPolicy.mode, 'SINGLE');
  assert.equal(routing.routingPolicy.fallbackModelDeploymentIds.length, 0);
  evidence.routing = {id:routing.id, status:routing.status, model:model.modelId}; checkpoint();
  console.log('PASS: real DeepSeek provider validation and SINGLE routing.');

  let agent = items(await client.project(projectId, '/instances')).find(i => i.name === 'OrbStack DeepSeek acceptance');
  if (!agent) {
    const policy = items(await client.project(projectId, '/access-policies')).find(p => p.status === 'ACTIVE');
    assert(policy, 'No active Access Policy exists.');
    const created = await call('/instances', {
      name:'OrbStack DeepSeek acceptance', description:'Local acceptance: real DeepSeek chat, tools and native memory; no embeddings.',
      runtime:'openshell', agentPlatform:'hermes', accessPolicyIds:[policy.id], modelRoutingId:routing.id,
      knowledgeSourceIds:[], memory:{mode:'native'},
      systemPrompt:'You are a local acceptance assistant. Execute requested tools honestly. Only operate on acceptance files under /sandbox. Do not call embedding services.',
    });
    agent = {id:created.instanceId};
  }
  evidence.agentId = agent.id; checkpoint();
  agent = await eventually(async () => {
    const response = await client.project(projectId, `/instances/${agent.id}`);
    const current = response.instance ?? response;
    if (current.status === 'FAILED') throw Error(`Agent failed: ${current.error ?? 'inspect runtime'}`);
    return current.status === 'READY' ? current : undefined;
  }, {description:'Hermes runtime readiness', timeoutMs:600000, intervalMs:3000});
  assert(!agent.durableMemoryId, 'Native memory must not bind an external embedding-backed store.');
  console.log('PASS: Hermes runtime Ready with native memory.');
  const terminal = await call(`/instances/${agent.id}/terminal-sessions`, {targetId:'agent'});
  await probeRelayTerminal({baseUrl, websocketPath:terminal.websocketUrl, timeoutMs:45000});
  evidence.terminal = 'PASS'; checkpoint();
  const interaction = await client.project(projectId, `/instances/${agent.id}/interaction`);
  assert.equal(interaction.httpEndpoint?.status, 'READY');
  const dashboard = await exchangeDashboardSession(interaction.httpEndpoint.url);
  evidence.dashboard = {pageStatus:dashboard.pageStatus, accessTokenReplayStatus:401}; checkpoint();
  console.log('PASS: terminal and authenticated Dashboard access.');
  const startedAt = new Date().toISOString();
  const marker = `RELAY-LIVE-${crypto.randomUUID()}`;
  const filename = `/sandbox/relay-acceptance-${crypto.randomUUID()}.txt`;
  const first = await runHermesDashboardTurn({...dashboard, timeoutMs:240000,
    requiredTools:['terminal'], responseIncludes:[marker],
    prompt:`Use the terminal tool to write exactly ${marker} into ${filename}, then read it with cat. Report the exact content returned by the tool. You must actually invoke terminal; do not simulate the operation.`,
  });
  evidence.firstTurn = {tools:first.tools, response:first.response, file:filename, marker}; checkpoint();
  console.log('PASS: first live chat invoked terminal and returned the written marker.');
  const second = await runHermesDashboardTurn({...dashboard, timeoutMs:240000,
    requiredTools:['terminal'], responseIncludes:[marker],
    prompt:`Use terminal to read ${filename}. Report its exact content, which you have not been given in this session. Do not overwrite the file.`,
  });
  evidence.secondTurn = {tools:second.tools, response:second.response}; checkpoint();
  console.log('PASS: a fresh chat retrieved the real persisted tool result.');
  evidence.modelAttribution = await waitForInstanceModelAttribution({instance:agent, routing, startedAt,
    projectRequest:(path, init)=>client.project(projectId,path,init), timeoutMs:180000});
  const denied = await fetch(new URL(`/api/v1/projects/${projectId}/instances/${agent.id}/interaction`, baseUrl));
  assert.equal(denied.status, 401);
  evidence.unauthenticatedInteractionStatus = denied.status;
  evidence.result = 'PASS'; checkpoint();
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(error => {evidence.result='FAIL'; evidence.error=error.message; checkpoint(); console.error(error.message);process.exitCode=1;});
