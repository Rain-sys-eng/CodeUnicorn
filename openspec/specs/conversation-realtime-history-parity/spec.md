# conversation-realtime-history-parity Specification

## Purpose

Defines the conversation-realtime-history-parity behavior contract, covering Realtime And History Paths MUST Preserve Visible Transcript Parity.
## Requirements
### Requirement: Realtime And History Paths MUST Preserve Visible Transcript Parity

realtime stream, completed settlement, history hydrate, and history reconcile MUST converge equivalent conversation facts to the same visible transcript semantics.

#### Scenario: realtime and history produce the same visible row cardinality

- **WHEN** a turn has already rendered through realtime stream and completed settlement
- **AND** the user reopens the same thread through history hydrate
- **THEN** the visible row cardinality for equivalent user, assistant, reasoning, tool, and control facts MUST remain stable
- **AND** history hydrate MAY only backfill canonical ids, timestamps, metadata, or structured facts

#### Scenario: history reconcile does not become primary duplicate repair

- **WHEN** completed settlement provides an equivalent final assistant snapshot after streaming deltas
- **THEN** local realtime settlement MUST converge the assistant fact before any later history refresh
- **AND** history reconcile MUST NOT be required to remove obvious duplicate assistant prose

#### Scenario: completed snapshot does not append streamed body twice

- **WHEN** an assistant response has streamed visible text
- **AND** a completed payload provides an equivalent final body
- **THEN** the system MUST canonicalize or replace the live fact
- **AND** MUST NOT append the final body as duplicate prose

### Requirement: User Bubble Parity MUST Collapse Optimistic And Authoritative Equivalents

optimistic, queued handoff, shared session, and authoritative history user observations MUST converge when they represent the same user intent.

#### Scenario: queued follow-up bubble converges with authoritative user item

- **WHEN** a queued follow-up is shown optimistically
- **AND** the authoritative user item arrives with equivalent normalized text
- **THEN** the system MUST keep one visible user bubble
- **AND** the authoritative item MAY replace local ids or metadata

#### Scenario: injected context does not create duplicate user rows

- **WHEN** authoritative history includes project memory, note-card, selected-agent, or shared-session wrappers
- **AND** the optimistic user bubble contained only the user-visible intent
- **THEN** normalization MUST treat them as equivalent user facts
- **AND** the visible transcript MUST NOT show duplicate user bubbles

#### Scenario: distinct user messages remain distinct

- **WHEN** two user observations are not equivalent after wrapper stripping and semantic comparison
- **THEN** both messages MUST remain visible
- **AND** parity logic MUST NOT collapse them only because their text is partially similar

### Requirement: Assistant And Reasoning Parity MUST Use Shared Semantic Equivalence

assistant and reasoning facts MUST use shared equivalence rules across realtime, completed, and history sources.

#### Scenario: assistant history replay does not duplicate realtime answer

- **WHEN** realtime path already displayed an assistant answer
- **AND** history replay provides equivalent assistant content
- **THEN** history hydrate MUST converge with the existing assistant fact
- **AND** MUST NOT add a second assistant row with the same body

#### Scenario: reasoning snapshots converge across carriers

- **WHEN** reasoning content arrives as realtime summary, thinking content, completed snapshot, or history hydrate
- **AND** the normalized reasoning content is equivalent for the same turn
- **THEN** the system MUST converge it to one reasoning fact
- **AND** engine-specific display titles MUST NOT change duplicate judgment

#### Scenario: distinct reasoning steps remain distinct

- **WHEN** two reasoning observations describe different steps
- **THEN** the system MUST keep them as distinct reasoning facts
- **AND** shared prefixes or similar wording MUST NOT force a merge

### Requirement: Structured Tool And Control Facts MUST Replay Consistently

structured tool facts and user-readable control events MUST retain their transcript role across realtime and history.

#### Scenario: file changes replay as structured tool facts

- **WHEN** file changes were shown during realtime execution
- **AND** history hydrate replays the same file changes
- **THEN** the system MUST render them as structured tool/file-change facts
- **AND** MUST NOT replay internal resume markers as assistant prose

#### Scenario: modeBlocked remains a control event after history reopen

- **WHEN** a turn entered `modeBlocked` during realtime execution
- **AND** the thread is reopened from history
- **THEN** `modeBlocked` MUST remain a compact control event
- **AND** MUST NOT appear as ordinary assistant text

#### Scenario: request_user_input settled state survives history hydrate

- **WHEN** a `request_user_input` was submitted, timed out, dismissed, cancelled, or marked stale
- **AND** history hydrate replays the thread
- **THEN** the settled state MUST be preserved or reconstructed
- **AND** the request MUST NOT become actionable again unless a new request was emitted

### Requirement: Presentation State MUST Not Become Durable Transcript Fact

presentation-only state MUST remain outside durable transcript parity checks, and restoring-history presentation MUST derive from an actual history restore lifecycle rather than provisional thread identity.

#### Scenario: history loading placeholder does not persist as message

- **WHEN** the UI shows a history loading, live placeholder, spinner, or scroll/sticky affordance
- **THEN** that state MUST be classified as presentation-state
- **AND** it MUST NOT become a durable transcript row after hydrate or reopen

#### Scenario: Codex history loading state is scoped presentation state

- **WHEN** the user selects an unloaded Codex history conversation and no visible items are available yet
- **THEN** the message surface MAY show a scoped restoring-history status instead of the generic empty-thread placeholder
- **AND** that status MUST clear when history restore settles or the selected thread changes
- **AND** the restoring-history status MUST NOT be persisted, replayed, or counted as a conversation item

#### Scenario: freshly created pending draft is not history loading

- **WHEN** the user creates a new conversation whose provisional thread identity is pending
- **AND** the draft has no visible conversation items yet
- **THEN** the message surface MUST present the normal empty conversation state
- **AND** it MUST NOT infer restoring-history status from the pending identity alone

#### Scenario: Markdown presentation convergence does not change fact identity

- **WHEN** live rendering uses throttled Markdown, staged Markdown, or plain-text fallback
- **THEN** completion MUST converge to final Markdown presentation
- **AND** the presentation strategy MUST NOT create extra dialogue facts

### Requirement: Shared realtime and history MUST preserve reasoning parity

Shared Session MUST preserve normalized reasoning facts across realtime rendering, snapshot persistence, canonical/legacy dual-read, and history reload. History convergence MUST use the same Conversation assembler equivalence semantics as Native Session and MUST NOT drop a reasoning fact merely because the canonical projection lacks that fact.

#### Scenario: realtime reasoning survives shared history reload
- **WHEN** a Shared Turn renders one or more reasoning items in realtime and the Shared snapshot persists those items
- **THEN** reopening the Shared Session MUST render the same reasoning facts in the same Turn order
- **AND** canonical identity overlay MUST NOT remove those reasoning facts

#### Scenario: canonical and legacy reasoning do not duplicate
- **WHEN** equivalent reasoning exists in both canonical projection and Legacy presentation snapshot
- **THEN** history convergence MUST produce one equivalent reasoning fact
- **AND** MUST preserve the more complete visible content

### Requirement: Shared terminal final MUST cross the durable settlement boundary

When live assistant text is externalized from the root reducer, a Shared Turn's authoritative terminal final MUST be settled into the same assistant item before terminal lifecycle state permits snapshot persistence. Observing one or more streaming deltas MUST NOT be treated as equivalent to observing a completed assistant final.

#### Scenario: streaming prefix is replaced by terminal final
- **WHEN** a Shared Turn emits an assistant streaming prefix and `turn/completed` later carries the complete provider final
- **THEN** the complete final MUST settle the same assistant item exactly once
- **AND** the persisted Shared snapshot MUST contain the complete final rather than the prefix-only shell

#### Scenario: item completion remains idempotent
- **WHEN** a Shared Turn emits both an assistant `item/completed` event and a later `turn/completed` payload with equivalent text
- **THEN** completion tracking MUST keep one assistant final
- **AND** the terminal fallback MUST NOT append a duplicate message

#### Scenario: live text externalization retains its performance boundary
- **WHEN** the assistant emits multiple realtime text deltas before completion
- **THEN** only the existing bounded live-text path MAY process per-delta growth
- **AND** this durability fix MUST NOT restore per-delta root reducer dispatch

### Requirement: Grok live versus history tool visibility MAY differ by protocol capability

For Grok sessions that use headless `streaming-json` (text/thought/end/error only), the live canvas MAY omit tool rows while tools are executing. After history hydrate from `chat_history.jsonl`, tool rows that exist on disk MUST become visible with real tool names. This live/history tool cardinality difference MUST NOT be treated as a parity defect.

#### Scenario: live turn without tool events is acceptable for Grok

- **WHEN** a Grok turn streams thought and/or text without tool events
- **AND** tools are only recorded in history files
- **THEN** the live canvas MUST NOT be required to invent tool rows
- **AND** history hydrate MUST surface those tools with non-generic names when the wire provides them

#### Scenario: history hydrate does not degrade all Grok tools to generic Tool

- **WHEN** history hydrate loads Grok tool_calls with real names such as `read_file` or `grep`
- **THEN** the visible tool timeline MUST preserve those names for classification and grouping
- **AND** MUST NOT render the stack as generic `Tool` cards solely due to a nested-`function` parse assumption

### Requirement: Running Shared live projection MUST survive conversation navigation

When a Shared Turn remains in progress, changing the active conversation MUST NOT detach the canonical Shared thread from its realtime assistant projection. The first assistant delta MUST establish a stable assistant item identity independently of active-thread presentation scheduling, subsequent body growth MUST remain on the bounded live-text path, and returning to the Shared thread MUST expose the latest published live text without requiring durable history reload.

#### Scenario: user leaves before the first assistant delta

- **WHEN** a Shared Turn is processing and the user activates another conversation before the first assistant delta arrives
- **THEN** the first delta MUST establish exactly one assistant shell on the canonical Shared thread
- **AND** the system MUST continue routing subsequent live text to that shell while the Shared thread is inactive

#### Scenario: user returns while the Shared Turn is still running

- **WHEN** an inactive Shared thread has accumulated published live assistant text and the user activates that Shared thread again
- **THEN** the conversation canvas MUST render the existing assistant shell with the latest published live text
- **AND** activation MUST NOT depend on a full canonical history reload

#### Scenario: Shared Turn completes while inactive

- **WHEN** a Shared Turn receives its authoritative terminal final while another conversation is active
- **THEN** the terminal final MUST settle into the same assistant item exactly once
- **AND** reopening the Shared thread MUST NOT show a prefix-only shell or duplicate assistant final

#### Scenario: navigation recovery preserves the render performance boundary

- **WHEN** multiple assistant body deltas arrive while the Shared thread is inactive or after it is reactivated
- **THEN** only first-shell, activation handoff, and terminal settlement MAY update structural reducer state
- **AND** subsequent body growth MUST NOT restore per-delta root reducer dispatch
- **AND** Shared activation MUST NOT synchronously flush pending operations owned by unrelated threads

### Requirement: Live Settlement And History Upsert MUST Not Duplicate Equivalent Assistant Rows

When live completed settlement has already stored an assistant final body, a later history hydrate or `upsertItem` of an equivalent assistant snapshot MUST NOT create a second visible assistant row on Native or Shared threads. History MAY canonicalize id, timestamps, or metadata onto the existing row.

#### Scenario: shared live final then history upsert same body

- **WHEN** a Shared thread has a live `completeAgentMessage` assistant final
- **AND** history projection upserts an equivalent assistant message with a different id
- **THEN** visible assistant cardinality for that semantic response MUST remain one
- **AND** history reconcile MUST NOT be required as the only repair

#### Scenario: native live final then history upsert same body

- **WHEN** a Native Claude (or other non-Codex) thread has a live final assistant message
- **AND** an equivalent history snapshot arrives with another id
- **THEN** conversation state MUST keep a single assistant message for that response

