# Tasks: fix-turn-terminal-live-text-commit-loss

> 状态约定：实现前由 review 确认本清单与 design 一致；完成后按 gate 执行 verify / sync。

## 0. 前置 review（实现前必须完成）

- [x] 0.1 复核 `flushPendingRealtimeEvents` 的全部调用点（turn completed / turn error / durable settle / activeThreadId effect / unmount），确认 drain 不改变非 terminal 语义
- [x] 0.2 复核 `dispatchNormalizedRealtimeEvent.run()` 的 `isEventTurnTerminal` 丢弃路径——**结论优于预期**：`markProcessingIfNeeded` 内部自带 `isEventTurnTerminal()` 早退，salvage 放行后 processing 复燃天然防住，无需额外 `skipProcessingMark` 接线
- [x] 0.3 复核 `onNormalizedRealtimeEventTracked` exact-guard 放宽范围仅限 `isSalvageableTerminalAssistantComplete`；~~`shouldSkipLateCodexNormalizedEvent`（quarantine）维持原样~~ **review 修正（R1）**：codex 正常完成即 quarantine，salvageable complete 必须同时跳过 quarantine，否则 Fix 2 对 codex 失效
- [x] 0.4 复核 `markThreadAgentCompletionSeen` 去重语义：barrier 前已落盘的同文本 complete 在上游提前返回，salvage 不会重复落盘；`markContinuationEvidence` 非 processing 线程上为 no-op，salvage 路径安全

## 1. Fix 1：terminal 结算前同步 drain contract batcher

- [x] 1.1 ~~`pendingBatcherOperationRef`~~ **简化**：drain 时按 event 现算 `getCustomName(workspaceId, threadId)`（比 push 时闭包捕获更新鲜、更正确），无需新增 ref
- [x] 1.2 `flushPendingRealtimeEvents` 增加 `normalizedRealtimeBatcherRef.current.flush("terminal")` + 逐事件 `applyNormalizedRealtimeEventNow`（sync）
- [x] 1.3 cadence 定时器在 drain 后再触发为 no-op（pending 已空，`flush("cadence")` 返回 null）——单测覆盖
- [x] 1.4 单测：末段 burst + terminal drain 顺序下全文完整（`useThreadItemEvents.terminalTextCommit.test.ts`）
- [x] 1.5 `settleCompletedTurn` 顶部统一 `flushPendingRealtimeEvents()`（覆盖 `flushDeferredTurnCompletionIfReady` 这条此前不 flush 的路径）；`onTurnCompletedTracked` 冗余 flush 移除（既有测试 pin 1 次调用，保持语义不变）

## 2. Fix 2：barrier 后迟到 completeAgentMessage 的 salvage

- [x] 2.1 新增 `isSalvageableTerminalAssistantComplete` 谓词——**review 修正（R2）**：放 `contracts/realtimeEventContract.ts`（hook 模块会被测试 vi.mock 工厂遮蔽），两个 hook 共用
- [x] 2.2 `applyNormalizedRealtimeEventNow`：terminal 检查分支支持 salvage（`allowTerminalCompleteSalvage` 透传）
- [x] 2.3 `dispatchNormalizedRealtimeEvent.run()`：terminal 丢弃前放行 salvageable complete
- [x] 2.4 `onNormalizedRealtimeEventTracked`：exact-guard 对 salvageable complete 放行
- [x] 2.4b **review 修正（R1）**：quarantine 守卫（`shouldSkipLateCodexNormalizedEvent`）对 salvageable complete 同样放行；raw item 路径 quarantine 不变
- [x] 2.5 单测：barrier 后 `completeAgentMessage` salvage（文本合入 / `markProcessing(true)` 不被调用 / 空正文不 salvage）
- [x] 2.5b wrapper 层单测 ×3：quarantined codex turn 后迟到 complete 放行 salvage / 迟到 delta 仍被 quarantine 拦下 / 空正文 complete 不放行
- [x] 2.6 单测：barrier 后 `appendAgentMessageDelta` 仍被丢弃（行为不回归）

## 3. 诊断（可选，bounded）

- [ ] 3.1 `thread/session:terminal-text-salvage`（结构字段，不含正文）——**本期不做**：salvage 落点与既有 `agent-completed` / `agent-completed-terminal-salvage` 日志同源可观测
- [ ] 3.2 `thread/session:terminal-batcher-drained`（eventCount）——**本期不做**：drain 为空时零成本，有量时由既有 dispatch 链路观测

## 4. 测试与门禁

- [x] 4.1 既有套件：`realtimeEventBatcher` / `liveTextSegment`（8）/ `useThreadTurnEvents.test.tsx`（81）/ `realtimeBoundaryGuard` / `liveItemDelta`（6）/ `liveDeltaDispatchCount` / `useThreadEventHandlers.test.ts`（65+3 新增）全绿；`src/features/threads` 全量 93 红与基线完全一致（零新增）；`src/features/app` + `Messages.live-behavior` 13 红与基线完全一致（零新增）
- [x] 4.2 tsc 0 error
- [x] 4.3 `npm run check:app-shell:governance` 22 绿（本 change 不涉及 app-shell 边界，确认通过）
- [x] 4.4 `openspec validate fix-turn-terminal-live-text-commit-loss --strict --no-interactive` 通过
- [ ] 4.5 手测矩阵（codex-native / shared 长终稿回合、快速连发、interrupt）按 design §3.3——**待用户真机验收**

## 5. 收口

- [ ] 5.1 同步 main specs（`realtime-event-batching-performance` / `conversation-realtime-history-parity` / `turn-terminal-text-commit-integrity`）——verify 后执行
- [x] 5.2 更新 `openspec/changes/README.md` active 表
- [x] 5.3 确认未命中基石文档「更新触发器」（本 change 不改 engine registry / Shared 支持集合 / provider binding / canonical fact schema / context compiler / terminal-ACK contract / recovery exit——不触发 ADR 校准回写）
