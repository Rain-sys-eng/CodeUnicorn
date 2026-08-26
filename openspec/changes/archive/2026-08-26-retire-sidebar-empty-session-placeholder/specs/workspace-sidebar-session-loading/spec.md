## ADDED Requirements

### Requirement: Workspace sidebar MUST NOT render a "no sessions" empty placeholder

workspace / worktree session 列表 MUST NOT 渲染「暂无会话 / No sessions yet」空态占位。空列表 MUST 渲染为无占位（nothing），而不是一行可能引起归属歧义或谎报的文案。

#### Scenario: Hydrated empty workspace renders no placeholder

- **GIVEN** workspace 已完成 first-paint hydration
- **AND** session 列表为空（含权威空与非权威空）
- **WHEN** 侧栏绘制该 workspace
- **THEN** MUST NOT 出现「暂无会话」占位行
- **AND** MUST NOT 出现 loading 占位

#### Scenario: Disconnected workspace renders neither loading nor empty text

- **GIVEN** workspace `connected === false`
- **WHEN** 侧栏绘制该 workspace
- **THEN** MUST NOT 出现 loading 占位
- **AND** MUST NOT 出现「暂无会话」

### Requirement: Loading placeholder MUST persist until rows arrive or the grace deadline

unconfirmed-empty settle 未证实（失败 / 超时 / 仍非权威空）时，系统 MUST NOT 将该 workspace 标为 hydrated——loading 占位 MUST 持续到会话行真正出现（`session-index-imported` → ensure 合并）或 `EMPTY_SETTLE_LOADING_GRACE_MS`（20s）宽限到期；全程 MUST NOT 出现无占位的空白期，也 MUST NOT 闪「暂无会话」。settle 确认（有行或权威空）时 MUST 立即标 hydrated 终态。

#### Scenario: Settle timeout keeps loading until importer fills rows

- **GIVEN** first-paint 与 settle 均返回非权威空
- **WHEN** settle 已结束而 importer 尚未落盘
- **THEN** 侧栏 MUST 继续显示 loading 占位
- **AND** MUST NOT 标 hydrated、MUST NOT 出现空白期

#### Scenario: Grace deadline terminates loading for a truly empty workspace

- **GIVEN** settle 未证实且宽限期内无任何行到达
- **WHEN** `EMPTY_SETTLE_LOADING_GRACE_MS` 到期
- **THEN** 系统 MUST 标 hydrated 终态并停止 loading（渲染为空白）
- **AND** MUST NOT 永生 loading

#### Scenario: Rows arriving during grace paint directly

- **GIVEN** 宽限期内的 workspace 仍在 loading
- **WHEN** `session-index-imported` 触发 ensure 合并得到会话行
- **THEN** 侧栏 MUST 直接从 loading 切换为会话行
- **AND** 中间 MUST NOT 出现「暂无会话」或空白期

### Requirement: Loading placeholder MUST label the current phase

loading 占位 MUST 给出阶段描述文案：初始为「读取会话索引」（first-paint 快路径）；持续超过 first-paint 预算（`INDEX_PHASE_LABEL_MS = 4s`）仍在 loading 时 MUST 切换为「完整扫描本地会话」（二次强制同步 / 等 importer 长查询）。阶段标签 MAY 用组件本地计时近似，MUST NOT 要求跨层 phase 状态传递。

#### Scenario: Slow load swaps the label after the index budget

- **GIVEN** 某 workspace 正在显示 loading 占位
- **WHEN** loading 已持续 4s 仍未出行
- **THEN** 文案 MUST 从「正在读取会话索引…」切换为「正在完整扫描本地会话…」
- **AND** spinner MUST 保持转动
