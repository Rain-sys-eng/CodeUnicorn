# Proposal: perf-large-transcript-first-paint

> OpenSpec change id: `perf-large-transcript-first-paint`  
> Skill: `openspec-ff-change`  
> Evidence: 本地大会话（约 6000 条 / 芯片「显示之前的 4761 条消息」）打开卡 ~10s，点芯片黑屏后缓慢恢复  
> 邻近 change（禁止混进本 diff）：`fix-claude-history-disk-window-load-more`、`fix-shared-history-projection-nonblocking`、`fix-canvas-user-bubble-stack-and-merge-order`、`fix-session-switch-unlock-windows-jank`

---

## Why

今天接上的历史芯片让「4761 条更早消息」这条路真正活了，但打开 / 翻页的成本模型是错的。幕布卸下之前，`hydrateHistory` 用直播增量 `upsert` 扫整份 snapshot（每次 append 整表拷贝 + 线性 identity 扫描 = O(n²)）。首屏切口遇到超大 `turnId` 段会一路回退，把整段甚至整份 transcript 打进 store。芯片一页又按 DOM 窗 800 条 prepend，且 **不** 增加 `revealedHistoryItemCount`，新行可能立刻被 800 窗裁掉——用户付一次主线程黑屏，视口却几乎不动。

这不是缺一个更小的全局常数，也不是虚拟化回潮。0.9 把普通会话窗从 150/16 放到 800/300，是为了中等会话不要一打开就出芯片。本 change 只修大会话的成本耦合。

## What Changes

- `hydrateHistory` 走 batch working-set（可变数组 + identity Map）。直播 `upsertSnapshotItem` 语义不变，禁止把直播路径改成可变。
- `resolveHistoryWindowCutIndex` 增加可选 `maxDisplayed`。首屏调用方传入硬顶，超大 turn 不得把 300 窗扩成整份 transcript。普通 turn 仍不切两半。
- 芯片 / 滑顶的翻页大小与 DOM 800 窗解耦，默认 500；旁边显式 `All` 才抽干内存余量。prepend 后新行进入可见预算。一次点完全量当默认芯片的实验已回退。
- 打开路径：空探针不再全量 classify；tool classify 不扫 output；Phase-A 已上屏的同一 snapshot 不再第二次 hydrate。
- 不改 `DEFAULT_HISTORY_WINDOW_SIZE = 800`、`THREAD_ITEMS_FIRST_PAINT_COUNT = 300`、`CLAUDE_UI_HISTORY_WINDOW = 80`。中等会话打开体验保持 0.9。

## 目标与边界

- **目标**：打开 5000+ item 会话，幕布不再等三遍全量 classify；点「更早」一次挂 500 且用户能看见它们；`All` 一次抽干内存余量。
- **边界**：assembler hydrate、classify probe、history window cut、older-history page size、MessagesCore reveal-on-prepend、Shared Phase-A 去重。
- **引擎**：Claude Native / Shared / 其他走 `hydrateHistory` + pending/DOM 窗的会话都受益。不改各引擎磁盘 limit。

## 非目标

- 不重开 `shouldVirtualizeTimelineRows` / 行级 lightweight 摘要条。
- 不把 800/300/80 磁盘窗改回全量，也不全局缩小 800/300 惩罚普通会话。
- 不把今天的 hasMore 芯片、空 assistant preserve、Shared V0 first-paint 拆掉。
- 不按 timestamp 全局 sort。
- 不在 AppShell 根链挂翻页 setState。
- 不用固定 timeout 当卡顿修复。
- 不重做 Shared projection 权威 / 不把 curtain 重新绑到 Phase-B。

## 技术方案对比

| 选项 | 做法 | 取舍 |
|------|------|------|
| **A. 拆成本耦合（采用）** | batch hydrate + 首屏 maxDisplayed + 页大小独立 + reveal-on-prepend | 普通会话常数不动；修的是算法与两窗互抢 |
| B. 全局缩小 800/300 | 窗改回 150/16 | 0.9 中等会话立刻出芯片；拆东墙补西墙 |
| C. 重开时间线虚拟化 | TanStack Virtual 回来 | 与 stick-to-bottom / 流式中部卡顿红线冲突；合同禁止 |
| D. 打开时拉全量 Claude 历史 | `limit: null` | 打开更卡；否定今天磁盘 80 的存在理由 |

## Capabilities

### New Capabilities

- `large-transcript-first-paint`：大会话打开 / 翻页的成本合同——hydrate 必须线性、首屏 turn 回退必须有硬顶、翻页按视口页且 prepend 后可见。

### Modified Capabilities

- （无）现有 `conversation-render-surface-stability` / `conversation-curtain-assembly-core` 的 MUST 不改口径；本 change 补的是它们没写的大规模成本约束。

## Impact

- `src/features/threads/assembly/conversationAssembler.ts`：`hydrateHistory` batch working-set。
- `src/utils/historyWindowCut.ts`：可选 `maxDisplayed`。
- `src/features/threads/utils/dispatchThreadItemsProgressively.ts`：首屏传入 maxDisplayed；翻页常数与 DOM 窗解耦。
- `src/features/threads/utils/pendingOlderHistory.ts` / `createOlderHistoryRequester.ts`：内存按 500 分页；`All` 走 `drainAll`。
- `src/features/threads/contracts/conversationFactContract.ts` + assembler：classify 不扫 tool output。
- `src/features/threads/hooks/useThreadActionsResumeThread.ts`：跳过空探针全量 classify 与 Phase-A 重复 hydrate。
- `MessagesCore.tsx`：prepend 时 `revealNextHistoryPage(prependedCount)`。
- 测试：assembler hydrate、classify probe、historyWindowCut、dispatch progressive、pending/requester、Shared Phase-A 去重。
- 红线回归：虚拟化保持关闭；Claude hasMore / Shared V0 / empty-assistant 接线不动。

## 验收口径

| # | 标准 | 证据 |
|---|------|------|
| A | 3000+ 互异 history item 的 `hydrateHistory` 与旧语义一致，且不再按条拷贝整表 | assembler 单测 |
| B | 同一 `turnId` 覆盖整份 2000 item 时，首屏 displayed ≤ maxDisplayed，余量进 pending | dispatch + cut 单测 |
| C | 普通小 turn 跨切口仍回退到段首（不回退 0.9 体验） | 现有 cut 单测仍绿 |
| D | 芯片 / pending 一次 prepend 500，且 reveal +500；All 抽干内存余量且不打磁盘 | pending / requester 单测 |
| E | prepend N 条后 presentation 可见预算至少增加 N | MessagesCore / window 单测 |
| F | `DEFAULT_HISTORY_WINDOW_SIZE` 仍 800，`THREAD_ITEMS_FIRST_PAINT_COUNT` 仍 300，Claude 磁盘 80 不变 | 常数守卫 |
| G | `shouldVirtualizeTimelineRows` 仍恒 false | 虚拟化单测 |
