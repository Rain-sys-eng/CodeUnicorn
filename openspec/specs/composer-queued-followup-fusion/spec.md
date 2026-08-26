# composer-queued-followup-fusion Specification

## Purpose

Defines the composer-queued-followup-fusion behavior contract, covering Queued Follow-up Surface SHALL Match Composer Container Semantics.
## Requirements
### Requirement: Queued Follow-up Surface SHALL Match Composer Container Semantics

系统 MUST 将 composer 上方的排队消息区域渲染为与输入容器一致的组合式表面，而不是割裂的独立列表块。

#### Scenario: queued area keeps shared visual language with composer
- **WHEN** 当前线程存在至少一条排队消息
- **THEN** 系统 MUST 渲染排队容器并与下方 composer 保持一致的圆角、边框层级和背景语义
- **AND** 队列容器 MUST 视觉上属于同一输入组合区域

#### Scenario: queue items render as child cards inside shared surface
- **WHEN** 排队区域渲染多条队列项
- **THEN** 每条队列项 MUST 作为外层容器内的子卡片渲染
- **AND** 系统 MUST 避免出现外层圆角与内层 item 风格冲突的视觉断裂

### Requirement: Each Queued Follow-up SHALL Expose Dedicated Item Actions

系统 MUST 为每条排队消息提供独立动作入口，至少包含 `融合` 与 `删除`。

#### Scenario: queued item shows fuse and remove actions
- **WHEN** 队列项出现在当前活动线程的排队区域
- **THEN** 该队列项 MUST 提供 `融合` 按钮
- **AND** 该队列项 MUST 继续提供既有 `删除` 按钮

#### Scenario: unsupported runtime does not fake interactive fuse affordance
- **WHEN** 当前活动线程不满足融合条件
- **THEN** 系统 MUST NOT 展示“可点击且会成功”的假融合交互
- **AND** 融合入口 MUST 以禁用态或不可见方式表达不可用状态

### Requirement: Queued Follow-up Fusion SHALL Prefer Existing In-Run Follow-up Semantics

PI 引擎在本 change 后 `input.mid-turn = supported`（RPC `steer` 实证），融合按钮 MUST 对 pi 走 same-run steer 路径；pi 的默认排队行为 MUST 保持与当前客户端一致（queuedByThread 排队 + drain），不引入第二套 pi 原生队列 UI。

#### Scenario: pi 排队默认行为不变

- **WHEN** pi thread 处理中用户直接发送新消息
- **THEN** 消息 MUST 进入既有 mossx 队列（queuedByThread）
- **AND** 队列 UI MUST 与现状一致（composer 上方排队区域）
- **AND** MUST NOT 渲染 pi RPC 原生 `queue_update` 驱动的第二套队列

#### Scenario: pi 融合按钮 = same-run steer

- **WHEN** pi thread 存在排队消息且 fusion 条件满足
- **THEN** 融合按钮 MUST 可用
- **AND** 点击后 MUST 经 delivery decision 路由为 same-run steer（RPC `steer` 命令）
- **AND** steered user message MUST 由前端乐观气泡上幕布（既有链路），后端不重复投影
- **AND** 融合完成判定 MUST 等待新 continuation 证据（既有 pending 纪律不变）
- **AND** RPC 回退 print-json 时后端 MUST 拒绝并发发送（防双进程交叉写 session 文件）

#### Scenario: pi 融合条件不满足时降级

- **WHEN** RPC 会话不可用或已回退 print-json 路径
- **THEN** 融合按钮 MUST 以禁用态表达（fuseDisabledReasonKey 既有链路）
- **AND** MUST NOT 展示「可点击且会成功」的假融合交互

### Requirement: Queued Follow-up Fusion SHALL Preserve Queue Order Integrity

系统 MUST 在 fusion continuation 未接上的情况下有界结算当前融合动作，避免留下永久锁死的 fusion 状态。

#### Scenario: stalled continuation releases fusion lock and returns thread to recoverable state

- **WHEN** 用户对某一条队列项执行融合
- **AND** 在受限窗口内未收到新的 continuation 证据或终态事件
- **THEN** 系统 MUST 将该融合动作结算为 recoverable stalled / degraded
- **AND** 系统 MUST 清理该线程的 fusion lock
- **AND** 用户 MUST 能继续操作当前线程与后续排队消息

#### Scenario: terminal settlement clears unresolved fusion continuation

- **WHEN** 融合动作对应的恢复链最终收到了 completed、error、runtime-ended 或等效终态
- **THEN** 系统 MUST 清理该融合动作的待确认状态
- **AND** 剩余队列项 MUST 不再被已结束的 fusion continuation 阻塞

### Requirement: Queued Follow-up Fusion SHALL Preserve Original Message Payload

系统 MUST 在融合发送时保留原排队消息的完整 payload，而不是退化成纯文本 resend。

#### Scenario: fusion preserves text images and send options
- **GIVEN** 某条排队消息包含 `text`、`images` 或逐条 `sendOptions`
- **WHEN** 用户对该消息执行融合
- **THEN** 系统 MUST 使用与原排队项一致的 `text`、`images` 和 `sendOptions` 发送该消息
- **AND** 系统 MUST NOT 静默丢弃附件或逐条发送参数

### Requirement: Shared Queue Drain SHALL Require Typed Durable Acceptance

Shared queue drain MUST keep an item recoverable until the V2 send path returns a matching typed accepted result with canonical commit confirmation.

#### Scenario: Shared dispatch is blocked

- **WHEN** queue drain receives `blocked`, `target-unavailable`, `recovery-required`, or an ambiguous error
- **THEN** the original queue item MUST remain recoverable with its original order and payload
- **AND** the UI MUST NOT claim that it was sent

#### Scenario: Shared dispatch commits

- **WHEN** queue drain receives matching `status=accepted` and `v2.committed=true`
- **THEN** the item MAY be removed exactly once
- **AND** duplicate settlement or React effect execution MUST NOT dispatch it again

