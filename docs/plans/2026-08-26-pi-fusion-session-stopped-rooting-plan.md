# PI 融合偶发「Session stopped. → pi rpc process exited」根因与根治计划（2026-08-26）

> **状态**：调研完成 + 修复计划已定，**未实施**。后续 AI 直接从「§5 根治方案」开始，无需重做排查。
>
> **触发场景**（用户截图实证）：PI 会话 turn 进行中（思考 14 次 / 工具 48 次，子代理 2/2），点击排队消息「融合」→ 融合 turn 短暂运行后报 `会话失败: Session stopped.`；重发 → `pi rpc process exited`；再重发 → 自愈（resident 重建）。同日实测：融合插队多数情况正常，问题**偶发**。

---

## 1. 结论（TL;DR）

| # | 结论 | 依据 |
|---|------|------|
| 1 | **融合（same-run steer）链路本身无 bug**：整条路径无一处调用 interruptTurn；pi CLI（0.84.3）`steer` 实测 = 排队 + turn 边界注入，不 abort 不退出 | §3 链路走查 + §4 CLI 复现 |
| 2 | 错误三连签名**精确对应「有人向该 resident 下发了 interrupt」**：`Session stopped.` 仅在 `abort_requested` 时发出（该标志全仓只有 `PiSession::interrupt` / `interrupt_turn` 两处写入）；后续 `exited` 是 abort 未结算 → `kill()` → 下次发送撞死进程；再下次 `ensure_resident` 重建自愈 | §2 代码坐标 |
| 3 | 根因 = **interrupt 旁路误伤/竞态**，三个候选：**C1**（最可疑）turn 级失败无差别降级 workspace 级 interrupt，误杀同 workspace 所有 pi resident；**C2** pendingInterrupt 在 `activeTurnId` 空窗挂起后于下一个 turn（恰好融合新 turn）补刀；**C3** Esc 快捷键误触 | §5 入口枚举 |

## 2. 错误签名的唯一来源（代码锚点）

> 行号基于 2eea1cfb8（2026-08-26），函数名锚点为主、行号为辅。

### `Session stopped.`（两处，均在 `src-tauri/src/engine/pi.rs`）

- `settle_rpc_run`（~L423）：`run.abort_requested == true` → `Some("Session stopped.")`——RPC 路径唯一来源；
- `interrupt()` 内部日志（~L2429）：abort 后 grace 未结算的 kill 前记录。
- `abort_requested` 全仓仅两处赋值：`interrupt()`（~L2493，workspace 级、遍历所有 resident）与 `interrupt_turn()`（~L2562，按 main/attached turn id 匹配单 resident）。
- print-json fallback 的 `was_interrupted` 同样只由上述两函数写入的 `interrupted_turns` 集合判定。
- **pi CLI 自身不产生该字符串**（已 grep `~/.hermes/.../pi-coding-agent/dist/**`，无 `Session stopped`）。

### `pi rpc process exited`

- `pi_rpc.rs` pump 检测子进程退出 → fail 所有 pending RPC；
- `pi.rs` `PiRpcPumpEvent::Exited` → `settle_rpc_run(fatal="pi rpc process exited")` + 死 resident 摘除（下次发送重建）。

### interrupt 连锁（三连成因）

`interrupt_turn`：`abort_requested = true` → `client.abort()` → CLI `agent_settled` → waiter 收 `Session stopped.`；`PI_RPC_ABORT_SETTLE_GRACE`（2s，L39）内未结算 → `client.kill()` → resident 死 → 下次发送 `exited` → 再下次重建自愈。

## 3. 融合链路走查（证明融合不发 interrupt）

**前端** `useQueuedSend.ts` `fuseQueuedMessage`（~L1794）：

- `decideEngineMessageDelivery({intent:"steer"})` → pi 能力矩阵 `input.mid-turn: "supported"` → `useSameRunContinuation` 恒真、`useSafeCutover` 恒 false（后者要求 `compat-input` 才 interruptTurn）→ **pi 融合永不 interrupt**；
- activeRunId 为 null 时融合 no-op（消息留队列，无副作用）；
- 融合 stall 看门狗超时只显示「融合回复未能接上」，文案与行为均不同。

**后端** `pi.rs` `try_send_message_rpc` steer 分支：`attach_turn_to_rpc_run`（orphan 收养/普通 attach）→ `client.steer()`；失败报 `pi rpc steer failed`，非 `Session stopped.`。

turn 结算看门狗超时文案为 `pi rpc turn timed out`，排除。

## 4. pi CLI steer 实测（2026-08-26，pi 0.84.3 本机）

spawn `pi --mode rpc` → 长 prompt（`sleep 45`）→ 8s 后发 `steer` → 观察 60s。事件序列：`steer accepted(queue_update) → 工具执行 → turn 边界注入 steered msg → 新 turn → 正常 agent_settled`；**进程全程存活，无 abort**。复现脚本在 `/tmp/pi-steer-repro/`（临时，重查需重写）。

CLI 源码坐标：`rpc-mode.js` `case "steer"` → `agent-session.js` `steer() → _queueSteer` → `pi-agent-core/agent.js` `steer()` → `steeringQueue.enqueue()`（纯入队）；消费点 `agent-loop.js` `getSteeringMessages`（turn 边界 drain）。

## 5. interrupt 全部入口与候选根因

### 后端 command（`src-tauri/src/engine/commands.rs`）

| command | pi 分支 | 范围 |
| --- | --- | --- |
| `engine_interrupt` | `interrupt_pi_sessions(workspace, None)` → `interrupt()` | **workspace 级：所有 pi session 所有 resident** |
| `engine_interrupt_turn` | `interrupt_pi_sessions(workspace, Some(turn_id))` → `interrupt_turn()` | 按 turn 匹配单 resident |

### 前端触发点

| 触发点 | 位置 | 候选 |
| --- | --- | --- |
| 停止按钮 / pending 补刀 / rename 迁移补刀的 **turn 级失败 catch** | `useThreadMessaging.ts` `interruptTurn` catch 臂（~L4137-4121 区块）：`isUnknownEngineInterruptTurnMethodError` 且 engine≠qoder → `engineInterruptService(workspace)`；`useThreadTurnEvents.ts` 补刀臂同构 | **C1** |
| pendingInterrupt 补刀 | `useThreadTurnEvents.ts` `onTurnStarted`（~L548）：`activeTurnId` 空窗按过停止 → 挂起 `pendingInterruptsRef` → **下一个 turn 起步即补发**（若恰好是融合新 turn 则杀错对象） | **C2** |
| Esc 快捷键 | `src/features/app/hooks/useInterruptShortcut.ts` + `useAppShellSearchAndComposerSection.ts`：`canInterrupt` 时全局触发 interruptTurn | **C3** |
| plan 应用 handoff | `usePlanApplyHandlers.ts` / `useThreads.ts` | 计划模式专属，本次可排除 |

已排除的后端 abort：turn 看门狗超时（文案不符）、`drop_resident_by_key`（session 删除，**不设** `abort_requested`）。

**关键先例**：Qoder 已因同类误伤禁用 workspace 级降级（`useThreadMessaging.ts` catch 臂注释「Qoder Global/CN 不能降级到 workspace-wide interrupt」），pi 是漏网的同款场景——多 resident 并行（`71c8eca49` 按会话拆 resident）之后 interrupt 降级没跟上按 session 隔离。

## 6. 根治方案（待实施，PlanFirst 载体即本文档）

> 涉及行为变更，实施时开 OpenSpec change（建议 id：`fix-pi-interrupt-fallback-friendly-fire`），本文档作 design 调研附件。

### P0 — 收窄 C1：turn 级 interrupt 失败禁止 pi 降级 workspace 级（核心）

1. `useThreadMessaging.ts` `interruptTurn` catch 臂与 `useThreadTurnEvents.ts` 两处补刀臂：fallback 按 engine 分轨——`pi`（及未来多 resident 引擎）禁止 workspace 级降级，失败仅记 diagnostics（`turn/interrupt fallback blocked, engine=pi`）；
2. （更优解，可并行）后端 `engine_interrupt` 加可选 `sessionId` 参数，降级改为 **session 级**（`PiSession::interrupt_session`，按 resident key `session:{id}` 精确匹配），从根上消除误伤面；
3. `isUnknownEngineInterruptTurnMethodError` 判定保留，但命中后对 pi 也不走 workspace 级。

**验收**：单测 mock `engineInterruptTurn` reject → pi 不再调 `engineInterrupt`，非 pi 不变；手测同 workspace 双 pi 会话并行 turn，停 A → B 不受影响。

### P1 — C2：pendingInterrupt 补刀加时效与来源校验

1. `pendingInterruptsRef` 条目携带 `armedAtMs` + `reason`；补刀前校验：超阈值（建议 10s）丢弃并记 diagnostics；新 turn 为 queue-fusion successor 时不补发；
2. 补刀成功/丢弃均落 `turn/pending-interrupt executed|dropped` diagnostics。

**验收**：单测「过期不补发」「fusion successor 不被补刀」；手测 turn 边界按停止→立即融合，不再出 `Session stopped.`。

### P2 — C3：Esc 触发面先观测后收窄（可选）

`interruptTurn` reason 增加 `"shortcut"` 细分随 diagnostics 上报；收集数据后再决定是否收窄（如 Esc 仅 composer 无焦点/无面板时生效）。

### 取证清单（复现瞬间确认三点，区分 C1/C2/C3）

1. 同 workspace **其他 pi 会话**是否刚被停止过（→ C1）；
2. 是否按过 **Esc / 停止**——含上一 turn 刚结束的边界瞬间（→ C2/C3）；
3. 是否有并行后台任务（外部 turn 注入期间点过融合）。

取证位置：`~/.ccgui/error-log/<date>.jsonl` 搜 `Session stopped.` / `pi rpc process exited`；`~/.ccgui/client/diagnostics.json` 搜 `turn/interrupt*`；tauri dev 终端 `[pi/rpc]` 行 `abort... killing resident`。

**排除判据**：若复现时无任何停止操作、无并行会话被停、无 Esc——C1/C2/C3 全排除，勿硬套本方案，重查 remote 模式 daemon 转发或新旁路。

## 7. 验证清单（实施时执行）

1. `cargo test --lib engine::pi` 全绿；
2. `useQueuedSend.test.tsx` / `useThreadMessaging.test.tsx` / `useThreadTurnEvents.test.tsx` interrupt 相关用例全绿；
3. 手测矩阵（isolated 开发者客户端）：双 pi 会话互停不误伤；turn 中融合正常结算；turn 边界停止→立即融合不补刀；（可选）强制 turn 级 interrupt 失败验证不触发 workspace abort；
4. rustfmt 仅限本次改动文件（Format Discipline Gate）。

**收口标准**：融合场景 error log 不再出现 `Session stopped.` + `pi rpc process exited` 三连签名。

## 8. 相关历史（避免重复排查）

- `2a1ea9733`（2026-08-25）：orphan turn 承接与融合收养，错误文案不同，排除；
- `7f91b7389`：turn 结算看门狗对账（长任务不误杀），排除；
- `837b67870` / `5e15b934f` / `71c8eca49`：RPC 闩冷却 / fallback 忙锁 / resident 按会话拆分——多会话并行基础，C1 正是「interrupt 降级没跟上 session 隔离」的残留；
- `[TURN_STALLED] QueueFusionCutover` 为 Codex 专属旁路，pi 不经过；
- `openspec/changes/pi-background-task-experience/`（已提交 `2eea1cfb8`）：与本问题无因果，但验收建议同场覆盖「后台任务完成注入外部 turn 期间融合」。
