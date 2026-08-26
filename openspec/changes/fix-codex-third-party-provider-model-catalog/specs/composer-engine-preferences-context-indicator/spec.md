# Delta: composer-engine-preferences-context-indicator

## ADDED Requirements

### Requirement: Codex Usage Events MUST NOT Fabricate Context Window

Codex adapter 的 usage / tokenCount 事件转换 MUST NOT 在 runtime 未上报 `model_context_window` 时合成默认窗口值（如 200K）。窗口缺失时 `EngineEvent::UsageUpdate.model_context_window` MUST 透传 `None`，context usage indicator 与 turn badge 按既有「未上报」降级语义渲染，MUST NOT 基于伪造窗口计算百分比。auto-compaction 触发链路的窗口启发式是独立行为面，不受本 requirement 约束。

#### Scenario: third-party provider usage without window

- **WHEN** 三方 provider 绑定的 Codex 会话收到 tokenCount / usage 事件且未携带 context window 字段
- **THEN** 转换后的 usage 事件 MUST 携带 `model_context_window = null`
- **AND** context 指示器 MUST NOT 显示按 200K 计算的百分比
- **AND** turn badge / 回执按「未上报」语义展示

#### Scenario: runtime-reported window passes through

- **WHEN** Codex runtime 在 usage 事件中上报了真实 `model_context_window`
- **THEN** 转换后的事件 MUST 携带该值且不得改写
- **AND** context 指示器 MUST 按该值计算百分比
