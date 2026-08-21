## MODIFIED Requirements

### Requirement: Capability matrix includes Qoder

The engine capability fixture SHALL include a `qoder` engine row covering
every capability key. Generated TypeScript and Rust matrices SHALL be
regenerated from that fixture. Cells that were not live-verified during the
Phase S spike SHALL be `unknown`, not optimistic `supported`.

#### Scenario: Query Qoder streaming text

- **WHEN** a caller asks the capability matrix for `qoder` / `streaming.text`
- **THEN** the state SHALL be `supported`

#### Scenario: Query Qoder reasoning and tool streaming

- **WHEN** a caller asks for `qoder` / `streaming.reasoning` or `streaming.tool-output`
- **THEN** the state SHALL be `unknown` in this change
- **AND** consumers SHALL degrade as documented for `unknown`

#### Scenario: Query Qoder Shared-facing continuation

- **WHEN** a caller asks the capability matrix for `qoder` / `session.continuation`
- **THEN** the state SHALL be `unsupported` in this change
- **AND** Shared support collections SHALL remain without `qoder`

#### Scenario: Query Qoder session fork

- **WHEN** a caller asks the capability matrix for `qoder` / `session.fork`
- **THEN** the state SHALL be `unknown` in this change
- **AND** consumers SHALL degrade as documented for `unknown` until a live fork turn is recorded
