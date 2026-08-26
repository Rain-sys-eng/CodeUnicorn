# Design: add-minimal-transcript-live-turn-fold

## 1. 现状（代码事实）

`resolveMinimalTranscriptCollapsedTimeline`（messagesViewModel.ts）流式分支现状：

```text
if (isThinking) {
  // 活跃尾部 turn：回落 per-phase 实时折叠（collectProcessPhaseCollapsedTimeline）
  // slice 带 preceding user 消息保证 trailing phase key 一致
} else {
  foldCompletedTurn(canvasItems.slice(tailSegmentStart));
}
```

关键约束：

1. **chip 放置两条既有路径**（投影层 `buildTimelineProjectionRows`）：
   - `assistantItemId` → 折叠态经 `phaseByAssistantId` 锚定该 prose 正上方（turn chip 用）。
   - `collapsedAnchorItemId` → 折叠态锚定某 item 之前（默认模式 trailing chip 用，
     `assistantItemId = phaseKey` 自锚）。
   本设计两条都复用，**投影层零改动**。
2. **折叠 = hard-unmount**：`unmountedItemIds` 从 timelineItems 过滤；展开 remount。
   流式期间新到 item 若在 hidden 集合内随即 unmount——这正是「随流式增长实时折叠」
   想要的行为，方向为减 DOM（Render Perf Baseline 兼容）。
3. **展开态**：`expandedProcessPhaseKeys: Set<string>`（MessagesCore state），chip 点击
   toggle 写入，切会话清空。view model 只读 `expandedPhaseKeys`。
4. **trailing 滚动窗口**：`TRAILING_PROCESS_COLLAPSE_THRESHOLD = 5` /
   `TRAILING_PROCESS_VISIBLE_TAIL_COUNT = 3`，默认模式常数，本 change 不动。

## 2. live turn 折叠算法（foldLiveTurn）

`isThinking === true` 时，对尾部 segment（`canvasItems.slice(tailSegmentStart)`）：

```text
segmentItems
  ├─ liveAnchor = 最后一条 isAssistantMessageWithVisibleText（生长中的 prose，可无）
  ├─ beforeAnchor（anchor 存在时）
  │    → hiddenBefore = 其中全部 isCollapsibleProcessItem + assistant prose
  └─ trailingSource = anchor 之后的 items（无 anchor 时为整段）
       → trailingEntries = groupToolItems(filter isCollapsibleProcessItem)
       → entries.length > MINIMAL_TRANSCRIPT_TRAILING_COLLAPSE_THRESHOLD (4) 时：
           hiddenTrailing = entries[0 .. len-3) 展开的全部 items
           firstVisibleTailItem = entries[len-3] 的第一个 item
```

- `hiddenItems = [...hiddenBefore, ...hiddenTrailing]`；为空 → 不产 chip，segment 全可见。
- `count` = 可渲染 process 数 + 隐藏 prose 数；`breakdown` 含 `proseCount`；
  `durationMs` 复用 `resolvePhaseDurationMs(hidden process)`。
- 折叠时 hiddenItems 全部进 `unmountedItemIds`。
- **展开时（2026-08-25 修订）**：不再整段平铺。外层 chip 保持渲染作为折回入口，
  turn 内部复用默认模式的 per-phase 收集渲染（见 §2.4）。

### 2.1 phaseKey 与放置

- `phaseKey = liveturn:${precedingUserMessageId ?? "start"}`。
  precedingUserMessageId = `canvasItems[tailSegmentStart - 1]`（即切出该 segment 的
  user 消息）；`tailSegmentStart === 0` 时为 `"start"`。turn 周期内不随新 prose 落地
  而变化（锚点 prose id 会变，key 不变）。
- **anchor 存在**：`assistantItemId = liveAnchor.id`（折叠态锚定生长中 prose 上方），
  `insertBeforeItemId = hiddenItems[0].id`（展开态 chip 落段首）。
- **anchor 不存在**（纯工具跑动中且超过阈值）：复用 trailing chip 形态——
  `assistantItemId = phaseKey`（自锚），`collapsedAnchorItemId = firstVisibleTailItem.id`，
  `insertBeforeItemId = hiddenItems[0].id`。

### 2.2 完成瞬间的 key 切换与展开态迁移

`isThinking` 转 false 后尾部 segment 走 `foldCompletedTurn`，chip key 变为
`turn:${finalAnchor.id}`。若用户流式中展开过 live chip（`expandedPhaseKeys` 含
`liveturn:` key），直接切换会突然折回。

→ `foldCompletedTurn` 增加可选参数 `legacyExpandedKeys?: string[]`：
`expanded = expandedPhaseKeys.has(phaseKey) || legacyExpandedKeys?.some(has)`。
仅尾部 segment 在完成分支传入 `[liveturnKey]`；历史 segment 不传（它们的 live key
早已随各自 turn 完成而失效，且 user id 一一对应不会误命中）。

### 2.3 阈值常数

```ts
const TRAILING_PROCESS_COLLAPSE_THRESHOLD = 5;              // 默认模式，不动
const MINIMAL_TRANSCRIPT_TRAILING_COLLAPSE_THRESHOLD = 4;   // 极简模式 live turn 专用
const TRAILING_PROCESS_VISIBLE_TAIL_COUNT = 3;              // 两模式共用，不动
```

阈值 4 只进入 `foldLiveTurn` 折叠态；默认模式 `collectProcessPhaseCollapsedTimeline`
继续引用 5，零回归。展开态 turn 内部渲染回落默认形态，trailing 阈值同样回到 5。

### 2.4 展开态：外层 chip + 内层默认 per-phase 渲染（2026-08-25 修订）

起因：目视验收发现极简展开后整段平铺（几十条工具/思考全列），比默认模式还长。
拍板：展开第一层时，turn 内部 UI 与默认模式保持一致。

**算法**：外层 chip expanded 时（`foldCompletedTurn` / `foldLiveTurn` 同构）：

1. 先 push 外层 chip（`expanded: true`），`insertBeforeItemId` 改为「内层折叠后
   segment 内第一个仍可见的 item」（投影层 expanded chip 经 `phaseByFirstItemId`
   放置，若锚到被内层 chip unmount 的 item，header 会跌进 fallback 落到幕布底部）。
2. 再调用抽出的公共 helper `collectPerPhaseCollapsedInto(segmentItems)`（即默认模式
   `collectProcessPhaseCollapsedTimeline` 的 per-phase + trailing 收集逻辑原样抽出），
   内层 phases 追加在外层 chip 之后。内层 chip phaseKey = prose item id，与外层
   `turn:`/`liveturn:` key 不冲突，可独立展开/折回。
3. 折叠态路径逐行不变（不产内层 chip）。

**投影层唯一改动**：`phaseByFirstItemId` 从 `Map<string, Chip>` 改为
`Map<string, Chip[]>`。仅「外层展开 chip 与内层 trailing chip 同锚第一个可见
entry」（live 无 prose 场景）会同锚；phases 数组外层在前，保证外层 header 渲染在
内层 trailing header 之上。默认模式不存在同锚多 chip，行为不变。

**count/breakdown 稳定性**：外层 chip 数字仍按折叠态 hidden 集合统计，展开/折回
切换时 chip 数字不跳变。

## 3. 边界场景

| 场景 | 行为 |
| ------ | ------ |
| 流式中，prose + 其前已有过程/叙述 | 单 live chip 锚定 prose 上方，此前全部 hard-unmount |
| 流式中，尚无 prose，过程 entry ≤ 4 | 全可见，无 chip（与默认模式阈值内行为同形） |
| 流式中，尚无 prose，过程 entry > 4 | 隐藏至仅剩尾部 3 条，chip 自锚于第一个可见尾部 entry 前 |
| 流式中，prose 之后 trailing entry > 4 | 超出部分并入同一 live chip 的 hiddenItems |
| 流式中段（无过程、单 prose 生长中） | hiddenItems 为空，无 chip，prose 正常生长 |
| 展开 live chip 后继续流式 | 展开态下新到 item 按内层 per-phase 规则即时折叠；key 稳定不抖动 |
| 展开 live chip 后 turn 完成 | 展开态迁移到 `turn:` key，chip 保持展开 |
| 未展开直接完成 | 切换为 `turn:` chip 保持折叠（与历史 turn 一致） |
| 切会话 | `expandedProcessPhaseKeys` 清空（现状），全部回折叠态 |
| pending approval / user input | 非 process/prose item，不进 hiddenItems，不受影响 |
| flag 关（默认模式） | 不进入本分支，逐行不变 |

## 4. 性能与红线自查

- 折叠方向为减 DOM；流式中每个新 item 触发一次 view model 重算（既有 useMemo 链路，
  与现状 per-phase 回落相同），无新增高频 setState、无轮询。
- 不触碰 liveAssistantTextChannel / liveItemDeltaChannel 外化链路。
- 新到 item 立即 unmount 不产生挂载-卸载抖动：它在 filter 阶段就不进 timelineItems。

## 5. 测试计划（messagesViewModel.minimalTranscript.test.ts 追加）

1. 流式 + prose + 其前过程/叙述 → 单 live chip，key = `liveturn:<userId>`，
   锚定 prose，此前过程+叙述 hard-unmount，proseCount 计入。
2. 流式 + 无 prose + 4 entry → 无 chip 全可见；5 entry → 仅剩尾部 3 条 + 自锚 chip
   （`collapsedAnchorItemId` 放置）。
3. 流式 + prose 之后 trailing > 4 → 超出部分并入 live chip hiddenItems。
4. 流式 + 单 prose 无过程 → 无 chip。
5. 展开 live chip → 内层按 per-phase 渲染；随后 isThinking=false → `turn:` chip 保持展开
   （展开态迁移）。
6. 默认模式 guard：trailing 阈值仍为 5（5 entry 全可见，6 entry 触发折叠）——
   既有默认模式测试已覆盖则无需新增，否则补一例。
7. 展开 completed turn chip → 外层 chip 保持 + 内层 per-phase chip（过程行 unmount、
   中间 prose 可见、内层 chip 可独立展开、外层 insertBeforeItemId 锚到首个可见 item）。
8. 外层折叠时 MUST NOT 产出内层 chip（phases 仅 1 个）。
9. 投影层：同锚多 chip（外层 expanded + 内层 trailing）两个 header 按「外层在上」顺序渲染。
