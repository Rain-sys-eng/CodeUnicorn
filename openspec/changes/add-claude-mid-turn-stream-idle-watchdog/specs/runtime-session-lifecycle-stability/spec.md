# Delta: runtime-session-lifecycle-stability

## ADDED Requirements

### Requirement: Claude Mid-Turn Stream Silence MUST Be Bounded

Claude turn 在首事件之后、`result` 之前的流静音 MUST 受看门狗约束：系统 MUST 以固定步长（默认 120s）检查静音时长，并在静音超过硬上限（默认 2100s）时终止子进程并发出带明确 code（`claude_stream_mid_turn_idle_timeout`）的 TurnError，MUST NOT 无限期等待。

合法静音期 MUST NOT 被误杀：pending AskUserQuestion（等待用户应答）期间看门狗硬上限 MUST 挂起；硬上限 MUST 高于全部非用户驱动的合法静音 ceiling（工具/MCP 调用由 CLI 侧超时自结算，≤1800s+余量）。

#### Scenario: mid-turn proxy stall eventually fails the turn

- **WHEN** Claude turn 已产生有效流事件但超过硬上限未再收到任何 stdout 事件
- **AND** 该 turn 无 pending AskUserQuestion
- **THEN** 系统 MUST 终止 CLI 子进程
- **AND** MUST emit 带 `claude_stream_mid_turn_idle_timeout` code 的 TurnError
- **AND** 线程 MUST 解除「生成中」状态，允许用户重发

#### Scenario: pending user input suspends the hard cap

- **WHEN** Claude turn 存在 pending AskUserQuestion（等待用户应答）
- **THEN** 看门狗 MUST NOT 因静音时长终止该 turn
- **AND** 既有 AskUserQuestion 超时自结算行为 MUST 保持不变

#### Scenario: sub-cap silence only warns

- **WHEN** mid-turn 静音未达硬上限
- **THEN** 系统 MUST 仅记录 warn 诊断日志（含静音时长与 diagnostic sample）
- **AND** turn MUST 继续等待，后续事件到达 MUST 重置静音计时
