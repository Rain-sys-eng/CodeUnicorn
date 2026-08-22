## Context

- 现状：`useQueuedSend` 的 auto-drain effect 仅读 `activeThreadId`、`isProcessing`、`activeTerminalPulse`、`hasPendingUserInput`（均 active 作用域）。
- 存储已是 `queuedByThread`；`sendUserMessageToThread` 与 `threadStatusById[t].isProcessing` 已存在。
- Codex 为填「queue 摘掉到 history 落地」空窗引入 `queuedHandoff`，但 **先 handoff、后异步删 queue**，长窗口双显（图1）。

## Goals / Non-Goals

**Goals**

1. Per-thread ready 判定 + 全局调度循环（S1）。
2. `MAX_BACKGROUND_QUEUE_DRAIN = 1`；active 优先且不计入后台配额。
3. Drain 原子：claim → 乐观出队 → handoff（Codex）→ dispatch → success 保持出队 / fail 回队。
4. Handoff state 在等价 user item 可见时主动 clear。
5. 不串线：非 active 禁止走 active-bound `sendUserMessage`。

**Non-Goals**

- S2 UI、设置项、Toast 产品流
- Backend contract
- 可配置并发（常量 1）

## Decisions

### D1: 调度落点

**决策**：扩展 `useQueuedSend`，不新建独立 scheduler 包。  
**原因**：队列/inFlight/fusion/handoff 状态已内聚；拆包成本高于收益。

### D2: 并发模型

**决策**：`MAX_BACKGROUND_QUEUE_DRAIN = 1`。
- active thread drain 不占配额  
- 后台 in-flight 计数 = 非 active 且 `inFlightByThread[t]` 非空 的数量  
**原因**：2026-08-11 incident 表明多路并发会放大 ambiguous completion 的重发面；恢复到 3 前必须先有端到端 terminal receipt 证据。

### D3: 乐观出队（修残留）

**决策**：进入 inFlight 的同一同步段内从 `queuedByThread` 移除 item。  
Fail/blocked：`prepend` 回队（保留原 `id`），clear handoff。  
**备选**：仅 MessageQueue 过滤 inFlight → 不足，state 仍脏。

### D4: 不串线

**决策**：

1. `QueuedMessage` 在 enqueue 时写入 `ownerWorkspaceId` + 使用 enqueue 时的 `threadId`。  
2. Drain 时 `sendUserMessageToThread` 使用 **item 的 owner**，不是 `activeWorkspace`/`activeThreadId`（除非 active 且一致）。  
3. 若 owner workspace 不可解析 → 不 drain，item 留队（或仅当仍是 active 时 fallback 旧路径）。

### D5: Per-thread 门闩来源

| 信号 | 来源 |
|---|---|
| isProcessing | `threadStatusById[t].isProcessing` |
| terminalPulse | 扩展传入 `terminalPulseByThread`；active 的现有 pulse 写入 map |
| pendingUserInput | `pendingUserInputByThread`；至少 active 正确；未知 thread 默认 false |
| fusion / inFlight | 已有 per-thread state |
| shared idle | 仅 shared session thread；用该 thread 的 shared send state |

### D6: UI

**决策**：无 S2 UI。残留修复只改错误双显。不新增角标/Toast。

### D7: 应急闸

```ts
const ENABLE_BACKGROUND_QUEUE_DRAIN = true;
const MAX_BACKGROUND_QUEUE_DRAIN = 1;
```

常量级，非 Settings。

### D8: Shared `pending-ack` 的显式 abandon

**决策**：`pending-ack` 不再将队列条上的删除操作静默吞掉。用户点击后展示现有 `ConfirmDialog`，明确说明 Runtime 可能已接收、无法撤回、不会自动重发。确认后只调用既有 Shared V2 `abandon unresolved attempt` terminal contract；仅当该 contract 成功，才结算 cancelled、移除 queue item 与清除 in-flight。

**禁止**：本地强制清 `inFlight`、固定 timeout 自动丢弃、把消息重新入队/重发。

**失败语义**：terminal abandon 失败或无可验证 attempt owner 时，保留原 queue item/in-flight 和当前 recovery UI，并暴露已有错误反馈；不能以「删除已点击」当作成功。

### D9: Owner-scoped queue persistence

**决策**：任何 thread queue 的写回由该 queue item 的 `ownerWorkspaceId` + `ownerThreadId` 定位，而非当前 active session。`normalizeQueuedMessage` 必须 round-trip owner 字段；缺失或不一致的 owner 进入安全 hold，不允许 active fallback。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 多会话 high demand | maxBg=1；失败回队不丢 |
| 误发错 thread | owner 字段 + 单测 |
| 乐观出队丢消息 | fail prepend 同 id + 测试 |
| ambiguous Shared handoff 被误删或重发 | ConfirmDialog + Shared V2 terminal abandon 成功后才结算 |
| 后台更新覆盖当前持久化 owner | owner-scoped write + rehydrate round-trip 测试 |
| jank | 不增 delta 频率；复用 batching |
| reviewing 全局 | 若仅 active reviewing，后台仍可 drain；与今日「非焦点本就不跑」比可接受 |

## Migration

无 schema migration。既有持久化记录在 rehydrate 时补保留可用 owner；owner 缺失的记录保留但安全 hold。内存队列语义：从「切走暂停」变为「后台继续」。

## Open Questions

无。

## Post-incident safe S1 (2026-08-11)

见 `INCIDENT.md`。默认后台 **开**、cap=**1**；防重发三闸永开；drain 触发用 `queueDrainSignal` 而非整表 `threadStatusById`。
