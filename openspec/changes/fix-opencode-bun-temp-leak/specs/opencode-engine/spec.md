## MODIFIED Requirements

### Requirement: OpenCode One-Shot Engine Runtime

OpenCode CLI SHALL run as a one-shot headless engine (`opencode run --format json`) with
block-level events surfaced to the conversation UI via the unified engine event stream, and
synthetic streaming MAY smooth block-level text into incremental deltas. On Windows, every
ccgui-created OpenCode one-shot child MUST pass through the OpenCode native-artifact containment
policy before spawn; that policy MUST NOT alter the one-shot arguments, event protocol, or
parent-process environment.

#### Scenario: New OpenCode turn on a new thread

- **WHEN** the user sends the first message on an `opencode-pending-*` thread
- **THEN** backend SHALL spawn `opencode run --format json` with an explicit `--model <provider/model>`
- **AND** `SessionStarted` SHALL carry the `sessionID` parsed from the first JSONL event before any content event
- **AND** on Windows the spawned child SHALL use its own ccgui-owned native-artifact run directory

#### Scenario: Continue an existing OpenCode session

- **WHEN** the user sends a message on an `opencode:<ses_*>` thread with continue semantics
- **THEN** backend SHALL pass `--session <ses_*>` and SHALL still pass an explicit `--model`

#### Scenario: Stream event mapping

- **WHEN** the CLI emits JSONL events on stdout
- **THEN** `text` events SHALL map to assistant text, `reasoning` to reasoning, `tool_use` to tool call/result entries, `step_finish` to usage update, and `error` to `TurnError`
- **AND** a single malformed JSONL line MUST NOT fail the turn
- **AND** turn completion MUST be derived from process exit with a `step_finish reason=stop` hint, not from `step_finish` alone

#### Scenario: Native artifact budget is exceeded

- **WHEN** the Windows native-artifact containment policy reports that an active OpenCode child exceeded storage budget
- **THEN** backend SHALL terminate the registered child process for that turn
- **AND** the turn SHALL settle with a storage-limit error rather than continue writing to system Temp

#### Scenario: Interrupt a running OpenCode turn

- **WHEN** the user stops a running OpenCode turn
- **THEN** backend SHALL kill the child process registered for that turn id
- **AND** the turn SHALL settle as stopped, not as an error
