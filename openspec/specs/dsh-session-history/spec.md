# dsh-session-history Specification

## Purpose
TBD - created by archiving change add-dsh-engine. Update Purpose after archive.
## Requirements
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

### Requirement: DSH history hides producer-injected context

DSH persists workspace instructions, runtime snapshots, and skill catalogs as durable `user/message` events. mossx SHALL treat these as control-plane context, not as user-authored chat bubbles.

Classification MUST follow DSH `source.kind`:

- `source.kind === "user"` is a real human prompt and MUST stay visible
- any other present `source.kind` (`agent-instructions`, `plugin`, …) MUST be hidden
- when `source` is absent, mossx MAY hide rows whose text is only a
  `<system-reminder>` / `<available_skills>` envelope or a
  `Current runtime context.` snapshot

#### Scenario: Injected AGENTS.md / runtime snapshot / skill catalog stay off the curtain

- **WHEN** a DSH session history contains the user's `你好` plus three injected
  `user/message` rows for workspace instructions, runtime context snapshot, and
  available skills
- **THEN** the curtain MUST show the real user prompt and later assistant text
- **AND** MUST NOT render those three injected rows as chat bubbles

#### Scenario: Real user text that mentions system-reminder stays visible

- **WHEN** a DSH `user/message` has `source.kind === "user"` and the text
  mentions `<system-reminder>`
- **THEN** mossx MUST keep that row visible

#### Scenario: Injected runtime context must not become the sidebar title

- **WHEN** DSH session title / `first_message` is only a
  `<system-reminder>` envelope or a `Current runtime context.` snapshot
- **THEN** mossx MUST NOT use that string as the sidebar display name

### Requirement: Delete archives instead of erasing logs

The first-wave Host RPC MUST NOT expose a physical session-file delete. mossx
delete SHALL call `workspace.archiveSession` instead of claiming the DSH logs
were removed from disk.

#### Scenario: User deletes a DSH conversation

- **WHEN** the user deletes a `dsh:<sessionId>` row
- **THEN** mossx SHALL archive that session on the DSH host
- **AND** the row SHALL disappear from the mossx sidebar
- **AND** mossx SHALL NOT claim the DSH log files were removed from disk

