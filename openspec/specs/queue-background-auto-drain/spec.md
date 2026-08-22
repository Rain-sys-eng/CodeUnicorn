# queue-background-auto-drain Specification

## Purpose

Defines safe queued follow-up dispatch across active and non-active threads.

## Requirements

### Requirement: Non-Active Thread Queue SHALL Auto-Drain When Ready

系统 MUST 在 thread 非焦点时，仍对该 thread 的 queued follow-up 执行 auto-drain，只要该 thread 处于 ready 状态。ready 判定 MUST 基于 per-thread 信号（至少包括 isProcessing、inFlight、fusion、pending user input、shared send idle 若适用），MUST NOT 仅因为 `activeThreadId !== threadId` 而跳过 drain。

#### Scenario: switch workspace keeps source queue draining

- **GIVEN** thread A 存在至少一条 queued message 且 A 的当前 turn 已结束（ready）
- **AND** 用户将焦点切换到 thread B
- **WHEN** 调度循环运行
- **THEN** 系统 MUST 从 A 的队列 head 派发下一条消息
- **AND** 系统 MUST NOT 要求用户回到 A 才开始 drain

#### Scenario: active-only freeze is forbidden

- **GIVEN** 任意 non-active thread 满足 ready 且 queue 非空
- **WHEN** 仅因为该 thread 不是 active thread
- **THEN** 系统 MUST NOT 仅据此拒绝 drain

### Requirement: Background Drain Concurrency SHALL Cap At One

系统 MUST 将「非 active thread 上同时处于 drain in-flight 的数量」限制为最多 1。Active thread 的 drain MUST NOT 占用该后台配额。

#### Scenario: second background thread waits

- **GIVEN** 已有 1 个 non-active thread 有 in-flight drain
- **AND** 第 2 个 non-active thread 也 ready 且 queue 非空
- **WHEN** 调度循环运行
- **THEN** 系统 MUST 暂缓第 2 个 thread 的 drain
- **AND** 当任一后台 in-flight 结束后 MUST 允许后续后台 drain

#### Scenario: active drain ignores background quota

- **GIVEN** 已有 1 个 non-active in-flight drain
- **AND** active thread ready 且 queue 非空
- **WHEN** 调度循环运行
- **THEN** 系统 MUST 仍允许 active thread drain

### Requirement: Drain Dispatch SHALL Not Cross Thread Or Workspace

系统 MUST 将 queued message 派发到 enqueue 时所属的 workspace 与 thread。后台 drain MUST 使用按 thread 定向的发送路径（例如 `sendUserMessageToThread`），MUST NOT 使用仅绑定 active session 的发送入口导致串线。

#### Scenario: background drain targets owner thread

- **GIVEN** thread A 上入队消息 M（owner 为 workspace W、thread A）
- **AND** 当前 active 为 thread B
- **WHEN** 系统 drain M
- **THEN** 系统 MUST 向 thread A / workspace W 发送
- **AND** 系统 MUST NOT 将 M 发送到 thread B

#### Scenario: missing owner blocks unsafe fallback

- **GIVEN** queue item 无法解析合法 owner workspace/thread
- **WHEN** 调度尝试 drain 该 item
- **THEN** 系统 MUST NOT 盲发到 active session
- **AND** item MUST 保留在原 queue（或等价安全 hold）直到 owner 可解析或用户删除

### Requirement: Hold Semantics Remain Per-Thread

系统 MUST 在下列 per-thread 条件下 hold drain：isProcessing、inFlight、fusion 进行中、pending user input（AskUserQuestion 等）、shared send 非 idle / recovery-required（若 shared）。Hold MUST 只作用于该 thread，MUST NOT 全局冻结其他 ready thread 的后台 drain（后台配额除外）。

#### Scenario: ask-user on A does not block B

- **GIVEN** thread A 存在 pending user input
- **AND** thread B ready 且 queue 非空
- **WHEN** 调度循环运行
- **THEN** 系统 MUST hold A
- **AND** 系统 MAY drain B（受并发上限约束）

### Requirement: Shared Pending ACK SHALL Have An Explicit Safe Abandon Path

当 Shared V2 dispatch 已进入 `pending-ack` 且未获得可结算结果时，系统 MUST NOT 将队列条的删除操作静默忽略。系统 MUST 要求用户确认潜在 Runtime 已接收风险，并且只可通过 Shared V2 的 terminal abandon contract 结束该 attempt。系统 MUST NOT 自动重发或本地强清 in-flight。

#### Scenario: user confirms abandoning an unresolved handoff

- **GIVEN** Shared queue item M 为 `pending-ack` 且存在可验证的 unresolved attempt
- **WHEN** 用户点击删除并在确认对话框中选择放弃
- **THEN** 系统 MUST 先调用 Shared V2 terminal abandon contract
- **AND** 仅当该调用成功后，M 才能从 queue 与 in-flight 状态移除
- **AND** 系统 MUST NOT 自动重新派发 M

#### Scenario: abandon fails or owner cannot be verified

- **GIVEN** Shared queue item M 为 `pending-ack`
- **WHEN** terminal abandon 失败或 attempt owner 无法验证
- **THEN** 系统 MUST 保留 M 与其 in-flight/recovery state
- **AND** 系统 MUST NOT 将 M 发送到当前 active thread 作为 fallback

### Requirement: Queued Persistence SHALL Remain Owner Scoped

系统 MUST 用 queue item 的 `ownerWorkspaceId` 与 `ownerThreadId` 持久化该 item 的变更，而不是以当时的 active workspace/thread 覆盖。rehydrate MUST 保留 owner 字段；owner 缺失或不一致的 item MUST 安全 hold。

#### Scenario: background owner persists while another thread is active

- **GIVEN** thread A 的 queue 在用户已切换到 thread B 后发生变更
- **WHEN** 系统持久化 queue
- **THEN** 系统 MUST 写回 thread A / workspace A 的 queue
- **AND** 系统 MUST NOT 覆盖 thread B 的 queue 或将 A 的 item 归属为 B

#### Scenario: rehydrated item has no valid owner

- **GIVEN** 重启后 rehydrated queue item 缺失合法 owner
- **WHEN** drain scheduler 运行
- **THEN** 系统 MUST 保留该 item 并安全 hold
- **AND** 系统 MUST NOT 以 active workspace/thread 作为发送 fallback
