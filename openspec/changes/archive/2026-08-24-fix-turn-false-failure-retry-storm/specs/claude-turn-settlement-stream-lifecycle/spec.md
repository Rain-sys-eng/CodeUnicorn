## ADDED Requirements

### Requirement: Successful result MUST outrank process exit code during settlement

当 Claude runtime 已从 stream-json 收到成功 terminal `result` 事件（`is_error != true` 且 subtype 非 `error*`）时，turn SHALL 按成功结算并发出 `TurnCompleted`；进程随后的非零退出码 MUST NOT 把该 turn 翻成 `TurnError`，只能降级为 warn 级诊断日志（保留 exit status 与 stderr sample）。未收到成功 `result` 的 turn 维持现有失败路径不变。

#### Scenario: 成功 result 后进程非零退出

- **GIVEN** Claude 进程已发出 assistant 正文与 `result`（`subtype: "success"`，`is_error: false`）
- **WHEN** 进程随后以非零 status 退出且 stderr 为空
- **THEN** runtime MUST 返回成功并发出恰好一次 `TurnCompleted`
- **AND** MUST NOT 发出 `TurnError`
- **AND** MUST 以 warn 日志记录 exit status（供事后诊断）

#### Scenario: 成功 result 后非零退出且 stderr 有噪声

- **GIVEN** turn 已收到成功 `result`
- **WHEN** 进程非零退出且 stderr 含有非错误语义的环境噪声（如 hook / 渠道告警）
- **THEN** runtime MUST 仍按成功结算
- **AND** warn 日志 MUST 包含截断后的 stderr sample

#### Scenario: 无 result 的非零退出保持失败

- **GIVEN** Claude 进程未发出任何有效 stream 事件或未见 `result`
- **WHEN** 进程以非零 status 退出
- **THEN** runtime MUST 维持现有 `TurnError` 失败路径（含 `Claude exited with status` 诊断格式）

#### Scenario: 错误 result 的非零退出保持失败

- **GIVEN** 收到的 `result` 事件 `is_error: true` 或 subtype 以 `error` 开头
- **WHEN** 进程以非零 status 退出
- **THEN** runtime MUST 维持现有 `TurnError` 失败路径

#### Scenario: prompt-too-long 链路不受影响

- **WHEN** turn 失败消息命中 `is_prompt_too_long_error`
- **THEN** runtime MUST 维持现有 `RETRYABLE_PROMPT_TOO_LONG` 标记与 auto `/compact` 恢复链路
