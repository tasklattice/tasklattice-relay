# OrbStack InitJob 验收记录

后续真实 DeepSeek 对话、MCP 工具调用和业务回写验收见 [DeepSeek 验收记录](orbstack-deepseek-acceptance.md)。

验收日期：2026-10-23。结果：修复下面两处实际部署问题后，新安装、重复部署、卸载保留后重装、登录和动态租户初始化流程均通过。

## 测试环境

- Kubernetes context / Docker context：`orbstack`，ARM64，Kubernetes `v1.36.5+orb1`。
- Namespace：`relay-initjob-test`；Helm release：`tali-relay`。
- Control：<http://localhost:38180>；Keycloak：<http://keycloak.localhost:38190>。
- 启用 PostgreSQL、Runner、LiteLLM、Hindsight、Docling、Keycloak、Example MCP、Agent Sandbox Controller。
- 使用本地构建的开发镜像与当前 Chart；最终 release 状态 `deployed`，9 个 Deployment、1 个 StatefulSet 全部 Ready，Hindsight migration Job 完成。
- 原有 `tali` Namespace 中的 Guard 未修改，最终健康检查全部 Ready。
- 环境保留供手工验收。最终 revision 为 1，因为测试中执行过卸载后重装。

## 实测结果

| 场景 | 结果与证据 |
| --- | --- |
| 新安装 | InitJob 在业务资源启动前创建凭据源和组件配置，共 9 个 Secret；全部启用组件 Ready |
| 相同配置并发重入 | 同时运行两个真实 Job；所有 Secret 的数据摘要、UID 不变 |
| 全新 Namespace 并发首次初始化 | 两个 Job 竞争创建凭据，最终生成一套 9 个 Secret；凭据源 immutable，Control / Runner / PostgreSQL 的共用凭据一致；临时测试资源已清理 |
| 缺失组件 Secret 恢复 | 删除测试环境的 Example MCP Secret 后运行 Job，生成新 UID，但数据摘要与删除前相同 |
| SA 权限 | 实测允许读取凭据源、创建 Secret、patch 指定组件 Secret；拒绝 patch/delete 凭据源、list Secrets、读取无关 Secret |
| Job 删除 | 删除测试 Job 后，9 个 Secret 均存在，owner 为 Namespace |
| Helm 重复部署 | 部署脚本完整执行成功，9 个 Secret 摘要及凭据源 UID 不变；管理员登录、原有两个 Project 正常 |
| 卸载与重装 | 卸载后 9 个 Secret 和 PostgreSQL PVC 保留；重装后摘要、凭据源 UID、数据库账号与原有两个 Project 不变 |
| 本地管理员登录 | 使用凭据源中的初始密码实际登录成功 |
| Keycloak SSO | 重装前后使用生成的测试用户密码完成真实 OIDC 登录；Alice 可切换到原有 Project `tp-v3i65n4c7jslo` 的管理员上下文 |
| 新建租户 | 重装后创建 `InitJob acceptance`，ID 为 `tp-3nrdwhtflu62o`；对应 Namespace 自动创建，OpenShell Gateway 和 Runtime Bridge 均 1/1 Ready |
| 服务鉴权 | LiteLLM `/v1/models` 正确 key 返回 200、错误 key 返回 401；Control `/api/metrics` 正确 token 返回 200、未认证返回 401 |

## 本次部署发现并修复的问题

1. **InitJob 假成功**：ConfigMap 投影卷通过符号链接提供脚本，Node 的 `import.meta.url` 与未解析链接的 `argv[1]` 不一致，原入口判断跳过初始化。使用 `realpathSync` 统一路径；增加符号链接启动回归，并将容器测试改为真实投影卷布局。修复后完整 Helm 升级与卸载重装均直接成功。
2. **开发 SSO 配置失败**：测试组使用固定别名，租户使用动态 Project ID，角色绑定被规范路径校验拒绝。配置脚本先按实际 ID 重命名 Keycloak Project 组，保留组 UUID、子组和成员关系，再创建绑定。重复执行不再次改名；实际 SSO 登录与重装验证通过。

## 可重复执行的命令

以下命令从仓库根目录执行；这些端口已用于本套保留的测试实例。

```bash
KUBE_CONTEXT=orbstack \
HELM_NAMESPACE=relay-initjob-test \
HELM_RELEASE_NAME=tali-relay \
CONTROL_SERVICE_PORT=38180 \
KEYCLOAK_SERVICE_PORT=38190 \
HELM_TIMEOUT=20m \
  scripts/deploy-local.sh deploy --keycloak --example-mcp

kubectl --context orbstack -n relay-initjob-test get deployments,statefulsets,jobs
kubectl --context orbstack -n tp-3nrdwhtflu62o get deployments

# 本地管理员用户名：admin。仅在本机终端读取初始密码，不复制到日志或工单。
kubectl --context orbstack -n relay-initjob-test get secret tali-relay-credentials \
  -o jsonpath='{.data.initialPlatformAdministratorPassword}' | base64 --decode

# 仅对可销毁的测试部署运行：会短暂删除并恢复 Example MCP Secret。
TALI_LIVE_E2E=1 KUBE_CONTEXT=orbstack \
HELM_NAMESPACE=relay-initjob-test HELM_RELEASE_NAME=tali-relay \
  node scripts/testing/live-credential-bootstrap.mjs
```

卸载保留测试已实际执行；上面的重复部署命令不会主动卸载当前实例。不要删除测试 Namespace 来验证卸载保留，因为 Namespace 删除会级联删除 Secret。

## 回归及覆盖边界

- Bootstrap、开发 SSO 组名、控制面发布和 OpenShift RBAC 共 **46/46** 个定向测试通过。
- Node 22 容器在 UID `10001` 和 OCP 风格 UID `1000880000` 下，通过投影卷入口、HTTPS API、凭据生成和重入测试；使用只读根文件系统及 drop ALL。
- 普通 Kubernetes、OpenShift、离线镜像渲染校验、开发默认值检查、Helm lint 和 `git diff --check` 通过。
- 模块注册表检查另有 2 项失败，原因是工作区已有的 `apps/control/server/works/` 源文件及 3 个测试尚未注册；未修改这部分无关工作。本记录不代表全仓 CI 通过。
- 本次是真实普通 Kubernetes 验收；OCP 只完成渲染与任意 UID 容器验证，未连接真实 OCP，未验证 SCC admission、内部 registry 或跨 Namespace 镜像冷拉取。
- 未配置模型供应商，未执行付费模型推理、完整 Agent 对话或工具调用；SSO 验收属于 `L4-live-no-model`。组件 Ready 不等同于完整模型业务链路已验收。
- `output/orbstack-initjob-test-baseline.json` 仅记录 Secret UID 和数据摘要；`output/orbstack-initjob-new-project.json` 仅记录验收 Project ID 和名称，不含明文凭据。
