# generic-tool-presentation Specification

## Purpose
TBD - created by archiving change decompose-generic-tool-presentation. Update Purpose after archive.
## Requirements
### Requirement: Generic tool presentation has one pure projection owner

Generic tool variant normalization MUST be built by a pure presentation function that does not
depend on React、i18n or component modules.

#### Scenario: tool item is projected

- **WHEN** a generic tool conversation item is prepared for rendering
- **THEN** normalized status、summary、parsed args、variant payload and hydration weight MUST come from one presentation model
- **AND** specialized components MUST NOT independently re-parse the source item

### Requirement: Specialized tool variants preserve behavior

ExitPlan、file-change and image-view variants MUST render through focused content components while
preserving the existing public props、DOM/a11y contract and user actions.

#### Scenario: ExitPlan variant renders

- **WHEN** an ExitPlan payload is recognized
- **THEN** plan sections、copy state and execution mode actions MUST match the existing behavior

#### Scenario: file-change variant renders

- **WHEN** a tool item contains file changes or diff/stat fallback data
- **THEN** paths、change kinds、diff preview and additions/deletions MUST match the existing behavior

#### Scenario: image-view variant renders

- **WHEN** an image-view-like item contains preview or local fallback candidates
- **THEN** preview loading and fallback rendering MUST match the existing behavior

### Requirement: Common shell and hydration remain centralized

`GenericToolBlock` MUST remain the owner of marker/title/status shell、expand/collapse、canonical copy、
heavy output hydration and variant dispatch.

#### Scenario: heavy generic output renders

- **WHEN** raw output exceeds the established hydration threshold
- **THEN** canonical copy data MUST remain available
- **AND** heavy detail MUST stay deferred until the existing reveal condition is met

#### Scenario: unknown tool renders

- **WHEN** no specialized variant matches
- **THEN** the generic fallback MUST preserve completed、processing and failed status behavior

### Requirement: Subagent tools may use persona presentation

When a tool item is recognized as a subAgent (`Agent` / `Task` or equivalent task-like type), the conversation canvas MUST be allowed to render it via the subagent persona card or squad grid presentation instead of the generic tool flat row as the primary surface.

#### Scenario: agent tool prefers persona surface

- **WHEN** a conversation tool item is classified as subAgent for canvas rendering
- **THEN** the primary visible surface MAY be the persona card or squad grid
- **AND** specialized ExitPlan / file-change / image-view variants MUST remain unaffected

#### Scenario: non-subagent tools unchanged

- **WHEN** a tool item is not classified as subAgent
- **THEN** generic tool presentation projection and GenericToolBlock ownership rules MUST remain unchanged

### Requirement: Classifiable tools MUST prefer specialized group or block presentation over unknown generic Tool

When a tool item's title/name classifies as read, edit, bash, or search under shared tool semantics, the conversation canvas MUST route it through the specialized group/block path. History projection that strips real names and forces large stacks of unknown generic `Tool` cards is NOT acceptable for known tool names such as `read_file`.

#### Scenario: known file read name is not generic-only

- **WHEN** a tool item title/name is `read_file` (or an equivalent read-classified name)
- **THEN** presentation MUST be eligible for Read tool block or read group rendering
- **AND** MUST NOT be forced into unknown generic `Tool` labeling solely because the item came from Grok history

#### Scenario: unknown true names still fall back generically

- **WHEN** a tool name is genuinely unknown and not classifiable
- **THEN** generic tool presentation remains allowed

#### Scenario: unknown name containing a specialized keyword stays generic

- **WHEN** a genuine tool name such as `get_command_or_subagent_output` contains
  `command` but is not an executable command tool
- **THEN** presentation MUST preserve the real name and generic arguments
- **AND** MUST NOT specialize it as `commandExecution` from substring matching alone

### Requirement: Collab lifecycle tool classification

系统 MUST 把 collab 工具按动作分类：spawn（含 `spawn agent`/`spawn_agent` 归一）进入 subAgent 分组；wait/close/输入转发等 MUST 保持普通工具渲染。

#### Scenario: underscore and space variants unified

- **WHEN** toolType 或标题使用下划线（`spawn_agent`）或空格（`spawn Agent`）变体
- **THEN** 分类结果 MUST 一致

### Requirement: Subagent group dedupe

同一小队分组内 MUST 对 launch 占位与 result 展开去重；同一逻辑子代理 MUST NOT 出现两张卡。

#### Scenario: kimi launch plus result in one group

- **WHEN** 分组内同时存在 `items` 占位卡与 XML 结果卡
- **THEN** 渲染 MUST 仅保留一组（优先结构化结果）

### Requirement: Subagent tools survive process-phase collapse

subAgent tool MUST NOT 被回合结束后的 process-phase 折叠吞没；卡片在回合完成后 MUST 仍留在幕布。

#### Scenario: final assistant message after parallel agents

- **WHEN** 并行 subAgent 完成后出现最终 assistant 正文
- **THEN** 小队卡片 MUST 仍可见（仅 reasoning/普通工具被折叠）

### Requirement: SubAgent primary surface excludes legacy agent-task card

When a tool item is classified as subAgent for canvas rendering, the conversation canvas MUST treat the persona / squad (S10) surface as the only primary completion chrome for that SubAgent. A sibling SubAgent-style `<task-notification>` message MUST NOT introduce a second completion card (legacy `message-agent-task-card`).

#### Scenario: Agent tool completion has single completion chrome

- **WHEN** a Claude Agent/Task tool item is rendered via subagentGroup and a SubAgent-style task-notification also appears in the same turn
- **THEN** the user-visible completion chrome MUST be the S10 card (or its process-phase collapsed host)
- **AND** the legacy Agent session card MUST NOT appear for that notification

