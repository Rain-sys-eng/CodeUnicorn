# add-minimal-transcript-live-turn-fold

## Why

极简展示（`add-message-minimal-transcript-mode`，2026-08-25 已归档）上线后用户目视验收发现：
**历史 turn 折叠符合预期，但流式中的活跃 turn 仍走 per-phase 实时折叠**——中间叙述 prose
在流式期间全程可见，长任务 turn 的幕布在生成过程中依然被过程性叙述撑得很长，
与「极简」的产品预期不一致。用户明确要求：实时段落也参与折叠。

## 目标与边界

- 极简展示开启时，**流式中的活跃尾部 turn 也整段折叠**：已落定的过程（reasoning / tool /
  explore）与中间叙述 prose 实时收进**单个 live turn chip**，幕布上只保留
  「live chip + 当前生长中的 prose + 尾部滚动窗口」。
- live chip 锚定在当前生长中的 prose 上方；尚无 prose（纯工具跑动中）时锚定尾部窗口
  第一个可见 entry（复用 trailing chip 的 `collapsedAnchorItemId` 放置路径）。
- 极简模式的 trailing 滚动窗口阈值单独取 **4**（`TRAILING_PROCESS_COLLAPSE_THRESHOLD = 5`
  为默认模式常数，保持不动）；可见尾部 3 不变。
- turn 完成瞬间，live chip 自然切换为既有 `turn:${finalAnchor.id}` chip；
  用户在流式中展开过 live chip 时，展开态 MUST 迁移，不得在完成瞬间突然折回。

## 非目标

- 不改变默认模式（flag 关）的任何行为：per-phase 折叠、trailing 阈值 5、chip 文案全部不变。
- 不改变已完成 turn 的折叠规则与 `turn:` phaseKey 命名。
- 不引入新设置项、新 flag、新 i18n key（复用既有极简开关与「叙述 N 段」文案）。
- 不做「连当前生长中的 prose 也折叠」的激进模式（用户已拍板：生长中 prose 保持可见）。

## 方案取舍

| 选项 | 说明 | 取舍 |
| ------ | ------ | ------ |
| A 流式回落 per-phase（现状） | 活跃 turn 不折 | 否：用户明确否决，叙述 prose 流式全程可见不极简 |
| **B live turn chip（选定）** | 活跃 turn 已落定部分实时折成单 chip，锚定生长中 prose | 是：复用 turn chip 折叠/展开与投影层放置路径，改动集中在 view model 一个分支 |
| C 流式也等完成再折 | 完成瞬间一次性折 | 否：与现状无差，未解决流式期间幕布过长 |

## What Changes

- `messagesViewModel.ts`：
  - `resolveMinimalTranscriptCollapsedTimeline` 的 `isThinking` 分支不再回落
    `collectProcessPhaseCollapsedTimeline`，改为 `foldLiveTurn`：segment 内 live anchor
    （最后一条可见 assistant prose）之前的过程 + 中间叙述整段折叠；anchor 之后
    （或无 anchor 时整段）走 trailing 窗口，阈值取极简专用常数 4。
  - 新增 `MINIMAL_TRANSCRIPT_TRAILING_COLLAPSE_THRESHOLD = 4`；默认模式
    `TRAILING_PROCESS_COLLAPSE_THRESHOLD = 5` 不变。
  - live chip `phaseKey = liveturn:${precedingUserMessageId ?? "start"}`（turn 周期内稳定）；
    turn 完成分支把 `liveturn:` key 作为展开态迁移源传入 `foldCompletedTurn`。
- 测试：`messagesViewModel.minimalTranscript.test.ts` 追加流式用例。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `message-process-phase-collapse`：MODIFIED requirement —— 「Minimal Transcript Mode
  MUST Fold Completed Turns Into A Single Turn Chip」扩展覆盖流式活跃 turn 的
  live 折叠契约；原「Active streaming tail turn stays live」scenario 被反转替换。

## Impact

- `src/features/messages/orchestration/presentation/messagesViewModel.ts`
- `src/features/messages/orchestration/presentation/messagesViewModel.minimalTranscript.test.ts`
- 投影层 / chip 组件 / 设置页 / i18n：零改动（全部复用既有路径）。
- 不命中 ADR 校准回写 Gate（纯表现层 view model 变更）。

## 验收标准

- 极简开启 + 流式中：幕布只显示「live chip + 当前生长 prose + ≤3 条尾部过程」；
  已落定过程与中间叙述全部 hard-unmount，chip 计数（含「叙述 N 段」）随流式增长实时刷新。
- 流式中展开 live chip：已落定过程与叙述全部 remount；turn 完成后 chip 保持展开，不突然折回。
- 尚无 prose 的活跃 turn：过程 entry 数 ≤ 4 全可见；> 4 时隐藏至仅剩尾部 3 条，
  chip 锚定第一个可见尾部 entry 上方。
- 极简开启 + 非流式（历史）：与现状完全一致。
- 默认模式（flag 关）：逐行不变，既有 messages 测试全绿。
