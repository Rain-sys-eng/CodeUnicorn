# Tasks: fix-pi-rpc-external-turn-steer-adoption

## 1. `PiRpcRun` orphan 形态与 settle 收养

- [x] `PiRpcRun` 加 `orphan: bool`（`new` 置 false）；新增 `PiRpcRun::new_orphan()`（合成 id `pi-external-{millis}-{seq}`，静态 `AtomicU64` 序列，dropped-rx waiter，`orphan: true`）。
- [x] `settle_rpc_run`：main 判定 `index == 0` → `turn_id == main_turn_id`（收养后 index 0 是合成 waiter；非 orphan run 等价无回归）。

## 2. pump：agent_start 建 orphan run

- [x] `spawn_rpc_projection` 事件循环：取 run 之前，`event_type == "agent_start" && guard.is_none()` 时建 orphan run 承接事件流；其余事件 run=None 维持丢弃。

## 3. send：判据放宽 + attach 收养 + busy 重试

- [x] 纯函数：`plan_rpc_send_mode(run_active: bool, streaming: bool) -> RpcSendMode`、`is_rpc_busy_error(&str) -> bool`（匹配 `already processing`）。
- [x] 发送前置检查（`try_send_message_rpc` 首个分支）判据 `run.is_some()` → `run.is_some() || client.is_streaming()`：streaming 时跳过 `align_rpc_session` / `reconcile_rpc_model`（防 mid-turn 切会话 / set_model）。
- [x] steer/prompt 判据同样放宽（op_lock 内重算，`plan_rpc_send_mode`）。
- [x] 抽 `attach_turn_to_rpc_run(resident, turn_id, tx)`：run 缺失补 orphan run；orphan → 收养（`adopt_orphan_run` 改 main_turn_id、`TurnStarted` 后回放已缓冲文本为一条 `TextDelta`）；非 orphan → 既有 attached 语义；统一发 `TurnStarted`。
- [x] prompt 失败 `is_rpc_busy_error` → log warn + `client.steer` 重投一次 + 走 `attach_turn_to_rpc_run`；其余 prompt 错误维持原样。

## 4. 守卫同步

- [x] `align_rpc_session` 拒绝切会话条件加 `|| client.is_streaming()`。
- [x] `rpc_has_active_run_for` 加 `|| resident.client.is_streaming()`。

## 5. 单测（`cargo test --lib engine::pi`）

- [x] `plan_rpc_send_mode`：run/streaming 四象限（仅两者皆 false → Prompt，其余 Steer）。
- [x] `is_rpc_busy_error`：pi 原文案命中；auth/模型错误不命中。
- [x] orphan run：合成 id 唯一且非空；`adopt_orphan_run` 收养/回放/二次不收养。
- [x] `settle_rpc_run` 收养场景——真实 turn 为 main 取完整 `response_text`，合成 waiter 取空文本；非 orphan run 维持 main 全文 / attached 空文本语义。

## 6. OpenSpec 与验证

- [x] spec delta：`pi-rpc-session-runtime` MODIFIED「发送语义 MUST 区分 idle prompt 与 streaming steer」（复制全部既有 scenario + 新增 orphan 承接 / 收养 steer / busy 转 steer / streaming 禁止切换与对账 scenario）。
- [x] `cargo test --lib engine::pi` 全绿（68/68，62 存量 + 6 新）；`cargo check --no-default-features` 过；`cargo fmt --check` 过。
- [x] `openspec validate fix-pi-rpc-external-turn-steer-adoption` 通过。

## 7. 发版

- [ ] 随下一安装版构建替换 /Applications/ccgui.app，请用户复验「agent 等后台任务时插话」场景。
