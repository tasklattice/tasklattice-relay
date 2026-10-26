# Agent 原生 Web UI：Control 域名路径代理

更新：2026-10-24。代码已实现，已在 OrbStack 本地集群验证。本文记录最终实现和分阶段验收，不再使用外层 HTML / iframe 方案。范围为桌面 Web。

## 用户入口和请求链路

用户打开 `/<projectId>/<instanceId>/ui/`，直接看到 Hermes 或 OpenClaw 自带的界面。原生子页面也保留在这个路径下。`interaction` API 只返回此路径，不再返回 Runner 域名或带原始 Token 的地址。

路径依次表达 Project、Instance 和 UI 资源，例如 `/<projectId>/<instanceId>/ui/chat`、`/<projectId>/<instanceId>/ui/config?profile=default`。无尾斜线的 `/<projectId>/<instanceId>/ui` 也可直接打开。不保留原 `/agent-ui/...` 入口。

```text
浏览器 → 现有 Control 地址 /<projectId>/<instanceId>/ui/...（本地 http://localhost:38080）
       → Control：登录、实例权限、受限会话、原生文档及 HTTP/WS 代理
       → Runner：现有 9090 私有认证接口
       → Project OpenShell Gateway → Supervisor → Sandbox loopback:18789
```

没有增加转发 Deployment、Redis 或独立公开域名。原 Runner 8080 监听、公开 Service 和 `serviceProxy` 配置已删除，不保留旧公开入口。`serviceBaseUrl` 仅用于生成 OpenShell 内部 Host，不交给浏览器。

## 同域名下的安全边界

不同 path 仍属于同源，不能直接无约束运行 Sandbox 的 HTML。当前将原生文档作为顶层页面返回，同时在所有代理响应上强制 `Content-Security-Policy: sandbox`，允许脚本、表单和下载，不允许 `allow-same-origin`、嵌套 frame、Service Worker 或弹窗逃逸。页面获得 opaque origin，无法读取 Control 的 DOM、Cookie 或持久化存储。

文档注入小型兼容脚本，改写资源/API/WS 地址、提供页面内存存储并适配导航；没有自制界面或承载原生界面的 iframe。Control 在非专用代理路径拒绝 `Origin: null`，带 Cookie 的跨来源写请求同样拒绝。专用代理的 CORS 不携带 Control Cookie，仍必须验证独立能力凭证；`Origin: null` 本身没有访问权。

每次打开入口校验 Relay 登录、Project 成员角色、实例归属及 `CAP_AGENT_INSTANCE_INTERACT`。会话存储在 PostgreSQL，绑定登录会话、用户、项目、实例、Sandbox、namespace、平台和运行代次。能力凭证随机生成，数据库只存摘要。内部资源路径是：

```text
/_agent-ui/<session UUID>/<随机能力凭证>/<upstream-path>
```

地址栏保留公共入口路径。能力路径是敏感 bearer 凭证：只能访问指定实例，5 分钟有效，原生页每 30 秒续期，最长 1 小时；到期后重新加载公共入口并重新鉴权。退出登录、禁用用户、撤销权限或替换实例使能力失效。每次 HTTP/WS 握手重新校验，已有 WS 和长 HTTP 响应每 10 秒复查。页面离开主动撤销。

上游请求只允许明确的请求头，不透传 Control Cookie、浏览器 Authorization 或任意 Forwarded。Runner 再校验服务身份，按可信项目 namespace 派生 Gateway 和 Host，并移除 Runner 凭证。禁止浏览器指定任意 URL、Host 或目标端口。上游 Set-Cookie、Clear-Site-Data、Service-Worker-Allowed、安全策略和跨源跳转不透传。

公开入口记录 `agent_ui.open` 审计；能力路径和代理正文不进入业务审计。Control 默认开启 `control.accessLog.enabled`，只记录固定路由分类、方法、状态、HTTP/WS 类型和耗时，不输出原始路径、查询参数、请求头或错误文本。实际请求注入虚构能力、查询参数及 Authorization/Cookie/Referer 标记后，日志未出现这些标记。应用同时设置 `no-store`、`no-referrer`。若环境另有 CDN、Ingress、APM 或错误追踪系统，也须在相应入口关闭或脱敏能力 URL；应用日志配置不能覆盖外部组件。

## 两个平台的认证

### OpenClaw

原先的 `/#token=<gateway.auth.token>` 改为服务端获取和加密保存。浏览器只有 Relay 会话能力和无权限的 `relay-managed` 标记。

针对实际镜像 OpenClaw 2026.7.1 的协议 4，Control 在 WS 握手中使用固定 backend 客户端身份和原始 Gateway Token；忽略浏览器提供的 auth、device、role 和 scopes。只授予 `operator.read`、`operator.write`、`operator.approvals`，不授予 `operator.admin`。连接返回的设备 Token 被剔除，设备凭证和节点配对方法被拒绝。没有关闭 OpenClaw 自身认证或设备安全检查。

因此原生聊天可以直接使用，无须用户再次复制 Token。设备配对和需要 admin 权限的原生管理操作不包含在当前交互入口的权限中。

### Hermes

Control 在服务端兑换 Hermes 一次性入口，保存加密的内部会话 Cookie 和原生 session token。HTTP 和 PTY WebSocket 由服务端注入这些凭证，浏览器不会收到原始 Cookie/token。原生 UI 的 prefix、静态资源、API、PTY 和路由由兼容脚本适配。

## 资源与网络限制

- 每个 Relay 登录最多 16 个有效 Agent 页面会话。
- 每个 Control 进程最多 64 个代理 HTTP 请求，每个能力最多 16 个；WS 分别最多 128 / 8 个。不是跨副本的统一配额。
- 上传最多 32 MiB，需改写的 HTML/JS/CSS 最多 16 MiB；WS 应用消息及积压检查为 8 MiB，连接前队列 1 MiB。
- 响应头等待 15 秒；Runner HTTP 空闲超时 120 秒；客户端断开取消上游请求。
- Runner / Gateway 使用内部 Service；Relay 不再创建额外的 Kubernetes NetworkPolicy，保留 OpenShell 自带的 Sandbox SSH 策略。
- Runner 服务令牌和 Control 能力校验继续生效。Gateway 当前为内部明文、允许未认证用户的模式；移除 Relay 的 Gateway 入站策略后，集群内可达 Pod 可直接访问 Gateway，不能再宣称 Gateway 具有 Pod 间访问隔离。

## 分阶段实施和验证

| 阶段 | 实现 | 验证证据 |
| --- | --- | --- |
| 1：统一入口与授权 | 原生公共路径、数据库会话、实例权限、运行代次绑定 | 单元测试覆盖伪造能力、失效登录、禁用用户、过期、运行替换、namespace 变化、权限撤销；真实未登录请求返回 401 |
| 2：私有 HTTP/WS 链路 | Control → Runner 9090 → Gateway，流式代理和头过滤 | Runner/Control 协议测试；真实 Hermes API/PTY 和 OpenClaw 握手/health RPC 通过 |
| 3：原生 UI 与认证迁移 | 无 iframe；两平台资源路径和认证适配 | 本地 Chromium 应用内浏览器加载两种原生 UI；OpenClaw 显示 Online，并回复 `RELAY_ORBSTACK_OPENCLAW_OK`；Hermes 显示 ready，并回复 `RELAY_ORBSTACK_HERMES_OK`；Hermes Config 深链接和刷新通过 |
| 4：生命周期与安全负例 | 续期、撤销、来源限制、连接复查 | 真实伪造能力 401、跨来源创建 403、opaque-origin Control 访问 403；撤销后 HTTP 立即拒绝，WS 在 10 秒左右关闭 |
| 5：入口收口 | 删除 8080 公共旁路，内部 Service 与 Control/Runner 鉴权 | 验证 Control/Runner 无凭证请求被拒绝，合法 Control 链路正常 |
| 6：部署与交付 | DB migration、Control/Runner/Worker、Chart 和现有 Gateway 配置 | OrbStack `tali` 本地镜像构建和滚动更新，Keycloak 启用，重复执行真实验收脚本及 init Job |

自动回归入口：

```sh
npm run test --workspace @tali/control -- server/agent-ui server/audit-logs/audit-request.test.ts server/authorization/route-capabilities.test.ts server/kubernetes/project-openshell-gateway-client.test.ts
npm run test --workspace @tali/runner -- src/web-ui-proxy.test.ts src/runner-config.test.ts src/runtime-target.test.ts
node --test scripts/testing/project-openshell-owner.test.mjs scripts/testing/test-modules.test.mjs
npm run helm:validate:resources
```

真实 HTTP/WS 验收使用 `scripts/testing/live-agent-ui-path.mjs`。设置 `TALI_LIVE_E2E=1`、`TALI_CONTROL_URL`、`TALI_UI_PROJECT_ID`、`TALI_UI_USERNAME`、`TALI_UI_PASSWORD`，通过进程环境传入现有测试账号；不将凭证写入文件或命令历史。账号须已有相应项目角色，项目须有 Ready 的 Hermes 和 OpenClaw。脚本只选择已赋予的访问上下文，不授予权限；完成后撤销自身能力并退出自身登录。

本次在重建后的 OrbStack 集群验收，控制面 namespace 为 `tali`，复用初始化的 `proj1`（`tp-v3i65n4c7jslo`），Hermes 为 `ti-ahbbdywgek2ut`，OpenClaw 为 `ti-dl5kx72w5f4jx`。Control 使用 `http://localhost:38080`，经用户授权使用已有 DeepSeek Key 和发现的 `deepseek-flash` 模型完成两条原生 UI 聊天。按最终要求使用 HTTP/WS，无额外转发组件，不签发或安装本地 CA，不要求本地 443/HTTPS。

最终代码回归：Control 7 个测试文件 / 66 项、Runner 3 个文件 / 8 项、owner post-renderer 和测试模块配置共 21 项通过；Control 类型检查和构建、Runner 构建、Helm 19 个容器的资源校验通过。新增日志脱敏、Hermes 根路径去尾斜线后追加 profile 参数的回归；入口调整为 Project → Instance → UI 后，8 个测试文件 / 38 项及类型检查、构建通过；测试模块归属检查 14 项通过。凭据 bootstrap 44 项、开发默认配置验证通过。真实撤销测试中 Hermes WS 在 9.4 秒、OpenClaw WS 在 10.0 秒内关闭；当时另一 Project 的无权限 Pod 无法连接 Runner 或 Gateway；该历史结果依赖现已移除的 Kubernetes NetworkPolicy，不再作为当前网络隔离保证。

本次 Hermes 使用默认 2 GiB 内存，最终验收时 Hermes 和 OpenClaw Pod 均为 Ready、0 次重启。Hermes 首次打开聊天需要约 1 分钟初始化工具；状态变为 ready 后，原生 PTY 输入、模型回复正常。根路径、Config 深链接和刷新已验证。生产资源仍须按原生 Agent 与交互并发测量。OpenClaw 验收镜像构建同时更新了 mcporter 的 body-parser / zod 锁定版本，保留依赖审计门禁并通过构建检查。

所有新部署的 Relay、LiteLLM UI、Keycloak 预置登录密码统一为 `password`，不再由开发模式开关控制；数据库密码、Example MCP 服务凭据、服务令牌、OIDC client secret、加密密钥继续独立随机生成并由不可变 root Secret 保持稳定。已有 Secret 原样复用，账号改密后以应用数据库为准。Relay 账号保存加盐 hash；组件连接密码通过 Kubernetes Secret 提供。此处历史验收覆盖了本地模式下的登录和 Job 重入，当前默认值及升级保留规则见[凭据初始化](helm-credential-bootstrap.md)。

## 部署顺序与验收边界

1. 构建并发布同一版本 Control、Worker 和 Runner。Control 镜像须包含更新后的 post-renderer 脚本。
2. 执行 `20261024120000_agent_ui_sessions` 数据库迁移。按现有配置更新 Runner，移除废弃 `serviceProxy` 字段。
3. 更新 Control/Worker/Runner 和 Helm 资源，删除旧公开 Runner Service。让现有项目 Gateway 执行受控 reconcile，并按[迁移说明](project-runtime-namespaces.md#removing-legacy-relay-kubernetes-networkpolicies)清理旧 Kubernetes NetworkPolicy。
4. 本地由 OrbStack 直接暴露 Control Service 的 38080 端口。若目标环境已有域名和 TLS 入口，则复用该入口转发两类路径，支持 WebSocket Upgrade 和流式响应；禁用能力路径缓存并处理上述日志脱敏。部署流程不自行生成或安装 CA。
5. 在目标环境重跑真实验收和无凭证访问测试，验证新标签、深链接刷新、实际角色及跨项目拒绝；目标入口使用 HTTPS 时再验证 WSS。
6. 生产放量前补充目标桌面浏览器、长时间续期/休眠恢复、多副本、预期并发及故障演练。当前没有声称完成 Firefox/Safari、生产负载或所有原生管理功能的验收。

浏览器隔离会使 Agent 的 localStorage/sessionStorage 仅在当前文档内保存，原生路由切换采用整页导航；Service Worker、跨源插件、通知及需要独立浏览器身份的配对功能不启用。服务端聊天历史不受页面内存存储限制。当前验收涵盖原生 UI、核心 API/实时通道及两平台实际聊天，不能推导所有插件或任意第三方 Agent 前端都兼容。

失败时关闭 Agent UI 入口并撤销能力，再回滚相应应用；不恢复旧的未经用户鉴权的 8080 公共旁路。滚动更新会断开现有实时连接，用户刷新原生入口后重新鉴权连接。
