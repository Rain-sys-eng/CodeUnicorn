## ADDED Requirements

### Requirement: Settled RequestUserInput Identity MUST Suppress Replay

系统 MUST 在 request identity 已结算（用户 accepted / stale settlement / runtime `completed=true`）后，抑制同 identity 的迟到或重放入队，避免 Claude 已继续执行时再次弹出问答框。

#### Scenario: accepted settlement tombstones identity and blocks re-add

- **WHEN** 用户成功提交或跳过某 `AskUserQuestion` / `RequestUserInput` 且 settlement 为 `accepted`
- **THEN** 客户端 MUST 将该 request identity（workspace + Shared owner 维度 + request_id）记入有界 settlement tombstone
- **AND** 后续同 identity 且 `completed` 不为 true 的 `item/tool/requestUserInput` 事件 MUST NOT 再次进入 pending queue
- **AND** 系统 MUST NOT 再次弹出该 identity 的交互卡片

#### Scenario: stale settlement also tombstones identity

- **WHEN** 用户提交/跳过触发 stale settlement（unknown request_id、timeout、workspace disconnected 等）
- **THEN** 客户端 MUST 同样写入 settlement tombstone
- **AND** 同 identity 迟到非 completed 事件 MUST NOT 重新入队

#### Scenario: completed event tombstones and removes queue entry

- **WHEN** 客户端收到 `item/tool/requestUserInput` 且 `completed=true`
- **THEN** 客户端 MUST 写入 settlement tombstone
- **AND** MUST 从 pending queue 移除该 request
- **AND** 后续同 identity 非 completed 重放 MUST 被忽略

#### Scenario: new request identity still elicits

- **WHEN** 到达的 `requestUserInput` 使用不同 request identity（例如新 tool_id 派生的 request_id 或不同 Shared attempt）
- **AND** 该 identity 未结算
- **THEN** 系统 MUST 正常入队并渲染交互卡片

#### Scenario: non-stale submit failure remains retryable without tombstone

- **WHEN** 用户提交失败且不属于 stale settlement
- **THEN** 客户端 MUST NOT 因该失败写入 settlement tombstone
- **AND** pending request MUST 保留并可重试

### Requirement: Claude Successful User Input Response MUST Emit Completed Lifecycle

Claude runtime 在成功接受 AskUserQuestion 答案后 MUST 发出 `completed=true` 的 `RequestUserInput` 生命周期事件，与超时结算路径对齐，供前端清理与墓碑写入。

#### Scenario: successful respond emits completed request user input

- **GIVEN** Claude session 存在 pending AskUserQuestion request
- **WHEN** `respond_to_user_input` 成功（MCP oneshot 或 native notify 路径）
- **THEN** runtime MUST 向该 turn 的订阅方 emit `RequestUserInput` 且 `completed=true`
- **AND** 事件 MUST 携带同一 request_id
- **AND** questions 可为 empty array

#### Scenario: successful respond does not leave resume wait re-entry for same request

- **GIVEN** 某 request_id 已成功 respond 并记入 session settled set
- **WHEN** 同一 native `AskUserQuestion` tool_use / 同 request_id 再次出现在 stream 转换路径
- **THEN** runtime MUST NOT 再次进入 kill+`--resume` 用户等待
- **AND** runtime MAY emit `completed=true` 或等效已结算信号，但 MUST NOT 重新注册 pending wait

#### Scenario: stream only waits on incomplete request user input

- **WHEN** Claude stream 收到 `EngineEvent::RequestUserInput`
- **AND** `completed=true`
- **THEN** runtime MUST NOT 调用 AskUserQuestion resume wait handler
- **AND** 仅当 `completed=false`（或缺省未完成）时 MUST 进入用户等待 / resume 流程
