import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {parse} from 'smol-toml';
import {RelayClient} from '../scripts/testing/live-hermes-e2e-lib.mjs';
const projectId='tp-t5r7oyer4yfb2';
const origin='http://localhost:38080';
const getSecret=JSON.parse(execFileSync('kubectl',['--context','orbstack','-n','tali','get','secret','tali-relay-control-config','-o','json'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}));
const config=parse(Buffer.from(getSecret.data['control.toml'],'base64').toString());
const client=new RelayClient(origin);
await client.login(config.auth.local.initial_platform_administrator_username,config.auth.local.initial_platform_administrator_password);
const evidence={projectId,reason:'Worker restart interrupted reconciliation while PostgreSQL rolled; existing lease protects the operation for 10 minutes.',leaseExpiresAt:'2026-10-24T09:06:57.159Z',retryRequested:false};
try {
  await client.request('/api/v1/access-context',{method:'PUT',headers:{origin},body:JSON.stringify({level:'project',resourceId:projectId,roleId:'ROLE_PROJECT_ADMIN'})});
  const deadline=Date.now()+360000;
  let ready=false;
  while(Date.now()<deadline){
    const state=await client.project(projectId,'/initialization');
    if(state.status==='ready'){evidence.finalState=state;ready=true;break;}
    if(!evidence.retryRequested&&Date.now()>Date.parse(evidence.leaseExpiresAt)+2000){
      const r=await client.rawRequest(`/api/v1/projects/${projectId}/initialization/retry`,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});
      await r.body?.cancel();
      assert([202,409].includes(r.status),`Unexpected retry status ${r.status}`);
      if(r.status===202){evidence.retryRequested=true;evidence.retryRequestedAt=new Date().toISOString();console.log('Expired operation lease: application retry accepted.');}
    }
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
  assert(ready,'Project reconciliation did not recover within the acceptance window');
  evidence.result='PASS';
  writeFileSync('output/orbstack-values-reconciliation.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));
} finally {await client.rawRequest('/api/auth/sign-out',{method:'POST',headers:{origin},body:'{}'}).catch(()=>{});}
