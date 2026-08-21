# add-qoder-engine

## Why

mossx 当前支持 8 个 built-in CLI 引擎（Claude / Codex / Gemini / Grok / Kimi / OpenCode / PI / DSH），Qoder CLI（`qodercli`，阿里 Qoder 全球版）已在 vendor 导航中作为 upcoming 占位（`cliEngineNav.tsx`，`supported: false`）但无任何实现。Phase S Spike（`docs/research/mossx-qoder-capability-spike.md`，qodercli 1.1.27 实测）确认：Qoder 是一等 **ACP（Agent Client Protocol）server**（`qodercli --acp`，stdio NDJSON JSON-RPC 2.0，protocolVersion 1），initialize / session 生命周期 / 模型与 reasoning 配置 / load 回放全部实测可用，具备按 L1 档位接入的条件。用户需要：

- 在对话中选择 Qoder 引擎发消息、流式渲染、续聊历史 session。
- 浏览 / 加载 / 删除本机 Qoder 历史会话，接入统一 session catalog。
- 在设置页完成 Qoder CLI 的安装检测、版本检测与 doctor 诊断、自定义路径配置。
- 在 composer 选择 Qoder 账号目录中的模型与 reasoning effort。

## What Changes

- 新增 `EngineType::Qoder`（serde `"qoder"`）全链路：engine 检测（`qodercli --version` + `QODER_HOME` / `~/.qoder` + `qodercli status -o json` 登录态）、session 管理（`QoderSession`，ACP stdio JSON-RPC client）、interrupt（`session/cancel` + kill）、capability matrix、daemon 影子副本同步。
- **新协议族 `acp-stdio`**：`EngineProtocolFamily` 前后端 union 各加一员（现三员：`stream-json-cli` / `app-server-json-rpc` / `dsh-host-rpc`）；`executionModel: "one-shot"`（**spawn-per-turn**：每 turn spawn `qodercli --acp` → initialize → `session/new` 或 `session/resume` → 按需 `session/set_model` / `session/set_config_option` → `session/prompt` → response 即 terminal → kill；进程管理形状参照 `kimi.rs`）。
- 新增 `engine/qoder.rs` / `qoder_history.rs` / `qoder_provider_profile.rs` 三件套：history 走 **ACP `session/list` + `session/load` 回放**（官方通道），不解析 vendor 磁盘文件；provider profile 只承载 `--config-dir` 隔离与展示元数据（Qoder 账号体系无 API-key provider 面，**不做** kimi 式 config.toml 物化）。
- 新增 `list_qoder_sessions` / `load_qoder_session` / `delete_qoder_session`（`session/delete`）/ `qoder_doctor` 命令，接入统一 session catalog 投影。
- 前端引擎接线：`EngineType` 加 `"qoder"`、`qoderRealtimeAdapter`（ACP `session/update` → NormalizedThreadEvent）、history loader/parser、`qoder:` / `qoder-pending-` thread id 前缀、渲染白名单（D4/D5/D6）、composer provider 接线、EngineIcon（`@lobehub/icons-static-svg/icons/qoder.svg`，已在库）、10 locale i18n。
- CLI 生命周期：`CliInstallEngine::Qoder`（官方安装脚本 / npm 包）+ `qoder_doctor`（binary 检测 + `qodercli status` 登录态 + ACP 握手自检）。

## Capabilities

### New Capabilities

- `qoder-engine-runtime`: Qoder CLI 作为第 9 个 Native Engine 的 ACP 消息发送 / 流式渲染 / 中断 / session 续聊 / 模型与 reasoning 配置。
- `qoder-session-history`: Qoder 历史会话的 ACP 列表 / 加载 / 删除，接入统一 session catalog。
- `qoder-cli-lifecycle`: Qoder CLI 的检测 / 安装 / 升级 / doctor 诊断与自定义路径。

### Modified Capabilities

- `engine-capability-matrix`: matrix fixture 与 Rust 推导增加 qoder 条目（streaming.text / tool.use / tool.mcp / reasoning.effort / image.input / session.resume = supported；streaming.reasoning / streaming.tool-output / input.mid-turn / session.fork / session.tree = unknown；collaboration.mode / session.continuation / session.switch / rpc.server = unsupported）。
- `engine-adapter-protocol-registry`: protocol family 增加 `acp-stdio`，registry 增加 `builtin.qoder`。
- `cli-engine-visibility`: qoder 从 upcoming（`supported: false`）转为 supported 引擎，默认可见。
- `shared-session-engine-selection`: 明确 qoder **不在** Shared 支持集合（picker disabled + reason，与 gemini/dsh 同形态）。

## Impact

- Affected code: `src-tauri/src/engine/**`、`src-tauri/src/bin/cc_gui_daemon/**`（影子副本）、`src-tauri/src/command_registry.rs`、`src-tauri/src/{state,session_management}.rs`、`src-tauri/src/workspaces/commands.rs`、`src/types/**`、`src/features/{engine,threads,messages,composer,vendors,settings,app,home,onboarding}/**`、`src/app-shell*/**`、`src/services/tauri/**`、`src/i18n/locales/*`、`scripts/check-engine-*.mjs`、`openspec/specs/engine-capability-matrix/fixtures/matrix.json`。
- APIs: 新增 Tauri 命令 `list_qoder_sessions` / `load_qoder_session` / `delete_qoder_session` / `qoder_doctor`；`cli_install_plan` / `cli_install_run` 的 `engine` 接受 `"qoder"`。
- Data: 只读 `~/.qoder/**`（或 `--config-dir` 指定 root）；mossx 自身 config 新增 `qoderBin` 等 key；**不写** Qoder 凭据 / settings.json。
- Compatibility: 未安装 qodercli 时引擎显示 not-installed 诊断，不影响其他引擎；存量 8 引擎全部走 additive routing，无共享代码路径变更。

## 目标与边界

- 目标：Qoder 引擎在对话、历史、设置、vendor 四个面达到与 Kimi/PI 相同的可用完备度（L1 Native）。
- 边界：
  - **spawn-per-turn**（进程 one-shot，session persistent）：不实现常驻 ACP 进程池；per-turn initialize 开销实测 ~0.55s，可接受。
  - 权限模式：attach 后 `session/set_mode bypassPermissions`（对齐 kimi `-p` auto / acpx `--yolo` headless 惯例）；composer accessMode 对 qoder 禁用；adapter 对 `session/request_permission` 实现兜底 auto-approve 防挂死，`fs/*` 请求沙箱在 workspace 内。
  - `inputAck: "first-event"`：不假装 request-response ACK；terminal 以 prompt JSON-RPC response（`stopReason` / error）为准，**进程退出只算 cleanup**。
  - 只接全球版 `qodercli`；国内版 `qoderclicn` 与 IDE launcher `qoder` 均不在 detect 范围。

## 非目标

- 不进 Shared Session（`SHARED_SESSION_SUPPORTED_ENGINES` 不加 qoder；picker disabled + reason）。pendingProbe / 成功 terminal / cancel 语义未完整实测，满足条件后独立 change 评估。
- 不做 L3 NativeHistoryReader / Provider Continuation（`session/load` 回放是未来通道，本 change 不接）。
- 不做 `session/request_permission` → mossx elicitation 卡桥的完整产品化（v1 兜底 auto-approve + bypassPermissions；后续独立 change）。
- 不做 Qoder 远程会话（`--remote` / `--teleport` / remote-control daemon）、SDK 面、插件/skills/hooks 管理面。
- 不做 vendor provider key 管理（Qoder 无此面）；不做 pricing / context-ledger 成本核算（ACP usage 未实测）。
- 不解析 `~/.qoder/projects/**` 磁盘 session 文件（history 走 ACP；红线 21 禁止手改 vendor 文件）。

## 风险

- **R1（高）成功 turn 黄金事件未采集**：本机账号模型 API 不可达（`Network attempt failed at unknown`），streaming.reasoning / tool-output / usage / cancel / fork 仅靠 binary strings + ACP v1 词汇 + Kimi ACP spike 交叉证据。matrix 相应项标 `unknown`；adapter 按全词汇实现（到达即归一），有可用账号后补黄金 turn 升级实测值。
- **R2（中）隐藏 flag 漂移**：`--acp` / `--yolo` 不在 `--help`；capability cache key 含 binary realpath + version + sha256 + protocolVersion + agentCapabilities hash，版本变化重 probe。
- **R3（中）`session/list` 空目录**：无成功 turn 时返回空；sidebar 首期允许 soft-empty（与 DSH host 不可达同策略），history loader 对缺条目容错。
- **R4（低）错误双通道**：prompt 失败同时出现 JSON-RPC error 与 `[Error]` 文本 chunk；adapter 把错误文本并入 TurnError，不作为 assistant 正文二次投影。
- **R5（低）回放重复**：load/resume/list 各推一次 `available_commands_update`；history loader 按 `messageId` 去重，slash 清单不入历史。
