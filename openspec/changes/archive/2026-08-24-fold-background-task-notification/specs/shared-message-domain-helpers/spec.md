## MODIFIED Requirements

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
