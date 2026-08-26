# add-message-minimal-transcript-mode

## Why

用户反馈（2026-08-25 群聊，用户「风尘化云烟」）：对话幕布一个 turn 完成后，**中间过程叙述文字太长**——
现状是每个 phase chip（`思考 N 次 · 工具调用 N 次`）之间仍完整渲染模型在工具/思考之间输出的
过程性 prose（"思路短文案"），长任务 turn 会出现十几段叙述，幕布长度远超最终答案本身。
Codex CLI 默认隐藏这类中间叙述，用户希望 ccgui 提供同等的**可配置隐藏**能力，想看时再自行展开。

产品结论（朱昆鹏）：做「极简展示」开关，设置里开入口。

## 目标与边界

- 新增 **Minimal Transcript Mode（极简展示）**：开启后，已完成 turn 把「user 消息之后、最终回答之前」
  的全部过程（reasoning / tool / explore + 中间叙述 prose）折叠为**单个 turn 级 chip**，
  锚定在最终回答上方；点击 chip 展开该 turn 完整过程。
- 与现有幕布**完全隔离切换**：默认模式（per-phase 折叠）行为零变化；开关即时生效、可随时切回。
- 设置入口：基础设置 → **外观** → 布局切换下方，新增 Switch（用户验收后指定位置）。
- 流式中的活跃 turn 保持现有 per-phase 实时可见行为（不折，保证可观察性）。

## 非目标

- 不改变默认模式的 per-phase 折叠粒度与 chip 文案。
- 不隐藏最终回答、文件变更条（Composer Run Status Strip，在时间线外）、approval / user-input 交互卡。
- 不做跨会话持久化的"按会话记忆展开态"（展开态沿用现有 `expandedProcessPhaseKeys`，切会话即清）。
- 不处理用户另提的 `~/.agents/skills` `@` 引用支持（独立需求，另开 change）。

## 方案取舍

| 选项 | 说明 | 取舍 |
| ------ | ------ | ------ |
| A per-phase 保留 + 隐藏中间 prose | 每个 chip 额外吃掉自己的锚点 prose | 否：折叠态 chip 靠 `assistantItemId` 锚定渲染，prose 隐藏后多 chip 锚点碰撞，需改投影层放置逻辑，侵入大 |
| **B turn 级整段折叠（选定）** | 完成 turn 折成单 chip，锚定最终 prose，复用现有 collapsed 放置路径 | 是：改动集中在 view model 一个分支，投影层零改动 |
| C 纯 CSS 视觉隐藏 | prose 保留 DOM 仅 `display:none` | 否：违反 Render Perf Baseline（折叠 MUST hard-unmount），长 turn 仍扛 DOM 成本 |

## What Changes

- `src/live-canvas/liveCanvasControls.ts`：新增 flag key `ccgui.messages.minimalTranscript`。
- `messagesViewModel.ts`：`resolveCollapsedTimelineItems` 新增 `minimalTranscriptEnabled` 分支——
  按 user 消息切 turn，已完成 turn 整段折叠为单 chip（含 proseCount 统计）；
  活跃尾部 turn 回落既有 per-phase 逻辑；`ProcessPhaseBreakdown` 增加 `proseCount`。
- `MessagesCore.tsx`：新增 `minimalTranscriptEnabled` state，复用
  `MESSAGES_LIVE_CONTROLS_UPDATED_EVENT` + `storage` 双通道监听，传给 view model。
- `MiddleStepsCollapsedChip.tsx` / `messagesTimelineProjection.ts` / `messagesTimelineModels.ts`：
  breakdown 增加 `proseCount`，chip 文案追加「叙述 N 段」。
- `BasicAppearanceSection.tsx`：外观页布局切换下方新增「极简展示」Switch（localStorage
  持久化 + 事件广播，模式同 `OtherSection` 的本地 flag 开关）。
- i18n：`settings.minimalTranscript*`、`messages.middleStepsStatNarration`，覆盖 zh / en / zh-TW /
  ja / ko / es / fr / hi / pt-BR / ru 全部 10 语言。
- 测试：view model 单测（turn 折叠/展开/流式活跃 turn 不折/无 prose turn 不折/单 prose turn 不折/
  默认模式零影响）+ 设置区开关测试。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `message-process-phase-collapse`：ADDED requirement —— 极简展示模式的 turn 级折叠契约（opt-in，
  默认 per-phase 行为不变）。

## Impact

- `src/live-canvas/liveCanvasControls.ts`
- `src/features/messages/orchestration/presentation/messagesViewModel.ts`
- `src/features/messages/components/MessagesCore.tsx`
- `src/features/messages/timeline/components/MiddleStepsCollapsedChip.tsx`
- `src/features/messages/timeline/projection/messagesTimelineProjection.ts`
- `src/features/messages/orchestration/models/messagesTimelineModels.ts`
- `src/features/settings/components/settings-view/sections/BasicAppearanceSection.tsx`
- `src/i18n/locales/*`（10 语言）
- 不命中 ADR 校准回写 Gate（纯表现层，不涉 engine registry / canonical fact / context compiler 等触发器）。

## 验收标准

- 默认（开关关）：幕布渲染与现状逐像素一致，现有 messages 测试全绿。
- 开关开：已完成 turn 只显示「turn chip + 最终回答」，中间叙述与过程全部 hard-unmount；
  点击 chip 展开完整过程，再点折回。
- 开关开 + 流式中：活跃 turn 的思考/工具/叙述保持实时可见，与默认模式一致。
- 设置页开关切换即时生效，无需重启；切会话后展开态清零（沿用现状）。
- 无 prose 的 turn（纯工具/错误收尾）不产生空 chip、不隐藏任何内容。
