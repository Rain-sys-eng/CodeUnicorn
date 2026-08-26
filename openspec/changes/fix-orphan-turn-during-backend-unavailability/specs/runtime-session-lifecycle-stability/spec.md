# Delta: runtime-session-lifecycle-stability

## ADDED Requirements

### Requirement: Native Engine Turn Zero-First-Event Window MUST Be Bounded

Native 引擎 turn 在进入「响应中」（processing）状态后，若持续未收到任何引擎事件（零首事件窗口），系统 MUST 在有界阈值（默认 90s，可配置）内 settle 该 turn：前端看门狗 MUST 清除 processing 状态与 activeTurnId，并落一条可重试错误消息；turn MUST NOT 永久停留在「响应中」。

看门狗 MUST 在收到该 turn 的任意首事件（任何 `turn/*`、`item/*`、`session/*` 或 delta 事件）时取消，MUST NOT 误杀正常慢启动 turn；与 terminal / interrupt / rpcError 的清除路径 MUST 互斥（已 settled turn 不重复触发）。shared-session V2 发送路径 MUST NOT 挂载此看门狗（由其 durable 状态机自管）。

#### Scenario: zero-first-event orphan turn settles as retryable error

- **WHEN** native 引擎 turn 进入 processing 后超过阈值（默认 90s）未收到任何引擎事件
- **THEN** 系统 MUST 清除该 thread 的 processing 状态与 activeTurnId
- **AND** MUST 落一条可重试错误消息（i18n 文案），允许用户重发
- **AND** MUST 发出诊断事件（含 elapsedMs / engine / threadId / activeTurnId）

#### Scenario: first event within threshold cancels the watchdog

- **WHEN** turn 首事件（含 `turn/started`、`item/*`、`session/*`、任意 delta）在阈值内到达
- **THEN** 看门狗 MUST 取消
- **AND** turn 行为 MUST 与无看门狗时完全一致（零额外干预）

#### Scenario: settled turn does not re-trigger

- **WHEN** turn 已通过 terminal 事件、interrupt 或 rpcError 路径 settled
- **THEN** 看门狗 MUST NOT 触发（互斥），MUST NOT 产生重复错误消息
