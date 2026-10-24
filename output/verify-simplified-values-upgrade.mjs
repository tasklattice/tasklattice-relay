import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse as toml } from 'smol-toml';
import { RelayClient, probeRelayTerminal, eventually } from '../scripts/testing/live-hermes-e2e-lib.mjs';
const file = 'output/orbstack-values-upgrade-validation.json';
const mode = process.argv[2];
const k = (args, namespace = 'tali') => execFileSync('kubectl', ['--context', 'orbstack', '-n', namespace, ...args], { encoding: 'utf8', timeout: 45000, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe','pipe','pipe'] });
const get = (kind, name, ns) => JSON.parse(k(['get', kind, ...(name ? [name] : []), '-o', 'json'], ns));
const helm = (...args) => execFileSync('helm', ['--kube-context', 'orbstack', '--namespace', 'tali', ...args], { encoding:'utf8', timeout:45000, maxBuffer:16*1024*1024, stdio:['pipe','pipe','pipe'] });
const config = toml(Buffer.from(get('secret', 'tali-relay-control-config').data['control.toml'], 'base64').toString());
const username = config.auth.local.initial_platform_administrator_username;
const password = config.auth.local.initial_platform_administrator_password;
const baseUrl = 'http://localhost:38080';
const client = new RelayClient(baseUrl);
const origin = baseUrl;
const report = mode === 'baseline' ? { startedAt:new Date().toISOString(), context:'orbstack', release:'tali/tali-relay' } : JSON.parse(readFileSync(file,'utf8'));
const save = () => writeFileSync(file, JSON.stringify(report,null,2)+'\n');
const items = r => Array.isArray(r) ? r : r.data;
const setContext = (level, resourceId, roleId) => client.request('/api/v1/access-context',{method:'PUT',headers:{origin},body:JSON.stringify({level,resourceId,roleId})});
const hash = data => createHash('sha256').update(JSON.stringify(Object.entries(data ?? {}).sort())).digest('hex');
async function snapshot() {
  const projects = items(await client.request('/api/v1/projects'));
  return {
    secrets: Object.fromEntries(get('secrets').items.filter(s=>!s.metadata.name.startsWith('sh.helm.release.')).map(s=>[s.metadata.name,{uid:s.metadata.uid,dataDigest:hash(s.data)}])),
    projects: projects.map(p=>({id:p.id,name:p.name})),
    tenants: Object.fromEntries(projects.map(p=>[p.id,{
      namespaceUid:get('namespace',p.id).metadata.uid,
      pods:get('pods',null,p.id).items.map(p=>({name:p.metadata.name,uid:p.metadata.uid,imageIds:(p.status.containerStatuses??[]).map(c=>c.imageID),restarts:(p.status.containerStatuses??[]).map(c=>c.restartCount)})).sort((a,b)=>a.name.localeCompare(b.name)),
      pvcs:get('pvc',null,p.id).items.map(p=>({name:p.metadata.name,uid:p.metadata.uid})).sort((a,b)=>a.name.localeCompare(b.name))
    }]))
  };
}
try {
  const health=await client.request('/api/health'); assert.equal(health.ok,true);
  await client.login(username,password);
  if(mode==='baseline') {
    report.before = await snapshot();
    report.beforeRevision = JSON.parse(helm('list','-o','json')).find(r=>r.name==='tali-relay').revision;
    const values=JSON.parse(helm('get','values','tali-relay','-o','json'));
    report.originalRolloutRevision=values.global?.rolloutRevision;
    report.baselineHealth='PASS';
    save();
    console.log(JSON.stringify({baseline:'PASS',revision:report.beforeRevision,secrets:Object.keys(report.before.secrets).length,projects:report.before.projects.length}));
  } else if(mode==='verify') {
    const after=await snapshot();
    assert.deepEqual(after.secrets,report.before.secrets,'Component Secrets or credential source changed');
    assert.deepEqual(after.projects,report.before.projects,'Project identities changed');
    assert.deepEqual(after.tenants,report.before.tenants,'Tenant Namespace/Pod/PVC/image/restarts changed');
    report.retention={result:'PASS',unchangedSecrets:Object.keys(after.secrets).length,unchangedProjects:after.projects.length,tenantPodsAndVolumes:'unchanged'};
    const release=JSON.parse(helm('list','-o','json')).find(r=>r.name==='tali-relay');
    assert.equal(release.status,'deployed');
    report.revision=Number(release.revision); report.status=release.status;
    const workloads=get('deployments,statefulsets').items.map(o=>({name:o.metadata.name,desired:o.spec.replicas,ready:o.status.readyReplicas??0,updated:o.status.updatedReplicas??0,generation:o.metadata.generation,observedGeneration:o.status.observedGeneration}));
    for(const w of workloads){assert.equal(w.ready,w.desired,w.name);assert.equal(w.updated,w.desired,w.name);assert.equal(w.generation,w.observedGeneration,w.name);}
    report.workloads=workloads;
    const pods=get('pods').items.filter(p=>!p.metadata.deletionTimestamp&&p.status.phase!=='Succeeded');
    report.pods=pods.map(p=>({name:p.metadata.name,ready:(p.status.containerStatuses??[]).every(c=>c.ready),restarts:(p.status.containerStatuses??[]).reduce((n,c)=>n+c.restartCount,0)}));
    assert(report.pods.every(p=>p.ready));
    report.core={databaseHealth:'PASS',originalAdministratorLogin:'PASS',projects:[]};
    const contexts=await client.request('/api/v1/access-context');
    for(const project of report.before.projects) {
      const context=contexts.options.find(c=>c.level==='project'&&c.resourceId===project.id&&c.roleId==='ROLE_PROJECT_ADMIN');assert(context);
      await setContext(context.level,context.resourceId,context.roleId);
      const initialization=await eventually(async()=>{const status=await client.project(project.id,'/initialization');return status.status==='ready'?status:undefined;},{description:'Project reconciliation '+project.id,timeoutMs:180000,intervalMs:5000});
      const runtime=await client.project(project.id,'/runtime');
      const instances=items(await client.project(project.id,'/instances'));
      const inventory=await client.project(project.id,'/runtime-inventory');
      const routings=await client.project(project.id,'/model-routings');
      const overview=await client.project(project.id,'/overview');
      const evidence={id:project.id,initialization:initialization.status,runtimeMode:runtime.mode,instances:instances.map(i=>({id:i.id,platform:i.agentPlatform,status:i.status})),inventory:'PASS',modelRoutings:'PASS',overview:'PASS'};
      const instance=instances.find(i=>i.agentPlatform==='hermes'&&i.status==='READY');
      if(instance){
        const session=await client.project(project.id,`/instances/${instance.id}/terminal-sessions`,{method:'POST',headers:{origin},body:JSON.stringify({targetId:'agent'})});
        await probeRelayTerminal({baseUrl,websocketPath:session.websocketUrl,timeoutMs:30000});
        evidence.terminal='PASS';report.uiProjectId=project.id;
      }
      report.core.projects.push(evidence);
    }
    await setContext('platform',null,'ROLE_PLATFORM_ADMIN');
    const settings=await client.request('/api/v1/platform/settings');
    report.core.platformSettings='PASS';
    const infrastructure=settings.infrastructure;
    const validation=await client.request('/api/v1/platform/infrastructure/validate',{method:'POST',headers:{origin},body:JSON.stringify({controlInternalUrl:infrastructure.controlInternalUrl,runner:{url:infrastructure.runner.url,token:{action:'preserve'}},litellm:{url:infrastructure.litellm.url,masterKey:{action:'preserve'}},runtimeNamespaces:infrastructure.runtimeNamespaces})});
    for(const key of ['control','runner','litellm','runtimeNamespaces']) assert.equal(validation[key].ok,true,key);
    report.core.infrastructure=Object.fromEntries(['control','runner','litellm','runtimeNamespaces'].map(key=>[key,validation[key]]));
    if(report.failure){report.preRecoveryObservation=report.failure;delete report.failure;}
    save();console.log(JSON.stringify({verification:'PASS',revision:report.revision,workloads:workloads.length,retention:report.retention,core:report.core},null,2));
  } else if(mode==='agent-ui') {
    const result=spawnSync(process.execPath,['scripts/testing/live-agent-ui-path.mjs'],{env:{...process.env,TALI_LIVE_E2E:'1',TALI_CONTROL_URL:baseUrl,TALI_UI_PROJECT_ID:report.uiProjectId,TALI_UI_USERNAME:username,TALI_UI_PASSWORD:password},encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
    if(result.status!==0) throw new Error('Agent UI live acceptance failed: '+(result.stderr||result.error?.message||`exit ${result.status}`));
    report.agentUi=JSON.parse(result.stdout);writeFileSync('output/orbstack-values-agent-ui.json',JSON.stringify(report.agentUi,null,2)+'\n');save();console.log(JSON.stringify(report.agentUi,null,2));
  } else if(mode==='sso') {
    const secret=get('secret','tali-relay-keycloak-config');
    const result=spawnSync(process.execPath,['scripts/testing/live-keycloak-control-sso.mjs'],{env:{...process.env,TALI_LIVE_E2E:'1',TALI_BASE_URL:baseUrl,TALI_SSO_USERNAME:'alice',TALI_SSO_PASSWORD:Buffer.from(secret.data['keycloak-test-user-password'],'base64').toString(),TALI_SSO_EXPECTED_PROJECT_ID:report.uiProjectId,TALI_SSO_EXPECTED_ROLE_ID:'ROLE_PROJECT_ADMIN'},encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
    if(result.status!==0) throw new Error('SSO acceptance failed: '+(result.stderr||result.error?.message||`exit ${result.status}`));
    report.sso=JSON.parse(result.stdout);writeFileSync('output/orbstack-values-sso.json',JSON.stringify(report.sso,null,2)+'\n');save();console.log(JSON.stringify(report.sso,null,2));
  } else throw new Error('Unknown acceptance phase');
} catch(error) {
  report.failure={phase:mode,message:String(error.message).replaceAll(password,'[redacted]')};save();console.error(report.failure.message);process.exitCode=1;
} finally {
  await client.rawRequest('/api/auth/sign-out',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'}).then(r=>r.body?.cancel()).catch(()=>{});
}
