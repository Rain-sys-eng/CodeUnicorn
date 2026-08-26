## ADDED Requirements

### Requirement: DSH composer exposes shipped Agent Presets

WHEN the selected engine is `dsh`, the composer toolbar SHALL show an Agent Preset control listing shipped ids `standard`, `code`, `minimal`, and `cordis`. The control SHALL NOT appear for other engines.

#### Scenario: Blank DSH session can change preset

- **WHEN** the current DSH conversation has no user messages
- **THEN** the user SHALL be able to choose one of the four shipped presets
- **AND** the next `session.create` SHALL include that `agentPreset`

#### Scenario: Started DSH session locks preset

- **WHEN** the current DSH conversation already has user messages
- **THEN** the control SHALL become read-only
- **AND** activating it SHALL explain that a new session is required
- **AND** mossx SHALL NOT call `agentPreset.select` on that session

#### Scenario: Resume shows the header preset

- **WHEN** the user opens an existing DSH session whose list row has `agentPreset`
- **THEN** the toolbar SHALL display that preset
- **AND** the control SHALL stay locked

### Requirement: Preset is a dedicated send field

DSH Agent Preset SHALL travel as `dshAgentPreset` on the mossx send contract. It SHALL NOT reuse OpenCode `agent` or Claude/Codex permission mode.

#### Scenario: New DSH turn creates with preset

- **WHEN** mossx creates a DSH session to send the first user turn
- **AND** the composer has a selected shipped preset
- **THEN** `session.create` SHALL include `agentPreset` equal to that id
