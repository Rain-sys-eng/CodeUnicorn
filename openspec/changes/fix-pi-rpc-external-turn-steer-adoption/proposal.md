# Change: fix-pi-rpc-external-turn-steer-adoption

## Why

用户实证（2026-08-25，截图取证）：PI 会话内 agent 的 turn 已结束（最终消息已渲染），agent 声明「等后台任务结果」。用户随后发送「我现在等结果就行是吗」，直接收到：

> 会话失败: pi rpc prompt failed: Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.

根因是本地/pi 状态错位有一个方向完全无兜底。`try_send_message_rpc` 的 steer/prompt 判据是**本地** `resident.run.is_some()`：

| 本地 run | pi streaming | 现状 |
|---|---|---|
| 有 | 是 | steer attach ✅ |
| 有 | 否 | `settle_stale_rpc_run_if_idle` 先结算再 prompt ✅ |
| 无 | 否 | prompt ✅ |
| **无** | **是** | 裸 prompt → pi 拒绝 → 硬报「会话失败」❌ |

「本地 run=None 但 pi 在跑」有两个来源：

1. **pi 自唤醒 turn**：后台任务完成通知由 pi 进程内部注入唤醒新 turn，不经过 ccgui 发送路径，本地永远不会为它建 run；且 pump 在 run=None 时丢弃全部事件（`pi.rs:1035`），该 turn 的流式输出本地不可见。
2. **判定竞态**：本地检查时 pi 空闲，`prompt` 到达 pi 时它刚被唤醒开始处理。

同类次生漏洞：外部 turn 期间 run=None 使发送前置检查走「空闲」分支，`align_rpc_session` 可能 mid-turn `switch_session`、`reconcile_rpc_model` 可能 mid-turn `set_model`（违反既有「活跃 run steer 不中途换模型」语义）；`rpc_has_active_run_for` 漏报 → fork/compact 守卫可被绕过。

## What Changes

- **F1 orphan run 承接外部 turn（pump 层）**：`agent_start` 到达且本 resident 无 run 时创建 orphan run（合成 main turn id、`orphan: true` 标记、dropped-rx waiter），承接事件流并累积 `response_text`；`agent_settled` 按既有逻辑结算（含 `get_last_assistant_text` 回填）。orphan run 的事件发往合成 turn id，被 daemon forwarder 按 turn_id 过滤天然丢弃，不污染任何真实会话 UI。
- **F2 发送判据放宽 + 收养（send 层）**：steer/prompt 判据从 `run.is_some()` 放宽为 `run.is_some() || client.is_streaming()`；发送前置检查同步放宽（streaming 时跳过 align/reconcile，防止 mid-turn 切会话/换模型）。steer attach 时 run 缺失则补 orphan run；首个 attach 到 orphan run 的真实 turn **收养主流**：成为 main turn、即时回放已缓冲文本、settle 取得完整 `response_text`（`settle_rpc_run` 的 main 判定从 `index == 0` 改为 `turn_id == main_turn_id`）。
- **F3 busy 错误自动转 steer（兜底）**：idle 判定后发出的 `prompt` 被 pi 以「already processing」拒绝时（判定与到达之间的残余竞态），自动改用 `steer` 重投同一条消息一次并按 F2 attach 结算，不再向用户暴露「pi rpc prompt failed: Agent is already processing」。非 busy 类 prompt 错误维持原样报错不重试。
- **F4 守卫同步**：`align_rpc_session` 的拒绝切会话条件与 `rpc_has_active_run_for` 增加 `|| client.is_streaming()`。

## Impact

- Affected specs: `pi-rpc-session-runtime`（MODIFIED「发送语义 MUST 区分 idle prompt 与 streaming steer」）。
- Affected code: `src-tauri/src/engine/pi.rs`（pump / send / settle / 守卫 + 单测）。不动 daemon、不动前端、不动 `pi_rpc.rs`（steer 命令已存在）。
- 行为变化：外部 turn 期间用户发送从「硬失败」变为「steer 融合进当前 turn 并拿到完整回复」；纯外部 turn（无用户插话）的流式内容仍不实时上屏（daemon turn_id 过滤），历史刷新后可见——与今天一致，无回归。
