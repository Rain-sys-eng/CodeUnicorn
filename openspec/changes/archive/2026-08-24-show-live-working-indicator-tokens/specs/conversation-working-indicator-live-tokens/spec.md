## ADDED Requirements

### Requirement: working indicator MUST show live turn token count beside the timer

当会话处于响应中且本轮 live token usage 可用时，working indicator MUST 在计时右侧显示 compact token 文案。文案 MUST 使用 i18n `messages.liveTokenUsage`，数值 MUST 来自当前线程 `activeTokenUsage.last` 的 input + cached input + output 之和，格式 MUST 与消息区 compact token（`formatTokenCount`）一致。没有本轮可靠计数时 MUST NOT 渲染 token 占位或分隔点。

#### Scenario: live usage appears while responding

- **WHEN** working indicator 正在显示且当前线程 live `last` token 计数大于 0
- **THEN** 计时右侧 MUST 显示 `· {{compact}} tokens` 形式的文案
- **AND** 该文案 MUST 随后续 `thread/tokenUsage/updated` 更新同一条 indicator，而不是另起一行

#### Scenario: no live usage yet

- **WHEN** working indicator 正在显示但本轮还没有大于 0 的 live token 计数
- **THEN** indicator MUST 仍显示 spinner、计时和「响应中...」
- **AND** MUST NOT 渲染 token 数字、`0 tokens` 或多余的 `·`

#### Scenario: stale previous-turn usage is hidden

- **WHEN** 新回合已经 `markProcessing(true)` 且现有 token usage 的 `lastTokenUsageUpdatedAt` 早于 `processingStartedAt`
- **THEN** working indicator MUST 隐藏该旧计数
- **AND** MUST 等到本轮新的 usage 快照后再显示

### Requirement: live working tokens MUST NOT ride the Messages root props

响应中 token 数字 MUST 由 WorkingIndicator（或其等价小树）通过 canvas selector / 等价窄订阅读取。系统 MUST NOT 把 `activeTokenUsage` 加入 `conversationCanvasNode` 送给 `Messages` 的根 props selector。

#### Scenario: Messages selector stays token-usage free

- **WHEN** 活跃流更新 `activeTokenUsage` 且 items / thinking / processingStartedAt 未变
- **THEN** `Messages` 根 props selector 的选中切片 MUST 保持引用稳定
- **AND** WorkingIndicator 仍 MAY 独立刷新 token 文案
