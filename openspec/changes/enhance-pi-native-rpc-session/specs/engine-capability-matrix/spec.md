## MODIFIED Requirements

### Requirement: Capability matrix includes Pi

The engine capability fixture SHALL refresh the `pi` engine row for the RPC-session capabilities delivered by this change. Generated TypeScript and Rust matrices SHALL be regenerated from the fixture. Semantic differences versus other engines SHALL be recorded as comments, not hidden.

#### Scenario: Query Pi mid-turn input

- **WHEN** a caller asks the capability matrix for `pi` / `input.mid-turn`
- **THEN** the state SHALL be `supported`（RPC `steer` 命令 + `queue_update` 事件，`rpc-types.d.ts` 实证）

#### Scenario: Query Pi session fork

- **WHEN** a caller asks for `pi` / `session.fork`
- **THEN** the state SHALL be `supported`
- **AND** the semantic SHALL be recorded as **fork-to-new-file**（新会话文件，非 TUI `/tree` 同文件树内 lane；依据 `docs/sessions.md` /tree·/fork·/clone 对比表）

#### Scenario: Query Pi session tree

- **WHEN** a caller asks for `pi` / `session.tree`
- **THEN** the state SHALL be `supported`
- **AND** the semantic SHALL be recorded as **只读 tree + fork 入口**（RPC 无 leaf-move/navigate 命令，`rpc-types.d.ts` 全量命令枚举实证）

#### Scenario: Query Pi RPC server

- **WHEN** a caller asks for `pi` / `rpc.server`
- **THEN** the state SHALL be `supported`（`pi --mode rpc` 长驻进程，本 change 落地）

#### Scenario: Query Pi session switch and MCP

- **WHEN** a caller asks for `pi` / `session.switch`
- **THEN** the state SHALL remain `unknown`（`switch_session` 存在但未产品化）
- **WHEN** a caller asks for `pi` / `tool.mcp`
- **THEN** the state SHALL remain `unsupported`（upstream 明确反 MCP 设计立场，README §498，注释注明非待补缺口）
