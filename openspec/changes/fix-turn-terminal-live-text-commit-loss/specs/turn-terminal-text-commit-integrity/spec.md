## ADDED Requirements

### Requirement: Turn Terminal Barrier MUST NOT Drop Committed-Before-Barrier Text Events

When a turn reaches terminal settlement, every assistant text event that arrived before the terminal barrier MUST be committed to durable items before the barrier is installed. The system MUST synchronously drain in-flight realtime batching queues (including the contract batcher) at terminal flush time, so a later cadence flush MUST NOT observe those events after the barrier and drop them.

#### Scenario: final text burst within the batching window survives terminal

- **WHEN** the final assistant text segment streams and its last deltas are still coalesced in the realtime batching queue
- **AND** `turn/completed` (or equivalent terminal settlement) is processed, installing the terminal barrier
- **THEN** the pending deltas MUST be committed to durable items synchronously before the barrier
- **AND** the durable assistant body after settlement MUST equal the full streamed text

#### Scenario: cadence flush after the barrier must not see stale pending deltas

- **WHEN** terminal flush drains the batching queue
- **AND** the cadence timer fires afterwards
- **THEN** the cadence flush MUST be a no-op for the drained events
- **AND** MUST NOT re-apply or drop them as late events

#### Scenario: legacy queues and contract batcher drain together at terminal

- **WHEN** turn terminal flush runs
- **THEN** both the direct-route delta queue (`pendingRealtimeDeltaOpsRef`) and the normalized-route contract batcher pending deltas MUST be flushed synchronously
- **AND** neither MAY be deferred via `startTransition` past the barrier

### Requirement: Terminal-Late Assistant Completion MUST Be Salvaged, Not Dropped

When a `completeAgentMessage` event for an assistant message arrives after the turn terminal barrier (cross-channel reorder), the system MUST salvage it into durable items instead of silently dropping it, provided the event carries non-empty assistant text. The salvage MUST NOT re-activate processing or the active turn lifecycle.

#### Scenario: late completeAgentMessage after barrier restores full body

- **WHEN** a turn is already terminal (barrier installed)
- **AND** a `completeAgentMessage` event with the full assistant text arrives afterwards
- **THEN** the system MUST merge the full text into the durable assistant item
- **AND** MUST NOT mark the thread processing again
- **AND** MUST NOT restore the active turn id

#### Scenario: late non-completion events remain dropped

- **WHEN** a turn is terminal
- **AND** a late `appendAgentMessageDelta` (or other non-terminal event) arrives
- **THEN** the system MUST keep dropping it as a late event (existing behavior)
- **AND** MUST NOT treat incremental deltas after a barrier as salvage

#### Scenario: salvage does not duplicate completed bodies

- **WHEN** a completed body was already committed before the barrier
- **AND** an equivalent late `completeAgentMessage` arrives
- **THEN** the visible assistant cardinality MUST remain one
- **AND** the merge MUST NOT duplicate prose

### Requirement: Durable Assistant Body MUST NOT Freeze at a Streamed Prefix While History Is Complete

After turn settlement, with the session still open, the visible durable assistant body MUST match the complete streamed body. A final bubble MUST NOT freeze at the first-token shell (e.g. a two-character prefix) while reopening history shows the full text.

#### Scenario: no partial-freeze after normal turn completion

- **WHEN** a turn completes normally and its final segment streamed within the batching window
- **THEN** the assistant bubble after settlement MUST show the full text
- **AND** the user MUST NOT need to reopen history to see the complete body

#### Scenario: final metadata does not hide missing body

- **WHEN** a message displays final metadata (duration, completion footer)
- **THEN** the message MUST also display the complete body text
- **AND** a shell-only bubble with final metadata MUST be treated as a defect
