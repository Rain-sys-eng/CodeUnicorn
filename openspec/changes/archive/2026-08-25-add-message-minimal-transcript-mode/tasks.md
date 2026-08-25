# Tasks: add-message-minimal-transcript-mode

## 1. View Model 核心

- [x] 1.1 [P0] `liveCanvasControls.ts` 新增 `MESSAGES_MINIMAL_TRANSCRIPT_FLAG_KEY = "ccgui.messages.minimalTranscript"`。
- [x] 1.2 [P0] `messagesViewModel.ts`：`ProcessPhaseBreakdown` + `proseCount`；`resolveCollapsedTimelineItems` 新增 `minimalTranscriptEnabled` / 使用 `isThinking`，实现 turn 级折叠分支（§2.1-2.3），默认路径零改动。
- [x] 1.3 [P0] view model 单测 7 例（design §7）。

## 2. 渲染接线

- [x] 2.1 [P0] `MessagesCore.tsx`：`minimalTranscriptEnabled` state + 双通道监听扩展 + 传入 view model。
- [x] 2.2 [P0] `MiddleStepsCollapsedChip.tsx` / `messagesTimelineProjection.ts` / `messagesTimelineModels.ts`：breakdown + proseCount，label 追加「叙述 N 段」。

## 3. 设置入口 + i18n

- [x] 3.1 [P0] `BasicAppearanceSection.tsx` 外观页布局切换下方新增「极简展示」Switch（localStorage + 事件广播）。
- [x] 3.2 [P0] i18n 10 语言：`settings.minimalTranscript*`、`messages.middleStepsStatNarration`。
- [x] 3.3 [P1] 设置区 Switch 测试。

## 4. 验证与收口

- [x] 4.1 [P0] focused vitest（messages + settings）全绿；既有 messages 测试零回归。
- [x] 4.2 [P0] `openspec validate add-message-minimal-transcript-mode --strict --no-interactive`。
- [x] 4.3 [P1] tsc 类型检查。
- [x] 4.4 [P1] 人工目视：默认模式无变化；开开关后长 turn 只剩 chip+终稿；流式中实时可见；展开/折回正常。
