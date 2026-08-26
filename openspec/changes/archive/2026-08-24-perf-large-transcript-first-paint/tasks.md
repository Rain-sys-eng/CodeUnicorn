## 1. Batch hydrateHistory

- [x] 1.1 在 `conversationAssembler.ts` 为 snapshot hydrate 增加可变 working-set + identity Map；append/replace 原地写，key 变化时删旧写新
- [x] 1.2 直播 `upsertSnapshotItem` 保持不可变返回新数组，禁止与 batch working-set 共享
- [x] 1.3 扩展 assembler hydrate 单测：3000 互异 item 结果长度与顺序；同 identity merge 与现网语义一致

## 2. First-paint maxDisplayed

- [x] 2.1 `resolveHistoryWindowCutIndex` 增加可选 `maxDisplayed`；turn 回退不得越过 `items.length - maxDisplayed`；`activeTurnId` pin 仍可超顶
- [x] 2.2 首屏 `dispatchThreadItemsProgressively`（tail-first）传入 `THREAD_ITEMS_FIRST_PAINT_MAX_DISPLAYED = 400`；DOM 800 窗省略该参数
- [x] 2.3 常数守卫：`THREAD_ITEMS_FIRST_PAINT_COUNT` 仍 300、`DEFAULT_HISTORY_WINDOW_SIZE` 仍 800、Claude 磁盘窗仍 80
- [x] 2.4 单测：2000 条同 turnId 首屏 displayed ≤ 400 且余量进 pending；20 条小 turn 跨 300 切口仍整段回退

## 3. Viewport-sized older pages + reveal-on-prepend

- [x] 3.1 新增 `OLDER_HISTORY_REVEAL_PAGE_SIZE = 500`；`takeNextOlderHistoryBatch` 与 presentation-only `revealNextHistoryPage` 默认用 500，不再绑 800
- [x] 3.2 `notifyOlderHistoryBeforePrepend(threadId, { prependedCount })`；MessagesCore listener 同步 `revealNextHistoryPage(prependedCount)`
- [x] 3.3 单测：pending 900 点芯片 prepend 500 且 reveal +500；presentation-only 路径也只扩 500

## 4. Red-line regression

- [x] 4.1 确认 `shouldVirtualizeTimelineRows` 仍恒 false，时间线仍静态 list
- [x] 4.2 确认今天 Claude hasMore / Shared V0 first-paint / empty-assistant 接线不被本 diff 改写
- [x] 4.3 跑受影响 Vitest：assembler、historyWindowCut、dispatch progressive、pending/requester、messagesHistoryWindow

## 5. Revert one-shot memory drain

- [x] 5.1 芯片 / requester 内存路径回到 `takeNextOlderHistoryBatch`（现默认 500）
- [x] 5.2 MessagesCore prepend listener 与 presentation-only 走 `revealNextHistoryPage`
- [x] 5.3 打开仍 tail-first 300/400；Claude 磁盘页仍 80
- [x] 5.4 单测：pending 900 一次 prepend 500；revealAll 仅保留 jump-to-anchor / 显式 All

## 7. Memory chip 500 + explicit All

- [x] 7.1 `OLDER_HISTORY_REVEAL_PAGE_SIZE = 500`；主芯片一次挂 500
- [x] 7.2 `takeAllRemainingOlderHistory` + requester `drainAll`；All 抽干内存余量，不自动打 Claude 磁盘页
- [x] 7.3 Timeline 芯片行旁加 `All` link（`messages.loadAllEarlierMessages`）
- [x] 7.4 单测：default page 500；drainAll 抽干；空内存 All 不 load disk

## 6. Cut open-path classify / hydrate waste

- [x] 6.1 空探针：`items.length > 0` 直接返回，不再 `hydrateHistory` 一遍
- [x] 6.2 classify probe 只扫 type + title/detail + 头 2KB；assembler 不 join tool output
- [x] 6.3 Shared Phase-A 已成功 hydrate 的同一 snapshot，`load()` 返回时跳过第二次 hydrate
- [x] 6.4 单测：巨大 tool output 仍是 visible tool；probe head 的 control marker 仍隐藏；Phase-A 后 `setThreadItems` 只一次

## 8. 上翻不自动翻页，加载更多不吸底

- [x] 8.1 `handleCanvasScroll` 只更新锚点，禁止 `scrollTop` 接近 0 时调用 `tryLoadOlderHistoryPage`
- [x] 8.2 send-boundary 只用尾部 `latestUserMessageId` 判定新发送；prepend 涨 `userMessageCount` 不得 `resumeFollowAndPin`
- [x] 8.3 芯片 / All 的 manual expansion 禁止写 `scrollTop = 0`；视口只走 expansion snapshot 增量恢复
- [x] 8.4 单测：`isNewTailUserMessage` 同尾 id 为 false；prepend 旧用户不改变 `latestUserMessageId`
