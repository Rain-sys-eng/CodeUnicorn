# enhance-pi-native-rpc-session design

> 事实源：本机 pi 0.84+ `docs/rpc.md`、`dist/modes/rpc/rpc-types.d.ts`（全量命令枚举）、`docs/sessions.md`（fork/tree/clone 语义对比表）。
> 设计稿：`docs/designs/pi-native-features/final-recommended.html`（2026-08-23 按本文 §2 校准 legend）。
> Gate：Engine Onboarding Guide §0 矩阵逐层勾选；基石设计校准回写在收口前完成（ADR 校准回写 Gate）。

## 1. 架构总览

```
mossx frontend                     Rust (src-tauri)                      pi process
─────────────────────────────────────────────────────────────────────────────────────
Composer (queue+融合)    engine_send_message ──► PiSession ──ensure_rpc─► pi --mode rpc (resident)
  默认排队 / 融合=steer                         │                           stdin: {"id","type":"prompt"|"steer"}
气泡 ⑂ / 树 / compact    pi_fork / pi_compact ─► PiRpcClient::request ──► stdout: response(id 关联) + events
树 dock / chip / ⑂N      pi_get_session_tree ──┘                           events → parse_pi_stream_line 复用
                                                                            → EngineEvent broadcast → 幕布
fallback: RPC spawn 失败 → 现有 print-json spawn-per-turn 路径（log warn，不阻断）
```

关键决策：**一个 native pi thread = 一个 RPC resident process**。进程跟着 `PiSession`（per workspace）走；`--session-id <id>` 启动即绑定会话文件；session id 变更（fork 后）通过 `get_state` 对账 + `SessionStarted` 事件上报。

**Resident 会话对齐（2026-08-23 验收后补）**：一个 workspace 可同时存在多个 pi thread，而 resident 每 runtime key 只有一个且跟随最近一次 fork/switch。所有发送与 RPC 命令（tree/stats/compact/fork）MUST 先对齐：`switch_session` 到调用方 thread 的会话文件（pi_history 解析 id→file）；新会话目标用 `new_session`；活跃 run 且目标不同 = 诚实拒绝。这是「树结构不对 / 幕布错乱」的根因修复。

## 2. RPC 语义校准（与设计稿的差异，诚实声明）

| 设计稿假设 | RPC 实际 | v1 落地 |
|---|---|---|
| 气泡 ⑂ = 树内新 lane | `fork {entryId}` = **新会话文件**（sessions.md 对比表：/tree=同文件，/fork=新文件），返回源文本；文件头含 `parentSession` 指向源文件 | **fork-then-switch-back**：fork 后立即 `switch_session` 切回源文件——源 thread 发送不漂移；草稿写入新会话。**派生会话族模型（v2 重做）**：`parentSession` 驱动——侧栏 `useThreadRows` 过滤派生行（不占顶层也不嵌套，避免与 subAgent 混淆）；右侧面板「会话树」tab 合并派生 lanes（共享前缀 id 去重，尾部接分叉点）。**turn 进行中禁止 fork**（流式中切文件会崩坏 run） |
| 树上点节点「跳回对话」 | RPC **无 leaf-move 命令**（rpc-types.d.ts 无 navigate/goto；`switch_session` 只换文件） | fork 派生 lane（独立文件）支持「↪ 跳转」= store 跳转请求 → onSelectThread 到 `pi:<lane-session-id>`（resident 对齐自动落到该文件）；文件内 lane 诚实禁用 |
| 全屏树 overlay | 全屏接管不友好；也不塞进 subAgent inspector 分屏（pi 树与 subAgent 分域，ConversationHost/DesktopLayout 已还原）；也不要右侧文件/Git tab（位置不对） | **中间对话区「上下右」dock**（`PiConversationTreeSplit` pi 独立容器包裹聊天列：左 = 上幕布下 composer，右 = 树）；topbar 入口 / chip / 侧栏徽标统一 `openPiTreeOverlay` 开态 |
| tab chip 下拉切 lane | 同上，无切换命令 | chip = lane 指示器（>1 出现）+ 点击开树 tab；不做切换 |
| `queue_update` 驱动 mossx 队列 UI | mossx 已有自有 queue（queuedByThread）+ 融合按钮 | **复用自有 queue**：默认排队不变；融合按钮 = RPC `steer`（same-run）；不渲染第二套 pi 原生队列 |

这条校准是「不假装能力」纪律的直接应用：upstream 没有的就是没有，UI 文案不说谎。

## 3. Rust：`pi_rpc.rs` 模块契约

```rust
pub struct PiRpcClient {
    child: tokio::process::Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>,
    next_id: AtomicU64,
    state: Arc<RwLock<PiRpcState>>,   // is_streaming / session_id / session_file / queue lens
}
impl PiRpcClient {
    pub async fn spawn(bin, workspace, session_id: Option<&str>, home: Option<&str>, custom_args: Option<&str>, events: broadcast::Sender<PiTurnEvent>) -> Result<Self, String>;
    pub async fn request(&self, cmd: Value) -> Result<Value, String>;   // id 关联 + 30s timeout
    pub async fn steer(&self, text: &str) -> Result<(), String>;
    pub async fn abort(&self) -> Result<(), String>;
    pub async fn get_state / get_session_stats / compact / fork / get_tree / get_fork_messages;
    pub fn is_alive(&self) -> bool;   // try_wait 非退出
}
```

- **Framing**：stdout 按 `\n` split（`BufReader::lines`，strip 尾部 `\r`）；禁止任何把 U+2028/2029 当分隔的 reader。
- **pending 先注册后写**（2026-08-23 review 修复）：request id 的 oneshot MUST 在写 stdin 之前入 pending map——response 走独立 stdout pump task，「写完成 → 注册」窗口内到达的 response 会被当 late/unknown 丢弃，调用方干等到超时（get_state 等本地快命令最易命中）；写失败回滚 pending。
- **事件泵**：reader task 逐行 `serde_json` → 三类分流：`type=="response"`（按 id 结算 oneshot）、`type=="extension_ui_request"`（立即回 `extension_ui_response {cancelled:true}`）、其余 = agent event → `parse_pi_stream_line` 复用投影 EngineEvent broadcast。steered user message 由前端乐观气泡上幕布（`wasProcessing && steerEnabled` 既有链路），后端**不**投影 user echo（防双气泡）；`compaction_start/end` 经 Raw → canonical `thread/compacting|compacted|compactionFailed`；`agent_settled` = turn 终态信号。
- **生命周期**：`PiSession` 持有 `rpc: RwLock<Option<Arc<PiRpcClient>>>`；`ensure_rpc()` 惰性 spawn / 死亡检测（`try_wait` 已退出则丢弃重建）；`Drop` kill。
- **Fallback**：`send_message` 先 `ensure_rpc`；失败 log warn → 走现有 print-json 路径（零行为变化）。RPC 中途死亡：当前 turn `TurnError`，下一 turn 重建。
- **Turn 终态**：`agent_settled` = TurnCompleted；`abort` 后 `agent_end`(aborted) = "Session stopped."。timeout 兜底 10min——超时即摘下 run、全 waiter（main + attached steer）以同一错误一次结算再 abort（2026-08-23 review 修复：原只 emit error + abort 会残留 run，`agent_settled` 迟到或 stale-settle 自愈时同一 turn 收第二次终态）；TurnError 由 `send_message` 的 Failed 臂统一发一次，`Settled` 臂禁止重发（同 review：mismatch/align/timeout 三臂曾双发）。

## 4. 发送与中断语义

| mossx 动作 | 条件 | RPC 命令 | 终态 |
|---|---|---|---|
| 普通发送 | `!is_streaming` | `prompt {message}` | `agent_settled` |
| 融合（same-run） | `is_streaming` 且 delivery decision = steer | `steer {message}` | 同 turn 继续（continuation pulse） |
| 排队发送 | 默认 | 不进 RPC，留在 mossx queuedByThread | drain 时按上行规则 |
| 中断 | 任意 | `abort`；2s 未 settle → kill 兜底 | `agent_end`(aborted) |

图片输入：RPC `prompt`/`steer` 支持 `images: [{type:"image",data,mimeType}]`（base64）；v1 沿用现有 `@file` 方案的——**注意**：RPC 无 argv，`@file` 传输不可用，须把图片文件读为 base64 ImageContent（复用 `cli_image_input` 的 resolve，读文件编码）。prompt 内 `@path` 引用在 RPC 模式由 pi 内部展开（print 模式不展开 inline @，RPC 模式的 prompt 走正常 input expansion——已在 pi.rs 注释确认 print-mode 差异；v1 保持文本透传，图片走 images 字段）。

## 5. 前端接线（全部 `engine === "pi"` gated）

| 能力 | 载体（真实组件） | 数据源 |
|---|---|---|
| 融合=steer | 既有 `MessageQueue` 融合按钮（matrix 升 supported 后自动可用；capability 即准入，不要求 experimental steer 总开关） | `decideEngineMessageDelivery` 已有 |
| /compact | composer footer pi-only `PiCompactEntry` → `PiCompactDialog`（统计三连 + 自定义指令） | 弹窗打开时 `pi_get_session_stats` 一次性拉取（stats store 切片已作为死代码删除） |
| compaction 留痕 | canonical `thread/compacting|compacted|compactionFailed`（幕布复用 Claude 同款渲染） | `compaction_start/end` EngineEvent → Raw Pi 臂 |
| 气泡 ⑂ | user 气泡 `message-action-bar` 增加 pi-only fork 按钮 → `PiForkDialog` | `pi_fork` 返回 text → 新会话草稿（switch-back）+ 自动 `requestPiThreadJump` 跳分叉幕布 |
| 会话树 dock | `PiConversationTreeSplit`（pi 独立容器包裹聊天列，DesktopLayout 挂载；与 subAgent ConversationInspectorSplit / ConversationHost 零接触）——git-graph 轨道、会话族全图、激活路径跨 lane 贯通染色、↪ 树内跳转、turn 结束自动刷新 | `pi_get_session_tree` → lanes 投影（首个 child 延续主线）+ derivedLanes/rootEntries 族拼接 |
| tab chip | `topbar-session-tab` 内 `main ▾`（>1 lane） | tree 数据同一 store |
| 侧栏 ⑂N | `ThreadList` thread-meta 徽标（pi + active thread + >1 lane） | 同上，点击开树 |
| run-status pill | `ComposerRunStatusStrip.piTree` prop（todo/subagent/plan/edit 同款 pill） | 同上，toggle dock 开态 |

状态归属：新增 `src/features/pi-session/` feature 模块 + zustand store（keyed by threadId），**不进 AppShell domain bag**（AppShell Structure Gate：feature-local store 无需新增 owned key）。树/chip/徽标共享同一份 tree snapshot。

## 6. Capability matrix 刷新（fixture → codegen）

| key | 现值 | 新值 | 依据 |
|---|---|---|---|
| `input.mid-turn` | unsupported | **supported** | RPC `steer` 命令 + `queue_update` 事件（rpc-types.d.ts） |
| `session.fork` | unknown | **supported**（fork-to-new-file 语义注释） | RPC `fork`/`get_fork_messages` |
| `session.tree` | unknown | **supported**（只读 tree + fork；无 leaf-move，注释注明） | RPC `get_tree`/`get_entries` |
| `rpc.server` | unsupported | **supported** | `--mode rpc` resident（本 change 落地） |
| `session.switch` | unknown | 保持 **unknown** | `switch_session` 存在但未产品化 |
| `tool.mcp` | unsupported | 维持 + 注释 upstream 反 MCP 立场 | README §498 |

## 7. 测试策略

- Rust 单测（`pi_rpc.rs`）：framing（\r\n 容忍 / U+2028 不分割）、response id 关联与迟到响应丢弃、timeout、extension_ui_request auto-cancel、steer/abort 命令序列化、parse 复用投影（steered user echo / compaction 事件）。
- Rust 集成：print-json fallback 路径回归（现有 pi.rs 测试不动）。
- 前端 vitest：delivery decision pi steer 路由、PiForkDialog 回填、tree store lanes 推导、chip 显示阈值（>1 lane）、fusion 按钮对 pi 可用。
- Gate：`pnpm check:engine-capability-matrix && pnpm check:engine-adapter-registry`、typecheck、`cargo test pi_`。
- 人工黄金 turn：RPC 模式 steer 融合、abort、compact、fork、树渲染各一遍（验收时跑）。

## 8. 风险与回退

| 风险 | 缓解 |
|---|---|
| RPC 进程崩溃/僵死 | ensure_rpc 死亡检测重建 + print-json fallback；turn 级 TurnError 不扩散 |
| pi 版本过旧无 RPC | spawn 后首命令 `get_state` 握手失败 → fallback print-json（版本底线写 doctor） |
| steered 消息不上幕布 | `message_start`(role=user) echo 投影 + 黄金 turn 验收 |
| fork 后 session id 漂移 | fork 后 `get_state` 对账，emit SessionStarted 走既有 rebind |
| response 先于 pending 注册到达 | pending 先注册后写 stdin（写失败回滚），迟到 response 丢弃不 panic |
| turn timeout 后双终态 | 超时即摘 run 全 waiter 一次结算；`Settled` 臂禁止 send_message 重发 TurnError |
| `agent_settled` 丢失（broadcast lag）→ 僵尸 run | `settle_stale_rpc_run_if_idle`：client `is_streaming` 为权威，run 存在但非流式 = 防御性结算（align/send/fork 三入口接入） |
| 事件泵背压 | broadcast 1024 + 树/统计走 on-demand 拉取，不推高频事件进根链（Render Perf 红线：高频 setState 禁挂根 hook） |

回退开关：`EngineConfig.custom_args` 或 settings 级 `piRpcResident: false` → 纯 print-json（编译期常量参照 `GEMINI_RUNTIME_ENABLED` 形态，默认 on）。
