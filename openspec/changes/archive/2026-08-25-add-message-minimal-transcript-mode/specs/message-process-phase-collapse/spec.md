# message-process-phase-collapse Delta

## ADDED Requirements

### Requirement: Minimal Transcript Mode MUST Fold Completed Turns Into A Single Turn Chip

当用户通过设置开启极简展示（Minimal Transcript Mode，flag 默认关）时，对话幕布 MUST 把每个**已完成 turn** 中「user 消息之后、最终回答锚点 prose 之前」的全部 items（reasoning / tool / explore 过程 + 中间叙述 prose）折叠为**单个 turn 级 chip**，折叠态 MUST hard-unmount 全部隐藏行，chip MUST 锚定渲染在该 turn 最终回答 prose 正上方。
最终回答锚点 MUST 取该 turn 最后一条 `isFinal === true` 的 assistant prose；无 isFinal 时 MUST 取最后一条可见 assistant prose。最终回答 prose 本身 MUST NOT 被折叠。
本模式 MUST 为 opt-in：flag 关闭时幕布 MUST 保持既有 per-phase 折叠行为，逐行不变。

#### Scenario: Completed turn folds process and interstitial prose into one chip

- **WHEN** 极简展示开启，且某已完成 turn 的 timeline 为
  `user → reasoning/tools → assistant(叙述 A) → reasoning/tools → assistant(final)`
- **THEN** MUST 只生成一个 turn 级 chip，锚定在 `assistant(final)` 上方
- **AND** 全部过程行与叙述 A MUST hard-unmount
- **AND** `assistant(final)` 正文 MUST 保持可见
- **AND** chip 统计 MUST 计入被隐藏的叙述段数（proseCount）

#### Scenario: Expanding a turn chip remounts the full original process

- **WHEN** 用户点击某个已折叠的 turn chip
- **THEN** 该 turn 被隐藏的 process 行与中间叙述 prose MUST 全部 remount，按原始顺序呈现
- **AND** 该 turn 展开期间 MUST NOT 再生成 per-phase chip
- **AND** 再次点击 MUST 折回单 chip 形态

#### Scenario: Active streaming tail turn stays live

- **WHEN** 极简展示开启，且尾部 turn 仍在进行（`isThinking === true`）
- **THEN** 该尾部 turn MUST 保持既有 per-phase 实时折叠行为，过程与中间叙述按现状实时可见
- **AND** 更早的已完成 turn MUST 仍按 turn 级折叠

#### Scenario: Turn without interstitial content produces no chip

- **WHEN** 极简展示开启，且某已完成 turn 仅含单条 assistant prose（无过程、无中间叙述）
- **THEN** MUST NOT 生成空 chip，该 prose MUST 正常显示

#### Scenario: Turn without any prose is never folded

- **WHEN** 极简展示开启，且某 turn 不含任何可见 assistant prose（纯工具或错误收尾）
- **THEN** MUST NOT 折叠该 turn 的任何 item，MUST NOT 生成 chip

#### Scenario: Mode toggle is isolated and immediate

- **WHEN** 用户在设置中切换极简展示开关
- **THEN** 幕布 MUST 当场按新模式重算折叠，无需重启
- **AND** 关闭开关后 MUST 完整恢复既有 per-phase 折叠渲染
