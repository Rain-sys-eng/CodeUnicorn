# codex-queued-user-bubble-continuity Specification

## Purpose

TBD - synced from change fix-codex-queued-user-bubble-gap. Update Purpose after archive.
## Requirements
### Requirement: Codex Queued Follow-up Handoff SHALL Preserve A Visible Latest User Bubble

系统 MUST 在 `Codex` 实时 turn 结束并自动进入 queued follow-up 时，持续提供一条可见的 latest user bubble，而不能出现“queue 已移除、幕布却没有该消息”的空窗。

#### Scenario: queue auto-drain creates an immediate visible handoff bubble
- **GIVEN** 当前线程是 `Codex` 实时会话
- **AND** 当前线程存在待自动发送的 queued follow-up
- **WHEN** 当前 turn 结束并触发 queue auto-drain
- **THEN** 系统 MUST 在 queue item 脱离排队区的同一 handoff 窗口内让最新用户消息在幕布中可见
- **AND** 系统 MUST NOT 等到 history refresh 完成后才第一次显示这条消息

#### Scenario: handoff visibility survives until a real user message item arrives
- **GIVEN** 当前线程已经进入 queued follow-up handoff
- **WHEN** optimistic user item 尚未插入且 authoritative history user item 也尚未返回
- **THEN** 系统 MUST 保持 latest user bubble 可见
- **AND** 该可见状态 MUST 不依赖 queue 区域是否仍保留该条消息

### Requirement: Previous-Turn Reconcile SHALL Not Hide Next-Turn Queued User Visibility

系统 MUST 确保上一轮 `Codex` turn completion 触发的 history reconcile 不会在下一轮 queued follow-up handoff 期间把最新用户消息从幕布中吃掉。

#### Scenario: old-turn reconcile does not remove the visible queued follow-up bubble
- **GIVEN** 当前线程的上一轮 `Codex` turn 已完成并触发 history reconcile
- **AND** 下一轮 queued follow-up 已开始 handoff 但真实 user item 仍未稳定落地
- **WHEN** reconcile 在该窗口内执行
- **THEN** 系统 MUST NOT 让 latest user bubble 从幕布中短暂消失
- **AND** 系统 MUST 保持 handoff bubble 或等价的可见 user item 直到真实消息可接管

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

### Requirement: Continuity Handling SHALL Remain Frontend-Scoped And Codex-Scoped

系统 MUST 将该修复限制在前端 handoff 编排层和 `Codex` 路径，不通过新增 runtime contract 来解决。

#### Scenario: continuity fix does not require new backend contracts
- **WHEN** 系统实现 `Codex` queued user bubble continuity
- **THEN** 系统 MUST NOT 新增 Tauri command、Rust payload 字段或持久化 schema
- **AND** 现有 history loading contract MUST 保持不变

#### Scenario: non-Codex providers do not regress because of Codex continuity handling
- **WHEN** 当前线程不是 `Codex` 实时会话
- **THEN** 系统 MUST NOT 因该修复误引入 provider 范围外的 handoff bubble 行为
- **AND** 现有非 `Codex` provider 的消息时间线语义 MUST 保持不变

### Requirement: Codex Queued Follow-Up User Bubble Continuity

Codex queued follow-up handoff MUST preserve exactly one visible user bubble for the queued message while runtime send and history reconcile converge.

#### Scenario: queued follow-up creates visible handoff bubble

- **WHEN** a non-command queued Codex follow-up is flushed to the active thread
- **THEN** the client MUST expose a thread-scoped optimistic user bubble for the queued message
- **AND** the bubble MUST preserve text, images, collaboration mode, selected agent metadata, and browser context attachment metadata when provided

#### Scenario: stale history reconcile does not create a zero-bubble gap

- **WHEN** Codex realtime history reconcile is scheduled before authoritative history contains the queued follow-up user message
- **AND** the local thread still contains a pending optimistic queued user bubble
- **THEN** the client MUST delay or skip destructive reconciliation for that attempt
- **AND** the visible timeline MUST continue to contain the queued follow-up user bubble

#### Scenario: authoritative history replaces optimistic bubble without duplicates

- **WHEN** refreshed Codex history contains a user message equivalent to the queued follow-up
- **THEN** the client MUST remove the optimistic queued bubble residue
- **AND** the visible timeline MUST contain exactly one matching user bubble
- **AND** that remaining bubble SHOULD use the authoritative history item id
