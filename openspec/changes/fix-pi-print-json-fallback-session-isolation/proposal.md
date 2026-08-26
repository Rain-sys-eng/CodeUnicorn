# Change: fix-pi-print-json-fallback-session-isolation

## Why

线上实测（2026-08-25 用户报告）：

1. 并行新建 PI 会话一开始正常；在**历史会话切模型**后发消息报 `PI session is busy (rpc unavailable, print-json fallback cannot steer); the message stays queued.`
2. 之后**新建 PI 会话也报同一句**，全 workspace 只剩一个 PI 能跑。

代码事实源（`src-tauri/src/engine/pi.rs`）：

- **B1 忙锁全局化**：`send_message` 的 print-json fallback 互斥是 `!active.is_empty()`（`active_processes` 按 turn_id  keyed，不带 session 信息）。注释写「同会话并发进程会交叉写同一 session JSONL」，实现却把一个 workspace 级 `PiSession` 里的**所有** print-json 进程当成互斥条件。A 会话 fallback 在跑，B 会话/新会话一律 busy。
- **B2 fallback 释放漏 scratch 槽**：fallback 分支 `if let Some(session_id) = ... { drop_resident(session_id) }`，且 `drop_resident` 硬编码 `session:{id}`。新会话 `session_id=None`（`pi-pending-*` 第一句 `continueSession=false`）直接跳过释放；`try_send_message_rpc` 实际占用的是 `scratch:{turn_id}` 槽（`pi_resident_map_key`），resident 泄漏。
- **B3 `rpc_disabled` 闩误伤存活 resident**：`ensure_resident` 在复用检查**之前**就 `if rpc_disabled → Err`。一次历史会话 spawn/handshake 失败（切模型后 kill 重 spawn 最容易踩）把整个 workspace 的 PI 永久降级 print-json，连仍存活的并行 tab 也不能继续 RPC。G19 已去掉命令路径的复位，闩一旦打上没有任何出口。
- **B4 `rpc_has_active_run_for(None)` 查错槽**：`pi_resident_map_key(None, "commands")` = `scratch:commands`，是树/fork 面板共享槽，与本次新发送的 `scratch:{turn_id}` 无关。

B1+B3 叠加即用户看到的「只能有一个 PI」：历史会话切模型 → `set_model` 失败 → Fallback → drop resident → print-json 在跑 → 全局 `!active.is_empty()` 把后续所有发送打成 busy；或重 spawn 失败闩死 `rpc_disabled` → 全员 print-json → 再撞全局忙锁。

## What Changes

- **F1 `ActivePiChildProcess` 增加 `session_id: Option<String>`**：spawn 时记录 `params.session_id`，互斥判定有据可依。
- **F2 新增纯函数 `print_json_fallback_busy(active_sessions, session_id)`**：仅当存在与本次发送**同一 session id** 的活跃 print-json 进程才判忙；`session_id=None`（新会话，各自落全新 JSONL）恒不忙。替换 `!active.is_empty()`。
- **F3 `ensure_resident` 禁用闩后移**：先复用存活 resident（含 `rpc_disabled=true` 时），仅新 spawn 前才检查闩。存活并行 tab 不被历史会话的一次 spawn 失败拖下水。
- **F4 `send_message` fallback 按 map key 释放**：`drop_resident_by_key(&pi_resident_map_key(params.session_id.as_deref(), turn_id))`，覆盖 `scratch:{turn_id}` / 非法 id，不再只认 `session:{id}`。新增 `drop_resident_by_key`，`drop_resident(session_id)` 保留为 `session:{id}` 包装（`manager.rs::drop_pi_resident_by_session_id` 调用面不变）。
- **F5 `send_message` busy 检查对 `session_id=None` 跳过 rpc run 查询**：新发送的本会话 scratch 槽已在 F4 释放，`scratch:commands` 与本次发送无关。
- **F6 测试**：`print_json_fallback_busy` 纯函数矩阵（同 session 互斥 / 跨 session 并行 / 新会话恒放行）；fallback 释放 key 与 `try_send_message_rpc` scratch key 同源契约。

## Capabilities

### Modified Capabilities

- `pi-rpc-session-runtime`：
  - 「Resident MUST 按会话隔离（真并行）」追加 scenario：RPC 禁用闩不得误伤存活 resident。
  - 「RPC 不可用时回退 print-json」追加 scenarios：fallback 忙互斥仅按 session 生效；fallback 必须按 map key 释放本次发送占用的 resident（含 scratch 槽）。

### Non-Goals

- 不改 `set_model` 失败的 Fallback 语义（归档 design 既定：不能以漂移模型静默作答；F4 修好后下一 turn 会重 spawn 带 `--model` 的 resident，自然恢复 RPC）。
- 不改 `rpc_disabled` 闩本身的置位条件与不可逆性（G19 结论保留）；只保证它**只拦新 spawn**。
- 不动 fusion/steer 的 busy 拒绝语义：同一 session 的并发 print-json 仍然拒绝并留队列。
- 不动前端：busy 错误文案、队列行为不变。
- 不碰工作树中与本 change 无关的未提交改动（`expand-shared-atomic-reasoning-linkage-to-pi` 及 notification sound 相关文件）。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Backend | `src-tauri/src/engine/pi.rs` 单文件 |
| Frontend | 零改动 |
| 测试 | `pi.rs` mod tests 追加 2 个纯函数/契约测试 |
| 热路径 | busy 检查从 O(1) map is_empty 变 O(n) values 扫描（n = 活跃 print-json 进程数，个位数）；fallback 释放多一次 map remove |
| 兼容性 | `drop_resident` pub 签名不变；`ActivePiChildProcess::new` 为 private |
| ADR 校准 | 不命中基石文档更新触发器（非 engine registry / Shared 支持集合 / provider binding / fact schema / context compiler / terminal-ACK / recovery exit 变更；属 fallback 纪律的 bug 修复，spec 语义经 MODIFIED delta 明确） |

## Acceptance

1. 历史会话切模型失败回退 print-json 后，另一并行 PI 会话（RPC 存活）继续正常 streaming。
2. 会话 A print-json 在跑时，新建 PI 会话发第一句不再报 `PI session is busy`，各自 spawn 各自 JSONL。
3. 同一 session id 已有活跃 print-json 进程时再发同会话消息，仍报 busy 并留队列（防交叉写 JSONL）。
4. `rpc_disabled=true` 后，存活 resident 的会话仍走 RPC；仅需要新 spawn 的会话降级 print-json。
5. fallback 发生后 `residents` map 中不残留本次发送的 scratch/session resident（日志可见 `dropped resident key=...`）。
6. `cargo test engine::pi` 全绿。
