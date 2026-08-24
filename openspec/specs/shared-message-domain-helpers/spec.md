# shared-message-domain-helpers Specification

## Purpose
TBD - created by archiving change relocate-shared-message-domain-helpers. Update Purpose after archive.
## Requirements
### Requirement: Shared diff capability has a neutral owner

All production consumers MUST import diff parsing/computation from `src/utils/diff.ts` or its
public neutral path, and peer features MUST NOT import messages-private diff helpers.

#### Scenario: oversized LCS input

- **WHEN** diff input exceeds the established LCS product guard
- **THEN** computation MUST use the bounded fallback
- **AND** result/stats MUST remain deterministic

#### Scenario: unified patch headers

- **WHEN** stats are derived from a unified patch
- **THEN** `---` and `+++` file headers MUST NOT count as removed/added content

### Requirement: Shared tool semantics are presentation-neutral

Parsers/classifiers/status mappings consumed by three or more features MUST live in a neutral
pure module and MUST NOT depend on React、i18n、messages components or UI policy.

#### Scenario: peer feature classifies a tool

- **WHEN** threads、status-panel、session-activity or operation-facts parses a tool item
- **THEN** it MUST consume the neutral semantics module
- **AND** output MUST match the previous messages-private helper behavior

### Requirement: Agent-task and command contracts use their real owner

Agent-task notification parsing MUST be owned by `engine-task-output/contracts`, and command
message tag parsing MUST be owned by root neutral utilities.

Messages consumers MUST parse via that contract. The parser MUST accept a well-formed
`<task-notification>` envelope that starts the payload even when `<result>` is absent.
For **SubAgent-style** notifications, messages MUST NOT render the legacy agent-task card.
For **Background-style** notifications, messages MUST use the Background fold surface
instead of the legacy card or a user bubble. Other non-SubAgent notifications MAY still
use the legacy card.

#### Scenario: messages renders agent-task notification

- **WHEN** messages receives an engine-task notification payload
- **THEN** it MUST consume the engine-task-output contract without reverse importing messages

#### Scenario: SubAgent-style notification does not use legacy card

- **WHEN** messages receives a SubAgent-style engine-task notification payload
- **THEN** it MUST still parse via the engine-task-output contract
- **AND** MUST NOT present the legacy `.message-agent-task-card` chrome for that payload

#### Scenario: envelope without result still parses

- **WHEN** the payload starts with `<task-notification>` (or an entity-escaped equivalent) and contains at least one of task-id, tool-use-id, output-file, status, or summary, but has no `<result>`
- **THEN** the engine-task-output parser MUST return a structured notification
- **AND** `resultText` MUST be an empty string

### Requirement: File icon has one shared visual owner

Peer features MUST render file icons through one shared component contract and MUST NOT import
`messages/components/toolBlocks/FileIcon`.

#### Scenario: status panel renders changed files

- **WHEN** status-panel renders file change entries
- **THEN** icon selection and size MUST match the previous UI
- **AND** the import MUST resolve to the shared component owner

