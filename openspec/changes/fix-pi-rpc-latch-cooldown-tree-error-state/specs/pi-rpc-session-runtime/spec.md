## MODIFIED Requirements

### Requirement: Resident MUST 按会话隔离（真并行）

系统 MUST 为每个 native PI session 维护独立的 `pi --mode rpc` resident process（map key = 有效 session id；无 id 的新发送用 scratch/turn 独占进程）。同一 workspace 的多条 PI 会话 MUST 能同时 streaming。禁止用一只进程靠 `switch_session` 串行所有标签。

workspace 级 `rpc_disabled` 闩（spawn/handshake 失败置位）MUST 只拦截新 spawn；已存活的 resident MUST 继续复用，不得因其它会话的一次 spawn 失败被降级。闩 MUST 带冷却自恢复：冷却期（60s）过后放行一次试探 spawn，成功即清闩，失败重新计时；禁止闩在 app 生命周期内不可逆。

#### Scenario: 两条 PI 会话同时发送

- **WHEN** 同一 workspace 中会话 A 正在 streaming，用户向会话 B（或新会话）发送
- **THEN** 系统 MUST 为 B 使用（或惰性 spawn）独立 resident 并受理 prompt
- **AND** MUST NOT 返回「另一 PI 会话的 turn 仍在进行中」
- **AND** A 的 run / 事件流 MUST 不受影响

#### Scenario: 同会话二次发送仍走 steer

- **WHEN** 同一 session id 上已有未 settle 的 run
- **THEN** 系统 MUST 在该 resident 上发送 `steer`（same-run 融合）
- **AND** MUST NOT 再 spawn 第二只进程

#### Scenario: 新会话不得复用上一场进程

- **WHEN** 发送未带有效 session id（新会话 / pending）
- **THEN** 系统 MUST spawn 新的 scratch resident，MUST NOT 回落到 workspace 级 tracked session id

#### Scenario: 树/统计/compact/fork 命令按会话取 resident

- **WHEN** 执行 `pi_get_session_tree` / `pi_get_session_stats` / `pi_compact` / `pi_fork` / `pi_get_fork_messages`
- **THEN** 命令 MUST 携带调用方 thread 的 session id 并使用该 session 的 resident
- **AND** MUST NOT 打开树/统计时 spawn 一只无 session 的共享进程给后续发送复用

#### Scenario: 活跃 run 禁止 fork/compact（仅挡本会话）

- **WHEN** 目标 session 存在未 settle 的 agent run 且调用 `pi_fork` / `pi_compact`
- **THEN** 系统 MUST 拒绝并返回「turn 仍在进行中」（fork 会切该进程的会话文件；pi `compact()` 内部第一步是 `abort()`）
- **AND** 其它 PI 会话的 resident MUST 不受影响
- **AND** 守卫 MUST 只读取该 session 的 run（对齐会先清掉本 resident 丢失 settle 的僵尸 run）

#### Scenario: RPC 禁用闩不得误伤存活 resident

- **WHEN** 某次 RPC spawn/handshake 失败已置 workspace 级 `rpc_disabled`，且另一 session 的 resident 仍存活
- **THEN** 后续发送 MUST 继续复用该存活 resident（RPC 主路径）
- **AND** 仅需要新 spawn 的会话才允许被禁用闩降级 print-json

#### Scenario: 禁用闩冷却过后自动试探恢复

- **WHEN** `rpc_disabled` 置位未超过冷却期（60s）
- **THEN** 新 spawn MUST 被拒绝（返回「pi rpc disabled after previous failure」）
- **WHEN** `rpc_disabled` 置位已超过冷却期
- **THEN** 下一次需要新 spawn 的操作 MUST 被放行试探
- **AND** 试探成功 MUST 清除闩并恢复全量 RPC 路径
- **AND** 试探失败 MUST 重新计时（同一冷却窗口内不得重复试探）
