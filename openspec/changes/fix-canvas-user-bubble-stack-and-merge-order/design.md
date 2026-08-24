# Design: fix-canvas-user-bubble-stack-and-merge-order

## Context

P0 Bug A（Claude 磁盘尾窗 80 接到幕布芯片）已独立落地。本 change 只修 P1 Bug B：连堆 + 错序。plan §3 拆成四条独立根因，禁止合成一个「排序函数」。

当前代码事实：

1. **B1** `src/utils/threadItems.ts` `prepareThreadItems` L784–792：`role === "assistant"` 且 `text.trim()` 为空、无 images、无 `executionTargetSnapshot` → 直接 `continue` 丢掉。live-text 外置后，流式正文在 `liveAssistantTextChannel`，reducer 里常是空壳；中途 `setThreadItems` / hydrate / settle 再跑 prepare，空壳消失，视觉变成 `user → user`。
2. **B2** `threadReducerOptimisticItemMerge.ts` 用 `isEquivalentUserObservation` / `isTextEquivalentUserTurn`（后者走 `normalizeComparableUserText`）。归一化已剥 project-memory、mode-fallback、agent-prompt、shared-session sync、note-card suffix、slash-skill。仍会漂移的变体（嵌套顺序、未覆盖的包装）会留下 optimistic + 权威两条蓝气泡。0.9 已补 Shared 投影丢图时把 optimistic 附图补回。
3. **B3** 同文件 L249–274：仅当存在未匹配 optimistic / compaction 需要保留时，先按 **local 顺序** 走已匹配 id，再把 incoming 里还没 emit 的全部 `push` 到末尾。迟到的 Claude 80 尾窗或 Shared projection 里对不上的更早项，会被接到最新消息后面。
4. **B4** `dispatchThreadItemsProgressively.ts` L74–78 `items.slice(-300)` 无 turn 回退。DOM 800 窗的 `resolveHistoryWindowCutIndex`（`messagesHistoryWindow.ts` L118–154）会把切口回退到同 `turnId` 段首。内存首屏不会，用户会觉得「这一轮上半截没了」。

约束：禁止 timestamp 全局 sort；禁止用 history reload 修 live settle；禁止重开虚拟化；禁止改 follow 模型；禁止动 Bug A 的芯片 / requester / `CLAUDE_UI_HISTORY_WINDOW`。

`prepareThreadItems` **不排序**，只 coalesce / 丢空 assistant / 截工具输出。本 change 保持这个不变量。

## Goals / Non-Goals

**Goals:**

- 假 user-user 连堆消失：结构上存在的空 assistant 壳在 live / 后接 user / live-text 引用时不被 prepare 丢掉。
- 迟到 incoming leftover 按相对位置插入，旧在上、新在下。
- 同一句 user 在 wrapper 剥离后收敛为一条；对不上则 optimistic 留原位。
- 首屏 300 与 DOM 800 共用 turn 回退，不切半轮。

**Non-Goals:**

- 不修 live settle 后助手结论跑到工具前。
- 不重做 `<task-notification>` 折叠。
- 不修助手双份渲染、不改 Shared V0-first。
- 不改 Bug A 翻页合同。
- 不为「未来可能的包装」新写一套模糊匹配。

## Decisions

### D1. B1 空 assistant：有结构意义才留，禁止无条件 `continue`

**选择**：把 L784–792 的无条件丢弃改成保留策略。空壳 **必须保留** 当且仅当满足任一：

- 该 item 的 `turnId` 仍属于 processing / live turn（调用方传入 `processingTurnId` / `isProcessing`，或 item 自身带未完成标记）；
- 同一列表里，该 assistant **之后** 还存在 `role === "user"` 的 message（丢掉会制造假连堆）；
- 该 assistant `id` 仍被 `liveAssistantTextChannel` 引用（调用方传入 `preserveMessageTextIds` 或等价 set；已有 `preserveMessageTextIds` 只保长度，本 change 复用/扩展为「不要丢壳」）。

同时满足以下才丢：

- `text.trim()` 空、无 images、无 `executionTargetSnapshot`；
- 已 settle（非 processing turn）；
- 后面没有 user；
- 不被 live-text channel 引用。

两条真实用户连发、中间本来就没有 assistant 的，**不是** 本策略的修复对象，必须保持两条蓝气泡。

**备选**：永远不丢空 assistant。否决：历史里大量无结构意义的空壳会变成空白卡。

**备选**：只看 live-text channel。否决：hydrate / settle 时 channel 可能已清，但后面已有下一条 user，仍会假连堆。

调用面：`prepareThreadItems` 已有 `options?.preserveMessageTextIds`。新增可选 `options.liveTurnId` / `options.referencedLiveAssistantIds`，缺省时「后面还有 user」这条仍生效，保证不传 options 的 hydrate 路径也能挡住假连堆。

### D2. B3 leftover：按 incoming 邻居相对插入，append 只作无邻居兜底

**选择**：当 `preservedLocalOnlyItemIds.size > 0` 需要重排时：

1. 仍先走 local 顺序，emit 已匹配 id 与 local-only（optimistic / compaction）。
2. leftover incoming **不再** `forEach push` 到末尾。
3. 对每条 leftover，在 incoming 里找最近的已 emit 邻居：
   - 前驱已 emit → 插到该前驱之后；
   - 否则后继已 emit → 插到该后继之前；
   - 否则 leftover 整段都在 incoming 第一个已匹配项之前 → 插到结果数组开头（保持相对序）；
   - 三个邻居都不存在 → 才允许 append。

这样迟到 80 尾窗里「比 local 更早、id 对不上」的项会落到已有时间线前面或中间，不会跑到最新 optimistic 后面。

**备选**：incoming 整表替换 local。否决：发送中 optimistic / live 尾会闪没。

**备选**：按 timestamp 插。否决：proposal 非目标；live 与 history 时钟不可比。

实现抽纯函数（建议 `insertUnmatchedIncomingByNeighbor`），与 merge 主流程分开测。禁止在函数里读 `Date`。

**B3 follow-up（Grok leftover Exploring）**：当 `firstMatchedIncomingIndex < 0`（incoming 完全对不上）时，`explore`（任意 status）与 in-progress `commandExecution` leftover **不得**插到结果开头。这类项是别的会话残留，不是「迟到更早窗」。user / assistant leftover 仍按原 D2 插到开头，B3 既有 fully-unmatched older-window 用例不得回退。有 matched neighbor 时 explore 仍相对插入。

**B3 follow-up（带图提问尾巴回归）**：`insertUnmatchedIncomingByNeighbor` 合同不变。回归出在 replacement map 没把「当前回合 optimistic」标成已被 history 替换：hydrate 后 leftover 助手 + 空 text 附图 user 按邻居插完，optimistic 仍留在最新尾巴，幕布上看就是用户图卡贴在响应中条右下。

修法：

1. merge 用已有 `buildOptimisticUserReplacementMap` 决定是否保留 optimistic，不再只靠 `findMatchingRealUserMessage`。
2. 当前回合 1:1：local 最后一条真实 user 之后恰好一条 unmatched optimistic，incoming 在对应位置之后恰好一条 **新 id** unmatched real user，且 `isPlausibleSameTurnUserPayload` 为真（同文案，或一侧可见文案为空但两侧都有图 / deferred 图）。两条非空且不同的可见文案禁止折叠，以保住 B2「hello 与 hello world 并存」。
3. 被替换的 history user 若 text 归一化后为空，回写 optimistic caption，避免位置对了、问句丢了。

配套两层，禁止只靠一层：

1. **Presentation**：Grok 用 `suppressOrphanExploringItemsBeforeLatestUserTurn` 隐藏 latest user 之前的 `exploring`，保留其后的当前轮 Exploring。不要求 `isThinking`。禁止把 Grok 改成 Codex/Claude 那种全藏 `exploring`。
2. **Session bind**：`pickLikelyGrokSessionId` 增加 optional `occupiedSessionIds`。已被其他 `grok:` thread 占用、或已被其他 pending cache 的 session 不得回绑。另一 `grok-pending-*` 已有 items 时跳过 list fallback。禁止因为仓库里存在任意旧 `grok:` thread 就关掉 pickLikely。

### D3. B2：只扩现有 `normalizeComparableUserText`，先红灯再加剥离

**选择**：不新写模糊匹配。流程：

1. 先补失败用例：optimistic 纯用户可见意图 + incoming 带现有 stripper **尚未覆盖** 的包装变体（或包装嵌套顺序导致剥不干净）。
2. 红灯成立才在 `conversationNormalization.ts` 扩 stripper。
3. 现有已覆盖的 memory / note-card / agent-prompt / shared-session / slash-skill 回归不得回退。
4. 归一化后仍不等价：保留 optimistic 在 **原下标**，权威项若 id 不同且文本不等价则作为新提问保留；禁止把权威项再 append 一份导致双气泡。

「对不上就保留 optimistic 在原位，不要复制一份」指：已经判定等价时只留一条；判定不等价时不要因为 merge leftover 把权威项又抄到末尾（与 D2 协同）。

**备选**：编辑距离 / 前缀相似折叠。否决：会误吞两条真实提问。现有 spec 已要求部分相似不得折叠。

### D4. B4：首屏切口复用 `resolveHistoryWindowCutIndex`，禁止复制近似逻辑

**选择**：把 `resolveHistoryWindowCutIndex` 抽到 messages 与 threads 都能 import 的共享位置（优先：已有 `messagesHistoryWindow.ts` 若 threads 层不能依赖 messages，则下沉到 `src/features/threads/utils/` 或 `src/features/messages/orchestration/presentation/` 的既有跨层合同文件；**只搬函数，不改 DOM 800 语义**）。

`dispatchThreadItemsProgressively` 在 `items.length > batchSize` 时：

```
cut = resolveHistoryWindowCutIndex({
  items,
  windowSize: batchSize,
  revealedItemCount: 0,
  activeTurnId: null, // 首屏无 live turn pin；只走同 turnId 段首回退
})
displayed = items.slice(cut)
```

`remainingOlderCount = cut`。`atomic` 模式与 `items.length <= batchSize` 不走切口。

**备选**：在 progressively 里手写 while 回退。否决：plan 明确禁止复制一份近似逻辑。

**备选**：把 first-paint 从 300 改成按 turn 计。否决：超出本 change；窗口大小不是根因。

## Risks / Trade-offs

- [Risk] 空 assistant 保留过多 → 历史出现空白气泡 → Mitigation：settle + 无后继 user + 无 live-text 引用才丢；补「真空间壳仍丢」单测。
- [Risk] leftover 相对插入把 live 尾插到历史中间 → Mitigation：local-only（optimistic / live 未匹配项）仍按 local 顺序钉在原相对位置；只移动 unmatched incoming。
- [Risk] 扩 wrapper 剥离误折叠两条相似提问 → Mitigation：只剥已知包装标记；部分相似不得折叠的现有场景必须绿。
- [Risk] 下沉 `resolveHistoryWindowCutIndex` 造成 messages ↔ threads 循环依赖 → Mitigation：下沉到无 UI 依赖的 utils，先查现有 import 方向再搬。
- [Risk] merge 改动加重 live settle 错序 → Mitigation：不碰 timestamp；不重排已匹配段；跑 `threadReducerCoreHelpers.liveSettlement.test.ts` 作哨兵，失败则收回 B3 算法而不是改 settle。
- [Trade-off] 空壳保留后幕布可能短暂看到极矮的空 assistant 行 → 可接受；假连堆比空壳更伤。不为本 change 新做占位 UI。

## Migration Plan

无需数据迁移。回滚按条独立：

- B1：恢复无条件丢空 assistant。
- B3：恢复 leftover `push` 末尾。
- B2：撤回 normalize 增量，保留原 stripper。
- B4：恢复裸 `slice(-300)`。

禁止连带回滚 Bug A。禁止用「临时全局 sort」当回滚。

## Open Questions

- `prepareThreadItems` 调用方是否都能拿到 live-text 引用 set：实现时先扫调用点；拿不到时 D1 的「后面还有 user」仍足以挡住假连堆。
- leftover 多段同时插（incoming 头尾都有 unmatched）：按 incoming 原序逐条插即可，不必产品拍板。
- B2 若现有 stripper 已能过新增用例：不改 `conversationNormalization.ts`，只把回归用例留下。T10 保持「仅在有失败用例时扩」。
