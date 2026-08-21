## MODIFIED Requirements

### Requirement: Realtime And History Coverage Includes Qoder

The realtime adapter registry and the history loader factory SHALL cover
`qoder` exhaustively, per the existing static-exhaustiveness requirements of
this contract. The Qoder realtime adapter SHALL normalize ACP
`session/update` notifications into the canonical event surface
(`run:start / turn:start / message:delta / reasoning:delta / tool:start|update|end / turn:end / run:settled`)
without changing existing event meanings. Qoder-private session updates
(`available_commands_update`, `config_option_update`, `user_message_chunk`)
SHALL be registered in `NORMALIZED_EVENT_DICTIONARY` and SHALL NOT render as
conversation items.

#### Scenario: Adapter registry covers qoder

- **WHEN** the realtime adapter registry is initialized
- **THEN** a `qoder` adapter SHALL be registered
- **AND** unknown ACP `sessionUpdate` kinds SHALL be skipped without error

#### Scenario: History loader does not fall through

- **WHEN** history is loaded for a `qoder:<sessionId>` thread
- **THEN** the loader factory SHALL dispatch to the Qoder history loader
- **AND** SHALL NOT fall through to the Codex loader
