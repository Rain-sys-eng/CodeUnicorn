# Tasks: add-claude-mid-turn-stream-idle-watchdog

## 1. claude.rs mid-turn 看门狗

- [x] 常量 `CLAUDE_STREAM_MID_TURN_IDLE_STEP`（prod 120s / test 1s）与 `CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP`（prod 2100s / test 30s——必须超过既有 fixture 最长合法静音 7s，经首轮测试失败校准），附合法静音盘点注释；prod 值由独立常量 `CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP_PROD_SECS` 承载以便测试断言。
- [x] `MidTurnIdleAction { Wait, Kill }` + 纯函数 `claude_mid_turn_idle_action(idle, has_pending_user_input, hard_cap)`。
- [x] 读循环：维护 `last_stream_event_at: Instant`（初始化于循环前，每收到一行刷新）。
- [x] 无界分支改 `tokio::time::timeout(STEP, lines.next_line())`：Ok 原样返回；Err 时读 `pending_user_inputs` → 纯函数判定 → Wait 则 warn 日志（idle 秒数 + diagnostic sample 快照）continue；Kill 走 `fail_stream_mid_turn_idle_timeout`。
- [x] 新增 `fail_stream_mid_turn_idle_timeout`（镜像 `fail_stream_no_event_timeout`：remove child + terminate + stderr drain 2s cap + TurnError code `claude_stream_mid_turn_idle_timeout` + clear_turn_ephemeral_state + Err）。

## 2. 测试

- [x] 纯函数单测矩阵：pending user input 恒 Wait；idle < cap → Wait；idle ≥ cap 且无 pending → Kill；边界 idle == cap。
- [x] `cargo test --lib engine::claude::` 全绿（181/0；首轮 3 失败已修：test cap 3s 误杀 sleep 4s fixture → 升 30s；prod cap 断言改走 PROD_SECS 常量；复跑 2 失败确认为并行负载 flaky，单跑与全组复跑均过）。

## 3. OpenSpec

- [x] `openspec validate add-claude-mid-turn-stream-idle-watchdog` 通过。
