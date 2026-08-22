## MODIFIED Requirements

### Requirement: Capability matrix includes Qoder

The engine capability fixture SHALL include a `qoder` engine row covering
every capability key. Generated TypeScript and Rust matrices SHALL be
regenerated from that fixture. Cells that were not live-verified during the
Phase S spike SHALL be `unknown`, not optimistic `supported`.
（2026-08-22 更新：黄金 turn 补采后 `streaming.reasoning` / `streaming.tool-output` / `input.mid-turn` / `session.fork` 已升级为 live 实测 `supported`；`session.tree` 仍未调研，保持 `unknown`。）

#### Scenario: Query Qoder streaming text

- **WHEN** a caller asks the capability matrix for `qoder` / `streaming.text`
- **THEN** the state SHALL be `supported`

#### Scenario: Query Qoder reasoning and tool streaming

- **WHEN** a caller asks for `qoder` / `streaming.reasoning` or `streaming.tool-output`
- **THEN** the state SHALL be `supported`（2026-08-22 黄金 turn 补采：probe6 live 观测 `agent_thought_chunk` 与 `tool_call`/`tool_call_update`）

#### Scenario: Query Qoder Shared-facing continuation

- **WHEN** a caller asks the capability matrix for `qoder` / `session.continuation`
- **THEN** the state SHALL be `unsupported` in this change
- **AND** Shared support collections SHALL remain without `qoder`

#### Scenario: Query Qoder session fork

- **WHEN** a caller asks the capability matrix for `qoder` / `session.fork`
- **THEN** the state SHALL be `supported`（2026-08-22 probe8 live：fork 返回新 sessionId 且携带历史）
