## ADDED Requirements

### Requirement: Current catalog wins on id or runtime before cross-catalog engine rewrite
The system SHALL resolve `handleSelectModel(id)` against the current engine catalog by catalog `id` or runtime `.model` before scanning any other engine catalog. Cross-catalog lookup MUST compare exact catalog `id` only, so an explicit pick such as `kimi-code/kimi-for-coding` from another engine group still lands on that engine.

#### Scenario: DSH runtime name matches Grok catalog id
- **WHEN** the active engine is `dsh` and its catalog contains `{ id: "ggggg/grok-4.6", model: "grok-4.6" }` while the Grok catalog contains `{ id: "grok-4.6" }`
- **THEN** selecting `grok-4.6` MUST keep `targetEngine` as `dsh` and persist the DSH catalog entry id `ggggg/grok-4.6`

#### Scenario: DSH last-segment matches Claude catalog id
- **WHEN** the active engine is `dsh` and its catalog contains `{ id: "acme/claude-sonnet-4-6", model: "claude-sonnet-4-6" }`
- **THEN** selecting `claude-sonnet-4-6` MUST keep `targetEngine` as `dsh`

#### Scenario: Explicit cross-engine catalog id still switches owner
- **WHEN** the active engine is `claude` and the user selects catalog id `kimi-code/kimi-for-coding` that exists only in the Kimi catalog
- **THEN** the system MUST store the pick under `kimi` and persist the Kimi engine pref

### Requirement: Native follow-up stays on the thread unless the user explicitly switched engine group
The system SHALL send a native follow-up to the current thread when that thread's engine prefix is valid, unless this send consumed an explicit composer engine-group switch whose target equals the current `activeEngine`. Implicit rematch, display-name collision, or catalog warmup MUST NOT call `startThreadForMessageSend`.

#### Scenario: DSH follow-up after a complex first turn
- **WHEN** the active thread id is `dsh:` compatible, no explicit engine-group switch was marked this send, and `activeEngine` has drifted to `grok`
- **THEN** the system MUST send to the existing DSH thread and MUST NOT spawn a Grok CLI session

#### Scenario: Same collision with Claude / Kimi / Codex / Gemini runtime names
- **WHEN** a DSH thread is active and `activeEngine` has drifted to `claude`, `kimi`, `codex`, or `gemini` without an explicit engine-group switch
- **THEN** the follow-up MUST stay on the DSH thread

#### Scenario: Explicit engine-group switch still spawns
- **WHEN** the user picks another native engine group in the Atomic left pane, creation target, or conversation engine control, and then sends
- **THEN** the system MUST create a new thread for that engine

### Requirement: DSH closed label includes provider
The system SHALL render the DSH composer closed-state model label as `{provider} / {lastSegment}` when the catalog id contains a `/`. List rows MAY keep the last path segment only.

#### Scenario: Closed trigger distinguishes DSH host from Grok CLI
- **WHEN** the selected DSH model id is `ggggg/grok-4.6`
- **THEN** the closed trigger label MUST be `ggggg / grok-4.6`

#### Scenario: List row stays short
- **WHEN** the same model is rendered in the picker list
- **THEN** the row label MAY be `grok-4.6`
