## ADDED Requirements

### Requirement: Qoder history uses the ACP channel

Qoder session history SHALL be listed, loaded, and deleted through the ACP
protocol (`session/list`, `session/load`, `session/delete`). mossx SHALL
NOT parse, modify, or delete files under `~/.qoder/projects/**`.

#### Scenario: List sessions for the workspace

- **WHEN** mossx lists Qoder sessions for a workspace
- **THEN** it SHALL spawn `qodercli --acp`, initialize, call `session/list`, and filter to the workspace cwd
- **AND** an empty list SHALL be a soft-empty result, not an error

#### Scenario: Load session history

- **WHEN** mossx loads a Qoder session
- **THEN** it SHALL collect the `session/load` replay (`user_message_chunk` / `agent_message_chunk`)
- **AND** replay entries SHALL be deduplicated by `messageId`
- **AND** `available_commands_update` notifications SHALL NOT enter the history timeline

#### Scenario: Delete session

- **WHEN** the user deletes a Qoder session
- **THEN** mossx SHALL call ACP `session/delete`
- **AND** SHALL NOT delete vendor files directly

### Requirement: Qoder history joins the unified session catalog

Qoder sessions SHALL project into the unified session catalog with the
`qoder:` thread-id prefix, alongside other native engines.

#### Scenario: Sidebar shows Qoder sessions

- **WHEN** the sidebar session index renders
- **THEN** Qoder sessions SHALL appear with the Qoder badge and title
- **AND** `qoder-pending-*` aliases SHALL NOT appear as separate rows
