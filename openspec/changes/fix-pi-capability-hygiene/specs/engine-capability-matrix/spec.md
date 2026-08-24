## MODIFIED Requirements

### Requirement: PI MUST NOT claim live tool-output streaming

PI 工具卡片有 start/end，但 RPC 宿主不订阅 `tool_execution_update`。矩阵不得把 `streaming.tool-output` 标成 `supported` 来倒逼接高频流。

#### Scenario: Query PI live tool-output

- **WHEN** a caller asks the capability matrix for `pi` / `streaming.tool-output`
- **THEN** the state SHALL be `unsupported`
- **AND** `tool.use` SHALL remain `supported`（工具调用本身仍可用）
