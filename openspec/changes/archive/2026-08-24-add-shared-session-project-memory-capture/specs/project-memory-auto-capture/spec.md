## MODIFIED Requirements

### Requirement: 输入采集确权 (A - Input Capture)

系统 MUST 在用户发送消息成功后采集输入。对 **shared** thread，MUST 在 shared send 成功路径（含 V2 committed early-return）显式采集，不得依赖 native turn-start 公共块。

#### Scenario: Shared V2 committed 采集

- **GIVEN** threadKind 为 shared 且 Shared V2 send 返回 committed=true
- **AND** 存在 runtimeTurnId 或 logicalTurnId
- **WHEN** messaging 处理成功响应
- **THEN** 系统 MUST 调用 captureTurnInput
- **AND** turnId MUST 优先 runtimeTurnId，否则 logicalTurnId
- **AND** engine MUST 为 shared resolved engine
- **AND** MUST 触发 onInputMemoryCaptured 登记 pending

### Requirement: 融合写入 (C - Fusion Write)

系统 MUST 在 assistant 完成时融合写入。对 shared terminal 路径，即便已发出 normalized completeAgentMessage 投影，MUST 仍调用 onAgentMessageCompleted 以驱动记忆融合。

#### Scenario: Shared terminal 投影后仍融合

- **GIVEN** shared turn 已 capture 输入
- **AND** turn/completed 带非空 result text（或等价终态文本）
- **WHEN** 系统 settle shared terminal final
- **THEN** 可投影 completeAgentMessage 到 canvas
- **AND** MUST 调用 onAgentMessageCompleted（含 turnId）
- **AND** 记忆融合 handler MUST 能匹配 pending capture 并完成 update/create
