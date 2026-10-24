# Helm 凭据初始化

Relay Chart 不接受密码、共享 token 或连接串的明文 values，也不提供固定初始口令。必要的协议键名（例如 `POSTGRES_PASSWORD`、Secret 的 `postgres-password`）保留。

采用 Guard 相同的初始化顺序：`pre-install,pre-upgrade,pre-rollback` Job 先于业务资源运行，使用 Node `crypto.randomBytes(32)` 为各用途独立生成凭据。初始化 Job 不依赖数据库可用，也不挂载待创建的 Secret。

## Secret 与重入规则

- `<fullname>-credentials` 保存完整凭据源，新建时设置 `immutable: true`。Job 对已有凭据源只有读取权限，不修改已有密码、会话密钥、加密盐或 token。
- Job 由凭据源和非敏感配置模板生成 Control、Runner、PostgreSQL、LiteLLM、Hindsight、监控、Keycloak 和 Example MCP 的组件 Secret。应用只挂载自身组件配置，不挂载完整凭据源。
- 重复执行不改变凭据，相同配置不写 API；配置更新仅刷新组件配置。中断后可继续；创建竞争的 HTTP 409 会读取获胜者，更新竞争使用 resourceVersion 重试。
- 凭据源缺字段、DB URL 不一致、Secret 归属错误或 Namespace UID 不符时失败。凭据源丢失但组件 Secret 仍存在时也失败，防止误生成新数据库密码或加密密钥。
- 组件 Secret 记录凭据指纹；Job 先渲染全部配置、检查所有已有输出，再开始写入。凭据源被替换、输出缺少指纹、外部凭据源正在删除或某个输出属于其他发布时明确失败，不自动轮换、接管或部分更新前面的配置。写入阶段仍再次检查归属和指纹，并使用 resourceVersion 防止检查后被替换。
- 组件 Secret 缺失时从原凭据源补建；重入会恢复组件 Secret 的保留注解。创建 Secret 时发生竞争则重新读取并校验，不能把其他发布的 Secret 当成初始化成功。
- 初始化 Secret 由安装 Namespace 持有，带 `keep`、Argo `Prune=false,Delete=false` 注解。卸载 release 保留 Secret；删除 Namespace 会删除这些 Secret。备份数据库时同时备份凭据源和组件 Secret。
- Worker 自身的 `worker.toml` 没有共享初始化凭据，仍由 Helm 渲染；Worker 通过 Control 的组件 Secret 获取共用配置。

组件配置由 Chart/bootstrap 统一生成，不接受整份外部组件 Secret 或 values 中的初始化密码。部署 values 只记录非敏感设置和凭据源名称。

## 部署与读取初始凭据

普通 Kubernetes 使用标准 Helm 发布命令；初始化 Job 镜像使用 `images.control`。该镜像需提供 Node 和生产依赖 `smol-toml`（Relay Control 镜像已包含）。脚本和配置模板随 Chart 的 hook ConfigMap 挂载，不依赖新应用启动成功。

```bash
helm upgrade --install tali-relay ./tali-relay.tgz \
  --namespace tali --create-namespace -f site-values.yaml \
  --wait --wait-for-jobs --timeout 30m

# 仅在有权限的本机终端读取；不放到日志、values 或工单。
kubectl -n tali get secret tali-relay-credentials \
  -o jsonpath='{.data.initialPlatformAdministratorPassword}' | base64 --decode
```

默认初始管理员用户名仍由 `auth.local.username` 设置。初始化凭据只用于创建账号；账号在应用中改密后，Secret 里的初始值不代表当前密码，重跑 Job 不会重置账号。

| 用途 | 凭据源键 |
| --- | --- |
| Relay 初始管理员 | `initialPlatformAdministratorPassword` |
| PostgreSQL | `postgresPassword`、`databaseUrl`、`adminUrl` |
| Relay 会话、Runner | `authSecret`、`runnerToken` |
| LiteLLM | `litellmMasterKey`、`litellmUiPassword`、`litellmSaltKey` |
| Keycloak（测试组件） | `keycloakAdminPassword`、`keycloakClientSecret`、`keycloakTestUserPassword` |
| Hindsight | `hindsightDatabasePassword`、`hindsightDatabaseUrl`、`hindsightApiKey`、`hindsightRouterToken` |
| 监控、Example MCP | `metricsToken`、`exampleMcpPassword` |

## 外部 Secret

`credentialBootstrap.existingSecret` 是唯一的外部初始化凭据入口，可指定预先准备的完整凭据源，键集合见上表。Job 仅读取它，不接管其 owner、不写入、不轮换；连接串必须与对应密码一致。凭据由 Secret 管理系统创建，不经 values、Job 环境变量或命令行传入。

所有启用组件的 Secret 都由同一个凭据源生成，保证数据库连接、Runner token、LiteLLM key、Hindsight 和 metrics token 在消费者之间一致。Worker 的非敏感配置仍由 Helm 渲染。外部凭据源被轮换后，Job 会因输出指纹不匹配而失败；凭据轮换必须单独协调数据库、配置和消费者，不能靠重跑 Job 完成。

新生成的 `<fullname>-credentials` 为未来启用的可选组件也保存独立凭据，启用组件不需要重新生成现有密钥。

## OCP 内部 registry 自动启动准备

使用 OCP 4.16+（Kubernetes 1.29+，与 Chart 的最低 Kubernetes 版本一致）且启用内部 Image Registry 时，默认不需要预建 bootstrap SA 或手动绑定拉取权限。`openshift.enabled=true` 且 Control 镜像指向内部 registry 时，Chart 会：

1. 在安装 namespace 创建专用 bootstrap SA，写入 `openshift.io/internal-registry-pull-secret-ref`，指定稳定的拉取 Secret 名称。
2. 在 **Control 镜像地址实际包含的 namespace** 创建 `system:image-puller` RoleBinding，授权该 SA 拉取。这里不使用 runtime 的 `openshift.imageSourceNamespace`；两者可以不同。授权先于初始化 Job 执行，也不依赖 Worker 是否启用。
3. 让初始化 Job 从创建时就显式引用该 Secret。OCP 控制器异步生成并轮换内部 registry 凭据；即使 Pod 先创建，kubelet 后续拉取重试也会读取到 Secret，无须重建 Pod。短暂的 `FailedToRetrieveImagePullSecret` 或 `ImagePullBackOff` 可以自动恢复；默认 Job 总时限为 300 秒，可通过 `credentialBootstrap.activeDeadlineSeconds` 调整。

Chart 不生成 registry token、不复制管理员凭据，也不创建额外的准备 Job。这个机制依赖 OCP 4.16+ 的 [ServiceAccount 控制器](https://github.com/openshift/openshift-controller-manager/blob/release-4.16/pkg/internalregistry/controllers/service_account_controller.go)。镜像仍需已导入或离线复制到内部 registry；执行 Helm 的身份必须能在安装 namespace 创建 SA，并在镜像源 namespace 绑定 `system:image-puller`。Chart 无法为安装者提升其自身权限。

```bash
CONTROL_NS=tali
SOURCE_NS=relay-images
REGISTRY=image-registry.openshift-image-registry.svc:5000
CONTROL_TAG=0.2.8-rc.3 # 替换为本次实际导入的镜像 tag

helm upgrade --install tali-relay ./tali-relay.tgz -n "$CONTROL_NS" --create-namespace \
  -f site-values.yaml --set openshift.enabled=true \
  --set-string images.control.repository="$REGISTRY/$SOURCE_NS/tali-control" \
  --set-string images.control.tag="$CONTROL_TAG" --set images.control.useGlobalRegistry=false \
  --wait --wait-for-jobs --timeout 30m

# 只查看引用和 UID，不输出 token。
oc -n "$CONTROL_NS" get sa -o json | jq '[.items[] |
  select(.metadata.annotations["meta.helm.sh/release-name"]=="tali-relay" and
    .metadata.annotations["openshift.io/internal-registry-pull-secret-ref"]!=null) |
  {name:.metadata.name,uid:.metadata.uid,imagePullSecrets}]'
```

自定义内部 registry route 需设置 `openshift.imageRegistryHost`，用于识别内部镜像。普通 Kubernetes、外部 registry 不生成 OCP 注解或 `system:image-puller` 绑定；外部私有 registry 仍需已有凭据。显式 `credentialBootstrap.serviceAccountName` 和 `global.imagePullSecrets` 继续优先使用：外部 SA 不被创建或替换，显式 Secret 必须预先存在。即使使用这些覆盖项，内部镜像的 SA 拉取权限绑定仍由 Chart 准备。

自动 OCP SA 使用不同于旧 bootstrap SA 的名称，升级时通过 Helm `lookup` 复用，保留 UID 和 OCP token。已有 SA 正在删除、归属或拉取 Secret 注解不匹配时停止，不接管或替换它。SA 创建 Hook 仅在缺失时运行 `pre-install,pre-upgrade`，不参加使用缓存清单的 `pre-rollback`；回滚复用原 SA，重建对应拉取权限绑定并执行初始化 Job。若 SA 被人为删除，应先用目标 Chart 执行 upgrade 恢复，不能依赖 rollback 补建 SA。回退到旧 Chart 则按旧版本的认证配置执行。

执行真实 `helm upgrade --install` 才能查询并复用已有 SA；只读预览可用 `helm template --dry-run=server`。离线 `helm template` 无法查询集群，会包含 SA 创建 Hook；其删除策略不允许在执行前删除已有 SA，避免旧渲染清单使 token 失效。不要将反复执行离线渲染清单视为 Helm 升级验收；GitOps 工具的 Hook 生命周期需要单独验证。

## RBAC、排错与验收

初始化专用 Role：指定 Secret 名称的 `get`，组件输出 Secret 的 `patch`，以及 Namespace 内 `create secrets`（Kubernetes RBAC 不能按名称限制 create）。凭据源不在 patch 清单中。ClusterRole 仅允许读取安装 Namespace，以验证 owner UID；无全局 Secret list/get，无 Secret delete、bind、escalate 权限。

脚本由 ConfigMap 投影卷挂载，入口判断必须先解析 `argv[1]` 的真实路径再与 `import.meta.url` 比较。否则 Node 解析符号链接后，Job 可能退出成功却没有执行初始化。容器回归使用与 Kubernetes 相同的 `..data` 符号链接结构覆盖此问题。

使用专用 bootstrap SA，不与业务 Pod 共用。Chart 创建的 SA 默认不自动挂载 token，只有 bootstrap Pod 显式启用。Job 使用非 root、只读根文件系统、RuntimeDefault seccomp 和 drop ALL；不指定 UID/GID，不依赖后续业务资源的 anyuid SCC 绑定，适用于普通 Kubernetes 和 OCP 分配的 UID。

普通 bootstrap SA、RBAC 和 ConfigMap 使用 `before-hook-creation`，成功后保留，下一次执行时重建；自动 OCP SA 通过 lookup 复用，外部 SA 不重建。自动 OCP SA 只设置 `hook-failed` 删除策略，不在成功或下次 Hook 前删除。它们不是普通 Helm release 资源，卸载后不会自动清理，不能假定 Job 删除即撤销权限。仅 Job 使用 `hook-succeeded` 清理。保持这个顺序也避免 Argo CD 提前清理 Job 所需的被动资源；参见 [Helm hook 生命周期](https://docs.helm.sh/docs/topics/charts_hooks/) 和 [Argo CD hook 删除语义](https://argo-cd.readthedocs.io/en/stable/user-guide/helm/#helm-hooks)。

同一组输出的配置发布应由一个 Helm/Argo CD 操作串行管理；测试覆盖相同配置的并发初始化与冲突重试，不提供不同版本之间的多 Secret 原子事务。任一步骤中断后应使用目标版本重跑，使全部组件配置收敛。

```bash
# 成功 Job 自动删除；失败 Job 保留。
kubectl -n tali get jobs -l app.kubernetes.io/component=credential-bootstrap
kubectl -n tali logs job/tali-relay-credential-bootstrap

# 本机比较两次执行的凭据摘要，不输出凭据本身。
kubectl -n tali get secret tali-relay-credentials -o json \
  | jq -cS .data | shasum -a 256
# 使用相同 values 再执行 helm upgrade 后，重复上面的命令，摘要应完全相同。
```

OCP 升级验收应额外确认自动 SA UID 和拉取 Secret UID 不变，并在禁用缓存的节点进行实际镜像拉取。本地模拟 API 测试覆盖 SA lookup、归属检查和缺失补建；不等价于真实 OCP 控制器与 registry 验收。

普通 Kubernetes 和 OCP 的密码生成/重入逻辑相同。验收包括：新安装能启动全部启用组件；重复安装和配置更新后凭据摘要不变；中断后恢复；并发初始化不产生分裂凭据；错误归属和缺失字段明确失败；日志、渲染清单、Helm release values 不出现生成的密码。

本地回归命令（容器测试只连接容器内的模拟 HTTPS API，不访问真实集群）：

```bash
node --test scripts/testing/credential-bootstrap.test.mjs
node scripts/testing/credential-bootstrap-containers.mjs
node scripts/validate-helm-resources.mjs
node scripts/validate-helm-openshift.mjs
node scripts/validate-helm-airgap.mjs
helm lint charts/tali-relay --kube-version 1.29.0
```

真实 Kubernetes 上的并发、权限和组件 Secret 补建测试见 [OrbStack 验收记录](orbstack-initjob-acceptance.md)。
