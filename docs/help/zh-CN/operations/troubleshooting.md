# 故障排查手册

找到第一个失败边界、保存证据，并在原因尚不确定时避免扩大为破坏性变更。

## 排查顺序

1. **明确范围与近期变更。** 记录受影响项目、角色、智能体、开始时间、最后正常时间以及近期发布或配置变更，判断问题属于 UI、API、数据库、网关还是运行时。
2. **重启前先检查状态。** 先保存 Pod、发布状态、事件和日志。重启可能清除定位原因所需的时间和状态信息。

   ~~~shell
   kubectl -n <namespace> get pods -o wide
   kubectl -n <namespace> get events --sort-by=.lastTimestamp
   helm -n <namespace> status <release>
   ~~~

3. **沿依赖链排查。** Control 依赖 PostgreSQL 和身份配置；智能体操作继续经过 Runner、OpenShell、Agent Sandbox controller、沙箱镜像、LiteLLM 和上游模型提供商。
4. **恢复最小失败边界。** 优先修复失败的 Secret、路由、Pod、提供商或实例，避免重启整个命名空间。最后同时验证技术健康和原始用户路径。

## 常见症状

### 控制台无法访问

检查 Control 发布、Service endpoints、Route/Ingress、证书、`control.toml` 挂载和 PostgreSQL 连接。Pod 健康但没有 endpoint 仍然不可用。

~~~shell
kubectl -n <namespace> get deploy/<release>-control svc/<release>-control endpoints/<release>-control
kubectl -n <namespace> logs deployment/<release>-control --since=30m
~~~

### 登录失败

检查数据库连接和用户状态。OIDC 场景还需检查 issuer discovery、回调地址、客户端凭证、证书信任和时钟偏差。保留认证错误后再考虑重置账户。

### 实例长时间停留在创建中

检查实例创建日志、Runner、OpenShell gateway、sandbox 资源、controller 事件、PVC、调度和镜像拉取 Secret。重试前确认期望状态。

~~~shell
kubectl -n <namespace> get sandboxes,pods,pvc
kubectl -n <namespace> logs deployment/<release>-runner --since=30m
kubectl -n <namespace> logs deployment/agent-sandbox-controller --since=30m
~~~

### 模型请求失败

检查 LiteLLM 健康和日志、路由状态、提供商模型名称、网络、配额和凭证元数据。不要把提供商密钥粘贴到日志或工单中。

~~~shell
kubectl -n <namespace> logs deployment/<release>-litellm --since=30m
~~~

如果日志反复出现 `Child process [pid] died`，但 Pod 本身没有重启，请先检查
worker 数量和 cgroup 内存计数。LiteLLM 的 Uvicorn worker 是独立进程，不是
线程；supervisor 的这条消息不会显示子进程的退出码。因而内核只 OOM 杀死
子进程时，PID 1 和 Kubernetes 容器仍可能继续运行。

~~~shell
kubectl -n <namespace> get deployment/<release>-litellm \
  -o jsonpath='{.spec.template.spec.containers[0].args}{"\n"}{.spec.template.spec.containers[0].resources}{"\n"}'
kubectl -n <namespace> exec deployment/<release>-litellm -- \
  sh -c 'cat /sys/fs/cgroup/memory.events 2>/dev/null || true'
kubectl -n <namespace> top pod -l app.kubernetes.io/component=litellm
~~~

持续增加的 `oom_kill` 是 cgroup OOM 的直接证据。Chart 默认使用单 worker，
使致命进程退出成为 Kubernetes 能记录原因的容器退出。需要并发时优先扩展
`litellm.replicaCount`；如果必须在单 Pod 中使用多个 worker，需要为每个完整
Router 和 Prisma 进程增加内存上限。

离线部署应渲染出 `LITELLM_LOCAL_MODEL_COST_MAP=True`。`tali-litellm` 镜像
会验证并使用其固定 LiteLLM 版本自带的价格和上下文窗口表，启动时无需访问
GitHub。新模型信息和价格随新镜像更新；私有模型价格应在模型部署中明确配置。

### 用量、成本或审计数据延迟

确认请求完成状态、时钟和时区、采集服务、数据库写入、所选时间范围和归因标识。必须区分数据缺失与真实零值。

## 升级所需证据

- **应包含：** 版本、命名空间、带时区的时间戳、受影响资源 ID、脱敏错误、Pod 状态、相关事件、有限范围日志和已尝试步骤。
- **不得包含：** 密码、会话令牌、提供商密钥、完整 `control.toml`、私有 values、原始个人数据，或完整提示和模型响应；除非获批安全通道明确要求。

> **数据库回退不是普通的应用回退。** 不要因为应用发布失败就降级或恢复 PostgreSQL。应停止操作、保留证据、检查迁移兼容性，并在明确维护窗口中执行已验证的恢复计划。
