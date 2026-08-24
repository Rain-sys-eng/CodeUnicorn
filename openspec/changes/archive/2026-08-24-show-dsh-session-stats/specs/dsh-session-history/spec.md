## MODIFIED Requirements

### Requirement: DSH history is host-RPC, not a local wire file

mossx SHALL list and load DSH conversations through `session.list` /
`session.history`. History read SHALL NOT resume or publish a DSH agent.
The history tail page `projections.values` MUST be mapped when present:

- `tokenUsage` → `ThreadTokenUsage` (uncached / cacheRead / cacheWrite / output)
- `sessionStats` → `ThreadTokenUsage.sessionStats`

#### Scenario: Sidebar lists DSH sessions for the current workspace

- **WHEN** the user opens a mossx workspace bound to DSH workspace W
- **THEN** mossx SHALL show W's non-archived `sessionIds`
- **AND** each row id SHALL be `dsh:<sessionId>`

#### Scenario: Open an existing DSH thread after restart

- **WHEN** the user selects `dsh:<sessionId>`
- **THEN** mossx SHALL load `session.history` into the curtain via `dshHistoryLoader`
- **AND** SHALL NOT fall through to the Codex history loader
- **AND** SHALL hydrate `tokenUsage` / `sessionStats` from the tail-page projections

#### Scenario: Live projection frames update usage without a new history load

- **WHEN** DSH mux emits `session/projection` with `key=tokenUsage` or `key=sessionStats`
- **THEN** mossx SHALL update the active thread usage store
- **AND** SHALL keep previously hydrated `sessionStats` when a token-only update omits them
