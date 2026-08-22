## ADDED Requirements

### Requirement: Working-indicator live tokens MUST stay off the Messages root lane

Working indicator 展示 live token 时，token usage 抖动 MUST 只使 indicator 小树或 canvas selector 订阅者失效。它 MUST NOT 把 `activeTokenUsage` 并入 Messages 根 props，也 MUST NOT 为了刷新 token 文案重建 `TimelineLiveModel`。

#### Scenario: token usage updates do not invalidate Messages root props

- **WHEN** 活跃线程收到新的 `thread/tokenUsage/updated` 且幕布 items / thinking 状态未变
- **THEN** `conversationCanvasNode` 送给 `Messages` 的 selector 切片 MUST 保持不变
- **AND** live token 文案仍 MAY 在 WorkingIndicator 内更新
