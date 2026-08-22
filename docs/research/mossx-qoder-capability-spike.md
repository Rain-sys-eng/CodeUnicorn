---
type: research
status: active
---

<!-- DOC-LIFECYCLE: draft-spike -->
> [!NOTE]
> **Lifecycle: Phase S Capability Spike.** 不是产品 contract。Adapter contract 以本文件实测为准。
> 上游：[`mossx-new-cli-onboarding-guide.md`](./mossx-new-cli-onboarding-guide.md)（Phase S 模板 §2.1）、[`mossx-multi-cli-provider-session-foundation-design.md`](./mossx-multi-cli-provider-session-foundation-design.md)（基石设计）

# Qoder CLI（qodercli）Capability Spike

> 日期：2026-08-21（2026-08-22 黄金 turn 补采更新）
> CLI：`qodercli` `1.1.27`（spike 当日）；2026-08-22 补采时为 `1.1.28`（hidden flag 未变，握手一致；R2 提醒：cache key 含 version+sha256）
> sha256：`fd36420ae0e740f7f3fb7f62e9df23aa70df400aad55fc7e7e48e0edc0ce8e2e`（跟随 symlink）
> ACP protocolVersion：`1`（initialize 请求 1 / 响应 1）
> 登录态：2026-08-21 `qodercli status -o json` → `logged_in: true`（browser login）；**当时本机模型 API 不可达**（`Network attempt failed at unknown`）。**2026-08-22 补采**：CLI 升级 1.1.28 后 browser login 态丢失，改用 mossx 存储的 PAT（`QODER_PERSONAL_ACCESS_TOKEN` spawn 注入）跑通黄金 turn（probe6 成功 + probe7/8/9），原 `unknown` 项已升级实测值，见「13. 2026-08-22 黄金 turn 补采」
> 分档结论：**L1 Native（ACP 主协议，spawn-per-turn + session/resume）**；**不进 Shared**

---

## 0. 官方接入面（docs.qoder.com）

| 页面 | URL | 用途 |
|------|-----|------|
| Using CLI | https://docs.qoder.com/en/cli/using-cli | 仓库 `cliEngineNav.tsx` 已登记入口 |
| ACP | https://docs.qoder.com/en/cli/acp · /cli/acp | **IDE/host 接入主协议**（Zed External Agent 同协议） |
| Command | https://docs.qoder.com/en/cli/command | 命令参考 |
| Installation | https://docs.qoder.com/cli/installation | 安装 / 升级 |
| Authentication | https://docs.qoder.com/cli/authentication | 登录与 PAT |
| Sessions | https://docs.qoder.com/cli/sessions | 会话管理 |
| Slash | https://docs.qoder.com/cli/slash-reference | 斜杠命令 |
| SDK | /en/cli/sdk/authentication · /en/cli/sdk/session-control | 伴生 SDK（非主对话路径） |
| Zed catalog | https://zed.dev/acp/agent/qoder-cli | 官方生态 ACP 声明（`qodercli --acp`） |

注意：本环境直连 `docs.qoder.com` 返回空 body（SSL EOF），以上 URL 来自搜索索引；**协议事实以本机 binary 实测为准**。第三方 ACP 接入实现（Zed、openclaw/acpx `agents/Qoder.md`、multica `server/pkg/agent/qoder.go`）一致使用 `qodercli --acp`，headless 场景追加 `--yolo`。

产品线边界：全球版 binary 是 `qodercli`；国内版是 **Qoder CN CLI**（`qoderclicn`，npm `@qodercn-ai/qoderclicn`，阿里云 Lingma 文档站），**不是同一 binary，首期不接**。本机 `/usr/local/bin/qoder` 是 Qoder.app 的 IDE launcher，与 CLI engine 无关，detect 不得命中它。

---

## 1. Binary / 协议身份

| 项 | 实测结论 | 证据 |
|----|----------|------|
| Binary | `qodercli`（`~/.local/bin/qodercli` symlink） | `which` / `readlink` |
| Version | `1.1.27` | `qodercli --version` |
| ACP 启动 | `qodercli --acp`（**隐藏全局 flag**，不在 `--help`；`qodercli acp` 不是子命令） | 实测握手成功；acpx/multica 同 |
| Transport | stdio newline-delimited JSON-RPC 2.0，stdout 无 banner 噪声 | probe1 transcript 首行即 initialize 响应 |
| protocolVersion | `1` | probe1 initialize |
| agentInfo | `{name: "qoder-cli", title: "Qoder CLI", version: "1.1.27"}` | probe1 |
| authMethods | `[{id: "qodercli-login", name: "Use qodercli login"}]` | probe1 |
| agentCapabilities | `loadSession: true`；`sessionCapabilities: {additionalDirectories, close, delete, fork, list, resume}`；`promptCapabilities: {image: true, embeddedContext: true}`（无 audio 字段）；`mcpCapabilities: {http: true, sse: true}`；`_meta.qoder.promptQueueing: true` | probe1 |
| Headless token | `QODER_PERSONAL_ACCESS_TOKEN`（PAT）；auth type `qoder-pat` / `qoder-browser` | binary strings + acpx 文档 |
| Cache key 建议 | binary realpath + version + sha256 + protocolVersion + agentCapabilities JSON hash | 基石 §14.3.1 |

## 2. Session 生命周期

| 维度 | 实测结论 | 证据 |
|------|----------|------|
| 创建 | `session/new {cwd, mcpServers:[]}` → `{sessionId: <uuid>, modes, models, configOptions}`；sessionId 是裸 UUID（无前缀） | probe1/probe6 |
| modes | `default / acceptEdits / bypassPermissions / plan`（plan = read-only） | session/new 响应 |
| models | `availableModels`（本机：`qmodel_38max` = Qwen3.8-Max default；`minimax/minimax-m3-cp`）+ `currentModelId` | session/new 响应 |
| configOptions | select 三项：`mode` / `model` / `reasoning_effort`（high \| max \| none） | session/new 响应 |
| Resume | `session/resume {sessionId, cwd, mcpServers}` → modes/models/configOptions，**不回放历史**（轻量 attach） | probe3 |
| Load | `session/load` → **回放历史**：`user_message_chunk` + `agent_message_chunk`（带 `messageId`），随后返回 modes/models/configOptions | probe3 transcript |
| List | `session/list` → `{sessions: []}`（本机无成功 turn，cwd 作用域；shape 已验证） | probe2/probe3 |
| Fork | `sessionCapabilities.fork` 声明 + binary `session/fork` + CLI `--fork-session` | initialize + strings（未 live 跑） |
| Close/Delete | `sessionCapabilities.close/delete` 声明 | initialize（未 live 跑） |
| CLI 侧 | `-c/--continue`、`-r/--resume [id]`、`--fork-session`、`--session-id`、`--list-sessions`、`--delete-session`、`--no-session-persistence`（仅 --print） | `--help` |

## 3. Input / Output 通道

| 维度 | 实测结论 | 证据 |
|------|----------|------|
| 投递 | `session/prompt {sessionId, prompt: [{type:"text", text}]}`；**长 turn request**（response 在 turn 结束才返回） | probe2（错误路径实测）；Kimi ACP spike 同构 |
| 流式 | `session/update` notification：`agent_message_chunk {content:{type:"text",text}}`（live 观测）、`available_commands_update`（18 个 slash 命令，live 观测）、`user_message_chunk`（load 回放观测） | probe2/3/6 |
| 未 live 观测 | ~~`agent_thought_chunk`、`tool_call`、`tool_call_update`~~：**2026-08-22 已 live**（probe6，见 §13）；`plan` 仍未观测 | probe6 transcript |
| 错误面 | prompt 失败 = JSON-RPC `{code:500, message:"Network attempt failed at unknown"}` + 先行 `agent_message_chunk` 文本 `[Error] ...` | probe2/6 三次复现 |
| 图片 | `promptCapabilities.image: true`；ACP image block `{type:"image",data,mimeType}`；CLI 另有 `--attachment <file>` | initialize + --help |
| 中途输入 | `_meta.qoder.promptQueueing: true`；**已 live**：turn 流式中第二个 `session/prompt` 被排队，FIFO 串行完成，不报错（probe9） | initialize + probe9 |
| 取消 | `session/cancel` notification → prompt response `stopReason: "cancelled"`，**已 live**（probe7）；cancel 后无迟到 chunk | probe7 |
| 审批 | `session/request_permission`（agent→client request，binary 存在）；`bypassPermissions` mode / `--yolo` 可绕过；`fs/read_text_file`、`fs/write_text_file` client 能力在 initialize 握手 | strings + probe client 实现 |
| 配置 | `session/set_model {modelId}` → `{}` + `config_option_update`（实测）；`session/set_config_option {configId:"reasoning_effort",value:"none"}` → 全量 configOptions（实测）；`session/set_mode {modeId}` → `{}`（实测） | probe2/5 |

## 4. ACK 语义（adapter 设计输入）

| mossx ACK 阶段 | Qoder ACP 信号 | 强度 |
|---|---|---|
| Prompt Accepted | request 未立即 error + 首个 `session/update`；request id 相关 | inferred（弱），与 Kimi ACP 同级 |
| Working / First Token | 首个 `agent_message_chunk` / `agent_thought_chunk` / `tool_call` | 真实（message chunk 已 live 观测） |
| Tool Progress | `tool_call` / `tool_call_update` | **真实**（probe6 live：`pending` → `completed`，带 `rawInput`/`rawOutput`/`_meta.qoder.toolName`） |
| Completion | prompt response（成功路径 `stopReason`；错误路径 JSON-RPC error） | **真实**（错误路径已实测） |
| Interrupt | `session/cancel` → `stopReason:"cancelled"` | **真实**（probe7 live） |
| Resume | `session/resume` attach / `session/load` replay | **真实**（实测） |
| Model Binding | `session/set_model` / `set_config_option` | **真实**（实测） |

填表结论：`inputAck: "first-event"`（不假装 request-response）；Terminal 强（typed response）。**禁止**把 process spawn / stdin write 当 ACK。

## 5. History 能力

> **2026-08-22 后续（取代本节通道结论）**：产品实现已切换为 **磁盘 jsonl primary + ACP fallback**——
> `list_qoder_sessions` 读 `~/.qoder/projects/<cwd-slug>/*.jsonl`（`encode_qoder_project_slug`，Grok/PI/Kimi NativeHistoryReader 形态），仅在无匹配 project 目录时回退 ACP `session/list`；`load_qoder_session` 同样 jsonl 优先、缺失时回退 ACP `session/load`；`delete` 仍走 ACP `session/delete`（红线 21 不变：只读，不改 vendor 文件）。事实源：`src-tauri/src/engine/qoder_history.rs`。

- `session/load` 回放 = **resume 自身 history**（user/agent 消息带 `messageId`），非 arbitrary import；可作为 L3 NativeHistoryReader 的 readback 通道（后置）。
- Qoder 磁盘 session 位于 `~/.qoder/projects/**`（本机尚无成功 turn，未枚举到 session 文件）；**禁止手改 vendor history 文件**（红线 21）。
- `session/list` 可作 pending probe 手段之一。
- `session/delete` 声明存在（删除走 ACP，不直接删文件）。

## 6. Provider / Model / 配置

- **Provider 模型与 Kimi 不同**：Qoder 没有 config.toml 式多 provider API-key 面；账号 = browser login（`qoder-browser`）或 PAT（`QODER_PERSONAL_ACCESS_TOKEN` / `qoder-pat`）。mossx **不写** Qoder 凭据；vendor 面板只做 CLI 状态/登录引导/模型偏好，不做 key 管理。
- 模型目录来自 ACP `models.availableModels`（账号实时目录）或 `qodercli --list-models`；模型选择 `session/set_model`。
- reasoning effort 经 `configOptions.reasoning_effort`（high/max/none，随模型变化）。
- 隔离：`--config-dir <dir>` 换 user-level config root（每 provider profile 一个 dir），`--cwd` 定工作目录。
- MCP：`qodercli mcp` 命令族 + `--mcp-config` / `--strict-mcp-config`；ACP `mcpCapabilities {http, sse}`。

## 7. Usage

- print `-o json` result envelope 有 Claude-like `usage {input_tokens, output_tokens, cache_*}`（错误路径实测 shape）。
- ACP usage 面**已 live**（2026-08-22 probe6）：prompt response 带 `usage {inputTokens, outputTokens, totalTokens}` + `_meta.quota {token_count, model_usage[]}`（model_usage 按模型分列）。**注意：本 PAT 账号下全为零值**——shape 已验证，非零值未验证；mossx `qoder.rs` 当前**不解析**该字段，专属 usage 卡仍后置。

## 7.5 启动延迟实测（2026-08-21 补充，app 冒烟驱动）

| cwd | initialize | session/new | session/resume |
|---|---|---|---|
| `/tmp` 小目录 | 2.4s | **0.1s** | — |
| 大型 repo（codemoss） | 2.5s | **30.1s**（三次一致，非首次缓存行为，疑似固定内部周期） | **0.1s** |
| `~` home 目录 | 2.4s | 30.1s | — |

结论：`session/new` 会扫描 cwd，大目录下需要 ~30s；`session/resume` 不扫描、恒快。
mossx 侧超时预算：initialize 15s / **session/new 90s** / session/resume 30s
（`QODER_SESSION_NEW_TIMEOUT` / `QODER_SESSION_RESUME_TIMEOUT`，qoder.rs）。
首轮发送在大 repo 下天然有 ~30s 冷启动——属 Qoder 侧行为，UI 等待态需容忍。

## 8. print / stream-json 旁路（非主路径）

- `-p/--print` + `-o text|json|stream-json` 存在；`json` 输出 Claude-like result envelope（`type:"result"`、`session_id`、`usage`、`stop_reason`、`is_error`）。
- 本机 `-o json` / `stream-json` 均因上游网络失败（json 58ms 返回 error envelope；stream-json 12s 零输出 timeout）。**print 路径证据不足，不作为主协议；ACP 是唯一实测可用面。**

## 9. Capability 填表（15 key，matrix.json 用）

| key | 首期 | 依据 |
|---|---|---|
| streaming.text | supported | live `agent_message_chunk`（probe2/3/6） |
| streaming.reasoning | supported | `agent_thought_chunk` live（probe6，2026-08-22） |
| streaming.tool-output | supported | `tool_call`/`tool_call_update` live（probe6，2026-08-22） |
| tool.use | supported | CLI 内建工具 + permission modes + `session/request_permission` 面 |
| tool.mcp | supported | `mcpCapabilities {http,sse}` + `qodercli mcp` 命令族 |
| reasoning.effort | supported | `configOptions.reasoning_effort` + `set_config_option` 实测 |
| collaboration.mode | unsupported | 无 mossx collab 协议 |
| session.continuation | unsupported | L3 后置（`session/load` readback 可作未来通道） |
| image.input | supported | `promptCapabilities.image:true` + ACP image block |
| input.mid-turn | supported | promptQueueing live：流式中第二 prompt 排队 FIFO（probe9，2026-08-22） |
| session.resume | supported | `session/resume` / `session/load` 实测 |
| session.fork | supported | `session/fork` live：返回新 sessionId，fork 携带历史上下文（probe8，2026-08-22） |
| session.switch | unsupported | 不在 mossx 暴露 |
| session.tree | unknown | 未调研 |
| rpc.server | unsupported | mossx 是 ACP client |

## 10. 分档与 Shared 决策

- **首期：L1 Native**。主协议 ACP（`qodercli --acp`），**spawn-per-turn**（进程 one-shot，session persistent）：每 turn spawn → initialize → `session/resume`（首轮 `session/new`）→ 按需 `set_model`/`set_config_option` → `session/prompt` → response 即 terminal → kill。参照 `kimi.rs` 进程管理形状，避免 persistent 进程生命周期风险；per-turn 握手开销 ~0.5s（实测 initialize 550ms）。
- **不进 Shared**（Gemini/DSH 同形态）：pendingProbe / 成功 terminal / cancel 语义未完整实测；UI 侧 Shared target picker disabled + reason，不静默隐藏。
- L2（history loader 全量 + Settings/i18n）随首期交付；L3（continuation）独立 change 后置。
- 身份：thread `qoder:<sessionId>`，pending `qoder-pending-<uuid>`；`session/new` 立即返回真实 sessionId，pending 晋升走既有 ACK cache 路径。

## 11. 风险与待复核

- **R1（已收口，2026-08-22）**：黄金 turn 已补采——reasoning / tool-output / cancel / fork / promptQueueing 全部升级为 live 实测（probe6/7/8/9）；usage shape 已验证但 PAT 账号零值。剩余未 live：`plan` 事件、`session/close`/`session/delete`、非零 usage 值。
- **R2（中）隐藏 flag**：`--acp` / `--yolo` 不在 `--help`，版本升级可能变更；cache key 必须含 version+sha256+capabilities hash，变了重 probe。
- **R3（已收口，2026-08-22）**：history 主通道已转磁盘 jsonl primary（见 §5 后续标注），不再依赖 `session/list` 非空；ACP list 降为 fallback 通道。
- **R4（低）迟到 chunk**：cancel/错误后可能有 in-flight chunk（Kimi ACP 同），adapter 在 terminal 后丢弃同 session 迟到 update。
- **R5（低）replay 双 `available_commands_update`**：load/resume/list 各推一次；history loader 需去重。
- **R6（提示）错误双通道**：prompt 失败同时出现 JSON-RPC error 与 `[Error]` 文本 chunk，adapter 不得把错误文本当 assistant 正文投影两次。
- **R7（提示）CN 版**：`qoderclicn` 不同 binary/账号体系，detect 必须只认 `qodercli`，不混用。

## 12. 证据索引

可复跑 harness 已入库：`docs/research/spikes/harness/qoder-acp/`（README 含复跑命令；probe1 已对 live CLI 冒烟复验，sha256 与本报告一致）。raw transcript 含 host/账号元数据，按 evidence policy 仅本地留存（`/tmp/mossx-qoder-spike-evidence/`）：

- probe1 initialize+session/new：`probe1-initialize.transcript.ndjson`
- probe2 prompt/list/set_model：`probe2-prompt.transcript.ndjson`
- probe3 load/resume/list：`probe3-resume.transcript.ndjson`
- probe4 --yolo prompt：`probe4-yolo-prompt.transcript.ndjson`（仅 spike 期间本地脚本，未入库）
- probe5 set_config_option/set_mode：`probe5-config.transcript.ndjson`
- probe6 golden turn（qmodel_38max）：2026-08-21 网络失败 / **2026-08-22 成功**：`probe6-golden-turn.transcript.ndjson`（thought chunk + tool_call/update + usage shape）
- probe7 cancel（2026-08-22）：`probe7-cancel.transcript.ndjson`（`stopReason:"cancelled"`，无迟到 chunk）
- probe8 fork（2026-08-22）：`probe8-fork.transcript.ndjson`（新 sessionId + fork 携带历史）
- probe9 mid-turn queue（2026-08-22）：`probe9-midturn.transcript.ndjson`（流式中第二 prompt FIFO 排队）
- 交叉证据：`docs/research/spikes/2026-07-27-s3-kimi-acp.md`（同 ACP v1 词汇）、openclaw/acpx `agents/Qoder.md`、multica `server/pkg/agent/qoder.go`、Zed ACP catalog

---

## 13. 2026-08-22 黄金 turn 补采（qodercli 1.1.28，PAT 注入）

环境变化：CLI 1.1.27 → 1.1.28，browser login 态丢失（`session/new` 报 `Authentication required`）；
改用 mossx 存储 PAT（`~/.ccgui/qoder-auth.json` → `QODER_PERSONAL_ACCESS_TOKEN` spawn 注入，与生产路径一致）跑通。
initialize 握手与 1.1.27 一致（protocolVersion 1，capabilities 形状不变）；`availableModels` 新增 `auto`（default）/ `ultimate` 等条目，模型目录以 ACP 实时返回为准。

| 能力 | 实测结果 | 证据 |
|------|----------|------|
| `streaming.reasoning` | **supported**。`agent_thought_chunk {content:{type:"text",text}}` 与 message chunk 交错到达 | probe6 |
| `streaming.tool-output` | **supported**。`tool_call {status:"pending", title, kind:"execute", rawInput, _meta.qoder.toolName:"Bash"}` → `tool_call_update {status:"completed", content, rawOutput}` | probe6 |
| `input.mid-turn` | **supported**。turn 流式中发第二个 `session/prompt`，不报错，FIFO 排队：p1 `end_turn`@6.6s → p2 `end_turn`@8.5s | probe9 |
| `session.fork` | **supported**。`session/fork {sessionId, cwd, mcpServers}` → 新 sessionId + modes/models/configOptions；fork 会话可继续 prompt 且携带历史上下文（引用原 turn 回答） | probe8 |
| `session/cancel` | **supported**。cancel → prompt response `stopReason:"cancelled"`（非 error）；cancel 后无迟到 chunk（R4 未复现，仍保留防御） | probe7 |
| usage | shape live：response `usage {inputTokens, outputTokens, totalTokens}` + `_meta.quota {token_count, model_usage:[{model, token_count}]}`；**PAT 账号下全零值**，非零值待验证；`qoder.rs` 当前不解析该字段 | probe6/7 |
| 成功 terminal | `stopReason:"end_turn"` + `userMessageId`，typed response 确认 | probe6 |

未观测（保持原状）：`plan` 事件、`session/close` / `session/delete` live、非零 usage 值、`session/request_permission`（probe6 全程 `AGENT_REQS []`，bypassPermissions 下无权限请求）。

---

## 14. 2026-08-22 Shared 语境补采（probe10/11）与资格结论

Shared 资格评估要求的 CLI 侧完整链路（接入指南 §0 F 层 + Step 2 ACK 分档）：

| Shared 要求 | Qoder 实测 | 证据 |
|-------------|-----------|------|
| 成功 terminal | typed response `stopReason:"end_turn"` + `userMessageId` + usage shape | probe6 |
| cancel 语义 | typed response `stopReason:"cancelled"`（非 error，无迟到 chunk） | probe7 |
| 跨进程 multi-turn continuation（spawn-per-turn re-attach = Shared binding 复原路径） | **supported**。进程 A `session/new`+prompt 植入事实 → kill → 进程 B initialize+`session/resume`+prompt 正确回忆（"Dumbo-42, a purple elephant"） | probe10 |
| pendingProbe / 存在性探测 | **supported**。`session/list`（cwd 作用域）返回 mossx 创建的 session（含 title/updatedAt）；可作 Shared recovery 的 native probe | probe11 |
| Provider profile 隔离（`--config-dir`）不破坏 re-attach | **supported**。自定义 config-dir 下 create → kill → resume 成功；`session/list` 按 config-dir 隔离（只见自己 1 条） | probe11 |
| inputAck | `"first-event"`（弱，显式标注）——与 Kimi 同级，Kimi 已在 Shared | spike §4 |
| Context delivery | user-channel prompt prefix（`user_channel_transcript: true`，`strong_context_ack: false`）——与 Kimi/Grok/OpenCode/PI 同档；ACP `promptCapabilities.embeddedContext: true` 可作未来 structured 通道，本评估不依赖 | initialize |

**结论：Qoder 达到 Kimi/Grok/OpenCode/PI 同档 Shared 准入标准**（typed terminal + typed cancel + 跨进程 resume + list probe + user-channel context）。已开 OpenSpec change `enable-qoder-shared-target` 做 F1–F5 双集合与逐处 match wiring。

注意边界（不因进 Shared 而改变）：L3 NativeHistoryReader / Provider Continuation 仍后置；`session/tree` 仍 unknown；recovery owner 隔离——Shared Attempt/Binding recovery 禁止回退 Native resume 路径（基石 §14.4.7.1），qoder 的 `session/resume` 只是 runtime re-attach 手段，不借给 Shared recovery。
