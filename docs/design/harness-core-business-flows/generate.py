# -*- coding: utf-8 -*-
from pathlib import Path
from html import escape
import json,re

ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'docs/design/harness-core-business-flows'
scenes=[s for s in json.loads((BASE/'scenarios.json').read_text()) if s['id']!='navigation']
all_icons=json.loads((BASE/'icons.json').read_text())
icons={k:all_icons[k] for k in ['Plus','ChevronRight','Settings','ChevronsUpDown','X','Search','FileText','Bot','Users','Laptop','Cloud','Check','PanelLeft']}
def ic(k):return icons[k]
def rows(items):return '<dl class="wire-rows">'+''.join(f'<div><dt>{a}</dt><dd>{b}</dd></div>' for a,b in items)+'</dl>'
def panel(t,b):return f'<section class="wire-panel"><h3>{t}</h3>{b}</section>'
def field(t,b):return f'<div class="wire-field"><span>{t}</span><div>{b}</div></div>'
def action(t):return f'<span class="wire-action main">{t}</span>'
def step(label,title,body,drawer='',**kw):return dict(label=label,title=title,body=body,drawer=drawer,context='个人 · 个人工作站 / 默认 Project · 本机执行',onboard=False,**kw)
welcome=field('你想完成什么','比较这三家供应商的报价，给出采购建议')+field('相关资料','报价文件、网页链接或文本（可选）')+'<button type="button" class="wire-action main" data-ui="new-task">开始一项工作</button>'
work=panel('当前进展','<p>调研专家已整理三份报价，正在核对税率和交付日期。比较表已保存为草稿。</p>')+rows([('已经完成','收集供应商资料、整理报价'),('正在进行','核对两处信息缺口'),('需要你决定','报价核实后，确认是否发送询价')])+panel('当前成果','<p>供应商比较表 · 草稿</p><p>包含规格、交期、价格与来源；两处信息仍待核实。</p>')
nav=dict(id='navigation',title='Workspace / Project 与 Task 主 Chat',steps=[
step('任务列表','供应商报价比较',work,task='供应商报价比较',tab='工作',task_state='进行中'),
step('展开 Agent 分工','供应商报价比较',work,task='供应商报价比较',tab='工作',task_state='进行中',agent_open=True),
step('Workspace Switcher','供应商报价比较',work,task='供应商报价比较',tab='工作',switcher_open=True),
step('选择 Project','供应商报价比较',work,task='供应商报价比较',tab='工作',project_open=True),
step('新建 Project','开始另一项持续工作',work,task='供应商报价比较',tab='工作',new_project=True),
step('按需打开 Settings','供应商报价比较',work,task='供应商报价比较',tab='工作',settings='project')])
scenes=[nav]+scenes
for scene in scenes:
 for s in scene['steps']:
  s['scene_id']=scene['id']
  s.pop('windows',None)
  if scene['id']!='navigation':s.pop('switcher_open',None)
  s.pop('nav',None)
  if scene['id']=='resources':s['settings']='agents';s['task']='供应商报价比较'
  if scene['id']=='approval':s['settings']='quota';s['task']='供应商报价比较'
  if scene['id']=='delivery' and s['label']=='Memory 候选':s['tab']='成果'
  if scene['id'] in ['task','sandbox']:s['task']='功能方案与变更草稿'
  if scene['id'] in ['browser','delivery','enterprise']:s['task']='供应商报价比较'
  if scene['id'] in ['onboarding','enroll'] and not s.get('admin'):s['empty']=True
  s['title']=s['title'].replace('Task ','').replace('Task','任务')
 if scene['id']=='resources':
  scene['title']='遇到不足后按需调整 Settings'
  scene['steps'][0]['label']='找到问题'
  scene['steps'][0]['settings']=None
  scene['steps'][0]['title']='报价附件需要补充读取工具'
  scene['steps'][0]['body']=panel('需要你处理','<p>已读取网页报价，扫描版附件暂时无法提取文字。</p><p>已完成内容保留，其他资料整理可以继续。</p>')+rows([('影响','两份扫描报价尚未进入比较表'),('推荐处理','使用已提供的文字识别工具'),('其他方式','直接补充可读文本')])+'<button type="button" class="wire-action" data-ui="settings" data-section="tools">查看所需工具</button>'
  scene['steps'][0]['drawer']=''
  scene['steps'][1]['label']='调整默认专家'
  scene['steps'][2]['label']='验证并应用'
 if scene['id']=='onboarding':
  scene['steps'][0]['drawer']=''
  scene['steps'][0]['body']=panel('连接一次，开始工作','<p>选择你已使用的模型服务并提供必要授权。</p>')+field('模型服务','你已有的服务（示例）')+field('访问密钥','••••••••')+action('连接并验证')+'<p class="wire-note">云模型会接收本次获准的工作资料。其他设置由系统准备。</p>'
  scene['steps'][1]['body']=rows([('默认 Workspace / Project','已建立'),('模型连接','验证通过'),('资料与浏览器','已就绪'),('工作环境','准备中')])+'<p>正在准备工作环境，完成后就可以提交目标。</p><details><summary>查看准备详情</summary><p>专家、Memory、Skill、MCP 与 Sandbox 按真实准备状态展示。</p></details>'
  scene['steps'][1]['drawer']=''
  scene['steps'][2]['title']='开始你的第一项工作';scene['steps'][2]['body']=welcome;scene['steps'][2]['drawer']=''
 if scene['id']=='task':
  scene['steps'][0]['body']=field('你想完成什么','根据仓库与需求说明，给出功能方案和可验证的变更草稿')+field('相关资料','需求说明.md · 已授权仓库文件')+panel('先给出一份可检查的方案','<p>系统安排负责人和所需专家，你可以在任务中查看或调整分工。</p>')+action('创建任务')
 if scene['id']=='enroll':
  scene['steps'][-1]['title']='开始你的第一项企业工作';scene['steps'][-1]['body']=welcome;scene['steps'][-1]['drawer']=''
 if scene['id']=='enterprise':
  scene['steps'][0]['body']=field('你想完成什么','核对本周采购报价，整理比较表和待确认事项')+field('相关资料','当前 Project 中获准的采购资料')+panel('团队已经准备好','<p>企业已提供默认专家、工具与工作环境，可以直接提交目标。</p>')+action('开始工作')
  scene['steps'][0]['drawer']=''

css=(ROOT/'apps/control/src/styles.css').read_text()
light=dict(re.findall(r'(--[\w-]+):\s*([^;]+);',re.search(r':root \{(.*?)\n\}',css,re.S).group(1)))
dark={**light,**dict(re.findall(r'(--[\w-]+):\s*([^;]+);',re.search(r'\.dark \{(.*?)\n\}',css,re.S).group(1)))}
def resolve(m,k):
 v=m[k]
 while re.search(r'var\((--[\w-]+)\)',v):v=re.sub(r'var\((--[\w-]+)\)',lambda x:m[x.group(1)],v)
 return v
roles={'bg':'--background','fg':'--foreground','card':'--card','soft':'--muted','line':'--border','muted':'--muted-foreground','primary':'--primary','primary-fg':'--primary-foreground','active':'--sidebar-active','active-fg':'--sidebar-active-foreground','ring':'--ring','edit':'--edit-surface','edit-fg':'--edit-foreground'}
tokens=';'.join(f'--desk-{n}:light-dark({resolve(light,k)},{resolve(dark,k)})' for n,k in roles.items())

STYLE=r'''<style>
.harness-desk{color-scheme:light dark;TOKENS;--desk-nav:light-dark(#eff0f2,#1d232d);--desk-selected:light-dark(#dce2e9,#384353);--desk-overlay:light-dark(rgb(25 35 50 / .12),rgb(0 0 0 / .3));font:13px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;color:var(--desk-fg)}
.harness-desk *{box-sizing:border-box}.harness-desk button,.harness-desk input,.harness-desk textarea{font:inherit;color:inherit}.harness-desk button{background:var(--desk-card);border:1px solid var(--desk-line);border-radius:5px;padding:5px 10px;text-align:left}.harness-desk button:hover{background:var(--desk-soft)}.harness-desk button:focus-visible,.harness-desk input:focus-visible,.harness-desk textarea:focus-visible,.harness-desk summary:focus-visible{outline:2px solid var(--desk-ring);outline-offset:2px}.harness-desk svg{width:15px;height:15px;vertical-align:middle;flex-shrink:0}.harness-desk h1,.harness-desk h2,.harness-desk h3{font-weight:500}.harness-desk .document-header h1{font-size:23px;margin:0}.harness-desk .document-header p,.harness-desk .sketch-label{color:var(--desk-muted);font-size:12px}.harness-desk .scene-heading{font-size:17px;margin:18px 0 6px}.harness-desk .scene-index{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0}.harness-desk .scene-index button{font-size:12px}.harness-desk .sketch-toolbar{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}.harness-desk .sketch-toolbar button[aria-pressed=true],.harness-desk .scene-index button[aria-pressed=true]{background:var(--desk-selected);border-color:var(--desk-line);font-weight:500}.harness-desk .wire-window{position:relative;border:1px solid var(--desk-line);border-radius:10px;background:var(--desk-card);overflow:hidden;container:desk-frame / inline-size;box-shadow:0 3px 12px var(--desk-overlay)}
.harness-desk .wire-titlebar{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:48px;background:var(--desk-nav);border-bottom:1px solid var(--desk-line)}.harness-desk .titlebar-left{display:flex;align-items:center;padding:0 16px;gap:16px}.harness-desk .window-dots{display:flex;gap:8px}.harness-desk .window-dots i{width:11px;height:11px;border-radius:50%;background:light-dark(#c7cacf,#576170);border:1px solid var(--desk-line)}.harness-desk .toolbar-title{display:flex;align-items:center;gap:12px;padding:8px 18px;min-width:0}.harness-desk .toolbar-title strong{font-weight:500;flex:1;overflow-wrap:anywhere}.harness-desk .toolbar-button{display:flex;gap:6px;align-items:center;padding:3px 7px;font-size:12px;background:transparent;border-color:transparent}.harness-desk .wire-layout{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:620px}.harness-desk .wire-nav{position:relative;display:flex;flex-direction:column;background:var(--desk-nav);border-right:1px solid var(--desk-line);padding:12px 10px 0;min-width:0}.harness-desk .project-heading{display:flex;align-items:center;border-top:1px solid var(--desk-line);padding:8px 0;margin-bottom:8px}.harness-desk .project-heading button{background:transparent;border:0;padding:5px}.harness-desk .project-picker{display:flex;align-items:center;gap:7px;flex:1;min-width:0}.harness-desk .project-picker span{flex:1;overflow-wrap:anywhere}.harness-desk .chat-label{font-size:12px;color:var(--desk-muted);margin-top:12px}.harness-desk form textarea{min-height:70px;margin:7px 0}.harness-desk .project-popover{top:125px}.harness-desk .workspace-switcher{display:flex;align-items:center;gap:8px;width:100%;background:transparent;border-color:transparent;padding:7px 8px;margin-bottom:10px}.harness-desk .workspace-identity{flex:1;min-width:0}.harness-desk .workspace-identity strong{display:block;font-weight:500;font-size:13px}.harness-desk .workspace-identity small{display:block;color:var(--desk-muted);font-size:11px}.harness-desk .task-list-heading{display:flex;align-items:center;justify-content:space-between;padding:3px 8px;color:var(--desk-muted);font-size:12px}.harness-desk .task-list-heading button{padding:3px 5px;background:transparent;border:0}.harness-desk .task-collection{display:flex;flex-direction:column;gap:4px;margin:8px 0 20px}.harness-desk .task-row{display:flex;align-items:center;gap:3px;border-radius:5px;padding:2px 4px}.harness-desk .task-row.selected{background:var(--desk-selected)}.harness-desk .disclosure{padding:4px 2px;width:22px;border:0;background:transparent}.harness-desk .disclosure[aria-expanded=true] svg{transform:rotate(90deg)}.harness-desk .task-select{display:flex;flex:1;gap:7px;align-items:flex-start;border:0;background:transparent;padding:6px 3px;min-width:0}.harness-desk .task-select span{min-width:0;flex:1}.harness-desk .task-select strong{display:block;font-weight:500;font-size:13px;overflow-wrap:anywhere}.harness-desk .task-select small{display:block;color:var(--desk-muted);font-size:11px}.harness-desk .task-children{padding:3px 3px 7px 24px}.harness-desk [hidden]{display:none!important}.harness-desk .agent-select{display:flex;align-items:center;gap:7px;background:transparent;border:0;width:100%;padding:5px 6px;font-size:12px}.harness-desk .agent-select.selected{background:var(--desk-selected)}.harness-desk .agent-select small{margin-left:auto;color:var(--desk-muted);font-size:11px}.harness-desk .agent-job{border-left:1px solid var(--desk-line);margin:3px 6px 4px 13px;padding:0 0 0 13px;color:var(--desk-muted);font-size:11px}.harness-desk .sidebar-footer{display:flex;margin-top:auto;align-items:center;padding:11px 7px;border-top:1px solid var(--desk-line)}.harness-desk .sidebar-footer button{background:transparent;border-color:transparent;display:flex;gap:7px;align-items:center}.harness-desk .sidebar-footer small{margin-left:auto;color:var(--desk-muted);font-size:11px}.harness-desk .empty-list{color:var(--desk-muted);padding:12px 8px;font-size:12px}
.harness-desk .wire-main{margin:0;max-width:none;width:100%;min-width:0;container:desk-main / inline-size}.harness-desk .task-tabs{display:flex;align-items:center;gap:2px;padding:10px 22px 0;border-bottom:1px solid var(--desk-line);background:var(--desk-bg)}.harness-desk .task-tabs span{display:block;padding:5px 10px 8px;color:var(--desk-muted);font-size:12px}.harness-desk .task-tabs span.active{color:var(--desk-fg);border-bottom:2px solid var(--desk-primary)}.harness-desk .task-tabs small{margin-left:auto;color:var(--desk-muted);font-size:11px}.harness-desk .wire-content{padding:24px 28px}.harness-desk .wire-content>h2{font-size:20px;margin:0 0 18px}.harness-desk .wire-columns{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:0}.harness-desk .wire-columns.only-body{grid-template-columns:minmax(0,1fr)}.harness-desk .wire-body{min-width:0}.harness-desk .wire-body>h3{font-size:14px;margin-top:0}.harness-desk .wire-drawer{border-left:1px solid var(--desk-line);padding:0 0 0 20px;margin-left:24px;min-width:0}.harness-desk .wire-drawer>h3{font-size:14px;margin:0 0 14px}.harness-desk .wire-panel{border:0;border-bottom:1px solid var(--desk-line);border-radius:0;padding:0 0 14px;margin:0 0 18px;background:transparent}.harness-desk .wire-panel h3{font-size:14px;margin:0 0 8px}.harness-desk .wire-panel p{margin:8px 0}.harness-desk .wire-rows{margin:0 0 16px}.harness-desk .wire-rows>div{display:grid;grid-template-columns:minmax(70px,.36fr) minmax(0,1fr);gap:12px;padding:8px 0;border-bottom:1px solid var(--desk-line)}.harness-desk .wire-rows dt{color:var(--desk-muted);font-size:12px}.harness-desk .wire-rows dd{margin:0;overflow-wrap:anywhere}.harness-desk .wire-field{margin:0 0 16px}.harness-desk .wire-field>span{display:block;font-size:12px;color:var(--desk-muted);margin-bottom:5px}.harness-desk .wire-field>div{padding:9px 11px;border:1px solid var(--desk-line);border-radius:5px;background:var(--desk-bg)}.harness-desk .wire-action{display:inline-block;padding:5px 12px;border:1px solid var(--desk-line);border-radius:5px;background:var(--desk-soft);margin:4px 5px 8px 0}.harness-desk .wire-action.main{background:var(--desk-primary);color:var(--desk-primary-fg);border-color:var(--desk-primary)}.harness-desk .wire-note{font-size:12px;color:var(--desk-muted);margin:12px 0;line-height:1.65}.harness-desk table{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:12px;table-layout:fixed}.harness-desk th{text-align:left;font-weight:500;color:var(--desk-muted);background:var(--desk-bg)}.harness-desk td,.harness-desk th{border-bottom:1px solid var(--desk-line);padding:8px;overflow-wrap:anywhere}.harness-desk .node-flow{display:flex;align-items:stretch;flex-wrap:wrap;gap:7px;margin:0 0 18px}.harness-desk .flow-node{background:var(--desk-bg);border:1px solid var(--desk-line);border-radius:4px;padding:8px 10px;font-size:12px}.harness-desk .flow-arrow{align-self:center;color:var(--desk-muted)}.harness-desk .wire-browser{border:1px solid var(--desk-line);border-radius:5px;padding:16px;margin-bottom:16px}.harness-desk .address{padding:6px 10px;margin:-16px -16px 16px;background:var(--desk-bg);border-bottom:1px solid var(--desk-line);color:var(--desk-muted);font-size:11px}.harness-desk .two-policies{display:grid;grid-template-columns:1fr 1fr;gap:20px}.harness-desk details{padding:8px 0}.harness-desk summary{font-size:12px}.harness-desk .notice{border-left:2px solid var(--desk-edit-fg);padding:7px 12px;background:var(--desk-edit);margin-bottom:14px}.harness-desk textarea{resize:vertical;width:100%;min-height:130px;border:1px solid var(--desk-line);border-radius:5px;padding:12px;background:var(--desk-card)}
.harness-desk .switcher-popover{position:absolute;left:8px;top:68px;width:310px;max-width:calc(100cqw - 20px);z-index:20;background:var(--desk-card);border:1px solid var(--desk-line);border-radius:7px;box-shadow:0 8px 24px var(--desk-overlay);padding:8px}.harness-desk .switcher-search{padding:2px 4px 8px}.harness-desk .switcher-search input{width:100%;padding:6px 9px;border:1px solid var(--desk-line);background:var(--desk-bg);border-radius:5px}.harness-desk .switcher-group{font-size:11px;color:var(--desk-muted);padding:8px 7px 3px}.harness-desk .workspace-entry{display:flex;align-items:center;gap:3px;border-radius:4px}.harness-desk .workspace-entry.current{background:var(--desk-selected)}.harness-desk .workspace-entry button{border:0;background:transparent;padding:7px}.harness-desk .entry-main{flex:1;display:flex;align-items:center;gap:8px}.harness-desk .entry-main small{display:block;font-size:11px;color:var(--desk-muted)}.harness-desk .entry-settings{width:32px}.harness-desk .switcher-note{border-top:1px solid var(--desk-line);padding:9px 7px 2px;font-size:11px;color:var(--desk-muted)}
.harness-desk .settings-scrim{position:absolute;inset:48px 0 0;background:var(--desk-overlay);z-index:30}.harness-desk .settings-sheet{position:relative;width:calc(100% - 48px);max-width:820px;margin:22px auto;background:var(--desk-card);border:1px solid var(--desk-line);border-radius:8px;box-shadow:0 12px 32px var(--desk-overlay);overflow:hidden}.harness-desk .settings-header{display:flex;align-items:center;padding:13px 16px;gap:9px;border-bottom:1px solid var(--desk-line);background:var(--desk-nav)}.harness-desk .settings-header h3{margin:0;font-size:14px;flex:1}.harness-desk .settings-header button{border-color:transparent;padding:3px;background:transparent}.harness-desk .settings-grid{display:grid;grid-template-columns:170px minmax(0,1fr);min-height:430px}.harness-desk .settings-nav{background:var(--desk-bg);border-right:1px solid var(--desk-line);padding:12px 8px}.harness-desk .settings-nav button{background:transparent;border:0;width:100%;margin:2px 0;padding:7px 9px;font-size:12px}.harness-desk .settings-nav button.active{background:var(--desk-selected);font-weight:500}.harness-desk .settings-main{padding:22px;min-width:0}.harness-desk .settings-main h2{font-size:17px;margin:0 0 8px}.harness-desk .settings-context{font-size:11px;color:var(--desk-muted);margin:0 0 20px}.harness-desk .settings-main .wire-columns{grid-template-columns:minmax(0,1fr)}.harness-desk .settings-main .wire-drawer{margin:16px 0 0;border-left:0;border-top:1px solid var(--desk-line);padding:14px 0 0}.harness-desk .settings-footer{border-top:1px solid var(--desk-line);padding:10px 16px;text-align:right;font-size:11px;color:var(--desk-muted)}.harness-desk .onboard .wire-titlebar{grid-template-columns:1fr}.harness-desk .onboard .toolbar-title{display:none}.harness-desk .onboard .wire-layout{grid-template-columns:1fr;min-height:480px}.harness-desk .onboard .wire-content{max-width:700px;margin:0 auto;padding:42px}.harness-desk .onboard .wire-columns{grid-template-columns:1fr}.harness-desk .onboard .wire-drawer{border:0;margin:18px 0 0;padding:0}.harness-desk .collapsed-layout{grid-template-columns:0 minmax(0,1fr)}.harness-desk .collapsed-layout .wire-nav{overflow:hidden;padding:0;border:0}.harness-desk .admin-links{display:grid;gap:4px;padding:10px 0}.harness-desk .admin-links span{padding:8px;font-size:12px}
@container desk-main (max-width:760px){.harness-desk .wire-columns{grid-template-columns:1fr}.harness-desk .wire-drawer{margin:18px 0 0;padding:16px 0 0;border-left:0;border-top:1px solid var(--desk-line)}.harness-desk .wire-content{padding:22px}.harness-desk .two-policies{grid-template-columns:1fr}}
@container desk-frame (max-width:700px){.harness-desk .wire-titlebar{grid-template-columns:110px minmax(0,1fr)}.harness-desk .wire-layout{grid-template-columns:190px minmax(0,1fr)}.harness-desk .toolbar-title{flex-wrap:wrap;gap:4px;padding:8px}.harness-desk .toolbar-title strong{flex-basis:100%}.harness-desk .settings-grid{grid-template-columns:130px minmax(0,1fr)}.harness-desk .settings-sheet{width:calc(100% - 24px)}.harness-desk .settings-main{padding:16px}.harness-desk .collapsed-layout{grid-template-columns:0 minmax(0,1fr)}.harness-desk .onboard .wire-titlebar,.harness-desk .onboard .wire-layout{grid-template-columns:1fr}}
@media print{.harness-desk .scene-index,.harness-desk .sketch-toolbar{display:none}}
</style>'''.replace('TOKENS',tokens)

def agent_data(s):
 coding=s['scene_id'] in ['task','sandbox']
 status=['统筹中','进行中','等待输入']
 if s['scene_id']=='delivery':status=['已交付','已完成','已完成']
 if s['scene_id']=='enterprise' and s['label']=='断连恢复':status=['待同步']*3
 if s['scene_id']=='resources' and s['label']=='找到问题':status=['需要处理','部分受阻','等待资料']
 if s['scene_id']=='approval':status=['等待预算调整','等待预算调整','等待输入']
 return [dict(name='负责人',job='组织步骤与确认目标',state=status[0]),dict(name='执行专家' if coding else '调研专家',job='生成代码变更与检查' if coding else '读取报价与供应商页面',state=status[1]),dict(name='审查专家',job='核对测试和交付证据' if coding else '核对来源、价格和交期',state=status[2])]
def sidebar(s):
 personal=s['context'].startswith('个人');name='个人工作站' if personal else '采购工作站'
 workspace=f'<button type="button" class="workspace-switcher" data-ui="switcher" aria-label="Workspace Switcher 当前 {name}" aria-expanded="false">{ic("FolderKanban") if "FolderKanban" in icons else ic("FileText")}<span class="workspace-identity"><strong>{name}</strong><small>{"个人 · 本机" if personal else "示例公司 / 采购 · 企业"}</small></span>{ic("ChevronsUpDown")}</button>'
 if s.get('admin'):
  return '<aside class="wire-nav" aria-label="企业管理工作台"><strong>示例公司 · Organization</strong><div class="admin-links">'+''.join('<span>'+x+'</span>' for x in ['身份与 SSO','成员与角色','Department','Workspace 分配','Project 访问','Enroll 配置','审批与审计'])+'</div><p class="wire-note">管理员工作台，成员桌面使用任务列表。</p></aside>'
 project_picker='<div class="project-heading"><button type="button" class="project-picker" data-ui="project-picker" aria-label="选择当前 Project 默认 Project" aria-expanded="false">'+ic('FileText')+'<span>默认 Project</span>'+ic('ChevronRight')+'</button><button type="button" data-ui="settings" data-section="project" aria-label="当前 Project 设置">'+ic('Settings')+'</button></div>'
 heading='<div class="task-list-heading"><span>任务</span><button type="button" data-ui="new-task" aria-label="新任务">'+ic('Plus')+'</button></div>'
 if s.get('empty'):tree='<div class="task-collection" aria-label="Task 列表"><p class="empty-list">还没有任务<br>提交目标后，工作会出现在这里。</p></div>'
 else:
  names=[s.get('task','供应商报价比较'),'产品上线准备','整理客户访谈']
  states=[s.get('task_state','等待你处理') if s['scene_id']=='approval' else s.get('task_state','进行中'),'草稿','已完成']
  parts=[]
  for i,(t,st) in enumerate(zip(names,states)):
   expanded=i==0
   agents=''.join('<button type="button" class="agent-select" data-ui="agent" data-agent="'+str(j)+'">'+ic('Bot')+'<span>'+a['name']+'</span><small>'+(a['state'] if i==0 else ('待安排' if st=='草稿' else '已完成'))+'</small></button><div class="agent-job" '+('' if s.get('agent_open') else 'hidden')+'>'+a['job']+'</div>' for j,a in enumerate(agent_data(s)))
   parts.append(f'<section class="task-tree"><div class="task-row {"selected" if i==0 else ""}"><button type="button" class="disclosure" data-ui="task-disclosure" aria-label="展开 {t} 的 Agent 分工" aria-expanded="{str(expanded).lower()}">{ic("ChevronRight")}</button><button type="button" class="task-select" data-ui="select-task" data-task="{t}" data-task-state="{st}">{ic("FileText")}<span><strong>{t}</strong><small>{st}</small></span></button></div><div class="task-children" {"" if expanded else "hidden"}>{agents}</div></section>')
  tree='<div class="task-collection" aria-label="Task 列表">'+''.join(parts)+'</div>'
 footer='<div class="sidebar-footer"><button type="button" data-ui="settings" data-section="general" aria-label="打开 Settings">'+ic('Settings')+'<span>设置</span></button><small>Harness</small></div>'
 return '<aside class="wire-nav" aria-label="当前 Project 的任务列表">'+workspace+project_picker+heading+tree+footer+'</aside>'
def window(s):
 ison=s.get('onboard',False);admin=s.get('admin',False);has_drawer=bool(s.get('drawer')) and not s.get('settings')
 execution='本机' if s['context'].startswith('个人') else '企业'
 title='Harness' if ison else s.get('task',s['title'])
 titlebar='<div class="wire-titlebar"><div class="titlebar-left"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span>'+('' if ison else '<button type="button" class="toolbar-button" data-ui="collapse" aria-label="显示或隐藏任务侧栏">'+ic('PanelLeft')+'</button>')+'</div><div class="toolbar-title"><strong>'+escape(title)+'</strong><button type="button" class="toolbar-button" data-ui="task-details">'+ic('Users')+' 分工</button><button type="button" class="toolbar-button" data-ui="next-decision">需要你处理</button></div></div>'
 tabs='<div class="task-tabs">'+''.join('<span class="'+('active' if x==('主 Chat' if s.get('tab','工作')=='工作' else s.get('tab')) else '')+'">'+x+'</span>' for x in ['主 Chat','计划','浏览器','成果','详情'])+'<small>'+execution+'执行</small></div>' if not ison and not admin and not s.get('empty') else ''
 body=s['body'];drawer=s.get('drawer','')
 if s['scene_id']=='navigation':
  body=panel('主 Chat','<p class="chat-label">你</p><p>比较这三家供应商的报价，给出采购建议。</p><p class="chat-label">负责人</p><p>已安排调研与审查专家。两处信息待核实，比较表已保存为草稿。</p>')+body+'<div data-chat-history></div><form data-chat-form><label for="'+s['scene_id']+'-reply">继续这项工作</label><textarea id="'+s['scene_id']+'-reply" name="reply" placeholder="补充要求或继续追问" required></textarea><button type="submit" class="wire-action main">发送</button><p class="wire-note">追加到同一 Task 的主 Chat · 线稿演示，不执行或计费</p></form>'
 if s.get('settings'):
  body=panel('当前进展','<p>等待所需工具或配置调整。已完成内容保留，其他获准的工作可以继续。</p>');drawer=''
 return f'<div class="wire-window {"onboard" if ison else ""}">{titlebar}<div class="wire-layout">{"" if ison else sidebar(s)}<main class="wire-main">{tabs}<div class="wire-content"><h2>{escape(s["title"])}</h2><div class="wire-columns {"" if has_drawer else "only-body"}"><div class="wire-body">{body}</div>{"<aside class=wire-drawer>"+drawer+"</aside>" if has_drawer else ""}</div></div></main></div></div>'
for scene in scenes:
 for s in scene['steps']:s['agents']=agent_data(s)
 scene['windows']=[window(s) for s in scene['steps']]

SCRIPT=r'''<script>
(()=>{
 const root=document.getElementById(ROOT_ID),scenes=SCENES,icons=ICONS;
 const stage=root.querySelector('[data-stage]'),toolbar=root.querySelector('[data-steps]'),index=root.querySelector('[data-scene-index]');
 const state={scene:0,step:0,settings:null,workspace:null,project:'默认 Project',task:null,selectedAgent:null};const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\"','&quot;');const workProjects={};const chatTurns={};let settingsObserver=null;
 const sections=[['project','当前 Project'],['general','通用与成员'],['models','模型与连接'],['agents','专家与分工'],['tools','工具与连接'],['memory','记忆与资料'],['environment','执行环境'],['quota','预算与配额'],['records','记录与策略']];
 const current=()=>scenes[state.scene].steps[state.step];
 const identity=()=>state.workspace||{name:current().context.startsWith('个人')?'个人工作站':'采购工作站',personal:current().context.startsWith('个人')};
 const taskName=()=>state.task||current().task||'供应商报价比较';
 function closePopover(){root.querySelectorAll('.switcher-popover').forEach(x=>x.remove());root.querySelectorAll('.workspace-switcher,.project-picker').forEach(x=>x.setAttribute('aria-expanded','false'));}
 function showWorkspaces(){
  closePopover();const id=identity(),el=document.createElement('section');el.className='switcher-popover';el.setAttribute('role','dialog');el.setAttribute('aria-label','Workspace Switcher');
  const workspaces=[{name:'个人工作站',group:'个人',personal:true},{name:'内容工作站',group:'个人',personal:true},{name:'采购工作站',group:'示例公司 / 采购',personal:false},{name:'研发工作站',group:'示例公司 / 研发',personal:false}];
  const groups=[...new Set(workspaces.map(p=>p.group))].sort((a,b)=>Number(workspaces.some(p=>p.group===b&&p.name===id.name))-Number(workspaces.some(p=>p.group===a&&p.name===id.name)));
  el.innerHTML='<div class="switcher-search"><input type="search" data-search-workspace aria-label="搜索 Workspace" placeholder="搜索 Workspace"></div>'+groups.map(g=>'<div data-workspace-group><div class="switcher-group">'+g+'</div>'+workspaces.filter(p=>p.group===g).map(p=>'<div class="workspace-entry '+(p.name===id.name?'current':'')+'" data-workspace-row data-filter="'+p.name+' '+g+'"><button type="button" class="entry-main" data-ui="workspace" data-name="'+p.name+'" data-personal="'+p.personal+'">'+icons.FileText+'<span>'+p.name+'<small>'+(p.personal?'个人 · 本机':'企业 · 已授权')+'</small></span>'+(p.name===id.name?icons.Check:'')+'</button>'+(p.name===id.name?'<button type="button" class="entry-settings" data-ui="settings" data-section="general" aria-label="设置当前 Workspace">'+icons.Settings+'</button>':'')+'</div>').join('')+'</div>').join('')+'<div class="switcher-note">切换资源与治理环境，打开其默认 Project；原工作保留归属。</div>';
  root.querySelector('.wire-nav').appendChild(el);root.querySelector('.workspace-switcher').setAttribute('aria-expanded','true');el.querySelector('input').focus();
 }
 function showWorkProjects(){
  closePopover();const el=document.createElement('section');el.className='switcher-popover project-popover';el.setAttribute('role','dialog');el.setAttribute('aria-label','选择 Project');const list=workProjects[identity().name]||['默认 Project','产品上线','客户研究'];
  el.innerHTML='<div class="switcher-group">'+identity().name+' 中的持续工作</div>'+list.map(p=>'<div class="workspace-entry"><button type="button" class="entry-main" data-ui="work-project" data-name="'+esc(p)+'">'+icons.FileText+'<span>'+esc(p)+'</span>'+(p===state.project?icons.Check:'')+'</button></div>').join('')+'<button type="button" class="entry-main" data-ui="new-project">'+icons.Plus+' 新建 Project</button><div class="switcher-note">资料、Memory 与 Task 分别保存；沿用 Workspace 的资源。</div>';
  root.querySelector('.wire-nav').append(el);root.querySelector('.project-picker').setAttribute('aria-expanded','true');el.querySelector('button').focus();
 }
 function loadProject(){
  state.task=null;applyWorkspace();root.querySelector('.task-collection').innerHTML='<p class="empty-list">'+esc(state.project)+' 的 Task 列表独立加载。<br>原 Project 的聊天与资料留在原处。</p>';root.querySelector('.toolbar-title strong').textContent=state.project;root.querySelectorAll('.toolbar-title .toolbar-button').forEach(b=>b.hidden=true);root.querySelector('.wire-content').innerHTML='<h2>'+esc(state.project)+'</h2><p>资源已经准备好，直接开始工作。</p><button type="button" class="wire-action main" data-ui="new-task">新任务</button><p class="wire-note">'+identity().name+' / '+esc(state.project)+' · '+(identity().personal?'本机执行':'企业受控执行、计费与治理')+'</p>';
 }
 function newProject(){
  closeSettings();root.querySelector('.toolbar-title strong').textContent='新建 Project';root.querySelector('.wire-content').innerHTML='<h2>开始另一项持续工作</h2><form data-project-form><label for="'+root.id+'-project-name">Project 名称或一句工作目标</label><textarea id="'+root.id+'-project-name" name="name" placeholder="例如：产品上线" maxlength="80" required></textarea><p>沿用 '+identity().name+' 已准备的模型、专家、工具与执行环境。</p><p class="wire-note">创建独立资料、Memory 和 Task 列表；不增加 Workspace 余额。</p><button type="submit" class="wire-action main">创建 Project</button><p data-form-result role="status"></p></form>';root.querySelector('textarea').focus();
 }
 function chatForm(){return '<div data-chat-history></div><form data-chat-form><label for="'+root.id+'-reply">继续这项工作</label><textarea id="'+root.id+'-reply" name="reply" placeholder="补充要求或继续追问" required></textarea><button type="submit" class="wire-action main">发送</button><p class="wire-note">同一 Task 的主 Chat · 线稿演示，不执行或计费</p></form>';}
 function appendChat(text){const box=root.querySelector('[data-chat-history]');if(!box)return;const p=document.createElement('p');p.textContent='你：'+text;box.append(p);const reply=document.createElement('p');reply.className='wire-note';reply.textContent='要求已追加到本 Task 的主 Chat（演示）；没有新建 Task。';box.append(reply);}
 function closeSettings(){settingsObserver?.disconnect();settingsObserver=null;root.querySelector('.settings-scrim')?.remove();root.querySelector('.wire-window')?.style.removeProperty('min-height');root.querySelectorAll('.wire-titlebar,.wire-layout').forEach(e=>e.inert=false);state.settings=null;root.querySelector('[aria-label="打开 Settings"]')?.focus();}
 function settingsContent(key){
  if(current().settings===key&&state.workspace===null&&['resources','approval'].includes(current().scene_id))return {body:current().body,drawer:current().drawer||''};
  const enterprise=!identity().personal;
  const content={
   project:'<dl class="wire-rows"><div><dt>工作名称</dt><dd>'+esc(state.project)+'</dd></div><div><dt>所属 Workspace</dt><dd>'+identity().name+'</dd></div><div><dt>资料与记忆</dt><dd>本 Project 独立资料与 Memory；共享集合只按明确授权读取</dd></div><div><dt>可用资源</dt><dd>默认继承 Workspace 获准模型、专家与工具，可按需收紧</dd></div><div><dt>预算</dt><dd>沿用 Workspace 总额度；可选子额度不会增加总余额</dd></div></dl><p>新 Project 不重复连接模型或部署环境。</p>',
   general:'<dl class="wire-rows"><div><dt>名称</dt><dd>'+identity().name+'</dd></div><div><dt>成员</dt><dd>'+(enterprise?'企业已分配的成员与角色':'你')+'</dd></div><div><dt>准备状态</dt><dd>按实际就绪状态显示</dd></div></dl>',
   models:'<h3>默认模型</h3><p>已就绪，任务按默认策略使用。</p><details><summary>查看模型与连接的详细设置</summary><p>Providers、Models、Routing 与连接验证集中在这里；只显示当前 Workspace 获授权候选。</p></details>',
   agents:'<h3>默认专家安排</h3><p>系统按工作目标分配负责人和所需专家，普通任务无需预先配置。</p><dl class="wire-rows"><div><dt>调研专家</dt><dd>整理资料与核对来源</dd></div><div><dt>执行专家</dt><dd>完成指定产物</dd></div><div><dt>审查专家</dt><dd>检查成果与证据</dd></div></dl><p>默认专家变更用于后续任务；本次分工从任务内查看。</p>',
   tools:'<h3>这项工作需要的工具</h3><dl class="wire-rows"><div><dt>浏览器</dt><dd>已准备</dd></div><div><dt>文本处理</dt><dd>已准备</dd></div><div><dt>扫描附件文字识别</dt><dd>按实际可用状态验证后启用</dd></div></dl><details><summary>高级工具设置</summary><p>Skill、MCP 连接与工具授权。不会因为查看设置自动安装或授予权限。</p></details>',
   memory:'<h3>记忆与资料</h3><p>Workspace 管理 Memory 服务与获准共享集合。本 Project 记忆独立；跨 Project 分享需明确发布与授权。</p><p>任务经验在成果中先形成候选，按用户确认或企业策略写入。</p>',
   environment:'<h3>默认执行位置</h3><p>'+(enterprise?'企业受控环境，Sandbox、浏览器与工具按企业授权执行。':'本机受控环境，Sandbox 与浏览器已由初始化准备。')+'</p><details><summary>执行环境详情</summary><p>查看实例、Sandbox、运行限制与真实状态。</p></details>',
   quota:'<h3>Workspace 预算与配额</h3><p>总额度、可选 Project 子额度和 Task 上限共同约束一次消耗。查看已记录、在途预留和未知费用。</p><p>预算修改绑定原值、新值与已有义务。'+(enterprise?'按企业权限与严格 / 动态策略审批。':'修改前确认具体影响。')+'</p>',
   records:'<h3>记录与策略</h3><p>按当前权限查看追踪记录、访问与运行策略'+(enterprise?'、审计和审批记录':'')+'。</p><p>本任务的费用和运行问题也可从任务详情查看。</p>'
  };
  return {body:content[key]||content.general,drawer:enterprise?'<p>由企业提供的配置按维护权限显示；受管控修改执行企业审批，成员可向管理员申请。</p>':'<p>只在默认工具不能满足当前工作时调整设置。修改、验证与应用按具体对象显示。</p>'};
 }
 function openSettings(key='general'){
  closePopover();settingsObserver?.disconnect();root.querySelector('.settings-scrim')?.remove();state.settings=key;
  const val=settingsContent(key),sheet=document.createElement('div');sheet.className='settings-scrim';
  sheet.innerHTML='<section class="settings-sheet" role="dialog" aria-modal="true" aria-label="Settings 当前 Workspace 与 Project"><div class="settings-header"><h3>设置 · '+identity().name+'</h3><button type="button" data-ui="close-settings" aria-label="关闭 Settings">'+icons.X+'</button></div><div class="settings-grid"><nav class="settings-nav" aria-label="Settings 分区">'+sections.map(([k,label])=>'<button type="button" data-ui="settings-section" data-section="'+k+'" class="'+(k===key?'active':'')+'">'+label+'</button>').join('')+'</nav><div class="settings-main"><h2>'+sections.find(([k])=>k===key)[1]+'</h2><p class="settings-context">'+identity().name+' / '+esc(state.project)+' · '+(identity().personal?'个人 · 本机':'企业 · 受控执行 / 企业计费')+'</p><div class="wire-columns"><div class="wire-body">'+val.body+'</div>'+(val.drawer?'<aside class="wire-drawer">'+val.drawer+'</aside>':'')+'</div></div></div><div class="settings-footer">只查看不会改变配置；修改显示具体差异、验证与应用结果。</div></section>';
  root.querySelector('.wire-window').appendChild(sheet);root.querySelectorAll('.wire-titlebar,.wire-layout').forEach(e=>e.inert=true);
  const panel=sheet.querySelector('.settings-sheet');settingsObserver=new ResizeObserver(()=>{const frame=root.querySelector('.wire-window');if(frame)frame.style.minHeight=Math.max(frame.querySelector('.wire-layout').offsetHeight+48,panel.offsetHeight+95)+'px';});settingsObserver.observe(panel);sheet.querySelector('.settings-nav .active').focus();
 }
 function showAgent(n){
  const coding=['task','sandbox'].includes(current().scene_id),agents=[{name:'负责人',job:'组织步骤与确认目标',output:'可检查的计划和交接',status:'统筹中'},{name:coding?'执行专家':'调研专家',job:coding?'生成代码变更与检查':'读取报价与供应商页面',output:coding?'变更草稿与检查记录':'比较表草稿与来源',status:'进行中'},{name:'审查专家',job:coding?'核对测试和交付证据':'核对来源、价格和交期',output:'审查意见与待核实项',status:'等待输入'}];
  const a=agents[n];if(current().agents?.[n])a.status=current().agents[n].state;const selectedRow=root.querySelector('.task-row.selected [data-task-state]');if(selectedRow?.dataset.taskState==='草稿')a.status='待安排';if(selectedRow?.dataset.taskState==='已完成')a.status='已完成';const columns=root.querySelector('.wire-content .wire-columns');if(!columns)return;columns.classList.remove('only-body');let drawer=columns.querySelector('.wire-drawer');if(!drawer){drawer=document.createElement('aside');drawer.className='wire-drawer';columns.appendChild(drawer);}
  drawer.innerHTML='<h3>'+a.name+' · 本次分工</h3><dl class="wire-rows"><div><dt>所属工作</dt><dd>'+taskName()+'</dd></div><div><dt>负责什么</dt><dd>'+a.job+'</dd></div><div><dt>交付物</dt><dd>'+a.output+'</dd></div><div><dt>当前状态</dt><dd>'+a.status+'</dd></div></dl><p class="wire-note">这是本任务的分工；默认专家配置在 Settings 中按需调整。</p>';
  root.querySelectorAll('.agent-select').forEach(b=>b.classList.toggle('selected',Number(b.dataset.agent)===n&&b.closest('.task-tree')?.querySelector('[data-task]')?.dataset.task===taskName()));const row=[...root.querySelectorAll('.task-tree')].find(x=>x.querySelector('[data-task]')?.dataset.task===taskName());const jobs=row?.querySelectorAll('.agent-job');if(jobs?.[n])jobs[n].hidden=false;state.selectedAgent=n;
 }
 function selectTask(name,node){root.querySelectorAll('.toolbar-title .toolbar-button').forEach(b=>b.hidden=!node?.closest('.task-tree'));state.task=name;root.querySelectorAll('.task-row').forEach(x=>x.classList.remove('selected'));node?.classList.add('selected');root.querySelector('.toolbar-title strong').textContent=name;root.querySelector('.wire-content').innerHTML='<h2>'+name.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</h2><div class="wire-columns only-body"><div class="wire-body"><p>'+(node?.querySelector('[data-task-state]')?.dataset.taskState==='已完成'?'成果已交付。查看完成范围、来源与未验证事项。':'工作目标和资料已保留。展开这项工作，查看专家分别负责什么。')+'</p>'+chatForm()+'</div></div>';}
 function newTask(){
  closeSettings();root.querySelectorAll('.toolbar-title .toolbar-button').forEach(b=>b.hidden=true);state.task=null;root.querySelector('.toolbar-title strong').textContent='新任务';const content=root.querySelector('.wire-content');content.innerHTML='<h2>你想完成什么</h2><form data-task-form><label for="'+root.id+'-goal">把目标说清楚就可以开始</label><textarea id="'+root.id+'-goal" name="goal" placeholder="例如：比较这些报价，整理一份采购建议" required></textarea><p class="wire-note">可以补充相关资料。系统会安排需要的专家；时间、预算和分工可以之后调整。</p><button type="submit" class="wire-action main">创建任务</button><p data-form-result role="status"></p></form>';content.querySelector('textarea').focus();
 }
 function applyWorkspace(){const id=identity();if(!root.querySelector('.workspace-identity'))return;root.querySelector('.workspace-identity strong').textContent=id.name;root.querySelector('.workspace-identity small').textContent=id.personal?'个人 · 本机':'企业 · 已授权';root.querySelector('.workspace-switcher').setAttribute('aria-label','Workspace Switcher 当前 '+id.name);const pp=root.querySelector('.project-picker');if(pp){pp.querySelector('span').textContent=state.project;pp.setAttribute('aria-label','选择当前 Project '+state.project);}root.querySelectorAll('.task-tabs small').forEach(e=>e.textContent=id.personal?'本机执行':'企业执行');}
 function render(){
  settingsObserver?.disconnect();settingsObserver=null;state.settings=null;const scene=scenes[state.scene],s=current();
  root.querySelector('[data-scene-title]').textContent=scene.title;if(index)index.innerHTML=scenes.map((x,i)=>'<button type="button" data-scene="'+i+'" aria-pressed="'+(state.scene===i)+'">'+(i+1)+'. '+x.title+'</button>').join('');
  toolbar.innerHTML=scene.steps.map((x,i)=>'<button type="button" data-step="'+i+'" aria-pressed="'+(state.step===i)+'">'+(i+1)+' '+x.label+'</button>').join('');stage.innerHTML=scene.windows[state.step];applyWorkspace();if(s.empty||s.admin)root.querySelectorAll('.toolbar-title .toolbar-button').forEach(b=>b.hidden=true);
  if(s.switcher_open)showWorkspaces();if(s.project_open)showWorkProjects();if(s.new_project)newProject();if(s.agent_open)showAgent(1);if(s.settings)openSettings(s.settings);
 }
 function save(){window.openai?.setWidgetState?.({modelContent:{harnessFlow:{scene:scenes[state.scene].id,step:state.step}},privateContent:{version:2,settings:state.settings,workspace:state.workspace,project:state.project}}).catch(()=>{});}
 function restore(v){const x=v?.modelContent?.harnessFlow;if(!x)return;const i=scenes.findIndex(s=>s.id===x.scene);if(i>=0){state.scene=i;state.step=Number.isInteger(x.step)&&x.step>=0&&x.step<scenes[i].steps.length?x.step:0;}if(v.privateContent?.version===2){const w=v.privateContent.workspace;if(w&&['个人工作站','内容工作站','采购工作站','研发工作站'].includes(w.name))state.workspace=w;state.project=typeof v.privateContent.project==='string'?v.privateContent.project.slice(0,80):'默认 Project';}}
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-scene')){state.scene=Number(b.dataset.scene);state.step=0;state.workspace=null;state.project='默认 Project';state.task=null;render();root.querySelector('[data-scene="'+state.scene+'"]').focus();save();return;}
  if(b.hasAttribute('data-step')){state.step=Number(b.dataset.step);state.workspace=null;state.project='默认 Project';state.task=null;render();root.querySelector('[data-step="'+state.step+'"]').focus();save();return;}
  const ui=b.dataset.ui;
  if(ui==='switcher'){root.querySelector('.switcher-popover')?closePopover():showWorkspaces();}
  else if(ui==='settings'||ui==='settings-section'){openSettings(b.dataset.section||'general');}
  else if(ui==='close-settings'){closeSettings();}
  else if(ui==='task-disclosure'){const el=b.closest('.task-tree').querySelector('.task-children'),show=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(show));el.hidden=!show;}
  else if(ui==='agent'){const task=b.closest('.task-tree').querySelector('[data-task]').dataset.task;if(task!==taskName())selectTask(task,b.closest('.task-tree').querySelector('.task-row'));showAgent(Number(b.dataset.agent));}
  else if(ui==='task-details'){const node=root.querySelector('.task-row.selected')?.closest('.task-tree');if(node){node.querySelector('.task-children').hidden=false;node.querySelector('.disclosure').setAttribute('aria-expanded','true');showAgent(0);}}
  else if(ui==='select-task'){selectTask(b.dataset.task,b.closest('.task-row'));}
  else if(ui==='new-task'){newTask();}
  else if(ui==='collapse'){root.querySelector('.wire-layout').classList.toggle('collapsed-layout');}
  else if(ui==='next-decision'){const el=root.querySelector('.wire-content');el.querySelector('.notice')?.remove();const note=document.createElement('div');note.className='notice';note.setAttribute('role','status');note.textContent=current().scene_id==='approval'?'这项工作等待预算调整；查看具体变更和审批结果。':'查看本任务的当前交接与待确认事项。';el.prepend(note);if(current().scene_id==='approval')openSettings('quota');}
  else if(ui==='workspace'){closePopover();state.workspace={name:b.dataset.name,personal:b.dataset.personal==='true'};state.project='默认 Project';loadProject();}
  else if(ui==='project-picker'){root.querySelector('.project-popover')?closePopover():showWorkProjects();}
  else if(ui==='work-project'){closePopover();state.project=b.dataset.name;loadProject();}
  else if(ui==='new-project'){closePopover();newProject();}
  save();
 });
 root.addEventListener('submit',e=>{
  const form=e.target;if(!form.matches('[data-task-form],[data-project-form],[data-chat-form]'))return;e.preventDefault();
  if(form.matches('[data-project-form]')){const name=form.querySelector('textarea').value.trim();if(!name)return;const list=workProjects[identity().name]||['默认 Project','产品上线','客户研究'];if(list.includes(name)){form.querySelector('[data-form-result]').textContent='这个 Project 名称已经存在，请选择另一名称。';return;}workProjects[identity().name]=[...list,name];state.project=name;loadProject();save();return;}
  if(form.matches('[data-chat-form]')){const val=form.querySelector('textarea').value.trim();if(!val)return;appendChat(val);form.querySelector('textarea').value='';save();return;}
  const goal=form.querySelector('textarea').value.trim();if(!goal)return;const title=goal.length>22?goal.slice(0,22)+'…':goal;state.task=title;root.querySelector('.toolbar-title strong').textContent=title;root.querySelector('.wire-content').innerHTML='<h2>'+esc(title)+'</h2><p class="chat-label">你</p><p>'+esc(goal)+'</p><p>Task 主 Chat 已建立（演示），尚未实际执行或计费。</p>'+chatForm();const collection=root.querySelector('.task-collection');if(collection){const row=document.createElement('div');row.className='task-row selected';const b=document.createElement('button');b.type='button';b.className='task-select';b.dataset.ui='select-task';b.dataset.task=title;b.textContent=title+' · 草稿';row.append(b);collection.querySelector('.empty-list')?.remove();collection.querySelectorAll('.task-row').forEach(x=>x.classList.remove('selected'));collection.prepend(row);}save();
 });
 root.addEventListener('input',e=>{if(!e.target.hasAttribute('data-search-workspace'))return;const q=e.target.value.trim().toLowerCase();root.querySelectorAll('[data-workspace-row]').forEach(r=>r.hidden=!r.dataset.filter.toLowerCase().includes(q));root.querySelectorAll('[data-workspace-group]').forEach(g=>g.hidden=![...g.querySelectorAll('[data-workspace-row]')].some(r=>!r.hidden));});
 root.addEventListener('keydown',e=>{if(e.key==='Escape'){if(root.querySelector('.settings-scrim')){closeSettings();}else if(root.querySelector('.switcher-popover')){closePopover();root.querySelector('.workspace-switcher')?.focus();}}if(e.metaKey&&e.key===','){e.preventDefault();openSettings('general');}if(e.key==='Tab'&&state.settings){const dialog=root.querySelector('.settings-sheet'),buttons=[...dialog.querySelectorAll('button,input,textarea,summary')].filter(x=>!x.disabled),first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
 restore(window.openai?.widgetState);if(index&&location.hash){const i=scenes.findIndex(s=>'#'+s.id===location.hash);if(i>=0){state.scene=i;state.step=0;}}
 window.addEventListener('openai:set_globals',e=>{restore(e.detail?.globals?.widgetState);render();});render();
})();
</script>'''

def fragment(chosen,rid,full=False):
 compact=[{k:v for k,v in s.items() if k!='steps'}|{'steps':[{k:v for k,v in t.items() if k not in ['body','drawer']}|({'body':t['body'],'drawer':t.get('drawer','')} if t.get('settings') else {}) for t in s['steps']]} for s in chosen]
 data=json.dumps(compact,ensure_ascii=False).replace('</','<\\/')
 heading='<header class="document-header"><h1>Harness 核心业务流程线稿</h1><p>Workspace → Project → Task · Mac 桌面窗口 · 2026 年 10 月 4 日</p></header>' if full else ''
 selector='<nav class="scene-index" data-scene-index aria-label="选择业务场景"></nav>' if full else ''
 markup=f'<div id="{rid}" class="harness-desk">{STYLE}{heading}{selector}<h2 class="scene-heading" data-scene-title>{chosen[0]["title"]}</h2><p class="sketch-label">低保真提案 · 示例数据 · 展开任务查看 Agent 分工；能力配置按需进入 Settings。</p><nav class="sketch-toolbar" data-steps aria-label="切换流程步骤"></nav><div data-stage role="region" aria-label="当前步骤线稿" aria-live="polite">{chosen[0]["windows"][0]}</div></div>'
 return markup+SCRIPT.replace('ROOT_ID',json.dumps(rid)).replace('SCENES',data).replace('ICONS',json.dumps(icons))
for scene in scenes:(BASE/(scene['id']+'.html')).write_text(fragment([scene],'harness-flow-'+scene['id']))
all_html=fragment(scenes,'harness-flow-document',True)
(BASE/'index.html').write_text('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Harness 核心业务流程与使用场景线稿</title><style>body{margin:24px;background:light-dark(#f7f8fa,#101828);color-scheme:light dark}.preview-main{max-width:1440px;margin:auto}</style></head><body><div class="preview-main">'+all_html+'</div></body></html>')
(BASE/'scenarios.json').write_text(json.dumps([{k:v for k,v in s.items() if k!='windows'} for s in scenes],ensure_ascii=False,indent=2))
print(json.dumps({'groups':len(scenes),'states':sum(len(s['steps']) for s in scenes),'max_fragment_bytes':max((BASE/(s['id']+'.html')).stat().st_size for s in scenes),'index_bytes':(BASE/'index.html').stat().st_size},ensure_ascii=False))
