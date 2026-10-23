# OrbStack DeepSeek 对话与工具验收

验收日期：2026-10-23。范围按用户授权限定为已有 DeepSeek 配置；未使用 NVIDIA 凭据，未配置 embedding 模型、向量检索或外部 Durable Memory。

## 结果

使用真实 `deepseek-flash`，完成：管理员登录 → Project 模型发现与配置 → SINGLE、无回退路由 → Hermes 实例创建 → 终端与 Dashboard 认证 → 真实对话和工具执行 → 模型请求归因 → 执行记录回写 → 实例删除及资源回收。

| 检查 | 实测结果 |
| --- | --- |
| 对话及本地工具 | 第一个实例实际调用 `terminal` 写入随机标记；独立新会话在未获得标记内容的情况下读取同一文件并正确返回 |
| MCP 认证 | Example MCP 使用 InitJob 生成的 Secret 完成认证，Catalog 状态 HEALTHY |
| MCP 授权 | 独立 Access Policy 仅允许 `echo_message`、`calculate_sum`；Agent 通过实例级 LiteLLM Virtual Key 连接 MCP，不直接持有 Example MCP 密码 |
| 真实 MCP 调用 | `mcp__tali__acceptance_calculate_sum(137, 241)` 返回 `378`；`mcp__tali__acceptance_echo_message` 返回随机标记；两者均有实际完成事件 |
| 模型归因 | 排除 MCP 自身记账记录后，最终 MCP 实例关联到 `deepseek/deepseek-flash`，验收读取到 5 条模型请求记录 |
| 执行记录 | 修复后概览记录 1 次 Run，成功率 100%，对应最终 MCP 实例 |
| 访问控制 | Dashboard 一次性访问链接重放返回 401；聊天实例未认证 interaction 请求返回 401 |
| 删除 | 已完成的聊天实例及首次失败的 MCP 实例通过 Relay API 删除；Pod/PVC 已回收，删除后详情查询返回 404 |
| 凭据保留 | 完成配置、重建镜像、滚动更新后，原 9 个初始化 Secret 摘要及凭据源 UID 均未改变 |
| 最终健康 | Relay 全部 Deployment/StatefulSet Ready，最终 MCP Agent Ready；原有 Guard 正常 |

当前保留实例：

- Project：`InitJob acceptance`（`tp-3nrdwhtflu62o`）。
- Agent：`OrbStack MCP acceptance`（`ti-2vw4mpoyh2ixh`）。
- [Relay 实例页面](http://localhost:38180/tp-3nrdwhtflu62o/instances/ti-2vw4mpoyh2ixh)。
- Namespace：`relay-initjob-test`；租户 Namespace：`tp-3nrdwhtflu62o`。

本机内存无法同时调度两个 2 GiB 验收 Agent，因此测试按顺序执行，并通过正常删除流程回收前一个实例。

## 实测发现并修复

1. **Hermes 所选 MCP 未接入运行时。** Control 保存了选择及权限，但 Hermes 主配置和 Dashboard 均没有 MCP 网关连接。Bootstrap 现在配置同一 LiteLLM origin 的 `/mcp/`，使用 OpenShell 管理的凭据占位符；Dashboard 只镜像该受管连接，验证 origin 与认证字段。原始配置锚点仍需先通过检查，新 MCP 配置使用上游 digest builder 计算并事务更新完整性锚点。
2. **Run telemetry 未回写。** token 由 OpenShell Provider 管理，但到 Control 的直连网络规则绕过了凭据解析。将 telemetry endpoint 纳入 Provider，并移除旧直连规则；真实对话复测后执行记录和成功率回写正常。
3. **删除实例后详情返回 UUID 数据库错误。** Kubernetes Instance ID 在未命中实例记录时被用于查询 UUID 类型的 Expert Agent 关系。现在只对 UUID 做该回退查询；实测恢复为 404。
4. **验收脚本协议及归因问题。** Dashboard PTY resize 与 Runner terminal resize 协议不同，原控制帧会混入提示词；现使用 Dashboard 的专用格式。MCP 与 LLM 共用实例 key，归因检查增加模型 endpoint 过滤，避免将 `MCP: list_tools` 误判为实际模型。

修复已构建到本地镜像并部署：Control `e5f1e0a6da8d…`、Runner `0e5514411bd0…`、Hermes `8969b47f6181…`。Hermes 启动配置是在新实例创建时应用的；本次通过新建实例验证，未验证保留旧 Pod/PVC 的原地配置迁移。

## 回归测试与证据

定向回归 **76 项通过**：Control admission 14，Runner/Bootstrap 51，Hermes 验收辅助函数 8，telemetry 插件 3。三个镜像构建成功，`git diff --check` 通过。

可复用脚本：

```bash
# 在已加载授权凭据的环境执行；不要将密码或 key 写入命令行/日志。
# 两个脚本共用这些参数：
export TALI_LIVE_E2E=1
export TALI_BASE_URL=http://localhost:38180
export TALI_LIVE_E2E_PROJECT_ID=tp-3nrdwhtflu62o
export TALI_VALIDATION_USERNAME=admin
# TALI_VALIDATION_PASSWORD：从 tali-relay-credentials 安全读取。
# DEEPSEEK_API_KEY：使用本地已有凭据；不加载 NVAPI_API_KEY。

TALI_LIVE_MODEL_ID=deepseek-flash \
TALI_LIVE_EVIDENCE_PATH=output/orbstack-deepseek-acceptance.json \
  node scripts/testing/live-hermes-chat-tools.mjs

# 本机容量有限，两套 Agent 应顺序运行；第二步依赖第一步创建的路由。
HELM_NAMESPACE=relay-initjob-test HELM_RELEASE_NAME=tali-relay \
TALI_LIVE_MCP_EVIDENCE_PATH=output/orbstack-mcp-acceptance.json \
  node scripts/testing/live-hermes-mcp.mjs
```

证据文件不含密钥：

- `output/orbstack-deepseek-acceptance.json`：两轮真实对话、终端工具、模型归因、实例删除。
- `output/orbstack-mcp-initial-failure.json`：修复前 MCP 未接入的失败证据。
- `output/orbstack-mcp-acceptance.json`：修复后 MCP 工具结果、模型归因、Run 统计及凭据保留。

模型请求已经实际发生，包括首次失败时的排查请求。LiteLLM 当前返回的金额为 0，本次没有验证非零价格和账单准确性，不能据此认定调用免费。MCP 请求本身没有模型 endpoint 映射，会出现在成本数据质量的未映射项中。本次未验收向量检索、embedding、A2A 委派或全部 Agent 引擎，也不代表全仓 CI 或真实 OCP 验收通过。
