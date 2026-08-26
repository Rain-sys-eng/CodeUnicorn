## ADDED Requirements

### Requirement: Engine send orchestration has a single implementation

mossx SHALL implement per-engine send orchestration (`engine_send_message`
and `engine_send_message_sync` semantics: parameter normalization,
per-engine dispatch, streaming aggregation, synthesized `agentMessage`,
turn settlement, and error paths) exactly once, in the shared send core
module. The GUI runtime and the daemon runtime SHALL both delegate to the
shared send core and SHALL NOT carry their own copy of any per-engine send
branch.

#### Scenario: Same engine, same semantics on both runtimes

- **WHEN** the same engine receives an equivalent send request on the GUI
  runtime and on the daemon runtime
- **THEN** both runtimes SHALL execute the same send-core code path for
  that engine
- **AND** any difference in observable behavior SHALL be attributable only
  to the injected event sink or runtime access implementation

#### Scenario: New engine wires send exactly once

- **WHEN** a new CLI engine is onboarded
- **THEN** its send orchestration SHALL be added only to the send core
- **AND** no per-engine send logic SHALL be added to the GUI command shell
  or the daemon state shell

### Requirement: Runtime differences enter only through injection seams

The send core SHALL depend on runtime-specific capabilities only through
the existing `EventSink` trait and the send-core runtime access seam. The
send core SHALL compile for both the GUI target and the daemon binary
target without depending on Tauri window APIs or daemon-only transports.

#### Scenario: Sink is injected, not selected

- **WHEN** the send core emits an engine event
- **THEN** it SHALL emit through the injected `EventSink` implementation
- **AND** it SHALL NOT branch on which runtime it is executing in

### Requirement: Divergence between the two legacy copies is adjudicated, not silently merged

mossx SHALL NOT silently merge behavioral differences between the legacy
GUI copy and the legacy daemon copy of a per-engine send branch. For every
such difference discovered during migration, the difference and its
adjudication (which behavior is correct, and why) MUST be recorded in the
change's design document before the migration PR for that engine lands.

#### Scenario: Unintended drift is not silently absorbed

- **WHEN** the two legacy copies disagree on settlement timing, event
  order, or error payload for the same engine
- **THEN** the migration PR SHALL cite the recorded adjudication for that
  divergence
- **AND** the send core SHALL implement the adjudicated behavior for both
  runtimes
