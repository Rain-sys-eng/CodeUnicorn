# Design: fix-orphan-turn-during-backend-unavailability

## 0. 背景与目标

问题：turn 进入「响应中」后，若**后端永远不回任何事件**（dev 重启窗口 / backend wedge / daemon 重启），前端 turn 状态机永久卡死。既有看门狗（后端 900s RPC silence、Claude mid-turn idle）都要求「后端存活且已起流」，不覆盖「从未起流」。

目标：**任何 native 引擎 turn 的「零首事件」窗口必须有界**；用户在 ≤90s 内得到可重试错误，而不是无限转圈。

分层原则（与既有 watchdog 互补，不重复造轮）：

| 层 | 既有覆盖 | 本 change 新增 |
| --- | --- | --- |
| 后端运行时（进程活着） | pi.rs `emit_error` + 900s silence watchdog；Claude mid-turn watchdog | F3 补 detached spawn panic 兜底 |
| 后端接收时（进程活着但引擎已知死） | RPC circuit breaker latch（冷却后自愈） | F2 send gate：不返回 started |
| 前端（后端 wedge / 已死 / 事件断流） | 无 | F1 孤儿 turn 看门狗（engine-agnostic 兜底） |

## 1. F1 前端孤儿 turn 看门狗

### 1.1 触发与生命周期

- 位置：`useThreadMessaging.ts` native 路径——`markProcessing(threadId, true)` 乐观点亮后，为该 threadId 挂一个 `ORPHAN_TURN_FIRST_EVENT_TIMEOUT_MS`（prod 90s）timer。
- 取消条件（任一即 cancel + cleanup）：
  - 该 thread 收到**任意**引擎事件（`turn/started`、`item/*`、`session/*`、任何 delta）——首事件定义刻意放宽，避免慢引擎冷启动误杀；
  - `isProcessing` 被任何路径清除（terminal / interrupt / rpcError）；
  - thread 切换/卸载时随 effect cleanup 清理。
- 触发动作：
  - `markProcessing(threadId, false)` + `setActiveTurnId(threadId, null)`；
  - `pushThreadErrorMessage`（可重试文案，新 i18n key `threads.turnOrphanedRetryable`，11 locale）；
  - 诊断事件（`emitTurnDiagnostic("orphan-turn-first-event-timeout")`，含 elapsedMs / engine / threadId / activeTurnId）；
  - 复用 `turnSettlementDecision` 的 terminal kind `stalled` 走既有 settle 通道，避免另起一套 settle 语义。

### 1.2 为什么 90s

- 大于全引擎已知最慢合法冷启动（CLI spawn + 模型排队 + 首事件）：PI RPC resident spawn 秒级；Claude/Codex 冷启动含 auth/CLI 启动 10~30s 级；90s 留足余量。
- 小于用户感知「卡死」的耐心阈值（本次实测用户在 46s+ 已截图报障）。
- 可配（模块级常量 + test setter），后续可按引擎细分。

### 1.3 与既有机制的互斥

- `useThreadTurnSettlementReconciliation`：事件驱动，零事件不触发；F1 触发时 turn 已判孤儿，无需 status query（后端本来就没回执）。
- shared V2：不走 F1（`threadKind === "shared"` 分支不挂看门狗）；其 `ackAmbiguous` / `connectionLost` / recovery 机制自管。
- interrupt：用户手动中断清 `isProcessing` 即取消看门狗。

## 2. F2 后端 PI send gate

`engine/commands.rs` PI 分支，在 spawn detached `send_message` 之前：

- 读 workspace runtime 的 RPC disabled latch（`pi.rs` 已有 `rpc_disabled_since`，补一个只读查询接口，如 `pub fn rpc_spawn_blocked(&self) -> bool`）；
- 若 latch 生效（冷却期内）**且** print-json fallback 也不可用（busy / 被拒），返回结构化 error：

```json
{ "error": { "message": "PI engine is restarting (rpc cooldown); please retry", "code": "pi_engine_unavailable" } }
```

- 前端 `extractRpcErrorMessage` 命中既有 `rpcError` 分支：`markProcessing(false)` + 错误消息 + 不进入孤儿看门狗窗口（因为 invoke 已返回 error，乐观 processing 已被清除）。

边界：latch 是「最近一次 spawn 失败」的证据，不保证下一次仍失败——但 send gate 只在「fallback 也被拒」时才拦，两证据叠加时快速失败优于静默孤儿。

## 3. F3 detached send panic 兜底

PI 分支 detached `tokio::spawn` 闭包：

```rust
tokio::spawn(async move {
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
        futures::executor::block_on(session_clone.send_message(params, &turn_id_clone))
    }));
    match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => log::error!("PI send_message failed: {e}"), // pi.rs 内部已 emit_error
        Err(panic) => {
            log::error!("PI send_message panicked: {panic:?}");
            session_clone.emit_error(&turn_id_clone, "pi send task panicked".into());
        }
    }
});
```

（实际实现避免 `block_on`——保持 async，用 `futures::FutureExt::catch_unwind`。）

即使 F3 失效，F1 前端看门狗仍在 90s 内兜底 settle——两层独立。

## 4. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 误杀慢启动 turn（首事件 >90s） | 首事件定义宽（任何 method）；阈值可配；F1 触发只落错误消息不丢 turn 数据，用户重发即恢复 |
| F1 与 terminal 事件竞态（事件在途） | settle 前二次检查 `threadStatusById[threadId]?.isProcessing`；已 settled 则跳过（复用 turnSettlementDecision 的 stale-turn 判定） |
| F2 误拦可恢复场景 | 仅「latch 生效 AND fallback 拒绝」双证据才拦；单证据放行走既有路径 |
| dev 环境 in-flight 代码 panic 多发 | F3 catch_unwind 保证事件兜底；panic 信息进日志 |
| 首事件登记跨 turn 污染（非 turn 事件 / 上一 turn 迟到登记遮蔽新 turn 孤儿判定） | arm 时一律清陈旧登记；已见首事件的窗口内再次 arm 视为新 turn 重挂全新窗口，仅零事件窗口内的重复 arm 复用最早 deadline |

## 5. 实施顺序

1. F1 前端看门狗（纯增量，收益最大，先手测可复现：kill 后端模拟）；
2. F3 后端 panic 兜底（小改动）；
3. F2 send gate（需要 pi.rs 补查询接口）；
4. spec sync + 真机验证（tauri dev 重启窗口实测复现 → 确认 90s 内 settle）。
