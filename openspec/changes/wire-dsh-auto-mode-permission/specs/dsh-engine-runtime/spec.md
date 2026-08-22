## MODIFIED Requirements

### Requirement: Native DSH session identity

A mossx DSH thread SHALL map 1:1 to a DSH `sessionId`. Canonical thread id is
`dsh:<sessionId>`. `dsh-pending-*` is only an optimistic alias before
`session.create` returns.

#### Scenario: New DSH session

- **WHEN** the user creates a DSH conversation in mossx workspace path P
- **THEN** mossx SHALL call `workspace.create({ path: P })` then
  `session.create({ workspaceId, agentPreset? })`
- **AND** if the composer selected a shipped Agent Preset, `agentPreset` SHALL
  be that id
- **AND** the backend SHALL use the returned DSH `sessionId` as canonical identity
- **AND** the backend SHALL NOT invent a durable UUID to stand in for it
- **AND** before `session.prompt`, mossx SHALL execute
  `/permission danger-full-access` when access mode is `full-access`,
  otherwise `/permission workspace-write`

#### Scenario: Pending promotion

- **WHEN** the composer shows `dsh-pending-*` before create returns
- **THEN** promotion SHALL merge that row into `dsh:<sessionId>`
- **AND** sidebar SHALL keep exactly one row
