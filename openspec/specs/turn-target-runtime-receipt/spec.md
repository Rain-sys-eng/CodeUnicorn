# turn-target-runtime-receipt Specification

## Purpose

Defines Shared-only turn badge runtime receipt: picker identity stays on `executionTargetSnapshot`, live model/window live on `runtimeReceipt`, Native CLI sessions never render the badge.

## Requirements
### Requirement: Native CLI sessions MUST NOT show turn badge or runtime receipt

Native Claude / Codex / Gemini / Grok / Kimi / OpenCode / PI / DSH 会话 MUST NOT 写入 `executionTargetSnapshot` 或 `runtimeReceipt` 到助手消息。系统 MUST NOT 在 Native 助手气泡渲染 turn badge 或 `→` 回执。

#### Scenario: Native live assistant has no badge

- **GIVEN** 当前是 Native CLI 会话
- **WHEN** 用户发送一条消息并出现助手气泡
- **THEN** 该消息 MUST NOT 带 `executionTargetSnapshot`
- **AND** MUST NOT 带 `runtimeReceipt`
- **AND** UI MUST NOT 渲染 turn badge

### Requirement: Shared assistant turns MUST carry a picker snapshot and inline receipt

Shared 在已知 engine / provider / send model 时，MUST 把 picker 身份写入 `executionTargetSnapshot`，并立刻用 `send.request` 写入 `runtimeReceipt`。snapshot.model MUST 表示发送时 picker / mapping 请求名，MUST NOT 被后来的 runtime 回写覆盖。回执 MUST 在同一行渲染高亮 `→`、圆形 `R` 章、`{model}` 与可选 `{windowLabel}`。窗口未知时 windowLabel MAY 为 `?`，MUST NOT 用 200K 占位。

#### Scenario: Shared send-time receipt is visible before stream model arrives

- **GIVEN** Shared 用户发送 `k3`
- **WHEN** 助手气泡出现
- **THEN** 同一行 MUST 出现 picker 段与高亮 `→ R k3`

#### Scenario: Shared snapshot remains the picker identity

- **GIVEN** Shared 发送时 snapshot.model 为 `sonnet`
- **WHEN** runtime 回写 `deepseek-v4-pro-0813[1m]`
- **THEN** snapshot.model MUST 仍为 `sonnet`
- **AND** 真实模型 MUST 只出现在 `runtimeReceipt`

#### Scenario: Stream-reported model upgrades the Shared receipt

- **GIVEN** Shared badge 已显示 `Claude Code · DeepSeek · sonnet → R sonnet`
- **WHEN** assistant 事件带来 `message.model = deepseek-v4-pro-0813[1m]` 且 live window 为 1_000_000
- **THEN** 回执 MUST 升级为 `→ R deepseek-v4-pro-0813[1m] 1M`
- **AND** picker 段 MUST 仍为 `sonnet`

#### Scenario: Unknown window does not fake 200K

- **GIVEN** Shared receipt 已有模型
- **AND** `model_context_window` 缺失
- **THEN** 回执 MUST 显示模型
- **AND** MUST NOT 显示 `200K`

#### Scenario: Synthetic model is ignored

- **WHEN** Shared `message.model` 为 `<synthetic>` 或空
- **THEN** 系统 MUST NOT 用它覆盖已有 receipt
- **AND** MUST NOT 渲染空箭头

### Requirement: Clicking the Shared receipt MUST slide down provenance in the bubble

回执 MUST 是可激活的 control。激活后 MUST 在气泡内下滑展示可读出处：CLI、供应商、请求模型、实际模型、回执来源说明、上下文窗口。窗口未上报时 MUST 写「未上报」并解释不估 200K，MUST NOT 只显示 `?`。若本轮有耗时或 token，MUST 追加「本轮用量」。再次激活 MUST 收起。

#### Scenario: User opens the receipt provenance

- **GIVEN** Shared 助手气泡已有 `→ R` 回执
- **WHEN** 用户点击回执
- **THEN** badge 下方 MUST 下滑出处面板
- **AND** 面板 MUST 包含 picker 请求名、runtime 模型、来源说明
- **AND** 窗口未知时 MUST 显示「未上报」而不是单独一个 `?`

### Requirement: Shared CLI adapter chrome MUST keep the original muted color

Shared 侧栏 engine badge 与顶栏 Shared 图标 MUST 使用与 native engine badge 相同的 muted / inherit 原色。系统 MUST NOT 用 `#f59e0b` 表示 Shared 适配。

#### Scenario: Shared sidebar icon is not orange

- **GIVEN** 侧栏有一条 Shared 会话
- **WHEN** 渲染 engine badge
- **THEN** 图标颜色 MUST 继承 `thread-engine-badge` 原色
- **AND** MUST NOT 使用 `#f59e0b`

