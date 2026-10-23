#!/usr/bin/env node
// Requires an existing READY DeepSeek routing. Calls only the local example MCP.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {RelayClient, eventually, exchangeDashboardSession, runHermesDashboardTurn,
  completedToolEvents, waitForInstanceModelAttribution} from './live-hermes-e2e-lib.mjs';
assert.equal(process.env.TALI_LIVE_E2E, '1');
const projectId = process.env.TALI_LIVE_E2E_PROJECT_ID;
const namespace = process.env.HELM_NAMESPACE;
const release = process.env.HELM_RELEASE_NAME;
assert(projectId && namespace && release && process.env.TALI_BASE_URL && process.env.TALI_VALIDATION_PASSWORD);
const client = new RelayClient(process.env.TALI_BASE_URL);
const items = value => Array.isArray(value) ? value : value?.data ?? [];
const call = (path, body, method='POST') => client.project(projectId,path,{method,body:JSON.stringify(body)});
const evidence = {projectId, embeddingProvisioned:false};
const save = () => {if(process.env.TALI_LIVE_MCP_EVIDENCE_PATH)writeFileSync(process.env.TALI_LIVE_MCP_EVIDENCE_PATH,JSON.stringify(evidence,null,2));};
async function main() {
  await client.login(process.env.TALI_VALIDATION_USERNAME ?? 'admin', process.env.TALI_VALIDATION_PASSWORD);
  await client.request('/api/v1/access-context',{method:'PUT',body:JSON.stringify({level:'project',resourceId:projectId,roleId:'ROLE_PROJECT_ADMIN'})});
  const definition = {name:'OrbStack acceptance MCP',alias:'acceptance',description:'Local read-only tool acceptance',
    category:'Developer Tools',transport:'http',endpoint:`http://${release}-example-mcp.${namespace}.svc.cluster.local:3000/mcp`,
    args:[],environment:[],authType:'basic',authReference:`k8s://${namespace}/${release}-example-mcp-auth#auth-value`,
    accessGroups:[],allowedTools:['echo_message','calculate_sum'],readOnlyTools:['echo_message','calculate_sum'],
    extraHeaders:[],staticHeaders:[],internalNetworkOnly:true};
  let server=(await client.project(projectId,'/catalog')).mcpServers.find(s=>s.name===definition.name);
  server=await call(`/catalog/mcp-servers${server?`/${server.id}`:''}`,definition,server?'PUT':'POST');
  assert.equal(server.status,'HEALTHY');
  evidence.mcp={id:server.id,status:server.status,allowedTools:server.allowedTools};save();
  console.log('PASS: local MCP registration and generated Secret authentication.');
  const routing=items(await client.project(projectId,'/model-routings')).find(r=>r.name==='OrbStack acceptance DeepSeek'&&r.status==='READY');
  assert(routing);
  let agent=items(await client.project(projectId,'/instances')).find(i=>i.name==='OrbStack MCP acceptance');
  if(!agent){
    let policy=items(await client.project(projectId,'/access-policies')).find(p=>p.name==='OrbStack MCP acceptance');
    if(!policy) policy=await call('/access-policies',{name:'OrbStack MCP acceptance',
      status:'ACTIVE',serverRules:[{mcpServerId:server.id,defaultDecision:'DENY',tools:[
        {toolName:'echo_message',decision:'ALLOW'},{toolName:'calculate_sum',decision:'ALLOW'}]}]});
    const created=await call('/instances',{name:'OrbStack MCP acceptance',description:'Real DeepSeek calling authenticated local MCP tools',
      runtime:'openshell',agentPlatform:'hermes',accessPolicyIds:[policy.id],modelRoutingId:routing.id,
      mcpServerIds:[server.id],knowledgeSourceIds:[],memory:{mode:'native'},
      systemPrompt:'Perform local acceptance tests using actual MCP tools. Do not simulate results. Use no embedding services.'});
    agent={id:created.instanceId};
  }
  evidence.agentId=agent.id;save();
  agent=await eventually(async()=>{const r=await client.project(projectId,`/instances/${agent.id}`);const i=r.instance??r;return i.status==='READY'?i:undefined;},
    {description:'MCP Hermes readiness',timeoutMs:600000,intervalMs:3000});
  const interaction=await client.project(projectId,`/instances/${agent.id}/interaction`);
  const dashboard=await exchangeDashboardSession(interaction.httpEndpoint.url);
  const startedAt=new Date().toISOString();
  evidence.startedAt=startedAt; save();
  const marker=`MCP-${crypto.randomUUID()}`;
  const turn=await runHermesDashboardTurn({...dashboard,timeoutMs:240000,responseIncludes:[marker,'378'],
    prompt:`Call the connected MCP calculate_sum tool with left=137 and right=241. Then call the MCP echo_message tool with message=${marker}. Invoke both actual MCP tools. If these tools are unavailable, immediately respond MCP_UNAVAILABLE and stop; never inspect files, use terminal, or troubleshoot. Report both returned results concisely.`});
  const completed=completedToolEvents(turn.events);
  for(const suffix of ['calculate_sum','echo_message']) {
    const event=completed.find(e=>e.payload?.name?.endsWith(suffix));
    assert(event,`No completed MCP ${suffix} call: ${turn.tools.join(', ')}`);
    assert(!event.payload.result?.isError,`MCP ${suffix} returned an error`);
  }
  evidence.chat={tools:turn.tools,response:turn.response};save();
  evidence.modelAttribution=await waitForInstanceModelAttribution({instance:agent,routing,startedAt,
    projectRequest:(path,init)=>client.project(projectId,path,init),timeoutMs:180000});
  const overview=await eventually(async()=>{
    const value=await client.project(projectId,'/overview');
    const activity=value.agentActivity.find(item=>item.agentId===agent.id);
    return activity?.runs>0 && activity.successRate===1 ? value : undefined;
  },{description:'successful Run telemetry in Project overview',timeoutMs:60000,intervalMs:2000});
  evidence.overview={kpis:overview.kpis,agentActivity:overview.agentActivity.find(item=>item.agentId===agent.id)};
  evidence.result='PASS';save();console.log(JSON.stringify(evidence,null,2));
}
main().catch(error=>{evidence.result='FAIL';evidence.error=error.message;save();console.error(error.message);process.exitCode=1;});
