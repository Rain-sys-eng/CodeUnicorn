## ADDED Requirements

### Requirement: Qoder is a first-class Native Engine

mossx SHALL expose Qoder CLI as engine id `qoder` with display name
`Qoder CLI`, protocol family `acp-stdio`, and `executionModel: one-shot`.
Qoder SHALL NOT be modeled as a vendor preset, a Shared-only target, or the
Qoder IDE launcher (`qoder`). The detectable binary SHALL be `qodercli`
only; the CN edition `qoderclicn` SHALL NOT be detected as `qoder`.

#### Scenario: User selects Qoder in the engine picker

- **WHEN** the user opens the composer engine / provider picker
- **THEN** mossx SHALL show a Qoder group labeled Qoder CLI / Qoder
- **AND** the provider mapping SHALL be `qoder` → `qoder` (not silently Claude)

#### Scenario: Protocol family is not stream-json

- **WHEN** the adapter registry reports the builtin `qoder` entry
- **THEN** `protocolFamily` SHALL be `acp-stdio`
- **AND** `executionModel` SHALL be `one-shot`

### Requirement: Spawn-per-turn ACP runtime

Each Qoder turn SHALL spawn a fresh `qodercli --acp` process, perform the
ACP `initialize` handshake, attach via `session/new` or `session/resume`,
send `session/prompt`, and treat the prompt JSON-RPC response as the typed
terminal. Process exit SHALL be treated as cleanup only, never as the turn
terminal. mossx SHALL NOT keep a persistent ACP process pool.

#### Scenario: First turn creates the session

- **WHEN** a Qoder thread has no tracked session id
- **THEN** mossx SHALL call `session/new {cwd, mcpServers}`
- **AND** SHALL use the returned `sessionId` as the canonical identity before prompting

#### Scenario: Follow-up turn resumes the session

- **WHEN** a Qoder thread has a tracked session id
- **THEN** mossx SHALL call `session/resume {sessionId, cwd, mcpServers}`
- **AND** SHALL NOT rely on `session/load` replay for the live turn

#### Scenario: Prompt response is the terminal

- **WHEN** the `session/prompt` JSON-RPC response arrives
- **THEN** mossx SHALL settle the turn from the response (`stopReason` or error)
- **AND** SHALL discard same-session `session/update` notifications that arrive after settlement
- **AND** SHALL kill the child process as independent cleanup

#### Scenario: Agent requests never hang the turn

- **WHEN** the agent sends `session/request_permission`
- **THEN** mossx SHALL auto-approve with the first `allow*` option in v1
- **AND** `fs/read_text_file` / `fs/write_text_file` requests SHALL be confined to the workspace root via realpath
- **AND** an out-of-sandbox path SHALL be answered with a JSON-RPC error

### Requirement: Native Qoder session identity

A mossx Qoder thread SHALL map 1:1 to a Qoder ACP `sessionId`. Canonical
thread id is `qoder:<sessionId>`. `qoder-pending-*` is only an optimistic
alias before `session/new` returns; promotion SHALL merge into the canonical
row without duplicates. mossx SHALL NOT fabricate a canonical session id when
the handshake fails.

#### Scenario: Pending row promotion

- **WHEN** `session/new` returns a real `sessionId`
- **THEN** the `qoder-pending-<uuid>` row SHALL be promoted to `qoder:<sessionId>`
- **AND** active turn / processing / selection state SHALL migrate with it

#### Scenario: Handshake failure does not mint identity

- **WHEN** initialize or `session/new` fails
- **THEN** the pending row SHALL settle as an error
- **AND** mossx SHALL NOT write a fabricated canonical session id

### Requirement: Model and reasoning configuration via ACP

The Qoder model catalog SHALL come from the ACP handshake
(`models.availableModels` + `configOptions`), not from a static roster.
Send-time selection SHALL use `session/set_model` and
`session/set_config_option`. The catalog is advisory; delivery authority is
the ACP session.

#### Scenario: Composer shows account models

- **WHEN** the user opens the Qoder model group
- **THEN** mossx SHALL list `availableModels` with their display names
- **AND** reasoning effort options SHALL reflect `configOptions.reasoning_effort`

#### Scenario: Not logged in

- **WHEN** `qodercli status -o json` reports `logged_in: false`
- **THEN** detection SHALL surface a not-authenticated diagnostic pointing at `qodercli login`
- **AND** the composer SHALL block send with an explainable reason

### Requirement: Qoder stays out of Shared Session

Qoder SHALL NOT be added to `SHARED_SESSION_SUPPORTED_ENGINES` or
`is_supported_shared_session_engine()`. The Shared target picker SHALL show
Qoder disabled with a reason. `normalizeSharedSessionEngine("qoder")` SHALL
fail closed to the default engine and Qoder SHALL NOT be written as a Shared
target.

#### Scenario: Shared picker shows Qoder disabled

- **WHEN** a Shared Session target picker lists engines
- **THEN** Qoder SHALL be disabled with a visible capability reason
- **AND** SHALL NOT be silently hidden

### Requirement: Permission mode is fixed headless

Qoder turns SHALL run with `session/set_mode bypassPermissions` after attach.
The composer access-mode selector SHALL stay disabled for Qoder. mossx SHALL
NOT expose per-turn permission prompts for Qoder in v1.

#### Scenario: access mode is disabled for Qoder

- **WHEN** the active engine is `qoder`
- **THEN** the composer access-mode control SHALL be disabled or hidden
- **AND** the Rust arm SHALL ignore any access-mode override
