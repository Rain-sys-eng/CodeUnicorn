## Why

对话幕布当前把同一个 user turn 内**全部** `reasoning` / `tool` / `explore` 并进终稿 assistant 的单一 `已处理` chip（turn-final ownership）。长回合会变成：

```text
assistant 段 1
assistant 段 2
…
assistant 终稿
已处理 · 思考 21 次 工具调用 198 次 ›
```

中间过程从时间线抽走后，多段正文贴成一堵墙，用户无法按「想 → 做 → 说」回看因果。这是 2026-08-02 `fix-native-process-phase-orphan-reasoning` 为消孤儿思考而接受的 trade-off，现场证明对长工具回合不可用。

## 目标与边界

- 目标：过程相位改回 **contiguous walk-back**——每段有可见正文的 assistant 只折叠**紧挨在它正上方**的连续 process run。
- 目标：多段回合呈现为时间线穿插：
  `user → [chip A] → 正文 A → [chip B] → 正文 B → trailing live process`
- 目标：保留 hard-unmount、shell hide、单步思考也进 chip、trailing 超阈值滚动折叠。
- 边界：只改 Messages 折叠归属（`resolveCollapsedTimelineItems`）与对应 spec / focused tests；不改 engine adapter、Shared projector、IPC。

## 非目标

- 不自动判定「计划句 vs 实质结论」并隐藏 mid-assistant。
- 不把整轮 198 次工具再收成一个终稿 chip。
- 不改 shell hide、file-IO 计入、ReasoningRow 单行展开。
- 不改 trailing in-progress 的「超 5 张卡留 3 张」窗口。

## What Changes

- `messagesViewModel.ts`：用 contiguous collect 替换 `collectTurnProcessItemsForFinalAssistant`。
- `messagesViewModel.collapseMiddleSteps.test.ts`：多段 assistant 各挂自己的 chip；孤儿思考归到紧挨的 plan 文，不再跨段并进终稿。
- OpenSpec：`message-process-phase-collapse` 从 turn-final ownership 改为 contiguous segmentation。

## Capabilities

### Modified Capabilities

- `message-process-phase-collapse`：过程相位按 assistant 段连续归属，不再 turn-final 整轮合并。

## Impact

- Native live + 任何走同一 `resolveCollapsedTimelineItems` 的路径（含 Shared 重载后的终稿形态）。
- 产品语义：长回合可按段回看；短问答（单段正文 + 其前过程）外观不变。
- 无 backend / DB / IPC 变更。

## 验收标准

1. `tools1 → A1 → tools2 → A2` 折叠后出现两个 chip，分别挂在 A1 / A2 上方；A1 与 A2 正文不被抽走，也不贴成无间隔墙。
2. `reasoning → A-plan → tools → A-final`：plan 上方是思考 chip，final 上方是工具 chip；展开各自 remount 自己的 process。
3. 单步思考 / 单工具仍进 chip；trailing running tool 仍保持展开（或走既有滚动窗口）。
4. focused Vitest 全绿。
