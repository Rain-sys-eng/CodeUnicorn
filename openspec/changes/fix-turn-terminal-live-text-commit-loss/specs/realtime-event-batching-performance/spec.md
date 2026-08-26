## MODIFIED Requirements

### Requirement: Terminal Events MUST Flush Pending Batches

Turn completion, interruption, error, and dedup settlement MUST flush pending deltas before final state is committed. This includes draining the contract realtime batcher synchronously at terminal settlement time — not only when a terminal event (`completeAgentMessage` / `itemCompleted`) passes through the batcher. `turn/completed` and equivalent terminal settlement paths MUST also drain pending deltas (including deltas coalesced under a different operation key) before the terminal barrier is installed, so a later cadence flush does not drop them as late events.

#### Scenario: completion flushes pending deltas

- **WHEN** a terminal event arrives while deltas are pending
- **THEN** pending deltas MUST be applied before the terminal state is visible

#### Scenario: turn/completed drains deltas pending under the contract batcher

- **WHEN** `turn/completed` is processed while the final segment's deltas are still coalesced in the contract batcher (arrived within the 32ms cadence window)
- **THEN** the terminal settlement path MUST drain those deltas synchronously before installing the terminal barrier
- **AND** a subsequent cadence flush MUST NOT drop them as late events

#### Scenario: terminal barrier never separates pending deltas from their final text

- **WHEN** terminal settlement drains pending deltas
- **THEN** the committed durable assistant body MUST equal the full streamed text
- **AND** the visible bubble MUST NOT freeze at a first-token shell while history shows the complete body

#### Scenario: terminal drain preserves coalescing order and content

- **WHEN** the terminal drain applies coalesced deltas
- **THEN** relative event order and final content MUST equal immediate processing
- **AND** dedup identity MUST remain stable (`S-RS-PE.dedupHitRatio` unchanged)
