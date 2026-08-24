# Tasks: fix-canvas-user-bubble-stack-and-merge-order

## 1. 基线与索引

- [x] 1.1 [P1] 跑 P1 基线测试并记下既有失败。Input: plan §6.3 P1 命令（`threadItems.test.ts`、`threadReducerOptimisticItemMerge.user-images.test.ts`、`dispatchThreadItemsProgressively.test.ts`）以及 `threadReducerCoreHelpers.liveSettlement.test.ts` 哨兵。Output: 失败集记录。Validation: 命令跑完，失败列表写入会话 / Progress Log。
- [x] 1.2 [P1] 在 `openspec/changes/README.md` 登记本 change，回写 plan T6。Input: 本目录 artifacts。Output: active 表新增一行；plan §5 T6 勾选。Validation: 链接可点；不覆盖 prune / complete-native 行。

## 2. B1 空 assistant 保留

- [x] 2.1 [P1][depends:1.1] 先写失败用例：`user → 空 assistant → user` 经 `prepareThreadItems` 后不得变成相邻 user。Input: `src/utils/threadItems.ts` L784–792、`src/utils/threadItems.test.ts`。Output: 红灯测试覆盖 live/后接 user/live-text 引用三条保留；以及 settle 真空间壳仍丢、两条真实 user 无 assistant 仍保留。Validation: 新测失败原因是无条件 `continue`。
- [x] 2.2 [P1][depends:2.1] 按 design D1 改保留策略。Input: `prepareThreadItems` options（复用/扩展 `preserveMessageTextIds`，可选 `liveTurnId`）。Output: 有结构意义的空壳留下；真空间壳仍丢。Validation: 2.1 用例转绿；既有 prepare 测试不扩大失败集。

## 3. B3 leftover 相对插入

- [x] 3.1 [P1][depends:1.1] 抽 `insertUnmatchedIncomingByNeighbor` 并先写测试。Input: design D2；`threadReducerOptimisticItemMerge.ts` L249–274。Output: 纯函数 + 用例：迟到 80 尾窗不得 append 到 optimistic 后；leftover 插在两个 matched id 之间；无邻居才 append。Validation: 纯函数单测红灯指向当前 `push` 末尾。
- [x] 3.2 [P1][depends:3.1] 替换 leftover `forEach push`。Input: `mergeThreadItemsPreservingOptimisticUsers`。Output: 先走 local 已匹配 + local-only，再相对插入 leftover。Validation: 3.1 转绿；`threadReducerOptimisticItemMerge.user-images.test.ts` 不回退；`liveSettlement` 哨兵不更糟。

## 4. B2 optimistic 包装对齐

- [x] 4.1 [P1][depends:1.1] 补 wrapper 漂移失败用例。Input: `normalizeComparableUserText`、`threadReducerOptimisticItemMerge`。Output: 至少一条「optimistic 纯意图 + incoming 带未剥干净包装」的红灯；以及「不等价则 optimistic 留原位、不复制」。Validation: 若现有 stripper 已能过，保留回归用例，不改 normalize。
- [x] 4.2 [P1][depends:4.1] 仅在 4.1 红灯成立时扩 `normalizeComparableUserText`。Input: `conversationNormalization.ts` 现有 stripper。Output: 最小剥离增量；禁止模糊匹配。Validation: 4.1 转绿；「部分相似不得折叠」场景仍绿。

## 5. B4 首屏 turn 回退

- [x] 5.1 [P1][depends:1.1] 确认 `resolveHistoryWindowCutIndex` 可被 threads first-paint import；若会循环依赖则下沉到无 UI utils。Input: `messagesHistoryWindow.ts` L118–154、`dispatchThreadItemsProgressively.ts`。Output: 单一函数，DOM 800 语义不变。Validation: 现有 `messagesHistoryWindow` 测试仍绿。
- [x] 5.2 [P1][depends:5.1] first-paint 用共享 cut，禁止裸 `slice(-300)`。Input: `dispatchThreadItemsProgressively.ts` L74–78。Output: `tail-first` 且超预算时 `slice(cut)`；`atomic` / 短列表不切。Validation: 新增 progressively 测试：切口落在同 turn 中间则回退段首。

## 6. 回归与回写

- [x] 6.1 [P1][depends:2.2,3.2,4.2,5.2] 重跑 1.1 同一组测试 + 本 change 新增测试。Input: 同基线命令。Output: 失败集不扩大。Validation: vitest 退出码 0 或仅记录既有红。
- [x] 6.2 [P1][depends:6.1] 回写 plan T7–T10 / Progress Log。Input: 本 change 证据。Output: `docs/plans/2026-08-18-conversation-curtain-history-missing-and-order.md` 勾选对应 Todo。Validation: 文档与 tasks checkbox 一致。
- [ ] 6.3 [P2] 手测：连堆（空壳/live 外置）+ 发送后 hydrate 单气泡 + 迟到 80 尾窗不跑到最底。Input: plan §6.2。Output: 用户可见验收。Validation: 未手测前保持未勾选；不得用本任务代替 6.1。

## 7. B3 follow-up：Grok leftover Exploring 串线

- [x] 7.1 [P1] 失败用例：fully unmatched incoming 只有 explore / in-progress `commandExecution` 时，不得插到 optimistic 前面。Input: `insertUnmatchedIncomingByNeighbor.test.ts`、`threadReducerOptimisticItemMerge.merge-order.test.ts`。Output: 红灯指向当前 index-0 插入。Validation: B3「fully unmatched older user/assistant window」用例仍绿。
- [x] 7.2 [P1][depends:7.1] leftover 在 `firstMatchedIncomingIndex < 0` 时跳过 explore / in-progress command。Input: `insertUnmatchedIncomingByNeighbor.ts`。Output: 串线 explore 不进新 tab；有 matched neighbor 时 explore 仍相对插入。Validation: 7.1 转绿；既有 B3 四条相对插入用例不回退。
- [x] 7.3 [P1] Grok presentation 隐藏 latest user 之前的 orphan `exploring`，保留其后的当前轮 Exploring。Input: `messagesLiveWindow.ts`、`MessagesCore.tsx`、`Messages.explore.test.tsx`。Output: `suppressOrphanExploringItemsBeforeLatestUserTurn`；Grok 不要求 `isThinking`。Validation: live-window 单测 + Messages explore 组件测转绿；Codex/Claude hide-all exploring 不回退。
- [x] 7.4 [P1] `pickLikelyGrokSessionId` 跳过已被其他 mossx thread 占用的 session；另一 `grok-pending-*` 已有 items 时跳过 list fallback。Input: `threadMessagingHelpers.ts`、`useThreadMessaging.ts`。Output: occupied set + `hasOtherPendingWithItems`。Validation: helper 单测覆盖 occupied / unoccupied / 旧 `grok:` 不误杀。

## 8. B3 follow-up：带图提问 hydrate 不得把 optimistic 接到助手尾巴

- [x] 8.1 [P1] 失败用例：caption + 图的 optimistic 与空 text / 不同 image URL 的 history user 不得出现在 assistant 之后；上一轮 image-only 不得吞掉后一条纯文本 optimistic。Input: `threadReducerOptimisticItemMerge.user-images.test.ts`、`threadReducerOptimisticItemMerge.merge-order.test.ts`。Output: 红灯指向 replacement map 未绑定当前回合。Validation: B3 迟到尾窗 / hello vs hello world 用例仍绿。
- [x] 8.2 [P1][depends:8.1] `buildOptimisticUserReplacementMap` 增加当前回合 1:1（两侧都有图、且不是两条非空不同文案）；merge 用 replacement map 决定是否保留 optimistic；history text 为空时回写 optimistic caption。Input: `threadReducerOptimisticUserReconciliation.ts`、`threadReducerOptimisticItemMerge.ts`。Output: 单气泡在助手上方；caption 保留。Validation: 8.1 转绿；既有 leftover 相对插入用例不回退。

## 明确不做

- 不按 `timestamp` 全局 sort。
- 不实现 / 不混进 `fix-live-settle-assistant-tool-order`、`fix-assistant-duplicate-render-native-shared`、`fix-shared-history-projection-nonblocking`。
- 不重做 `fold-background-task-notification`。
- 不改 Bug A 芯片 / requester / `CLAUDE_UI_HISTORY_WINDOW`。
- 不重开时间线虚拟化。
- 未获用户要求前不 commit、不 apply 本 change 的实现。
