## MODIFIED Requirements

### Requirement: Process Phase Collapse MUST Use Contiguous Segmentation

对话幕布过程相位折叠 MUST 将每个有可见正文的 assistant message 只归属**紧挨在它正上方**的连续 collapsible process run（`reasoning` / `tool` / `explore`）。walk-back 遇到 user message、另一段 assistant 正文或其它非 process item 时 MUST 停止，MUST NOT 把同 turn 内更早、已被中间正文隔开的 process 并进终稿。
折叠态 MUST hard-unmount 该段 process rows，仅在对应 assistant 上方保留 `已处理 · …` chip；展开 MUST 只 remount 该段 process。
mid-turn assistant 正文 MUST 保留在时间线，作为分段边界。

#### Scenario: Multi-segment assistants each own the process above them

- **WHEN** 同一 user turn 内存在
  `tools1 → assistant(A1) → tools2 → assistant(A2)` 且各段可渲染 process 步数 `>= 1`
- **THEN** MUST 分别在 `A1`、`A2` 上方各挂一个 process phase chip
- **AND** `tools1` MUST 只归属 `A1`，`tools2` MUST 只归属 `A2`
- **AND** 折叠后时间线 MUST 仍按 `A1` 然后 `A2` 分段，不得把两段正文中间的过程抽空后贴成一堵墙

#### Scenario: Leading reasoning folds onto the adjacent plan text

- **WHEN** timeline 为
  `user → reasoning → assistant(plan) → tools/reasoning… → assistant(final)`
- **THEN** plan 上方 MUST 出现思考 chip，final 上方 MUST 出现后续工具/思考 chip
- **AND** 折叠后 MUST NOT 在 plan 文之上单独保留展开的孤儿 `思考过程` 行
- **AND** plan 与 final 正文 MUST 仍可见

#### Scenario: Single-step process including lone reasoning folds into the chip

- **WHEN** 某段 assistant 正上方仅有 1 个可渲染 process 步（含仅 1 条 reasoning / 思考过程）
- **THEN** MUST 创建 process phase chip（例如 `已处理 · 思考 1 次`）
- **AND** 该 process 行在折叠态 MUST hard-unmount
- **AND** Native 与 Shared 共用同一门槛，行为一致

#### Scenario: Trailing in-progress process stays live

- **WHEN** 最后一条 assistant 终稿之后仍有 running tool/explore
- **THEN** 这些 trailing process items MUST NOT 被并入已完成正文的 phase
- **AND** MUST 保持展开可见，直到触发既有 trailing 滚动窗口或后续终稿落地
