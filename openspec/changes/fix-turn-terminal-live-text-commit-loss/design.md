# Design: fix-turn-terminal-live-text-commit-loss

## 1. 背景与根因（已核实的证据链）

### 1.1 两条事件路由

`useAppServerEvents.ts` `routeNormalizedRealtimeEvent` 的 `shouldRouteDirectly`：

```ts
Boolean(handlers.onNormalizedRealtimeEvent) &&
(event.engine === "codex" ||
  event.threadId.startsWith("shared:") ||
  event.threadId.startsWith("agent-canvas:"));
```

- **normalized 路由**（codex / shared / agent-canvas）：`appendAgentMessageDelta` → `handlers.onNormalizedRealtimeEvent`。
- **direct 路由**（其余 native 引擎）：`onAgentMessageDelta` → `liveAssistantTextChannel` + `pendingRealtimeDeltaOpsRef`。

### 1.2 contract batcher 的提交相位

`useThreadItemEvents.enqueueNormalizedRealtimeEvent`：

- `appendAgentMessageDelta`（增量式，shared adapter `item/agentMessage/delta` 已核实为增量）在 `enableRealtimeBatchingRef` 开时进 contract batcher（`normalizedRealtimeBatcherRef`）。
- first-token：`push` 返回 `reason: "first-token"` flush → **同步**提交（建壳，如「完全」）。
- 后续同 key delta：coalesce 进 pending map；cadence 定时器（32ms）`flush("cadence")` → `applyNormalizedRealtimeBatcherFlushes` → `useTransitionForDispatch: flush.reason !== "terminal"` → **`startTransition` 延迟**提交。
- `completeAgentMessage` **不进 batcher**（`shouldUseContractRealtimeBatcher` 仅命中 `appendAgentMessageDelta`），走 `applyNormalizedRealtimeEventNow(useTransitionForDispatch: false)` → 同步。

### 1.3 terminal barrier 的建立

`onTurnCompletedTracked`（`useThreadEventHandlers.ts`）：

```
flushPendingRealtimeEvents();      // = flushRealtimeDeltaOps() + flushNormalizedRealtimeOps()
                                   // ↑ 两条 legacy 队列；不 drain contract batcher
settleCompletedTurn(...) {
  drainLiveItemDeltasForThread(threadId);   // 仅 reasoning/toolOutput channel
  markRealtimeTurnTerminal(threadId, turnId);  // ← 同步 barrier
  onTurnCompleted(...) { settleLiveAssistantFullText(...) /* normalized 路由 channel 为空 → no-op */ ... }
}
```

### 1.4 丢失链

1. 末段 delta burst 与 `turn/completed` 落入同一 cadence 窗口（或主线程 jank 饿死 32ms 定时器）→ delta 仍滞留 batcher pending。
2. `turn/completed` 处理：`flushPendingRealtimeEvents` 不 drain batcher → barrier 同步建立。
3. cadence 定时器稍后触发 → `applyNormalizedRealtimeEventNow` 首行 `isRealtimeTurnTerminal` → **丢弃**（或 `dispatchNormalizedRealtimeEvent.run()` 内 `isEventTurnTerminal` 丢弃）。
4. 若 `completeAgentMessage` 在 barrier 之后到达（cross-channel 乱序）→ `onNormalizedRealtimeEventTracked` exact-guard 或 `applyNormalizedRealtimeEventNow` terminal 检查**丢弃**。
5. durable 冻结在 first-token 壳（「完全」）；`markLatestAssistantMessageFinal` 照常给 final 脚注；后端投影完整 → 重开历史恢复。

direct 路由不受影响（三重兜底：channel 同步累积 + `flushRealtimeDeltaOps` 同步 + `settleLiveAssistantFullText` / `onAgentMessageCompleted` terminal-salvage）。

## 2. 设计

### 2.1 Fix 1：terminal 结算前同步 drain contract batcher

**位置**：`useThreadItemEvents.ts` `flushPendingRealtimeEvents`。

```ts
const batcherFlush = normalizedRealtimeBatcherRef.current.flush("terminal");
if (batcherFlush && batcherFlush.events.length > 0) {
  applyNormalizedRealtimeBatcherFlushes([batcherFlush], pendingBatcherOperationRef.current);
}
```

- `flush("terminal")` 后 pending 清空；cadence 定时器再触发 `flush("cadence")` 返回 `null`，无重复提交。
- `pendingBatcherOperationRef`：在 `enqueueNormalizedRealtimeEvent` 每次 push batcher 时记录 `{event, hasCustomName}`，供 drain 复用（与既有 cadence 定时器闭包捕获 `operation` 的做法一致，保证 `hasCustomName` 语义不变）。若 ref 为 null（理论不可达），退化为 `hasCustomName: false`。
- 既有调用点全部受益，无需改调用方：
  - `onTurnCompletedTracked`（barrier 前）
  - `onTurnErrorTracked`（barrier 前）
  - `settleDurableRealtimeTurn`（Shared durable 结算，barrier 前）
  - shared `activeThreadId` 切换 effect（防切线程丢尾）
  - unmount（防退出丢尾）
- 语义：drain 是「把本就会在 ≤32ms 内提交的事件提前同步提交」，正确性不变，只改提交相位与时机。全局 batcher 一次性提交其他线程积压 delta：语义正确、batch 极小、回合末仅一次，可接受（若实测有 perf 顾虑，后续按 thread 收窄为独立任务）。

### 2.2 Fix 2：barrier 后迟到 `completeAgentMessage` 的 salvage

**不变式**：barrier 之后到达的终稿事件不得静默丢全文；仅 `completeAgentMessage` 且为**非空 assistant 正文**时允许 salvage；salvage 不得复燃 processing。

**判定谓词**（`useThreadItemEvents.ts` 内新增）：

```ts
function isSalvageableTerminalAssistantComplete(event: NormalizedThreadEvent): boolean {
  return (
    event.operation === "completeAgentMessage" &&
    event.item.kind === "message" &&
    event.item.role === "assistant" &&
    (event.item.text ?? "").trim().length > 0
  );
}
```

**改动点**：

1. `applyNormalizedRealtimeEventNow`：terminal 检查处改为——
   - 非 salvageable → 维持原丢弃路径（`droppedLateRealtimeEventCountRef++`）；
   - salvageable → 调 `dispatchNormalizedRealtimeEvent(event, { bypassTerminalGuard: true, skipProcessingMark: true })`，随后照常 `runNormalizedRealtimeEventSideEffects`。
2. `dispatchNormalizedRealtimeEvent.run`：`isEventTurnTerminal()` 检查改为——
   - `bypassTerminalGuard && isSalvageableTerminalAssistantComplete(normalizedEvent)` → 放行且 `skipProcessingMark: true`（不 `markProcessing`、不碰 `activeTurnId` / lifecycle）；
   - 其余维持丢弃。
3. `onNormalizedRealtimeEventTracked`：**两道守卫都要对 salvageable complete 放行**——
   - exact-guard（`isRealtimeTurnTerminalExact`）命中时，若 salvageable 则放行到 `onNormalizedRealtimeEvent`；
   - **quarantine 守卫（`shouldSkipLateCodexNormalizedEvent`）同样放行**（review 修正）：`quarantineCodexTurn` 对**每个正常完成的 codex turn 都无条件登记**，若只放 exact-guard，codex 引擎（native + shared-codex）的迟到终稿仍会被 quarantine 拦下，Fix 2 对 codex 失效。quarantine 的目的是防「复燃 processing / 污染活跃态」；salvage 只把终稿文本合入既有 item（reducer merge 幂等、`markProcessingIfNeeded` 内部 terminal 早退不复活 processing、turnId 全局唯一不会串 turn），与 quarantine 目标不冲突。raw item 路径（`onItemStarted/Updated/Completed` tracked）保持完整 quarantine 不变。

**谓词位置（review 修正）**：`isSalvageableTerminalAssistantComplete` 放在 `contracts/realtimeEventContract.ts` 而非 hook 模块——`useThreadEventHandlers.test.ts` 对 `./useThreadItemEvents` 的 vi.mock 工厂只导出 hook 本身，hook 模块上的命名导出在 mock 下是 `undefined`，会在 exact-guard 调用时炸 TypeError（潜在、当时未炸仅因无测试打到该路径）。contracts 层无测试 mock，两个 hook 共用。

**为什么安全**：
- 作用域：`completeAgentMessage` 携带 turnId + itemId；旧 turn 的迟到 complete 只作用于旧 item id，reducer `mergeCompletedAgentText` 取更长者，不会覆盖新 turn 正文。
- 去重：上游 `markThreadAgentCompletionSeen`（`useAppServerEvents.ts`）按 `(threadId, itemId, text)` 去重，同终稿不会重复 salvage。
- 复燃防护：salvage 分支显式 `skipProcessingMark`，不触碰 lifecycle / `activeTurnId` / processing 态。
- 副作用：`run()` 的 `setThreadTimestamp` / `setLastAgentMessage` / `markUnread` 副作用照常——终稿回填 sidebar 预览是期望行为。

### 2.3 不改动的部分（明确边界）

- reducer 文本合并（`mergeAgentMessageText` / `mergeCompletedAgentText` / `conversationAssembler`）零改。
- `liveAssistantTextChannel` 及其 direct 路由调用点零改。
- provider 适配器（`sharedRealtimeAdapter` / `codexRealtimeAdapter` 等）零改。
- history loader / `setThreadItems` 零改。
- `realtimeEventBatcher.ts`：仅确认 `flush("terminal")` 已是公开接口，如无需要不改。

## 3. 测试计划

### 3.1 新增回归（优先，锁 barrier 相位）

- `realtimeEventBatcher.test.ts` 扩展：
  - 末段 burst 场景：连续 delta push → `flush("terminal")` → 断言 sync 提交且 order / coalesce 正确；
  - terminal 事件（`itemCompleted` / `completeAgentMessage`）路过 batcher 时先 flush pending 的行为保持。
- `useThreadItemEvents` 层 replay（复用 `realtimeReplayHarness` 或直接驱动 handler）：
  1. **末段 burst + barrier**：delta burst → `markRealtimeTurnTerminal` → cadence flush 触发；断言 durable 全文完整、无 `droppedLateRealtimeEventCount` 增长；
  2. **barrier 后 completeAgentMessage salvage**：`markRealtimeTurnTerminal` → 迟到 `completeAgentMessage`（全文）→ 断言文本合入、`isProcessing` 不复活、无双气泡；
  3. **非 salvageable 迟到事件仍丢弃**：barrier 后迟到 `appendAgentMessageDelta` → 断言仍被丢弃（行为不回归）。

### 3.2 既有套件保持绿

- `useThreadItemEvents.liveTextSegment.test.ts`
- `useThreadTurnEvents.test.tsx`
- `realtimeBoundaryGuard.test.ts`
- `Messages.live-behavior.test.tsx`
- `useThreadItemEvents.liveItemDelta.test.ts` / `useThreadItemEvents.liveDeltaDispatchCount.test.ts`
- `realtimeReplayHarness` 依赖的 contract 测试

### 3.3 手测矩阵（P0）

| 场景 | 断言 |
|------|------|
| codex-native 长终稿回合，结束后不关会话 | 终稿全文可见 = 历史一致 |
| shared 长终稿回合（末段短促喷完） | 同上 |
| 快速连发消息（回合背靠背） | 上一回合终稿完整、下一回合正常建壳 |
| 手动 interrupt / stop | 既有 drain 行为不回归（尾段如预期） |

## 5. 评审发现与已知残留（multi-angle review 2026-08-25）

本轮对抗 review 排查出的问题与处置：

| # | 发现 | 处置 |
|---|------|------|
| R1 | codex 正常完成即 quarantine → 只放 exact-guard 会让 Fix 2 对 codex 失效 | **已修**：`onNormalizedRealtimeEventTracked` 对 salvageable complete 同时跳过 quarantine 检查；补 3 个 wrapper 层测试（放行/拦截/空正文） |
| R2 | 谓词放 hook 模块会被 `useThreadEventHandlers.test.ts` 的 vi.mock 工厂遮蔽成 undefined | **已修**：移到 `contracts/realtimeEventContract.ts`（无测试 mock 的中立层） |
| R3 | `normalizedRealtimeFlushTimerRef` 同时被 legacy 队列定时器与 batcher cadence 定时器复用，互相清 timer 可能延迟对方 flush | **不改**（pre-existing；只延迟不丢失，且本 change 的 terminal drain 已覆盖终局场景）；记录为后续候选 |
| R4 | hook unmount 只 flush legacy 队列，不 drain batcher | **不改**（pre-existing；该 hook 生命周期≈AppShell 存活期，unmount≈应用退出）；记录 |
| R5 | drain 逐事件 dispatch，未经 `noteRealtimeCoalescedFlush` 遥测 | 接受（诊断任务 3.2 已显式 deferred） |
| R6 | drain 未查 `isInterruptedThread` | 与既有 legacy flush 语义一致（interrupt 时保留已产生的部分正文是产品期望）；直接路由的 interrupt drain 同理 |

## 6. 诊断

- 现有 `droppedLateRealtimeEventCountRef` 保留（非 salvageable 迟到事件仍计数）。
- 新增 bounded 诊断（可选，`onDebug` 同源）：
  - `thread/session:terminal-text-salvage`：`{ threadId, turnId, itemId, salvagedTextLength, source }`，**不含正文全文**；
  - 若 Fix 1 drain 提交 >0 事件：`thread/session:terminal-batcher-drained`：`{ eventCount, reason: "terminal" }`。
- 约束：诊断 payload 只含结构字段，不含用户提示词 / 完整 assistant 正文（与 `live-assistant-segment-settlement` 既有隐私约束一致）。
