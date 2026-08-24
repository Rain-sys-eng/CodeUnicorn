## MODIFIED Requirements

### Requirement: Shared parent replaces hidden native owner

Shared 场景下，子会话 parent 指向被隐藏的 native owner 时，系统 MUST 能用 parent-id（含 raw / `engine:raw` 变体，engine ∈ Claude / Codex / Grok / Kimi / OpenCode）识别该子会话属于 Shared 执行树，并可选择将 `parentThreadId` 对齐到对应 `shared:`（辅助识别；**不是**侧栏清洁的充分条件）。

#### Scenario: parent id variants resolve to shared owner

- **WHEN** Shared 的 hidden native owner 记为 `codex:{uuid}`（或 raw）
- **AND** 子会话 parent 为对端形态
- **THEN** 系统 MUST 能将 parent 识别为该 Shared 的 owned subagent parent

## ADDED Requirements

### Requirement: Shared sidebar hides owned subagent pups

工作区**侧栏会话列表** MUST 隐藏 Shared-owned 子代理会话（下崽）。判定依据为 parent-id 匹配：parent 为 `shared:*`，或 parent 命中 Shared hidden native owner 的 id 变体。系统 MUST NOT 仅靠改挂嵌套来冒充清洁——侧栏 MUST NOT 展示这些崽子为顶层根，也 MUST NOT 在展开 Shared 时展示为可见子行。

隐藏动作 MUST 限于侧栏树投影（`useThreadRows` 或等价 UI 层）。系统 MUST NOT 因此从 threads store 删除子会话摘要（幕布 subAgent 正常规则、Strip / `childSubagentThreads` 仍可消费）。系统 MUST NOT 放宽 Shared Hidden Native Binding 的 id hide 规则，MUST NOT 改变幕布内 subAgent tool/persona 的既有展示契约。

#### Scenario: shared codex pups hidden from sidebar by parent id

- **WHEN** Shared Codex 的 hidden native owner 为 `codex:{uuid}`（或 raw）
- **AND** 子会话 parent 为对端形态或已对齐为 `shared:…`
- **THEN** 侧栏 MUST NOT 展示该子会话（含顶层与 Shared 展开子行）
- **AND** threads store MAY 仍保留该子会话摘要

#### Scenario: native subagent tree stays visible

- **WHEN** 子会话 parent 指向普通可见 native 父会话（非 Shared owner）
- **THEN** 侧栏 MUST 继续在该 native 父下展示子会话

#### Scenario: canvas subagent rules unchanged by sidebar hide

- **WHEN** 侧栏隐藏 Shared 下崽
- **THEN** 幕布内既有 subAgent tool / persona 展示规则 MUST NOT 因本隐藏而改写

#### Scenario: missing parent metadata is not inferred

- **WHEN** 子会话没有 authoritative parent 元数据
- **THEN** 系统 MUST NOT 仅凭标题、昵称推断为 Shared 下崽并隐藏
