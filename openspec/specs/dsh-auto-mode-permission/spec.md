# dsh-auto-mode-permission Specification

## Purpose
TBD - created by archiving change wire-dsh-auto-mode-permission. Update Purpose after archive.
## Requirements
### Requirement: DSH auto mode maps to danger-full-access

WHEN the selected engine is `dsh` and composer auto mode is on (`bypassPermissions` / `accessMode=full-access`), mossx SHALL switch the current DSH session to permission preset `danger-full-access` before `session.prompt`. This preset is sandbox `danger-full-access` plus approval policy `never`. mossx SHALL NOT auto-accept `approval/requested` cards as a substitute.

#### Scenario: Auto mode first turn

- **WHEN** the user sends the first DSH turn with auto mode selected
- **THEN** mossx SHALL create the session as today
- **AND** SHALL call `commands/execute` with line
  `/permission danger-full-access`
- **AND** SHALL wait for that RPC to succeed before `session.prompt`
- **AND** SHALL NOT leave the host on the default `workspace-write + ask`
  preset for that prompt

#### Scenario: Auto mode follow-up

- **WHEN** the user continues a DSH session with auto mode still selected
- **AND** the previous turn has already ended
- **THEN** mossx SHALL call the same `/permission danger-full-access`
  command before the next prompt
- **AND** a no-op host success (already on that preset) SHALL still count
  as success

#### Scenario: Skip permission switch during an open turn

- **WHEN** the user queues or sends a follow-up while a DSH turn is still
  open
- **THEN** mossx SHALL NOT execute `/permission` against the live agent
- **AND** SHALL still enqueue `session.prompt`
- **AND** SHALL apply the selected preset on the next idle send

### Requirement: Leaving auto mode restores workspace-write

WHEN the selected engine is `dsh` and composer auto mode is off, mossx SHALL switch the current session to permission preset `workspace-write` before `session.prompt`. mossx SHALL NOT leave a previous `danger-full-access` pin in place.

#### Scenario: Switch back to default mode

- **WHEN** a DSH session ran under auto mode
- **AND** the user sends the next turn with default mode
- **THEN** mossx SHALL execute `/permission workspace-write` before prompt

### Requirement: DSH ModeSelect exposes default and auto only

WHEN the composer provider is `dsh`, ModeSelect SHALL enable `default`
and `bypassPermissions`, and SHALL keep `plan` and `acceptEdits`
disabled. Copy SHALL describe DSH permission presets, not Claude/Codex
bypass semantics.

#### Scenario: DSH mode menu

- **WHEN** the user opens ModeSelect on a DSH conversation
- **THEN** default mode and auto mode SHALL be selectable
- **AND** plan / acceptEdits SHALL remain disabled
- **AND** choosing auto mode SHALL persist as `full-access` on the send
  contract

### Requirement: Blank DSH conversations start on workspace-write

WHEN the selected engine is `dsh` and the conversation has no stored auto-mode pin, mossx SHALL restore composer accessMode `default` even if the global default is `full-access`. Auto mode SHALL require an explicit choice.

#### Scenario: New DSH conversation

- **WHEN** the user opens a blank DSH conversation
- **THEN** ModeSelect SHALL start on default mode
- **AND** the first prompt SHALL use permission preset `workspace-write`
  unless the user already selected auto mode

