## ADDED Requirements

### Requirement: Qoder Native History Uses Workspace-Scoped Local JSONL First

The system MUST use Qoder's local `projects/<cwd-slug>/<sessionId>.jsonl` as the
primary source for Qoder history list and load. It MUST derive candidate project directories
from the workspace's raw path, canonical path, and supported `/tmp` path aliases, and MUST
honor the configured Qoder home. The system MUST not mutate any Qoder vendor history file.

#### Scenario: List a workspace with local Qoder sessions

- **WHEN** the configured Qoder home contains JSONL session files for the selected workspace
- **THEN** the system MUST return their summaries without starting `qodercli`
- **AND** each returned entry MUST have `engine: "qoder"`, its canonical session id, and
  `attributionStatus: "strict-match"`

#### Scenario: Load a local Qoder session

- **WHEN** a caller loads a Qoder session id with a matching local JSONL file
- **THEN** the system MUST project that file directly into the existing Qoder history payload
- **AND** the public Tauri payload schema MUST remain unchanged

#### Scenario: Read-only vendor boundary

- **WHEN** Qoder history is listed or loaded from local storage
- **THEN** the system MUST only open and read vendor files
- **AND** it MUST NOT rewrite, move, prune, or delete a file under `~/.qoder/projects/**`

### Requirement: Qoder Local Replay Preserves Renderable Timeline Semantics

The local JSONL reader MUST project visible user text, assistant text, assistant reasoning,
tool calls, and matching tool results in chronological order. It MUST skip metadata,
sidechain entries, malformed lines, and empty visible blocks without failing the whole
session. Tool results MUST merge into the corresponding tool-call item by tool id.

#### Scenario: Replay a turn with reasoning and a tool result

- **WHEN** a local Qoder JSONL turn contains user text, assistant thinking, `tool_use`, a
  matching `tool_result`, and assistant text
- **THEN** the returned history MUST contain user, reasoning, tool, and assistant items in
  that order
- **AND** the tool item MUST retain its input and result payloads

#### Scenario: A malformed record is isolated

- **WHEN** one JSONL line is malformed or an unknown Qoder record type is encountered
- **THEN** the reader MUST skip that record
- **AND** it MUST continue projecting valid records before and after it

### Requirement: ACP Remains the Qoder History Fallback and Live Control Plane

If no workspace-matching local artifact can be read, the system MUST retain the existing ACP
`session/list` and `session/load` paths as a best-effort fallback. Live send, typed terminal,
cancel, and post-response `session/update` draining MUST continue to use ACP and MUST NOT
read the JSONL as a live event source. Session deletion MUST continue to use ACP
`session/delete`.

#### Scenario: Native history artifact is unavailable

- **WHEN** no matching Qoder local project directory or session JSONL file exists
- **THEN** the system MUST attempt the existing ACP history operation
- **AND** an ACP failure on this fallback path MUST retain the existing soft-empty list
  behavior and MUST NOT affect a live Qoder turn

#### Scenario: A Qoder turn is running

- **WHEN** Qoder emits streaming messages, a terminal response, or a cancel response
- **THEN** the system MUST continue to consume those signals from ACP stdio
- **AND** it MUST NOT tail or poll the vendor JSONL for realtime rendering

#### Scenario: Delete a Qoder session

- **WHEN** a caller deletes a Qoder session
- **THEN** the system MUST call ACP `session/delete`
- **AND** it MUST NOT remove the local JSONL directly
