# Change: fix-orphan-turn-during-backend-unavailability

## Why

用户实测（2026-08-26，dev 环境，PI 引擎）：`tauri dev` 重启窗口（后端进程已退出/重建、旧 WebView 仍在）内发送消息，UI 永久停在「响应中」（截图 `0:46 响应中...`），无任何 delta / error。诊断证据（`docs/analysis/pi-orphan-turn-during-dev-restart-2026-08-26.md`）：

- pi session 目录在事发后**零写入**、消息文本在全部 session jsonl 中 grep 不到 ⇒ 消息从未到达 pi 进程；
- 事发时无任何 pi 进程存活；
- 前一分钟链路正常（上一 turn 6s 完成），排除模型慢/附件/用户操作。

代码核实（2026-08-26，本 change 前置调查）确认了**结构性缺口**，与上述现象完全吻合：

**前端（engine-agnostic）**：

1. `useThreadMessaging.ts` 在 invoke 前乐观 `markProcessing(threadId, true)`；`isProcessing` 仅由「RPC 返回 error」「terminal 事件」「用户 interrupt」清除。零事件 ⇒ 永不清除。
2. 全仓无 invoke 超时（`src/services/tauri.ts` 无 timeout 包装）。
3. 既有看门狗无一覆盖「零首事件」窗口：`TURN_STALL_WARNING_MS`(6s) 仅诊断日志；`CODEX_TURN_NO_PROGRESS_STALL_MS`(600s) 仅 codex 且事件驱动；`OPENCODE_INFLIGHT_STALL_MS`(18s) 仅 opencode 队列记账；`useThreadTurnSettlementReconciliation` 的 status query 是事件驱动，零事件永不触发。

**后端（PI 分支）**：

1. `engine/commands.rs` PI 分支：`engine_send_message` 立即返回 `{"turn": {"status": "started"}}`，真正 `send_message` 在 detached `tokio::spawn` 内执行，失败仅 `log::error!`（无事件回传）。
2. pi.rs 内部失败路径大多有 `emit_error`（Failed / spawn 失败）+ 900s RPC silence watchdog，但全部依赖**后端进程存活且 tokio runtime 正常调度**——dev 重启 / runtime wedge（如 rustc 99% CPU 抢占）窗口内全部失效。

既有 0.9.3 RPC circuit breaker 覆盖「运行中进程故障」；Claude mid-turn watchdog（`add-claude-mid-turn-stream-idle-watchdog`）覆盖「流中断」；两者都不覆盖「发送瞬间后端不可用且永远不会有回执」。此窗口在 dev 热重启下分钟级拉长，生产环境 backend wedge / daemon 重启（web-service 模式浏览器 tab 存活）同理。

## What Changes

- **F1 前端孤儿 turn 看门狗（兜底，engine-agnostic）**：turn 进入 `isProcessing=true` 后，若在 `ORPHAN_TURN_FIRST_EVENT_TIMEOUT_MS`（默认 90s，可配）内未收到任何该 turn 的首事件（`turn/started` / `item/*` / `session/*` 任一即算首事件），判定为孤儿 turn：清除 `isProcessing` + `activeTurnId`，落一条**可重试**错误消息（区分「引擎无响应，请重试」与真实模型错误），发诊断事件。看门狗必须：
  - 收到任意首事件即取消（不打扰正常慢启动，如 CLI 冷启动、模型排队）；
  - 与 interrupt/terminal 事件互斥（settled turn 不再触发）；
  - 仅作用于 native 引擎路径（shared V2 有自己的 durable 状态机与 recovery，不在本 change 范围）。
- **F2 后端 PI send gate（快速失败）**：`engine/commands.rs` PI 分支在 spawn detached `send_message` 前，若该 workspace+provider runtime 的 resident 已知死亡（latch 冷却期内）且 print-json fallback 也被禁用/拒绝，**不返回 started**，改为返回结构化 error（消息不进入 turn 状态机），前端走既有 `rpcError` 路径快速失败。
- **F3 detached send 失败必发事件**：PI 分支 detached `tokio::spawn` 中 `send_message` 返回 Err 时，除 `log::error!` 外**必须**确认已有 TurnError 事件回传（pi.rs 内部 emit_error 已覆盖大部分；补齐 `panic = unwind` 兜底：spawn 闭包包一层 catch，防 in-flight dev 代码 panic 导致静默孤儿）。

## Capabilities

### Modified Capabilities

- `runtime-session-lifecycle-stability`：ADDED requirement——native 引擎 turn 的「零首事件」窗口 MUST 有界：前端看门狗 MUST 在阈值内 settle 孤儿 turn 为可重试错误，MUST NOT 永久停留在「响应中」。
- `pi-rpc-session-runtime`：ADDED requirement——PI `engine_send_message` MUST NOT 在已知引擎不可恢复不可用时返回 started；detached send 失败 MUST 有 TurnError 事件兜底。

### Non-Goals

- 不做 tauri dev 热重启广播（backend-restarting 事件禁用发送入口）——体验优化，且 WebView 与后端同进程死亡场景下广播本身不可达；看门狗已兜底。留作后续可选。
- 不改 shared-session V2 发送路径（其 durable-first 状态机 + recovery 机制已有 `ackAmbiguous`/`connectionLost` 处理，架构不同）。
- 不改后端 900s RPC silence watchdog（它覆盖的是「起流后静音」，与「从未起流」互补）。
- 不做后端进程级健康心跳（跨 WebView/backend 的存活性探测成本高；前端看门狗已覆盖该窗口）。
- 不引入 turn 自动重发（孤儿 settle 后由用户手动重发，避免重复执行副作用）。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Frontend | `useThreadMessaging.ts`（native 路径 markProcessing 后启动看门狗）+ 新 util（纯函数判定，可单测）+ i18n 文案（`threads.turnOrphanedRetryable` 类 key，11 locale） |
| Backend | `src-tauri/src/engine/commands.rs` PI 分支（send gate + spawn panic 兜底） |
| 热路径 | 看门狗仅「turn 启动后无事件」期间挂一个 timer，首事件到达即 clear；正常 turn 零额外开销 |
| 兼容性 | 新错误文案需 i18n；孤儿 settle 不得误伤慢启动 turn（阈值 90s > 全引擎已知最慢冷启动；首事件定义宽：任何 method 均算） |

## Acceptance

1. 模拟后端不可用（invoke 悬死或 started 后零事件）≥90s：UI 落可重试错误、解除「响应中」、composer 可再发（单测：fake timer 推进 + 零事件断言）。
2. 正常 turn（首事件 <90s 到达，含慢引擎）：看门狗取消，无任何行为变化（回归：现有 threads 测试零新增红）。
3. 已 settled turn（terminal/interrupt 先到）：看门狗不触发。
4. PI send gate：latch 冷却期内且 fallback 拒绝时，`engine_send_message` 返回结构化 error 而非 started；前端走既有 `rpcError` 分支（不进入孤儿看门狗）。
5. detached send panic（人为注入）：仍能收到 TurnError（或至少不留下永久孤儿 turn——由 F1 兜底 settle）。
6. `npm run typecheck` 0 error；相关 vitest 全绿；`cargo test --lib engine::` 全绿；`openspec validate fix-orphan-turn-during-backend-unavailability` 通过。
