# Pi Agent 本地验收

日期：2026-10-24。环境：OrbStack，namespace `tali`，Project `proj1`
（`tp-v3i65n4c7jslo`）。入口：`http://localhost:38080`。

## 版本与构建

- NemoClaw v0.0.138；OpenShell 0.0.116；Pi 0.84.1。
- 重建并部署 Control、Runner、Pi 镜像。现有三平台沿用上轮已重建镜像并回归。
- Pi 所有核心包仍为 0.84.1。锁定修复 undici 8.12.2、
  brace-expansion 5.0.12、zod 4.6.6，生产 npm audit 为 0 vulnerabilities。
- 非 root UID/GID 1000；安装目录由 root 拥有且不可组/其他用户写入；
  models.json/settings.json 为 0600；加入 fd-find 10.2.0 以支持离线文件查找。

```text
["ghcr.io/tasklattice/tali-control:dev"] sha256:b749a45424542f22587ea1dccc6f6a19f5c7fa613fca7271e0c33391e6d95364
["ghcr.io/tasklattice/tali-openshell-runner:dev"] sha256:94e18698534da41a534763536e9dbcdf430cf4190f3fba71abcfb2f1a7da1a14
["ghcr.io/tasklattice/tali-nemoclaw-pi-sandbox:dev"] sha256:3d55cfdc37e7bd66ba5d0d473217cc13a3da1e10e98231525473a94235a59bbe
```

## 浏览器结果

| 平台 | Instance | 验收结果 |
| --- | --- | --- |
| Pi | ti-3ucmakcf74ybr | 从 Relay 创建；原生 TUI 对话、write、bash、stop/start 后恢复 |
| Pi | ti-e3qj2pvru2txp | 启动恢复修复后从前端新建，49.85 秒、零重试；原生 TUI 对话通过 |
| Hermes | ti-vbidmsxkdnz6v | 原生 UI 返回 HERMES_PI_REGRESSION_OK |
| OpenClaw | ti-pczmkach3adza | 新建回归实例；原生 UI 返回 OPENCLAW_PI_REGRESSION_OK |
| Deep Agents | ti-4exlqqqrtjwjd | 原生 TUI 返回 DEEPAGENTS_PI_REGRESSION_OK |

用户在验收期间主动清理了旧 OpenClaw 和重复的测试实例，因此 OpenClaw 使用
新建实例。所有模型请求使用 Project 已有的 Native UI acceptance Routing。

Pi 在 `/sandbox/workspace/relay-pi-acceptance.txt` 写入 `PINE-ORBIT-724\n`。
随后通过 OpenShell 官方 `sandbox stop` / `sandbox start` 重启。
Pod UID 改变，PVC UID 保持不变，会话文件与工作文件逐字节保持一致。
重新打开 TUI 以 `--continue` 恢复会话；要求不使用工具、不读文件，得到
`PI_RESUME_OK PINE-ORBIT-724`。见 restart.json、resume-reply.json 和截图。

## 安全与自动化检查

- Runner：12 个测试文件、85 项通过；Control 相关 7 个测试文件、82 项通过。
- Control、Runner TypeScript 检查通过；发布清单 15 项测试通过。
- Helm 离线镜像检查、资源配置检查通过（19 个渲染容器）。
- Pi bootstrap 8 项测试在主机与最终镜像中通过：配置权限、符号链接、
  硬链接、命令凭据、非绑定凭据拒绝，以及会话持久化。
- 匿名创建 Pi terminal session 返回 HTTP 401。
- 已登录浏览器通过另一 Project 路径读取 Pi 返回 HTTP 403，
  `CAP_AGENT_INSTANCE_CONFIG_VIEW` 拒绝（无该 Project 角色绑定）；
  见 project-isolation.txt。
- 创建 API 拒绝 Pi 暂未集成的 Memory、MCP、Skills 和 Knowledge 绑定。
- Bash 登录探针验证 `nproc=512`、`nofile=65536`；保留上游 RLIMIT 检查。

## 实测修复与范围

Pi 的上游 exact RLIMIT 钩子不支持通过 dash 检查 nproc，健康探针改用 Bash。
首次失败创建暴露了凭据撤销后错误晋升 Ready 的竞争，已修复状态判断并增加测试。
补齐 Worker 中断后的遗留 Key 恢复：移除旧 runtime 和已记录 Key 后，按别名查询，
精确匹配 alias 并验证 managed_by、Project、Instance 和 token hash，再按 hash
撤销。已 Ready 的实例不执行清理；旧 runtime 删除未完成时也不清理。查询结果
不完整、身份不明或跨租户时拒绝处理。新增相关测试后，两个测试文件共 52 项通过，
Control TypeScript 检查通过。

本地 LiteLLM 实测：跨 Project 清理被拒绝且原 Key 保留；正确归属的孤立 Key
清理后，同名 Key 可成功创建。测试 Key 仅两分钟有效期，测试结束已撤销，未调用
模型。见 key-recovery.json。新 Pi 创建记录见 startup-worker.jsonl。

Pi logo 使用用户提供的原始 SVG，并改名为 pi-logo-on-dark.svg，以更新长期静态
资源缓存。Control 最终镜像见上方；Worker 的启动修复镜像为
sha256:e2b45ab44e91e5f312c05845906dc7ff1331bbbcb8acf670948d3f29acf38cb1。
最终 Control 只在此基础上修改 logo 资源路径。未修改既有模型配置或用户账户。

Pi 提供原生 TUI 和会话恢复；此轮未实现 Hindsight、MCP、Knowledge、A2A 或
原生 HTTP UI。已接入 amd64/arm64 发布配置；实际镜像和浏览器验收为本地 arm64。
没有新增本地 CA、HTTPS 入口或转发组件。

## 证据

- pi-write.png：原生文件工具写入与 Bash 校验。
- pi-resume.png：重启后原会话召回。
- hermes-regression.png、openclaw-regression.png、deepagents-regression.png。

- pi-startup-native.png：新实例原生 TUI 已成功对话。
- pi-logo-startup.png：部署后使用提供的 Pi logo，实例 Ready。
