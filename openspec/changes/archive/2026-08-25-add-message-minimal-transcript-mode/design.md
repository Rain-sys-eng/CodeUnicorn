# Design: add-message-minimal-transcript-mode

## 1. 现状架构（代码事实）

幕布渲染流水线（Native + Shared 共用 Messages 核）：

```text
ConversationItem[]
  → resolveVisibleMessageItems        （engine 级过滤：hideClaudeReasoning 等）
  → timelineSourceItems               （explore 抑制）
  → resolveCollapsedTimelineItems     （per-phase 折叠，messagesViewModel.ts:465）
  → processPhaseChips                 （MessagesCore.tsx:1109）
  → buildTimelineProjectionRows       （chip 放置：expanded→insertBeforeItemId /
                                        collapsed→assistantItemId 锚定，
                                        messagesTimelineProjection.ts:130）
```

关键约束：

1. **折叠态 chip 的放置依赖锚点**：`phaseByAssistantId.set(phase.assistantItemId, phase)`，
   chip 渲染在 anchor prose 正上方。若 anchor prose 本身被 unmount，chip 失去放置点。
   → 这是否决「方案 A（per-phase 内藏 prose）」的直接原因：多个 prose-hidden phase 会争抢
   同一个「下一个可见 item」锚点，`phaseByFirstItemId` Map 键碰撞。
2. **折叠 = hard-unmount**：折叠的 process rows 从 timelineItems 移除，React 树释放；
   展开 remount。极简模式沿用同一机制（Render Perf Baseline 红线①兼容——方向是减 DOM）。
3. **展开态**：`expandedProcessPhaseKeys: Set<string>`（MessagesCore state），chip 点击 toggle，
   `threadId` 变化时清空。
4. **flag 响应式通道**：`liveCanvasControls.ts` 提供 `readLocalBooleanFlag` /
   `writeLocalBooleanFlag` / `MESSAGES_LIVE_CONTROLS_UPDATED_EVENT`（同 tab CustomEvent）+
   `storage` 事件（跨 tab）。`liveAutoFollowEnabled` 是完整先例
   （MessagesCore.tsx:342/805/842，ContextBar.tsx:114/309）。
5. **文件变更「已编辑 / 撤销 / 审核」卡在 `ComposerRunStatusStrip`**（Composer 区域），
   不在幕布时间线内——极简模式天然不影响操作入口。approval / tail user input 走投影层
   独立 row（`approvalVisible` / `shouldRenderUserInputAtTail`），同样不受影响。

## 2. Turn 分段与折叠规则

`resolveCollapsedTimelineItems` 新增 option：`minimalTranscriptEnabled?: boolean`（默认 false）。
为 true 时走新分支 `resolveMinimalTranscriptCollapsedTimeline`，默认路径**逐行不动**。

### 2.1 Turn 分段

- 以 `isUserMessageItem` 为边界把 `canvasItems` 切成 segment（segment 不含 user 消息本身）。
- 每个 segment 的「最终回答锚点」`finalAnchor`：
  优先最后一条 `isFinal === true` 的 assistant prose；否则最后一条 visible assistant prose。
- segment 分类：
  - **无 prose** → 跳过（纯工具/错误收尾不折叠，不产空 chip）。
  - **尾部 segment 且 `isThinking === true`** → 活跃 turn，对该段单独跑既有 per-phase 逻辑
    （流式实时可见性不变）。
  - **其余（已完成 turn）** → turn 级折叠。

### 2.2 Turn 级折叠

对完成 turn：

- `hiddenItemIds` = segment 内除 `finalAnchor` 外的全部 items（process + 中间 prose）。
- 若 `hiddenItemIds` 为空（单 prose turn）→ 跳过，不产 chip。
- 生成单个 phase：
  - `phaseKey` = `turn:${finalAnchor.id}`（与既有 phaseKey 命名空间隔离）
  - `assistantItemId` = `finalAnchor.id`（折叠态经 `phaseByAssistantId` 锚定最终回答上方，
    投影层**零改动**）
  - `insertBeforeItemId` = `hiddenItemIds[0]`（展开态 chip 落在段首）
  - `count` = 可渲染 process 数 + 隐藏 prose 数；`breakdown` 增加 `proseCount`
  - `durationMs` = 段内 tool duration 合计（复用 `resolvePhaseDurationMs`）
- 折叠时 hiddenItemIds 全部进 `unmountedItemIds`（hard-unmount）；
  展开（`expandedPhaseKeys.has(phaseKey)`）时全部 remount，且**该段不再生成 per-phase chip**
  （展开 = 原始过程流，所见即全部）。

### 2.3 活跃尾部 segment 的回落

对「`isThinking` 的尾部 segment」，把该 slice 单独喂给既有 per-phase 循环逻辑
（含其 trailing 滚动窗口），结果与完成 turn 的 turn chip 合并返回。
保证流式中思考/工具/叙述与默认模式完全一致。

### 2.4 边界场景

| 场景 | 行为 |
| ------ | ------ |
| 单 prose turn（无过程） | 无 chip，prose 正常显示 |
| 无 prose turn（纯工具/错误） | 不折叠、无 chip |
| 流式中 | 尾部活跃 segment 走 per-phase 实时；更早的完成 turn 已折 |
| turn 完成瞬间（isThinking false） | 尾部 segment 转为完成 turn，整段折叠 |
| 用户展开 turn chip 后继续流式新 turn | 互不影响（phaseKey 按 finalAnchor.id 隔离） |
| 切会话 | `expandedProcessPhaseKeys` 清空（现状），全部回折叠态 |
| pending approval / user input | 发生在活跃 turn（isThinking=true），不折叠；投影层独立 row 不受影响 |

## 3. 设置与响应式

- Flag key：`ccgui.messages.minimalTranscript`（localStorage，**默认关**）。
- `BasicAppearanceSection`（基础设置 → 外观，布局切换行下方）新增 Switch：
  local state 初始化 `readLocalBooleanFlag(..., false)`；切换时 `writeLocalBooleanFlag` +
  dispatch `MESSAGES_LIVE_CONTROLS_UPDATED_EVENT`（detail 带 `minimalTranscriptEnabled`）。
  模式同 `OtherSection` 本地 flag 开关；不新增 AppSettings 字段、不动 Rust。
- `MessagesCore`：
  - `useState(() => readLocalBooleanFlag(MESSAGES_MINIMAL_TRANSCRIPT_FLAG_KEY, false))`
  - 在既有 `handleLiveControlsUpdated` / `handleStorage` 中扩展新 key 处理
  - 传入 `resolveCollapsedTimelineItems({ minimalTranscriptEnabled, isThinking, ... })`

## 4. Chip 文案

`ProcessPhaseBreakdown` 增加 `proseCount: number`（默认 0）。
`MiddleStepsCollapsedChip` label 追加：`middleStepsStatNarration`（zh: `叙述 {{count}} 段`）。
turn chip 示例：`思考 12 次 工具调用 34 次 叙述 9 段 ›`。
需同步的三处类型：chip 本地 type、`messagesTimelineProjection.ts`、`messagesTimelineModels.ts`。

## 5. i18n

新增 key（10 语言全补）：

- `settings.minimalTranscript` / `settings.minimalTranscriptDesc`
- `messages.middleStepsStatNarration`

## 6. 性能与红线自查

- 折叠方向为减 DOM，hard-unmount 复用既有机制；不引入高频 setState 挂根链
  （state 在 MessagesCore，事件驱动，无轮询）。
- 不触碰 liveAssistantTextChannel / liveItemDeltaChannel 外化链路。
- 开关切换只触发一次 view model 重算（useMemo 依赖变化），无秒级轮询。

## 7. 测试计划

- `messagesViewModel` 单测（新文件或并入现有）：
  1. 默认关：输出与现状一致（guard 回归）
  2. 完成 turn：整段折叠为单 chip，prose+process 进 hiddenItemIds，最终 prose 可见
  3. 展开 phaseKey：全部 remount，无 per-phase chip
  4. `isThinking` 尾部 segment：per-phase 行为保留
  5. 单 prose / 无 prose turn：无 chip 无隐藏
  6. 多 turn 历史：每个完成 turn 各一个 chip
  7. chip breakdown：proseCount 计入 label
- `BasicBehaviorSection` 测试：开关渲染、切换写 localStorage + 广播事件。
