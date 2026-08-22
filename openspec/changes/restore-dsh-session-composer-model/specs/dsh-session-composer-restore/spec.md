## ADDED Requirements

### Requirement: Returning to a DSH thread rebinds composer chrome immediately
The system SHALL set visible `activeEngine` to `dsh` on the same turn the user selects a `dsh:` thread, without waiting for `switch_engine` IPC. The visible model list SHALL be the DSH status snapshot or the last-good DSH global catalog, never the previous native engine's leftover rows. A failed `switch_engine` MUST roll the visible engine and catalog back.

#### Scenario: Switch back from Codex before switch_engine resolves
- **WHEN** the user selects `dsh:session-1` while `activeEngine` is `codex` and `switchEngine("dsh")` has not settled
- **THEN** composer chrome MUST already treat the engine as `dsh`

#### Scenario: Empty DSH status models use last-good
- **WHEN** DSH `EngineStatus.models` is empty but this session previously loaded a DSH catalog
- **THEN** the optimistic catalog MUST be that last-good DSH list, not Codex/Claude leftovers

### Requirement: Native session repair must not write a foreign ledger onto DSH
The system SHALL persist Codex composer repair only when both `activeEngine` and the active thread engine are `codex`. Selecting a `dsh:` thread while chrome has not yet left Codex MUST NOT call `persistComposerSelectionForThread` with a Codex or global model.

#### Scenario: Codex repair window on a DSH thread
- **WHEN** `activeThreadId` is `dsh:session-1`, `activeEngine` is still `codex`, and effective selection is a Codex catalog id
- **THEN** the system MUST NOT persist that selection onto the DSH thread ledger

### Requirement: Trusted DSH catalog ids survive empty or leftover catalogs
The system SHALL keep a trusted per-thread DSH catalog id `{provider}/{model}` (not a reserved mossx provider such as `ccgui`) as the composer selection even when the current engine catalog is empty or belongs to another engine.

#### Scenario: Leftover native catalog after returning to DSH
- **WHEN** the DSH thread ledger is `gork-zhu/grok-4.6` and `engineModelsAsOptions` still lists Codex models
- **THEN** `effectiveSelectedModelId` MUST remain `gork-zhu/grok-4.6`

### Requirement: DSH Atomic closed state must not inherit the previous native global model
When the native Atomic target engine is `dsh` and the target has no model identity, the system SHALL render an empty selected model id instead of falling back to the global native `selectedModelId`.

#### Scenario: DSH target missing identity after visiting Codex
- **WHEN** `executionTarget.engine` is `dsh` with null catalog/runtime ids and global `selectedModelId` is a Codex model
- **THEN** Atomic `selectedModelId` MUST be `""`

### Requirement: Host history current model seeds only an untrusted DSH ledger
The system SHALL fold `{provider, model}` from already-loaded DSH history `request/header` / `request/context` events and, when the thread ledger is missing or not a trusted DSH catalog id, persist `{provider}/{model}` as that thread's composer selection. The system MUST NOT fetch `llm.models` or `session.models` on the thread-select click path to do this. A trusted existing ledger MUST NOT be overwritten. An existing `dsh:` follow-up MUST NOT take `composerEnginePrefs.dsh.modelId` as the restore source.

#### Scenario: Cold DSH session with empty ledger
- **WHEN** the user opens `dsh:session-1` with no trusted composer ledger and history last `request/context` is `{ provider: "gork-zhu", model: "grok-4.6" }`
- **THEN** the thread ledger MUST become `gork-zhu/grok-4.6`

#### Scenario: Trusted ledger wins over host
- **WHEN** the ledger already has `acme/deepseek-v4-flash` and history current is `gork-zhu/grok-4.6`
- **THEN** the ledger MUST stay `acme/deepseek-v4-flash`
