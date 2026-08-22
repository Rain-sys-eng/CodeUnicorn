## ADDED Requirements

### Requirement: Handoff Claim SHALL Optimistically Leave The Composer Queue Strip

当 Codex queued follow-up 进入 handoff / in-flight 派发时，系统 MUST 在同一同步 handoff 窗口内将该 item 从 composer 队列条（queue strip）移除。队列条与 handoff bubble MUST NOT 同时作为同一条消息的可见 owner。

#### Scenario: drain start removes strip item immediately

- **GIVEN** Codex 实时线程 queue head 为消息 M
- **WHEN** auto-drain 为 M 创建 handoff bubble 并开始 dispatch
- **THEN** composer queue strip MUST 立即不再渲染 M
- **AND** 幕布 MUST 显示 M 的 handoff（或后续真实 user bubble）之一

#### Scenario: dispatch failure restores strip without handoff residue

- **GIVEN** M 已乐观出队并创建 handoff
- **WHEN** dispatch 失败或 blocked
- **THEN** 系统 MUST 将 M 以原 id 恢复到该 thread 队列
- **AND** 系统 MUST 清除该 thread 的 handoff bubble state
- **AND** 幕布 MUST NOT 继续展示 M 的 handoff 残留

### Requirement: Handoff State SHALL Clear When Real User Item Is Visible

系统 MUST 在 timeline 已存在与 handoff 等价的 user message（optimistic 或 authoritative）时，主动将 `queuedHandoff` state 置空。仅「append 时跳过插入」不足；MUST 清理 handoff state 本身。

#### Scenario: optimistic user clears handoff state

- **GIVEN** thread 存在 handoff bubble state 对应消息 M
- **WHEN** 等价 optimistic user item 已进入 conversation items
- **THEN** 系统 MUST 将 handoff state 设为 null
- **AND** 幕布 MUST 只保留一份 M

#### Scenario: authoritative history clears handoff state

- **GIVEN** thread 存在 handoff bubble state 对应消息 M
- **WHEN** history 中到达等价 authoritative user item
- **THEN** 系统 MUST 将 handoff state 设为 null
- **AND** 幕布 MUST 只保留一份 M

## MODIFIED Requirements

### Requirement: Handoff Bubble SHALL Deduplicate Cleanly With Optimistic Or Authoritative User Items

系统 MUST 在 handoff bubble 只承担过渡可见性的前提下，与后续真实 user item 平滑去重，避免重复气泡，并 MUST 在去重成立时清理 handoff state（不仅是跳过 append）。

#### Scenario: optimistic user item replaces handoff bubble without duplication

- **GIVEN** 当前线程存在 handoff bubble
- **WHEN** 对应的 optimistic user item 已经插入消息时间线
- **THEN** 系统 MUST 清理 handoff bubble state
- **AND** 幕布 MUST 只保留一份最新用户消息

#### Scenario: authoritative history user item replaces handoff bubble without duplication

- **GIVEN** 当前线程存在 handoff bubble
- **WHEN** 对应的 authoritative history user item 在后续 refresh 中到达
- **THEN** 系统 MUST 清理 handoff bubble state
- **AND** 系统 MUST NOT 渲染两份内容等价的 latest user bubble
