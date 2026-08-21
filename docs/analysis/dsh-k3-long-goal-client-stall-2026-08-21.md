---
type: analysis
status: active
date: 2026-08-21
---

# DSH k3 超长 goal：客户端假死，host 仍活着（2026-08-21）

> 事故分析 + 最小修复说明。不是 OpenSpec contract，也不是公共事件队列的改动记录。  
> 代码事实源：`src-tauri/src/engine/dsh/events.rs`。

## 现象

下午用 DSH + k3 跑了 3 小时以上的长任务（实际同一 session 约 5 小时）。**mossx 客户端几乎卡死**，但本机 `http://127.0.0.1:3080` 的 DSH Web GUI 仍可操作、host 仍在出 `step/start`。

这不是「DSH 挂了」，是 **mossx 消费 DSH mux 的速度跟不上 token 级 delta**。

## 证据（本地 log）

Session：`~/.dsh/sessions/--Users-chenxiangning-code-AI-github-codemoss--/session-5dd86bd7-d420-4e9c-afb7-d6ba85c6ca70/`

| 项 | 值 |
|---|---|
| 开始 | 2026-08-21 15:02（先 grok-4.6，15:31 切 `kimi-coding / k3`） |
| 结束观察点 | 20:04 仍在 `step/start` |
| 时长 | ~5.0 h |
| jsonl seq | > 203,000 |
| 事件 | 21,488 行；其中 `tool-call-chunks` 8,936、`reasoning-chunks` 5,626、`assistant/chunk` 2,647 |
| 工具 | 333 次 `run_code`，367 个 step |
| token | 切 k3 第一步 `inputTokens=162,115`；后半段 `cacheReadTokens` 涨到 ~601,088；19:35 新 turn 第一步 `inputTokens=564,985` |
| DSH host | `pid 37532`，`dsh web --host 127.0.0.1 --port 3080`，从 8/20 00:15 一直活着，RSS ~620MB |

18:35 的 3 份 `node-*.ips` 是 **vitest OOM**（`FatalProcessOutOfMemory`，线程名 `node (vitest 1/2)`，coalition `com.zhukunpenglinyutong.ccgui`），**不是 DSH host crash**。对应 session 当时在 DSH `run_code` 里跑全量 vitest / cargo test。

18:54 goal 标 complete、DSH `turn/end`；mossx 侧像停住。DSH Web 不走 mossx 队列，所以看起来没事。

## 已知问题（机制，不是 DSH 特例）

Native 引擎的流式 delta 走同一条路：

1. engine → `EngineEvent::TextDelta` / `ReasoningDelta`
2. `engine_event_to_app_server_event_with_turn_context` → `item/agentMessage/delta` / `item/reasoning/textDelta`
3. `app.emit("app-server-event")`
4. 前端 `appServerEventBackpressure`（上限 4000）
5. `useAppServerEventBatchDispatch` 的 `queueRef`（**无上限**）
6. 渲染调度器按帧预算消化

关键约束：

- 心跳 / token 用量 / 整段 snapshot 可以 coalesce 或丢。
- **delta 碎片是 `protected`，队列满了也不丢。**
- 满了只找「可丢 snapshot」；找不到就 `break`，后面的 protected 事件继续 `push`。
- 这条策略 **所有 Native engine 共用**，没有 `if engine == dsh`。

短任务（1–2 小时、块比较大）通常过得去。DSH + k3 把问题放大，是因为：

- 思考和工具参数是 **token 级** 碎片；
- goal 多轮同一 session，cache 滚到 50 万+；
- 后半段还在客户端最钝的时候跑全量测试。

DSH jsonl 里的 `text-chunks` / `reasoning-chunks` **本来就不会进 mossx**。mossx 只吃 `assistant/chunk` 投影出来的 `text-delta` / `reasoning-delta`。所以「日志行数」和「客户端事件数」不是一回事。

Goal 多轮时吞掉中间 `turn/end` 的逻辑是为了防止客户端过早结束，**不是这场假死的主因**，本次也没有改它。

## 本次解决方案（最小、仅 DSH）

只改 `src-tauri/src/engine/dsh/events.rs` 的 mux 出口。不改公共队列、不改其它引擎、不改 goal settlement。

对连续的 `TextDelta` / `ReasoningDelta`：

- 同一 `session + item + kind` 先拼进一个 pending 槽；
- **50ms** 或 **4KB** 到期发出；
- 遇到工具 / 审批 / turn 边界 / 非 delta 事件立刻冲刷；
- session unbind、mux stop、WebSocket close / 读错误 / 重连等待也会冲刷尾巴。

窗口按 **第一片 delta 的时间** 算，不滑动。这样长思考会按 ~20 次/秒 封顶，而不是每个 token 打一次。短任务几乎无感（首字最多晚 50ms）。

验证：`cargo test --lib engine::dsh::events`（31 passed）。

客户端要吃到这补丁，必须 **重新编译并重启 mossx**。只刷新 `127.0.0.1:3080` 不够。

## 还差什么（以后再做）

按优先级，都不在本次范围：

1. **Pending 从单槽改成 per-session map**  
   现在整个 mux hub 只有一个 pending。两个 DSH session 同时流时，后一个会把前一个冲出去。日常单会话够用。

2. **不要把公共队列改成「delta 可丢」**  
   那是所有引擎的正确性底线。要降压继续在 **engine 出口合并**，或给 DSH 单独一条 live-delta 通道。

3. **k3 / 1M 窗口的 session 卫生**  
   cache 到 40–50 万后应新开 session。这次 19:35 新 turn 第一步就喂了 56 万 input，模型和客户端都会钝。这不是 coalesce 能单独修好的。

4. **Goal 里不要用 DSH `run_code` 跑全量 vitest / cargo**  
   墙钟 600s + vitest OOM 会在客户端最钝时再加内存压力。应走独立 CI / 本机终端，或给 DSH 工具设更短的测试白名单。

5. **`tool-call-delta` 仍未合并**  
   多数投影为空，不是这场主因。若以后工具参数流也变碎，再按同样窗口合。

6. **观测**  
   mux 出口缺 `coalesced_deltas` / `emitted_deltas` 计数。下次再出现「host 活着、客户端假死」，现在只能靠拆 jsonl，不能直接看 mossx 侧合并比。

7. **Goal complete 与 UI 完成态的时序**  
   这次 18:54:22 goal complete、18:54:58 才 `turn/end`。现有 deferred `TurnCompleted` 逻辑是故意的。若以后仍出现「DSH 已收口、composer 一直转」，再单独查投影，不要和本补丁绑在一起改。
