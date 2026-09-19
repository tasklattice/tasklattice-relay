# Agent Sandbox v1.0.2 升级与部署

Relay 的目标版本为 **Agent Sandbox Controller v1.0.2**；原固定版本为
v0.5.1。本文比较整个版本区间，不仅是 v1.0.2 的补丁更新。

## 新功能与实际影响

| 版本区间 | 主要变化 | 对 Relay 的影响 |
| --- | --- | --- |
| v0.5.2–v0.5.6 | 修复 Warm Pool 领用竞态、旧模板误领用、缓存延迟和冷启动问题；改进并发调度与缓存开销；Sandbox 状态反映 Pod 调度失败 | 当前直接使用 Sandbox 的链路受益于 Controller 稳定性与状态诊断；Warm Pool 功能需要另行接入 |
| v0.5.6 | Helm 原生支持 `imagePullSecrets`、可选 `ServiceMonitor` 和 `PrometheusRule` | 删除 Relay 的镜像凭据补丁；可通过 values 接入 Prometheus Operator |
| v1.0.0 | Core/Extensions API 只保留 `v1beta1`；删除转换 Webhook；不再写 `pod-name` 注解 | 必须确认调用方使用 beta API，并以 Sandbox 名定位 Pod；本次已验证 OpenShell 的实际链路 |
| v1.0.0 | Router 支持浏览器路径路由、会话 Cookie 和 WebSocket Origin 校验；SDK 支持 `sandboxd`；改善批量领取延迟 | 这些是上游可选能力；升级 Controller 不会自动替换 Relay 的 OpenShell 终端和服务代理 |
| v1.0.1 | 新增 TypeScript 资源管理 SDK、OpenHands workspace 集成；修复 Python 退出清理及 Pod 名回退 | Relay 当前通过 OpenShell CLI/Gateway 管理 Sandbox，无需引入另一套 SDK |
| v1.0.2 | Router 增加 Ed25519 scoped-token v2，可约束 Sandbox UID、端口、方法和路径；Go SDK 支持集群内直连；改善 Python 连接恢复 | 后续直接接入 Router/SDK 时可使用；本次未部署上游 Router |
| v1.0.2 | RL SDK 支持领用现有 Warm Pool、OpenHands Fleet；Controller 默认暴露 client-go REST 指标 | Controller 指标可直接用于观测 API 请求、延迟和重试；RL 集成不属于当前 Relay 运行链路 |

来源：[v0.5.2](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v0.5.2)、
[v0.5.3](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v0.5.3)、
[v0.5.4](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v0.5.4)、
[v0.5.5](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v0.5.5)、
[v0.5.6](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v0.5.6)、
[v1.0.0](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v1.0.0)、
[v1.0.1](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v1.0.1)、
[v1.0.2](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v1.0.2)。

v1.0.2 的 Router 还修改了 Go `authz.Authorizer` 接口，并将其原始部署清单的
命名空间改为 `agent-sandbox-system`。Relay 不依赖该接口或清单，现有代理无须迁移。

## Helm Chart 核对

v1.0.2 tag 下的上游 `helm/Chart.yaml` 仍声明 Chart `version: 0.1.0`。
**Chart 0.1.0 不代表 Controller 0.1.0**。镜像版本为 `v1.0.2`，CRD API 为
`v1beta1`，三者不同。依赖准备脚本从固定的 v1.0.2 源码 tag 打包整个 Chart，
同时检查 Chart 版本。由于依赖名称、仓库路径和 Chart 版本没有变化，
`Chart.lock` 的依赖摘要不变；必须重新运行依赖准备，不能复用旧的同名 tgz。

来源：[上游 Chart 元数据](https://github.com/kubernetes-sigs/agent-sandbox/blob/v1.0.2/helm/Chart.yaml)、
[上游 Helm 文档](https://github.com/kubernetes-sigs/agent-sandbox/blob/v1.0.2/helm/README.md)。

| 场景 | `agentSandbox.enabled` | Controller / CRD 管理者 |
| --- | --- | --- |
| 空白测试集群，随 Relay 安装 | `true` | Relay Chart 部署 Controller，安装配套 CRD |
| 测试环境单独安装 Controller | `false`（Relay） | 独立 `agent-sandbox` Helm release |
| UAT 已有同事部署的集群组件 | `false` | 平台团队负责 Controller 与 CRD |

关闭开关会排除依赖的 Deployment、CRD、ServiceAccount、ClusterRole、
ClusterRoleBinding、Service 和可选监控资源；Relay/OpenShell 使用 Sandbox API
所需的自身权限仍保留。Controller 是集群级组件：部署在独立 Namespace 中并不
意味着只管理这个 Namespace，也不能靠不同 release 名称来隔离两套 Controller。
本次独立安装与 Relay 本地部署脚本都检查已有 Controller，避免重复部署。

默认 `controller.extensions: false` 符合 Relay 直接创建 Sandbox 的方式。
使用 `SandboxClaim`、`SandboxTemplate`、`SandboxWarmPool` 时，再在 **Controller
所属的 release** 中启用 `controller.extensions: true`。有这些 CRD 不等于已启用
对应 Controller；本次没有把 Relay 改成 Warm Pool 分配模型。

## 本地独立安装

```bash
# 默认目标为 orbstack；不会使用当前选中的其他集群。
npm run helm:deploy:agent-sandbox

# Relay 使用刚刚独立部署的 Controller。
KUBE_CONTEXT=orbstack AGENT_SANDBOX_ENABLED=false npm run helm:deploy:dev
```

独立 release 默认为 `agent-sandbox`，Namespace 为 `agent-sandbox-system`。
可用 `KUBE_CONTEXT`、`AGENT_SANDBOX_NAMESPACE`、`AGENT_SANDBOX_RELEASE` 显式覆盖。
部署参数来自 [standalone values](../charts/tali-relay/examples/agent-sandbox-standalone-values.yaml)。
如需手工安装，先准备依赖，再对 `.helm-dependencies/agent-sandbox` 使用该 values
文件；它是上游子 Chart 的 values，不能直接传给 Relay 父 Chart。

脚本在 Helm 操作前应用固定版本 CRD，因为 Helm 不会自动升级 `crds/` 下的定义。
这些脚本支持新安装和仅含 beta API 的安装，不自动处理旧 alpha 存储迁移。
已有旧资源的共享集群由平台团队按
[上游迁移指南](https://github.com/kubernetes-sigs/agent-sandbox/blob/v1.0.2/docs/api-migration-guide.md)
升级；本次没有操作 UAT 或迁移历史数据。

## UAT 配置

将以下内容并入环境 values，或在正常 UAT values 后追加本仓库的 overlay：

```yaml
agentSandbox:
  enabled: false
```

```bash
helm upgrade --install tali-relay charts/tali-relay \
  --namespace tali \
  --values /path/to/uat-values.yaml \
  --values charts/tali-relay/values-uat.yaml
```

`values-uat.yaml` 只选择 Controller 的管理方式，不包含 UAT 地址、密钥、镜像等
完整环境配置。平台团队需提供 v1.0.2 Controller 和 `agents.x-k8s.io/v1beta1`
Sandbox CRD，Controller 必须能管理 Relay 创建的 Project Namespace。无需配置
Controller URL，OpenShell 通过 Kubernetes API 创建 Sandbox。

如果 UAT 本身需要由 Relay 部署 Controller，将此值设为 `true`，并由有集群级
权限的管理员安排 CRD 安装。不要直接用 `false` 去接管一个原本由同一 Relay
release 部署的 Controller：Helm 会移除该 release 原先管理的依赖资源。

## 兼容性验证

[OpenShell 0.0.106 Kubernetes driver](https://github.com/NVIDIA/OpenShell/blob/v0.0.106/crates/openshell-driver-kubernetes/README.md)
已优先探测 beta API；暂停和恢复分别写入 `spec.operatingMode: Suspended/Running`。
其 Pod 定位能回退到 Sandbox 名称，因此不依赖新版已经移除的注解。

```bash
npm run helm:dependencies
npm run helm:validate:agent-sandbox
npm run helm:package:worker
npm run test:agent-sandbox:live
```

Chart 验证覆盖 bundled/external 两种模式、4 个 beta-only CRD、旧 Webhook
移除、扩展参数、显式 `leaderElect: false`、镜像凭据和可选监控资源，并接入 PR
和 release CI。现有资源、离线镜像、OpenShift、开发默认值验证也均通过。

独立 Controller 安装只准备 Agent Sandbox Chart。上述 `helm:package:worker`
为实时测试准备 OpenShell Chart；共享 Control/Worker 镜像构建也会自动执行该步骤。
