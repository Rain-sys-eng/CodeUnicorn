# Design: add-claude-mid-turn-stream-idle-watchdog

## 合法静音期盘点（误杀风险分析）

mid-turn（首事件后、`result` 前）stdout 合法静音的来源与上限：

| 来源 | 上限 | 说明 |
| ---- | ---- | ---- |
| AskUserQuestion 等用户应答 | 1800s（`ASK_USER_QUESTION_TIMEOUT_SECS`） | 用户驱动，可随时远超任意固定阈值 → **看门狗必须挂起**（`pending_user_inputs` 非空时） |
| MCP 工具调用 | 1800s + 余量（`MCP_TOOL_TIMEOUT` 对齐） | CLI 侧超时后自产 error 事件 → 流恢复 |
| Bash 等本地工具 | 600s（claude code 默认 max） | CLI 侧超时自结算 |
| 后台 Agent/Task（run_in_background） | 已被 `CLAUDE_BG_TASK_MAX_WAIT` 30min 单独 bound | 不在本分支（`pending_agent_task_ids` 非空走另一分支） |

结论：除 AskUserQuestion（用户驱动）外，一切合法静音由 CLI 侧在 ≤1800s+余量 内自结算（超时错误会作为流事件出现）。因此硬上限取 **2100s = 1800s + 300s 余量**，并对 pending user input 挂起——可证明不误杀合法工作。

## 判定纯函数

```rust
pub(crate) enum MidTurnIdleAction {
    Wait,
    Kill,
}

fn claude_mid_turn_idle_action(
    idle: Duration,
    has_pending_user_input: bool,
    hard_cap: Duration,
) -> MidTurnIdleAction
```

- `has_pending_user_input == true` → 恒 `Wait`（挂起硬上限）。
- `idle < hard_cap` → `Wait`。
- 否则 → `Kill`。

warn 日志不进纯函数（每步超时且 Wait 时由调用点统一打）。

## 读循环接线

无界分支（`saw_valid_stream_event && result_seen_at.is_none() && pending_agent_task_ids.is_empty()`）：

```rust
match tokio::time::timeout(CLAUDE_STREAM_MID_TURN_IDLE_STEP, lines.next_line()).await {
    Ok(result) => result,                       // 正常路径不变；收到行后刷新 last_stream_event_at
    Err(_) => {
        let has_pending = self.pending_user_inputs.lock()
            .map(|m| m.contains_key(turn_id)).unwrap_or(false);
        match claude_mid_turn_idle_action(last_stream_event_at.elapsed(), has_pending, CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP) {
            MidTurnIdleAction::Wait => { log::warn!(...); continue; }
            MidTurnIdleAction::Kill => {
                // flush delta → kill child（镜像 fail_stream_no_event_timeout 的
                // active_processes.remove + terminate_child_process + stderr drain 2s cap）
                // → emit TurnError(code: claude_stream_mid_turn_idle_timeout)
                // → clear_turn_ephemeral_state → return Err
            }
        }
    }
}
```

Kill 路径抽 `fail_stream_mid_turn_idle_timeout(turn_id, idle, diagnostic_sample, stderr_handle)`，镜像既有 `fail_stream_no_event_timeout`（同 kill、同 stderr drain 上限、同 ephemeral 清理），仅错误文案与 code 不同。

## 常量

```rust
#[cfg(not(test))]
const CLAUDE_STREAM_MID_TURN_IDLE_STEP: Duration = Duration::from_secs(120);
#[cfg(test)]
const CLAUDE_STREAM_MID_TURN_IDLE_STEP: Duration = Duration::from_secs(1);

// ASK_USER_QUESTION_TIMEOUT_SECS(1800) + 300s 余量：合法静音（工具/MCP）由 CLI
// 在 1800s+ 内自结算，超过即判定代理断流/CLI 卡死。
#[cfg(not(test))]
const CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP: Duration = Duration::from_secs(2100);
#[cfg(test)]
const CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP: Duration = Duration::from_secs(3);
```

## 为什么不做前端心跳 UI（v1）

- 前端已有手动 interrupt 逃生口；TurnError 会解除「生成中」并允许重发。
- 新增 heartbeat EngineEvent 涉及 `engine_event_to_app_server_event` 映射 + 前端订阅 + 渲染，属跨层变更，单独 change 评估。
- v1 目标是把「无限隐形挂起」变成「有界失败 + 可诊断日志」，止损优先。
