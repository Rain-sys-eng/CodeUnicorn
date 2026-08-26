# Change: add-claude-mid-turn-stream-idle-watchdog

## Why

用户反馈（2026-08-25，0.9.3 测试版 Windows）：「经过 CCSwitch 转发的 claude-sonnet-5 模型，ClaudeCli 引擎，对话刚开始是正常渲染的，后面再次对话忽然就渲染不出来了，经常性遇到」。

根因机制（代码事实）：`src-tauri/src/engine/claude.rs` 的 stdout 读循环在「已见有效流事件、未见 `result`、无 pending 后台 Agent 任务」分支是**无界 `lines.next_line().await`**（代码注释自述 "Before `result` is seen, the stream-read wait is normally unbounded by design"）。现有超时边界只有三处：首事件 90s（`CLAUDE_STREAM_FIRST_EVENT_TIMEOUT`）、post-result grace 5s、后台 Agent 任务 30min。

CCSwitch 等中转代理场景下，resume 轮携带全量上下文、流更长，**mid-turn 断流/半开 TCP 连接**（Windows 上尤其不产生 EOF）概率显著高于首轮。一旦断流：turn 永远挂起——无 TurnError（进程未退出、无流错误）、线程永远「生成中」、后续发送被挂起 turn 挡住。用户无任何感知与恢复路径。PI 引擎同类问题已修（`7f91b7389` 看门狗对账），Claude 引擎缺 mid-turn 看门狗。

## What Changes

- **F1 mid-turn 空闲看门狗（claude.rs）**：无界分支改为步进等待（`CLAUDE_STREAM_MID_TURN_IDLE_STEP` = 120s）。每步超时：
  - 该 turn 有 pending AskUserQuestion（`pending_user_inputs`）→ 挂起硬上限，继续等（用户输入合法静音由用户驱动，30min 自结算）；
  - `last_stream_event_at.elapsed()` ≥ 硬上限 `CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP`（= 2100s = ASK_USER_QUESTION_TIMEOUT_SECS 1800s + 300s 余量）→ flush 残留 delta、kill 子进程、emit `TurnError`（code `claude_stream_mid_turn_idle_timeout`，错误文案含 idle 秒数与 diagnostic sample），`clear_turn_ephemeral_state` 后返回 Err；
  - 否则 `log::warn!`（含 idle 秒数 + diagnostic sample 快照）继续等。
- **F2 纯函数判定**：`claude_mid_turn_idle_action(idle, has_pending_user_input, hard_cap) -> MidTurnIdleAction { Wait, Kill }` 承载判定，单测矩阵覆盖（pending 挂起 / 未达上限 / 达上限 kill）。
- **F3 记录每行到达时间**：读循环维护 `last_stream_event_at: Instant`，每收到一行刷新。

## Capabilities

### Modified Capabilities

- `runtime-session-lifecycle-stability`：ADDED requirement——Claude turn 的 mid-turn 流静音 MUST 有界（看门狗），合法静音期（工具/AskUserQuestion/后台任务）MUST NOT 被误杀。

### Non-Goals

- 不做前端心跳 UI（「已等待 Xs」）——v1 仅日志 warn + 硬上限兜底；前端已有手动 interrupt 逃生口。
- 不改首事件超时、post-result grace、后台 Agent 任务上限三处既有边界。
- 不做 TCP 连接级活性探测（跨平台成本与误报风险高）；进程活性检查对代理断流无效（CLI 进程活着但 socket 静默）。
- 不把硬上限接入 shared-session 自动重试白名单（先把失败暴露出来，重试策略单独评估）。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Backend | `src-tauri/src/engine/claude.rs`（2 常量 + 纯函数 + 读循环分支 + kill 路径 + 单测） |
| 热路径 | 正常流式时每行仅一次 `Instant` 赋值；看门狗每 120s 一步，无锁竞争（pending_user_inputs 仅超时时读） |
| 兼容性 | 新 TurnError code `claude_stream_mid_turn_idle_timeout`；合法长工具/AskUserQuestion 不受影响（上限 > 全部合法静音 ceiling） |

## Acceptance

1. mid-turn 断流（无任何 stdout 事件）持续 ≥2100s 且无 pending AskUserQuestion → turn 被 kill，UI 收到带 `claude_stream_mid_turn_idle_timeout` code 的 TurnError，线程解除「生成中」，用户可重发。
2. pending AskUserQuestion 期间看门狗硬上限挂起，等待用户应答不受影响（30min 自结算既有行为不变）。
3. 静音 <2100s 时仅 warn 日志，turn 正常继续；事件到达即重置 idle 计时。
4. 纯函数单测矩阵全绿；`cargo test --lib engine::claude` 全绿；`openspec validate add-claude-mid-turn-stream-idle-watchdog` 通过。
