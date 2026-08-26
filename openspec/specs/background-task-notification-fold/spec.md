# background-task-notification-fold Specification

## Purpose
TBD - created by archiving change fold-background-task-notification. Update Purpose after archive.
## Requirements
### Requirement: Background 型 task-notification 默认折叠，不得进用户蓝气泡

当消息正文可被 `parseAgentTaskNotification` 解析，且判定为 Background 风格（`Background command "…"` / `Background shell` / 以 `Background` 开头的终态摘要 / `后台命令|后台任务|后台进程`）时，幕布 MUST 渲染默认收起的折叠条，MUST NOT 把该消息当作普通用户提问渲染右侧蓝气泡，MUST NOT 在折叠态露出裸 `<task-notification>` XML，MUST NOT 渲染 legacy `.message-agent-task-card`。

#### Scenario: 无 result 的后台命令完成回执走折叠条

- **WHEN** user 或 assistant 消息正文以 `<task-notification>` 开头，含 `task-id` / `status` / `summary`，summary 为 `Background command "Rebuild Windows bundles with latest code" completed`，且 **没有** `<result>`
- **THEN** 幕布 MUST 渲染 Background 折叠条（含 status 与后台任务完成文案）
- **AND** MUST NOT 渲染 `.message.user` 蓝气泡正文
- **AND** MUST NOT 在折叠态展示 `<task-notification>` 原文
- **AND** MUST NOT 渲染 `.message-agent-task-card`

#### Scenario: 展开后只展示一份详情

- **WHEN** 用户展开 Background 折叠条
- **THEN** 展开区 MUST 只展示一份详情：有 output snapshot 时渲染任务输出 inspector；否则渲染已解析 header 字段
- **AND** MUST NOT 同时堆叠 kv、原始 XML、inspector
- **AND** MUST NOT 在折叠态或展开态再单独渲染一份裸 `<task-notification>` 原文

#### Scenario: 有 result 的 Background shell 也不走旧卡

- **WHEN** notification summary 为 `Background shell task … completed` 且带非空 `<result>`
- **THEN** 幕布 MUST 仍走 Background 折叠条
- **AND** MUST NOT 渲染 `.message-agent-task-card`

### Requirement: 三类分流不得互相误伤

Background 折叠、SubAgent 退役、真用户提问蓝气泡 MUST 互斥。SubAgent 风格识别优先于 Background。parse 失败的普通文本 MUST 保持现有用户/助手气泡。

#### Scenario: SubAgent 通知不进入 Background 折叠

- **WHEN** notification summary 为 `Agent "架构治理评估" completed`（无论有无 `<result>`）
- **THEN** 幕布 MUST NOT 渲染 Background 折叠条
- **AND** MUST NOT 渲染 `.message-agent-task-card`

#### Scenario: 普通用户提问仍是蓝气泡

- **WHEN** user 消息正文是普通提问（不以 `<task-notification>` 或等价 entity-escaped envelope 开头）
- **THEN** 幕布 MUST 仍按普通用户消息呈现
- **AND** MUST NOT 渲染 Background 折叠条

#### Scenario: 散文提及 markup 不得被解析为通知

- **WHEN** 文本在正文中间提到 `<task-notification>` markup，但 envelope 不是载荷开头
- **THEN** `parseAgentTaskNotification` MUST 返回 null
- **AND** 该消息 MUST NOT 走 Background 折叠或 legacy agent-task 卡

### Requirement: 非 Background 且非 SubAgent 的旧卡保留

已解析、但既不是 SubAgent 也不是 Background 的 task-notification MUST 继续允许 legacy `.message-agent-task-card`（若产品仍依赖该路径）。本 capability MUST NOT 全局删除所有 task-notification 渲染。

#### Scenario: 通用有 result 通知仍可走旧卡

- **WHEN** task-notification 带非空 `<result>`，且 summary 无法识别为 SubAgent 或 Background
- **THEN** MessageRow MAY 继续渲染 `.message-agent-task-card`

### Requirement: 后台 wakeup 不得把已落盘 assistant 再恢复一份

CLI 注入的 Background / SubAgent `role=user` task-notification MUST NOT 被当成 shadow recovery 或 live assistant 等价搜索的新 turn 边界。幕布 MUST 只保留一份与 wakeup 之前相同的 assistant 正文。

#### Scenario: 历史里已有「已丢到后台」时不再 shadow 追加

- **WHEN** 历史为 `[user 提问, assistant「已丢到后台…」, user <task-notification> wakeup]`，且 live shadow 正文与该 assistant 等价
- **THEN** 幕布 MUST 只保留一份 assistant 正文
- **AND** MUST NOT 在 fold 后再追加 `claude-shadow-recovered-*`

#### Scenario: 无 assistant 的中断恢复仍可追加

- **WHEN** 历史只有 user（及 reasoning），没有 assistant 正文，但存在 unsettled shadow
- **THEN** loader MAY 追加一条 recovered assistant

