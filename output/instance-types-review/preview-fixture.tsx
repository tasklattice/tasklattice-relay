import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useLocation } from '@tanstack/react-router';
import { getAgentPlatformDefinition, type AgentPlatformId, type AgentInstanceDetail, type A2aStandardAgentInstanceDetail, type ProjectAgentInstanceDetail, type SupervisorAgentInstanceDetail } from '@tali/contracts';
import { ProjectContext } from '@/components/project/project-context';
import { A2aInstanceDetail } from '@/components/instances/a2a-instance-detail';
import { InstanceHeader } from '@/components/instances/instance-detail-header';
import { InstanceTabs } from '@/components/instances/instance-detail-tabs';
import { InstanceOverviewTab } from '@/components/instances/instance-overview-tab';
import { InstanceConfigurationTab } from '@/components/instances/instance-configuration-tab';
import { InstanceCapabilitiesTab } from '@/components/instances/instance-capabilities-tab';
import { AgentInstanceActivityTab } from '@/components/instances/agent-instance-activity-tab';
import { InstanceAuditorLogTab } from '@/components/instances/instance-auditor-log-tab';
import { InstanceUnavailablePanel } from '@/components/instances/instance-detail-layout';
import { normalizeInstanceDetailTab } from '@/components/instances/instance-detail-model';
import { getAgentPlatformPresentation } from '@/lib/agent-platforms';
import { SquareTerminal } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import '@/styles.css';

const date='2026-10-25T01:00:00.000Z';
const skills=[{id:'repository-triage',name:'Repository triage',description:'Classifies reported issues and returns evidence for the next action.',tags:['Repository','Triage']},{id:'Review changes',name:'Review changes',description:'Reviews changes against the project requirements and identifies actionable findings.',tags:['Review']}];
const protocol={type:'A2A' as const,version:'1.0' as const,direction:['SERVER' as const],binding:'HTTP+JSON' as const,endpoint:'https://agent.example.test/a2a',agentCardUrl:'https://agent.example.test/.well-known/agent-card.json',agentCardStatus:'VALID' as const,lastDiscoveredAt:date,capabilities:{streaming:true,pushNotifications:false,extendedAgentCard:false,defaultInputModes:['text/plain'],defaultOutputModes:['text/plain']},skills};
const shared={resourceType:'AGENT_INSTANCE' as const,form:'SERVICE' as const,role:'SPECIALIST' as const,executionStrategy:null,status:'READY' as const,platform:{id:'a2a',name:'A2A'},protocols:[protocol],capabilities:{interactive:false,canPlan:false,canDelegate:false,acceptsDelegation:true,terminal:false,liveLogs:true},observability:{logSources:['RUNTIME' as const,'LIFECYCLE' as const],terminal:{supported:false,reason:'This runtime does not expose an executable terminal.'}},createdAt:date,updatedAt:date};
function serviceDetail(type:string): A2aStandardAgentInstanceDetail | ProjectAgentInstanceDetail {
  const managed=!type.includes('external');
  const project=type==='project-agent';
  const id=type;
  const runtime=managed?'kubernetes' as const:'external' as const;
  const runtimeView={type:managed?'KUBERNETES' as const:'EXTERNAL' as const,managed,...(managed?{namespace:'preview-project',workloadName:'preview-triage-agent',podName:'preview-triage-agent-7bcdf8',imageReference:'example.test/agents/triage:v3',imageDigest:'sha256:'+'a'.repeat(64)}:{})};
  const instance={id,agentId:'fixture-'+type,kind:'A2A' as const,name:project?'Repository reviewer':managed?'Managed triage Agent':'External research Agent',description:project?'Reviews repository changes using the current published Agent version.':'Handles focused requests through an advertised A2A contract.',runtime,status:'READY' as const,runtimeNamespace:managed?'preview-project':null,deploymentName:managed?'preview-triage-agent':null,serviceName:null,podName:managed?'preview-triage-agent-7bcdf8':null,labelSelector:null,imageReference:runtimeView.imageReference??null,imageDigest:runtimeView.imageDigest??null,endpoint:protocol.endpoint,agentCardUrl:protocol.agentCardUrl,a2a:null,skills,createdAt:date,updatedAt:date,logs:[],error:null};
  const protocols=type==='a2a-no-protocol'?[]:[{...protocol,skills:type==='a2a-empty'?[]:skills,...(type==='a2a-discovery-failure'?{agentCardStatus:'INVALID' as const,lastDiscoveryError:'Preview discovery failed. The previous contract is retained.'}:{})}];
  if(project) return {...shared,id,name:instance.name,description:instance.description,kind:'PROJECT_AGENT',platform:{id:'langgraph',name:'LangGraph'},executionStrategy:'AGENTIC',runtimeView,protocols,instance:{...instance,kind:'PROJECT_AGENT',developedAgentId:'00000000-0000-4000-8000-000000000001',versionId:'00000000-0000-4000-8000-000000000003',versionNumber:3,contentDigest:'sha256:'+'b'.repeat(64)},definition:{id:'00000000-0000-4000-8000-000000000001',slug:'repository-reviewer',source:'AGENT_DEVELOPER',executionStrategy:'AGENTIC',activeVersion:{id:'00000000-0000-4000-8000-000000000004',versionNumber:4,contentDigest:'sha256:'+'c'.repeat(64)}}} as ProjectAgentInstanceDetail;
  return {...shared,id,name:instance.name,description:instance.description,kind:'A2A',runtimeView,protocols,capabilities:{...shared.capabilities,liveLogs:managed},instance,definition:{id:'fixture-'+type,name:instance.name,description:instance.description,source:'PROJECT_REGISTERED',integrationType:'a2a',platformLabel:'A2A',category:'Review',owner:'Preview',tags:[],status:'READY',usageMode:'CALLABLE',usageCapabilities:{interactive:false,canDelegate:false,acceptsDelegation:true},endpoint:protocol.endpoint,agentCardUrl:protocol.agentCardUrl,a2a:null,authType:'none',authReference:null,internalNetworkOnly:false,configuration:{},skills,specializationId:null,createdAt:date,updatedAt:date,lastDiscoveredAt:date,lastDiscoveryError:null,distribution:null}} as A2aStandardAgentInstanceDetail;
}
function supervisorDetail(id:AgentPlatformId):SupervisorAgentInstanceDetail {
  const platform=getAgentPlatformDefinition(id);
  const instance={schemaVersion:2 as const,id:'fixture-'+id,name:platform.name+' workspace',description:'A desktop workspace for evidence-based review and execution.',runtime:'openshell' as const,agentPlatform:id,policyId:'default',systemPrompt:'Inspect the available evidence and explain the result clearly.',accessPolicyIds:['policy'],skillIds:['skill'],mcpServerIds:['server'],knowledgeSourceIds:['vector'],specializationId:'general',providerAccountId:'provider',providerName:'Preview',modelDeploymentId:'routing',model:'preview-model',modelType:'llm',inferenceMode:'PLATFORM_MANAGED',modelRoutingId:'routing',modelRoutingBindingId:'binding',modelRoutingStatus:'READY',modelRoutingComplianceDomain:'GLOBAL',modelRoutingCapabilities:{automaticRouting:'ENABLED',failover:'ENABLED'},modelRoutingKeyFingerprint:'preview:fingerprint',costKeyAlias:'preview',sandboxName:'preview-'+id,status:'READY',createdAt:date,updatedAt:date,logs:['Workspace created.','Workspace ready.'],memory:{mode:id==='openclaw'?'hybrid':'native',citations:'auto',includeSessionTranscripts:false}};
  return {...shared,id:instance.id,name:instance.name,description:instance.description,kind:'SUPERVISOR',form:'INTERACTIVE',role:'SUPERVISOR',platform:{id,name:platform.name},runtimeView:{type:'OPENSHELL',managed:true},instance,definition:null,protocols:[{...protocol,direction:['CLIENT'],skills:[],capabilities:{...protocol.capabilities,streaming:false}}],capabilities:{...shared.capabilities,interactive:true,canPlan:true,canDelegate:platform.capabilities.canDelegate,acceptsDelegation:false,terminal:true,liveLogs:platform.capabilities.embeddedRunTelemetry}} as SupervisorAgentInstanceDetail;
}
const project={id:'preview',name:'Instance layout preview',department:{id:'preview',name:'Preview',role:'administrator' as const},memberCount:1,assignedRoles:['admin' as const],activeRole:'admin' as const,effectiveCapabilities:['CAP_AGENT_INSTANCE_ACCESS_POLICY_ASSIGN' as const]};
const client=new QueryClient({defaultOptions:{queries:{retry:0}}});
function Shell(){
 const [panelWidth,setPanelWidth]=useState(990); const [dark,setDark]=useState(false); const [restricted,setRestricted]=useState(false); const location=useLocation();
 useEffect(()=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light';},[dark]);
 return <QueryClientProvider client={client}><TooltipProvider><ProjectContext.Provider value={{availableProjects:[project],currentProject:project,error:'',isSwitching:false,loading:false,refreshProjects:async()=>[project],selectProject:async()=>{},switchingProjectId:null}}>
  <div className="border-b bg-warning-surface px-6 py-3 text-sm"><strong>Local layout fixture</strong> · Simulated data and responses. No production API or resource writes.</div>
  <div style={{maxWidth:990}} className="mx-auto flex flex-wrap items-center gap-4 p-6">
    <label className="flex items-center gap-2 text-sm">Instance type<select aria-label="Instance type" value={location.pathname.split('/').at(-1)} className="rounded-md border bg-card p-2" onChange={e=>window.location.assign('/preview/instances/'+e.target.value+'?tab=overview')}>{['a2a-managed','a2a-external','project-agent','a2a-empty','a2a-no-protocol','a2a-lifecycle-error','a2a-discovery-failure','openclaw','deepagents','pi','hermes'].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={restricted} onChange={e=>setRestricted(e.target.checked)} />Restrict permissions</label>
    <label className="flex items-center gap-2 text-sm">Panel width<select aria-label="Panel width" className="rounded-md border bg-card p-2" value={panelWidth} onChange={e=>setPanelWidth(Number(e.target.value))}><option value="990">Standard desktop</option><option value="760">Narrow desktop</option></select></label>
    <Button variant="outline" onClick={()=>setDark(!dark)}>{dark?'Light mode':'Dark mode'}</Button>
  </div>
  <main style={{maxWidth:panelWidth}} className="mx-auto px-6 pb-8"><View restricted={restricted}/></main>
 </ProjectContext.Provider></TooltipProvider></QueryClientProvider>;
}
function View({restricted}:{restricted:boolean}){
 const location=useLocation(); const type=location.pathname.split('/').at(-1)??'a2a-managed'; const tab=normalizeInstanceDetailTab((location.search as {tab?:string}).tab);
 const isSupervisor=['hermes','openclaw','deepagents','pi'].includes(type);
 if(!isSupervisor) return <A2aInstanceDetail key={type} activeTab={tab} canManage={!restricted} canViewLogs={!restricted} detail={serviceDetail(type)} />;
 const detail=supervisorDetail(type as AgentPlatformId);const platform=getAgentPlatformPresentation(type as AgentPlatformId);const access={terminal:{enabled:false,disabledReason:'Executable sessions are disabled in this read-only fixture.'},webUI:{enabled:false,disabledReason:'Native UI is disabled in this read-only fixture.'}};
 return <><InstanceHeader agent={detail.instance} access={access} platform={platform} canDelete={false} onDelete={()=>{}} /><InstanceTabs instanceId={type} active={tab} terminal={access.terminal}/>{tab==='overview'?<InstanceOverviewTab agent={detail.instance} modelRoutingName="Default routing"/>:tab==='configuration'?<InstanceConfigurationTab agent={detail.instance} form={detail.form} role={detail.role} protocol={detail.protocols[0]}/>:tab==='capabilities'?<InstanceCapabilitiesTab agent={detail.instance} capabilities={detail.capabilities} protocol={detail.protocols[0]}/>:tab==='activity'?<AgentInstanceActivityTab detail={detail}/>:tab==='logs'?<InstanceAuditorLogTab agent={detail.instance} includeSandboxAudit={false}/>:<div role="tabpanel" aria-label="Terminal" className="pt-5"><InstanceUnavailablePanel icon={SquareTerminal} title="Fixture terminal unavailable" reason={access.terminal.disabledReason}/></div>}</>;
}
const root=createRootRoute({component:Shell});const route=createRoute({getParentRoute:()=>root,path:'/$projectId/instances/$instanceId',validateSearch:(s)=>({tab:normalizeInstanceDetailTab(s.tab)})});
const router=createRouter({routeTree:root.addChildren([route])});
createRoot(document.getElementById('root')!).render(<RouterProvider router={router}/>);
