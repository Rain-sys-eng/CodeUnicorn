## ADDED Requirements

### Requirement: DirectoryGrant Surface MUST Scope Thread-Bound Requests To The Active Conversation

当 DirectoryGrant 请求携带明确 `threadId`（或等价会话绑定）时，系统 MUST 只在匹配的活动会话中显示对应内联授权卡，行为与现有 inline approval thread scoping 一致。

#### Scenario: matching thread renders its own directory grant
- **WHEN** 当前活动会话属于某个 workspace
- **AND** grant 队列中存在携带该活动 `threadId` 的 DirectoryGrantRequest
- **THEN** 内联 DirectoryGrant 表面 MUST 显示该请求
- **AND** 允许 / 拒绝 MUST 只作用于当前可见 request 集合

#### Scenario: unrelated thread does not render another thread's directory grant
- **WHEN** 同一 workspace 中另一条会话拥有带明确 `threadId` 的 DirectoryGrantRequest
- **AND** 用户当前查看的不是该 `threadId` 对应会话
- **THEN** 当前消息区 MUST NOT 渲染该 DirectoryGrant 卡
- **AND** 系统 MUST NOT 让用户误以为该授权属于当前会话

### Requirement: DirectoryGrant Surface MUST Preserve Compatibility For Requests Without Thread Identity

当 DirectoryGrant 无法解析 `threadId` 时，系统 MUST 走兼容回退，而不是直接丢弃该授权卡。

#### Scenario: threadless directory grant remains visible as workspace fallback
- **WHEN** 当前 workspace 中存在 DirectoryGrantRequest
- **AND** 该 request 没有可解析的 `threadId`
- **THEN** 内联 DirectoryGrant 表面 MUST 允许该 request 按 workspace 范围显示
- **AND** 系统 MUST NOT 因缺失 `threadId` 而 silent drop 该请求
