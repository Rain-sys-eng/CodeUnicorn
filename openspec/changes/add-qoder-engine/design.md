# add-qoder-engine design

## Context

Qoder CLI（`qodercli`）是一等 ACP（Agent Client Protocol）server：`qodercli --acp` 以 stdio NDJSON JSON-RPC 2.0 提供 initialize / session 生命周期 / prompt / 配置面。它不是 kimi/pi 式纯 print CLI（print 面存在但本机实测不可用，spike §8），也不是 dsh 式常驻 host。 mossx 作为 ACP client 接入，交互面与其他 Native Engine 对齐。

Phase S 证据：[`docs/research/mossx-qoder-capability-spike.md`](../../../docs/research/mossx-qoder-capability-spike.md)（qodercli 1.1.27 pinned）。~~本 spike 期间本机模型 API 不可达~~ **2026-08-22 黄金 turn 已补采**（1.1.28 + PAT 注入，probe6/7/8/9，spike §13）：reasoning / tool-output / cancel / fork / promptQueueing 已升实测值。

## Goals / Non-Goals

Goals：

- 第 9 引擎 `qoder`，**新协议族 `acp-stdio`**，`executionModel: "one-shot"`（spawn-per-turn）。
- Native session 身份 = Qoder ACP `sessionId`（`session/new` 立即返回真实 id）。
- composer 模型 / reasoning effort 来自 ACP `models` + `configOptions` 实时目录。
- 历史走 ACP `session/list` / `session/load` / `session/delete` 官方通道。
- 权限 attach 后 `session/set_mode bypassPermissions`（headless 惯例），accessMode UI 对 qoder 禁用。

Non-Goals：见 proposal（不进 Shared、不做 L3、不接 CN 版 `qoderclicn`、不解析 vendor 磁盘文件、不做 provider key 管理）。

## Decisions

### 1. Identity

| 字段 | 值 |
|---|---|
| engine id | `qoder` |
| displayName | `Qoder CLI` |
| shortName | `Qoder` |
| adapterId | `builtin.qoder` |
| protocolFamily | `acp-stdio`（**新增第四员**） |
| executionModel | `one-shot` |
| serde | `"qoder"` |
| thread | `qoder:<sessionId>` / `qoder-pending-<uuid>` |

`EngineProtocolFamily` 前端 union（`engineRegistry.ts`）与 Rust enum（`adapter_registry.rs`）同步加 `AcpStdio` / `"acp-stdio"`；`BuiltinEngineProtocol::family()` 给 Qoder 独立臂，禁止落到 `stream-json-cli`。`execution_model()` 落 `OneShot`（进程 per-turn，与 kimi 同形）。

### 2. Spawn-per-turn runtime（`engine/qoder.rs`）

```text
send_message(params):
  spawn: qodercli --acp            (cwd = workspace; QODER_HOME / --config-dir 按 profile)
  write initialize {protocolVersion:1, clientCapabilities.fs={read,write}}
  if tracked sessionId: session/resume {sessionId, cwd, mcpServers:[]}
  else:                 session/new   {cwd, mcpServers:[]}  → 立即拿到真实 sessionId
  if model 变更:        session/set_model {sessionId, modelId}
  if reasoning 变更:    session/set_config_option {configId:"reasoning_effort", value}
  session/set_mode {sessionId, modeId:"bypassPermissions"}
  session/prompt {sessionId, prompt:[{type:text|image,...}]}
  stream session/update → EngineEvent
  prompt response → TurnCompleted(stopReason) | TurnError(error)
  session/cancel（interrupt 时）→ kill child
```

- **进程生命周期**：response 到达即 logical settlement；kill child 是 cleanup，两者分域（基石 §14.2.2.1）。child 不 setpgid（与 kimi/pi 一致；若孤儿咬管道再升级 group kill）。
- **超时预算**（冒烟后修订）：`session/new` 会扫描 cwd（大 repo 实测 30.1s，spike §7.5），独立 `QODER_SESSION_NEW_TIMEOUT = 90s`；`session/resume` 30s；其余 RPC 15s。首轮冷启动 ~30s 属 Qoder 侧行为。
- **request/response 相关**：JSON-RPC id 单调递增；response 按 id 配对；agent→client request（`session/request_permission` / `fs/*`）必须回响应，否则 agent 挂起。
- **兜底审批**：`session/request_permission` 选首个 `allow*` option 自动应答（v1 不接 elicitation 卡，见非目标）；`fs/read_text_file` / `fs/write_text_file` realpath 后限 workspace 内，越界回 JSON-RPC error。
- **图片**：ACP content block `{type:"image", data:<base64>, mimeType}` 进 prompt 数组（`promptCapabilities.image:true`）。
- **R4 错误双通道**：prompt 的 JSON-RPC error 与 `[Error]` 文本 chunk 同源；`[Error]` 前缀 chunk 不投影为 assistant 正文，并入 TurnError.message。

### 3. Session identity 与 pending 晋升

`session/new` 在 prompt 前返回真实 sessionId → `SessionStarted` 携带真实 id；`qoder-pending-*` 仅覆盖 spawn+handshake 期间的 optimistic composer row，promotion 合并到 `qoder:<sessionId>`，禁止双行（同 DSH 决策 4）。
首轮失败（handshake error）时 pending row 结算为 error，**不得**伪造 canonical sessionId（Kimi P7 教训）。

### 4. Send / ACK / Terminal

| 阶段 | 信号 | 语义 |
|---|---|---|
| Input ACK | request 未立即 error + 首个 `session/update` | `first-event`（弱，显式标注） |
| Working | `agent_message_chunk` / `agent_thought_chunk` / `tool_call` | 真实 |
| Terminal | prompt response：成功 `stopReason`（`end_turn` 等）/ 失败 JSON-RPC error | 真实，typed |
| Interrupt | `session/cancel` notification → kill child | cancel ACK 已实测（2026-08-22 probe7）：typed response `stopReason:"cancelled"`，无迟到 chunk |
| Resume | `session/resume`（attach）/ `session/load`（replay） | 真实（已实测） |

delta 走 `liveAssistantTextChannel` / `liveItemDeltaChannel`（红线 35）；terminal 后同 session 迟到 chunk 丢弃（Kimi R3 同案）。

### 5. History（`engine/qoder_history.rs`）

- `list_qoder_sessions`：spawn ACP → initialize → `session/list`（cwd 过滤）→ kill；空目录 soft-empty（R3，不报错）。
- `load_qoder_session`：spawn ACP → `session/load` → 收集回放 `user_message_chunk` / `agent_message_chunk`（`messageId` 去重，R5）→ kill；replay 不含 assistant 正文的版本降级为 user-only 时间线并标注（Kimi R1 同案预案）。
- `delete_qoder_session`：`session/delete` ACP 命令；**禁止**直接删 `~/.qoder/projects/**` 文件（红线 21）。
- 统一 session catalog：`qoder:` 前缀解析 + catalog projection 注册。

### 6. Models / config

- `get_engine_models(Qoder)`：spawn ACP → initialize → `session/new`（空 session 不落盘，spike §2 实测 `session/list` 仍为空）→ 读 `models.availableModels` + `configOptions.reasoning_effort` → kill。`id = modelId`，`supportedReasoningEfforts` 从 configOptions 投影。
- composer 选择 → send 时 `session/set_model` / `set_config_option`；catalog 是 advisory，发送仍走 ACP（同 DSH 决策 7）。
- 未登录（`qodercli status` `logged_in:false`）：detect 报 `not-authenticated` 诊断，文案指向 `qodercli login`；模型目录空、composer 禁发。

### 7. Provider Profile

Qoder 账号体系无 API-key provider 面（auth = browser login / PAT env）。`qoder_provider_profile.rs` 只承载：`--config-dir` 隔离 root 解析 + 展示元数据；`isProviderProfileEngine("qoder") === false`（同 DSH/Gemini），vendor 面板为状态 + 登录引导 + 自定义 CLI 路径，不做 key CRUD。

### 8. Shared

不加入 `SHARED_SESSION_SUPPORTED_ENGINES` / `is_supported_shared_session_engine()`。
Shared picker 里 qoder disabled，reason「Not available in Shared Session」。
Rust exhaustiveness 给 `EngineType::Qoder` 失败闭合臂（与 Gemini/DSH 同类）；`normalizeSharedSessionEngine("qoder")` fail-closed 到 claude，禁止把 qoder 写成 Shared target。

### 9. 渲染投影（D 层纪律）

- `qoderRealtimeAdapter`：`session/update` → NormalizedThreadEvent 最小面（`run:start / turn:start / message:delta / reasoning:delta / tool:start|update|end / turn:end / run:settled`）；`available_commands_update` / `config_option_update` / `user_message_chunk` 不进 live 幕布；未知 `sessionUpdate` skip 并在 `NORMALIZED_EVENT_DICTIONARY` 登记。
- D4/D5/D6 白名单逐个加 qoder（streaming 光标、process/explore 折叠、usage 收尾、heartbeat、`inferRawMethodEngine`、threadId 前缀推断）；完成後真实会话目视验收五件套（streaming 光标 / reasoning 折叠 / tool 块 / usage 收尾 / 历史与 live 一致）。
- `qoderHistoryLoader`：ACP 回放 → canonical items；factory 按 `qoder:` 前缀分派，禁止落 codex loader。

### 10. ⚠ 决策记录（🔵 项）

- C4 model catalog：qoder 为 **runtime-only**（ACP 实时目录），不进静态 `generatedModelCatalog.json`（同 DSH）。
- G6 Session Management 过滤：第一期不单独做 qoder 解析器（grok/kimi/DSH 现状同样未覆盖）；侧栏/history 走 `qoderHistoryLoader`。
- E7 可见性：默认可见（导航已有占位，`supported: true`）；`disabledCliEngines` 两层开关行为不变。
- E3 自定义模型：不做（模型目录 = 账号实时目录）。
- D9 专属 usage 卡：不做，走通用 token 卡（ACP usage shape 已 live 但 PAT 账号零值、`qoder.rs` 不解析，2026-08-22）。
- E9 `useQueuedSend` 斜杠命令：qoder slash 经 ACP `available_commands_update` 到达但 v1 不在 mossx 斜杠 UI 暴露；`/clear` 等本地语义按通用路径。
- input.mid-turn：`_meta.qoder.promptQueueing` 已 live 实测（probe9：流式中第二 prompt FIFO 排队）但 v1 不接 steer/queue；用户发送即新 turn。

### 11. 存量保护

- 接入 PR 只做 additive：白名单只追加不重排；存量 8 引擎事件含义 / 顺序 / settlement 不变（红线 31/32/34/35）。
- 存量 fixture 回归：`session-foundation` golden fixtures + `realtimeAdapters.test.ts` / history parity 全绿。
- 序列化兼容：DB/JSONL 中 `"qoder"` 字符串对旧版本反序列化为 typed unknown，不 panic（存量 fixture 回归覆盖）。
