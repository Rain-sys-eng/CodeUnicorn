# Design: perf-large-transcript-first-paint

## Context

三层窗口现状（今天刚接上芯片后）：

```text
磁盘尾窗 CLAUDE_UI_HISTORY_WINDOW = 80        // 本 change 不改
内存首屏 THREAD_ITEMS_FIRST_PAINT_COUNT = 300 // 默认不改
DOM 窗   DEFAULT_HISTORY_WINDOW_SIZE = 800    // 本 change 不改
翻页     THREAD_ITEMS_PROGRESSIVE_BATCH_SIZE = 800  // 与 DOM 窗错误耦合
```

打开大会话的真实热路径：

```text
load snapshot (V0 全量 / Claude 80 message 爆炸成数千 item)
  → hydrateHistory = reduce(upsertSnapshotItem)
       upsert: findIdentityIndex 线性扫 + replaceItemAtIndex 整表拷贝
       n=6000 → ~1.8e7 次数组拷贝与 identity key 重建
  → resolveHistoryWindowCutIndex(window=300)
       同一 turnId 覆盖整段时 while 回退到 0 → 全量进 store
  → setThreadItems(displayed) + rememberFullHistory(pending)
  → setThreadHistoryLoading(false)   // 幕布现在才掉
  → 时间线全量 map 挂 Markdown（虚拟化永久关）
```

点芯片：

```text
tryLoadOlderHistoryPage
  → takeNextOlderHistoryBatch(800) + prependThreadItems
  → 不增加 revealedHistoryItemCount
  → DOM 窗仍 800 → 新行可能全部被裁掉
  或 pending 空时 revealNextHistoryPage(800) → 一次挂 800 行 Markdown
```

约束：禁止重开虚拟化；禁止拆今天 hasMore / Shared V0 / empty-assistant；禁止用 timeout 当修复；禁止全局缩小 800/300。

## Goals / Non-Goals

**Goals:**

1. `hydrateHistory` 对 snapshot 是 O(n) working-set，合并/隐藏语义与现网一致。
2. 首屏 turn 回退有硬顶，超大 turn 不能把 300 窗扩成整份 transcript。
3. 翻页大小独立于 DOM 窗，默认 80；prepend 后新行进入可见预算。
4. 中等会话（≤300 / ≤800）打开体验与 0.9 相同。

**Non-Goals:**

- 不改 Claude 磁盘 80，不给 Shared 套磁盘窗。
- 不重开虚拟化 / lightweight 摘要条。
- 不把 hydrate 改成「只处理尾 300、prefix 保持 raw」——那会在切口丢 merge/hidden。本轮先把 O(n²) 拿掉；若仍不够再开独立 change 做 tail-first classify。
- 不改芯片文案公式（本地已知 N 仍用 `showEarlierMessages`）。

## Decisions

### D1. hydrateHistory 用 batch working-set，直播 upsert 保持不可变

**选择**：`hydrateHistory` 内部走可变 `items[]` + `Map<identityKey, index>`。`findIdentityIndex` 走 Map；append/replace 原地写。等价搜索（user / reasoning / assistant）仍从尾部扫描到 stop item——它们本就是 O(turn)。

直播 `upsertSnapshotItem` 继续返回新数组。历史 snapshot 不是逐条 live event，不该付 O(n²) 拷贝。

**备选**：只 hydrate 尾窗，prefix 进 pending 不 classify。否决（本轮）：切口处等价合并、hidden fact 会计数错误。O(n) 之后 6000 次 classify 是可接受的秒下成本。

**备选**：给直播 upsert 也改可变。否决：reducer 依赖引用相等短路。

### D2. `maxDisplayed` 是首屏安全阀，不是拆普通 turn

**选择**：`resolveHistoryWindowCutIndex` 增加可选 `maxDisplayed`。turn 回退的 `while` 不得越过 `items.length - maxDisplayed`。`activeTurnId` 钉住仍可超过该顶（直播回合必须完整可见）。

首屏调用方传 `THREAD_ITEMS_FIRST_PAINT_MAX_DISPLAYED = 400`（300 预算 + 100 给普通 turn 回退）。DOM 800 窗不传，行为与现网一致。

超大 turn（整份 transcript 共用一个 turnId，或单 turn 上千条）允许在硬顶处切开。这不是「普通 turn 切两半」——那种 turn 不是 UX 单位，是数据事故。

**备选**：禁止回退（裸 `slice(-300)`）。否决：刚修过的 bubble/turn 切口回归。

**备选**：maxDisplayed = 2 × windowSize（600）。可接受，但 600 行 Markdown 仍偏重；400 足够覆盖普通 turn 回退。

### D3. 翻页大小独立于 DOM 窗，prepend 必须增加可见预算

**选择**：`OLDER_HISTORY_REVEAL_PAGE_SIZE = 500`。主芯片一次挂 500；旁边显式 `All` link 才抽干内存余量。`MessagesCore` listener 用 `revealNextHistoryPage(prependedCount)`。Claude 磁盘 `hasMore` 仍按 `CLAUDE_UI_HISTORY_WINDOW`（80）分页；All 不自动连打磁盘页。

默认芯片不再一次点完 6361 行（该实验已证伪：长黑屏）。All 是用户明确选择，不是打开默认路径。

打开路径仍 tail-first 300/400。

**备选**：打开时就把 6000 行打进 store + DOM。否决：会把 host 分页和全量 commit 叠在同一次打开上。

**备选**：芯片一次抽干全部内存余量、不给 All。否决：用户要保留分页，只要把 80 改成 500，并加 All。

### D4. 不把本修复塞进今天的 hasMore change

独立 change。芯片接线、V0 first-paint、empty-assistant 的回归测试必须保持绿，但 diff 不改那些合同。

### D5. 打开税先砍重复 hydrate / classify；本 dump 证明 25s 不在 DOM

用户网页 DOM 测试不卡。原始 dump `dsh-session-session-817dbcda-…` 是 **DSH** 会话：`session.jsonl` 45MB / 44663 events。Python 全量 JSON parse 0.40–0.54s；fold 5624 messages / 0.026s；JS `parseDshHistoryMessages` 4990 items / 0.003s；hydrate/classify ~0s。已知 CPU 合计 <0.5s，对不上 25s 幕布。

DSH 打开没有 Phase-A。幕布等的是 `load_dsh_session`：串行 `session.history`（`HISTORY_PAGE_SIZE=200` **messages**，最多 40 页）。host 事实：`maxMessages: 40` 曾拉到 8079 raw events。本 dump 最新一页按 200 messages ≈ 40395 events / 39.74MB。25 次串行胖 RPC + 可能整文件重扫，才能解释 25s。网页 DOM 测试测的不是这条路。

本刀仍保留 Shared 侧的浪费切除（空探针 / classify 头 2KB / Phase-A 去重）。**不**在本 change 做 DSH tail-first IPC——那是下一刀，要单独 OpenSpec。

**选择**：

1. 空探针：`firstSnapshot.items.length > 0` 直接返回，禁止再 `hydrateHistory` 一遍只为了决定要不要 retry。
2. classify：control-line / `developer_instructions` / probe 只扫 type + title/detail + 头 2KB；assembler 不再把 tool `output` join 进 probe。
3. Shared：Phase-A 已经成功 hydrate 的同一 snapshot（threadId + length + first/last id）在 `load()` 返回时跳过第二次 `hydrateHistorySnapshot`。

**备选**：打开时只 classify 尾 400、prefix 保持 raw。仍不在本刀做——切口处 hidden/merge 会偏；先把三遍全量 classify 和 output 扫描拿掉。

**备选**：用 timeout 提前卸幕布。否决：timeout 当卡顿修复是红线。

**备选**：本 change 顺手做 DSH tail-first / 首屏只拉最新一页。否决：跨引擎 IPC 合同，必须单独 change；500+All 不假装修 25s 打开。

### D6. 上翻不自动翻页；prepend 不得当发送吸底

用户手测：滑到顶会自动翻页，翻完视口被钉到底，必须再往上拉才能继续翻。

**选择**：

1. `handleCanvasScroll` 只 `scheduleAnchorUpdate`。滑顶 / 回顶按钮不得调用 `tryLoadOlderHistoryPage`。翻页只走芯片和 `All`。
2. send-boundary 用尾部 `latestUserMessageId` 是否变化判定新发送。prepend 旧用户会涨 `userMessageCount`，但 tail id 不变，不得 `resumeFollowAndPin`。
3. `All` / manual expansion 不再写 `scrollTop = 0`。视口只走已有 expansion snapshot 的 `scrollHeight` 增量恢复。

**备选**：保留滑顶自动翻页、只修吸底。否决：用户明确要求上翻不自动翻页。

## Risks / Trade-offs

- [Risk] batch hydrate 漏更新 identity Map（merge 改了 kind/id）→ Mitigation：replace 时若 key 变则删旧写新；现有 hydrate 单测全跑。
- [Risk] maxDisplayed 切开正在看的超大 turn，顶部缺上下文 → Mitigation：芯片仍在，下一页就是同 turn 的更早段；比打开卡 10s 可接受。
- [Risk] 一次抽干 4000+ 行会主线程卡一下 → Mitigation：默认芯片只挂 500；`All` 是用户显式选择，不是打开默认路径。不要重开虚拟化。
- [Risk] 芯片文案仍写「显示之前的 6361 条」却只挂 500 → Mitigation：文案是余量计数，不是本页大小。旁边有 `All`。
- [Risk] 头 2KB 之外的 control marker 漏藏 → Mitigation：现网 marker 都在 type/title/首行；单测锁 probe head。
- [Risk] Phase-A 与 projection merge 被误判为同一 snapshot → Mitigation：paint key 含 length + first/last id；merge 后必重 hydrate。
- [Trade-off] Shared 打开仍全量 classify 一遍（不再三遍），且不再扫 tool output。本 dump 的 25s 是 DSH 串行 `session.history`，下一刀才是 DSH tail-first IPC。

## Migration Plan

无需数据迁移。回滚：`hydrateHistory` 回到 reduce+immutable upsert；cut 忽略 `maxDisplayed`；classify 恢复扫全文；空探针恢复全量 hydrate。不要回滚虚拟化开关，也不要动 800/300/磁盘 80。

## Open Questions

- 400 是否还偏大：实现按 400 落地；若手测打开仍明显顿，只调 `THREAD_ITEMS_FIRST_PAINT_MAX_DISPLAYED`，不动 300 默认。
- 芯片一次抽干 4000+ 行是否可接受：默认芯片实验已证伪并回退。现默认 500 + 显式 All。
