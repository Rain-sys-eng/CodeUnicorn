# 回合结束缺渲染：turn terminal 与 batcher 延迟提交赛跑（2026-08-25）

> 关联 OpenSpec change：`openspec/changes/fix-turn-terminal-live-text-commit-loss/`
> 状态：根因已核实，change 进行中。

## 现象

实时对话小概率：回合结束后终稿气泡**只剩建壳首 delta**（现场截图只剩「完全」），
脚注已是 final 态且带 `耗时`；**关闭会话重开历史全文完整回显**。Native 与 Shared 均出现。

推断（与事实一致）：会话正确结束、后端投影完整，丢的只是 renderer durable 终稿提交。

## 两条事件路由

`src/features/app/hooks/useAppServerEvents.ts` `routeNormalizedRealtimeEvent`：

```ts
const shouldRouteDirectly =
  Boolean(handlers.onNormalizedRealtimeEvent) &&
  (event.engine === "codex" ||
    event.threadId.startsWith("shared:") ||
    event.threadId.startsWith("agent-canvas:"));
```

- **normalized 路由**（codex / `shared:` / `agent-canvas:`）：
  - assistant 增量 delta → `handlers.onNormalizedRealtimeEvent` → `useThreadItemEvents.onNormalizedRealtimeEvent`。
  - `appendAgentMessageDelta` 进 contract batcher（`contracts/realtimeEventBatcher.ts`）：
    - first-token：`push` 返回 `reason:"first-token"` → **同步**提交（建壳）；
    - 后续同 key coalesce，cadence 定时器 32ms `flush("cadence")` → `applyNormalizedRealtimeBatcherFlushes` → `useTransitionForDispatch: flush.reason !== "terminal"` → **`startTransition` 延迟**提交；
    - `completeAgentMessage` **不进 batcher**（`shouldUseContractRealtimeBatcher` 仅命中 `appendAgentMessageDelta`），同步提交。
- **direct 路由**（claude/gemini/grok/kimi/pi/dsh/qoder/opencode native）：
  - delta → `onAgentMessageDelta` → `liveAssistantTextChannel`（同步累积）+ `pendingRealtimeDeltaOpsRef`（32ms 批量，flush **同步**）。

## Terminal barrier 建立时序（`useThreadEventHandlers.ts`）

```ts
onTurnCompletedTracked:
  flushPendingRealtimeEvents();        // = flushRealtimeDeltaOps() + flushNormalizedRealtimeOps()
                                       // ↑ 不 drain contract batcher 的 pending deltas
  settleCompletedTurn:
    drainLiveItemDeltasForThread(threadId);   // 仅 reasoning/toolOutput liveItemDeltaChannel
    markRealtimeTurnTerminal(threadId, turnId);  // ← 同步 barrier
    onTurnCompleted → settleLiveAssistantFullText:  // normalized 路由 live 通道为空 → no-op
```

## 丢失链（逐环核实）

1. 末段全文与 `turn/completed` 落入同一 cadence 窗口（native IPC 批量送达 / 主线程 jank 饿死 32ms 定时器）→ delta 滞留 batcher pending。
2. `flushPendingRealtimeEvents` 不 drain batcher → barrier 同步建立。
3. cadence 定时器在 barrier 后触发：`applyNormalizedRealtimeEventNow` 首行 `isRealtimeTurnTerminal` →
   **丢弃**（`droppedLateRealtimeEventCountRef++`）；`dispatchNormalizedRealtimeEvent.run()` 内
   `isEventTurnTerminal` 同理。
4. barrier 之后到达的 `completeAgentMessage`：`onNormalizedRealtimeEventTracked` exact-guard /
   `applyNormalizedRealtimeEventNow` terminal 检查 → **丢弃**。
5. durable 冻结在 first-token 壳（「完全」）；`markLatestAssistantMessageFinal` 照常补 final 脚注。

## 为什么 direct 路由免疫

- delta 同步进 `liveAssistantTextChannel`；
- turn 结算前 `flushRealtimeDeltaOps` **同步**提交 legacy 队列；
- `settleLiveAssistantFullText`（`useThreadTurnEvents.ts`）从通道取全文写 durable；
- `onAgentMessageCompleted` 另有 terminal-salvage 分支（`useThreadItemEvents.ts`）。

normalized 路由三条兜底全部缺失：通道为空、legacy flush 不覆盖 batcher、complete 无 salvage。

## 为什么小概率

仅当末段 delta 与 terminal 事件在同一 32ms 窗口（或定时器被主线程 jank 延迟）才输。
正常时 cadence 早已提交、队列为空。

## 修复方向（见 change design）

- **Fix 1**：`flushPendingRealtimeEvents` 同步 drain contract batcher（`flush("terminal")`），
  barrier 前落 durable。
- **Fix 2**：barrier 后迟到 `completeAgentMessage`（非空 assistant 正文）走 salvage，
  不复燃 processing；与 direct 路由 terminal-salvage 语义对齐。

## 关键文件

- `src/features/app/hooks/useAppServerEvents.ts`（`shouldRouteDirectly` / 去重）
- `src/features/threads/hooks/useThreadItemEvents.ts`（batcher 接线 / terminal 守卫 / salvage 落点）
- `src/features/threads/hooks/useThreadEventHandlers.ts`（`onTurnCompletedTracked` / `settleCompletedTurn`）
- `src/features/threads/contracts/realtimeEventBatcher.ts`（coalesce / terminal flush）
- `src/features/threads/hooks/useThreadTurnEvents.ts`（`settleLiveAssistantFullText`）
