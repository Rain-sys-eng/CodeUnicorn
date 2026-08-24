## MODIFIED Requirements

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
