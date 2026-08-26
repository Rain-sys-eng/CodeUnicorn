## MODIFIED Requirements

### Requirement: 输入采集确权 (A - Input Capture)

系统 MUST 在用户发送消息成功并拿到 turnId 后，按 **resolved engine** 自动采集输入文本（不限于 Claude / Codex），并为后续融合写入预留记忆 ID。`engine` 字段 MUST 透传 resolved engine（如 `claude` / `codex` / `gemini` / `grok` / `kimi` / `opencode`）。

#### Scenario: Claude 引擎自动采集

- **GIVEN** 用户使用 Claude 引擎发送消息
- **WHEN** 消息内容为 "帮我优化数据库查询"
- **THEN** 系统应调用 `project_memory_capture_auto`（或等价 captureTurnInput）
- **AND** 传入用户输入文本、workspace_id、thread_id、engine=`claude`
- **AND** 返回 memoryId 或 null(重复则跳过)

#### Scenario: Codex 引擎自动采集

- **GIVEN** 用户使用 Codex 引擎发送消息
- **WHEN** 消息内容为 "实现用户登录功能"
- **THEN** 系统应调用采集入口
- **AND** 采集逻辑与 Claude 引擎一致，engine=`codex`

#### Scenario: Grok / Kimi 引擎自动采集

- **GIVEN** 用户使用 Grok 或 Kimi native 引擎发送消息
- **WHEN** turn 启动成功并拿到 turnId
- **THEN** 系统 MUST 同样调用输入采集
- **AND** engine 分别为 `grok` / `kimi`

#### Scenario: 采集确权回调

- **GIVEN** 输入采集成功并返回 memoryId="memory-123"
- **WHEN** `onInputMemoryCaptured` 回调被触发
- **THEN** 应将 memoryId 存储到 `pendingMemoryCaptureRef`
- **AND** 关联到当前 threadId 和 turnId
- **AND** 等待 assistant 回复完成后融合写入

#### Scenario: 采集失败降级

- **GIVEN** 输入采集因网络错误失败
- **WHEN** 系统执行采集
- **THEN** 应捕获异常并记录 warn
- **AND** 不应阻塞消息发送
- **AND** 返回 null 表示跳过本次采集

### Requirement: 融合写入 (C - Fusion Write)

系统 MUST 在 assistant 回复完成后，将输入文本和输出摘要融合写入到记忆中。对 Gemini 系 native 引擎（gemini / grok / kimi），TurnCompleted 后 MUST 发出 `item/completed`（agentMessage），即便该 turn 已流式下发过 TextDelta，以便触发 `onAgentMessageCompleted` 完成融合。

#### Scenario: Update 优先模式

- **GIVEN** 输入采集时返回 memoryId="memory-123"
- **AND** assistant 回复完成后生成 outputDigest
- **WHEN** 执行融合写入
- **THEN** 应优先调用 `project_memory_update(memory-123, ...)`
- **AND** 更新 title、summary、detail 字段

#### Scenario: Create 降级模式

- **GIVEN** Update 操作失败(如 memoryId 不存在)
- **WHEN** 系统检测到 update 失败
- **THEN** 应降级调用 `project_memory_create`
- **AND** 设置 source 为 "assistant_output_digest"

#### Scenario: Grok/Kimi 流式 turn 完成后融合

- **GIVEN** native Grok 或 Kimi turn 已流式 TextDelta
- **AND** 输入侧已 capture 且 pending 未过期
- **WHEN** provider 发出 TurnCompleted 且最终文本非空
- **THEN** backend MUST emit `item/completed` agentMessage
- **AND** item id MUST 与 text lane 流式 delta 使用同一 stable id
- **AND** 前端 MUST 触发 `onAgentMessageCompleted` 并完成融合写入

#### Scenario: 融合写入成功后清理

- **GIVEN** 融合写入成功完成
- **WHEN** 系统完成 update 或 create 操作
- **THEN** 应清理 `pendingMemoryCaptureRef[threadId]`
