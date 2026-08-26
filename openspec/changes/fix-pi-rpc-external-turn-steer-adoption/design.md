# Design: fix-pi-rpc-external-turn-steer-adoption

## 决策

**1. orphan run 的形态：合成 turn id + dropped-rx waiter + `orphan` 标记。**

pi 自唤醒 turn（bg 任务完成通知注入）不经过 ccgui 发送路径，没有真实 turn_id 与 waiter。为它建 `PiRpcRun` 时：

- main turn id 合成：`pi-external-{millis}-{seq}`（静态 `AtomicU64` 序列 + 毫秒时间戳，单调唯一，可日志辨认）；
- waiter 的 rx 直接 drop——`settle_rpc_run` 向它 send 失败静默跳过；
- `orphan: bool` 标记供收养判定，不靠 id 前缀猜。

daemon forwarder 按 `turn_id == 本 send 的 turn_id` 过滤转发（`daemon_state.rs`），合成 id 的事件天然全部被丢弃——**外部 turn 不会污染任何真实会话的 UI**，这是不碰 daemon/前端就能安全落地的前提。

**2. 收养（adoption）：首个真实 turn steer attach 时接管主流。**

`settle_rpc_run` 现行语义是「main turn 拥有内容流，attached steer turn 结算空文本」，配合前端 `wasProcessing && steerEnabled` 乐观气泡成立。但外部 turn 场景前端以为自己在发**新** turn（wasProcessing=false），若按普通 attach 结算空文本，用户会看到空气泡。所以 orphan run 被首个真实 turn attach 时收养：

- `run.orphan = false; run.main_turn_id = 真实 turn_id`（不重复入 `attached_turn_ids`）；
- 已缓冲的 `response_text` 作为一条 `TextDelta` 即时回放给新 main turn（`TurnStarted` 之后），其后流式增量自然衔接；
- settle 时 main waiter 取得完整 `response_text`（含收养前部分），daemon 侧 accumulated 非空走既有路径，无需任何改动；
- 第二个及以后 attach 的 turn 维持既有 attached 语义（空文本），与「同会话二次发送仍走 steer」一致。

`settle_rpc_run` 的 main 判定从 `index == 0` 改为 `turn_id == main_turn_id`——收养后 index 0 是合成 waiter，下标语义已失效；非 orphan run 的 waiters[0] id 本就等于 main_turn_id，等价无回归。

**3. 发送判据放宽到 `is_streaming`：为什么 `run.is_some()` 不够。**

`is_streaming` 由 pi_rpc reader 任务在解析 stdout 行时直接维护（`agent_start` 置 true / `agent_settled` 与 EOF 置 false），**不走 broadcast channel，不受 pump lag 影响**，是「pi 是否在处理」的权威近端信号。发送判据、发送前置检查（align/reconcile 跳过）、`align_rpc_session` 拒绝条件、`rpc_has_active_run_for` 统一放宽为 `run.is_some() || client.is_streaming()`，四处共用一个语义：streaming 即活跃。

判据抽纯函数 `plan_rpc_send_mode(run_active, streaming)` 便于单测。

**4. busy 兜底重试用 `steer` 而非 `streamingBehavior: "followUp"`。**

pi 的 `prompt` 支持 `streamingBehavior: "followUp"` 排队为下一 turn，但排队 turn 的 `agent_start` 到来时本地没有与之对应的 run/waiter 注册机制，本次发送的 rx 无法结算（要等 10min 看门狗）。`steer` 融合进当前 turn，waiter attach 到（orphan 或既有）run 随其结算，与既有 same-run 语义完全一致，且被 pi 拒绝的 `prompt` 在 preflight 阶段失败、消息未入队，重投无重复。

匹配串取 pi 错误文案的稳定子串 `already processing`（纯函数 `is_rpc_busy_error`）；非 busy 错误（auth、模型缺失等）维持原样报错，绝不重试。

**5. 残余反向竞态（判 steer 时 pi 恰好转空闲）不新增处理。**

该窗口在既有 `run.is_some()` 判据下同样存在（agent_settled 与判定之间的 lag），本次放宽不实质扩大。pi 空闲时 `steer` 仅入队不报错，本地 run 由看门狗既有分支「!streaming + run 有产出 → 按完成结算」兜底，用户 turn 正常完成而非挂死。pi 侧滞留的队列消息语义与交互模式一致，属可接受残留。

## 备选方案（否决）

- **daemon/前端改动：纯外部 turn 实时直播上屏**。否决。需要 daemon forwarder 订阅合成 turn id 并映射到会话活跃 thread，跨层 contract 变更 + 前端气泡归属设计，scope 爆炸；外部 turn 结果历史刷新后可见，无信息丢失，等真实需求再做。
- **`streamingBehavior: "followUp"` 重试**。否决。见决策 4——排队 turn 无 waiter 对应机制，本 send 无法结算。
- **busy 错误后排队等待 `agent_settled` 再重发 prompt**。否决。引入挂起状态机（取消/超时/中断都要管），而 steer 语义对用户「插话」场景本来就是正确产品行为。
- **orphan run 不收养、attached 统一空文本**。否决。前端在非 wasProcessing 路径会渲染空气泡，等于把「会话失败」换成「回复消失」。

## 风险

- **收养回放重复**：回放的缓冲文本与 daemon 的 TurnCompleted fallback 同源（都是 `response_text`），accumulated 非空时 fallback 被忽略，无双份。
- **收养前工具事件不回放**：仅回放文本；工具调用细节历史刷新后完整可见。可接受。
- **`is_streaming` stale-true**：仅在 reader 停止维护时发生（进程退出路径 EOF 已置 false），无新增风险。
