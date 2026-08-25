## ADDED Requirements

### Requirement: 会话树加载失败 MUST 显示错误态与重试入口

会话树面板 MUST 区分「加载中」与「加载失败」两种状态。加载失败时 MUST 就地显示失败提示、后端错误详情与重试入口；禁止以「加载中…」掩盖失败。存在 last-good 快照时 MUST 继续渲染旧树，不得因刷新失败闪错误页。

#### Scenario: 首次加载失败显示错误态

- **WHEN** 会话树首次加载失败（RPC 不可用 / 超时 / 命令错误）且无任何已缓存树
- **THEN** 面板 MUST 显示「加载失败」提示与错误详情
- **AND** MUST 提供重试按钮，点击后重新发起加载并回到加载中状态

#### Scenario: 重试开始即清除旧错误

- **WHEN** 用户点击重试（或任何路径再次触发 `refreshPiSessionTree`）
- **THEN** 上一次的错误态 MUST 在尝试开始时被清除
- **AND** 成功后正常渲染树；再次失败则显示新的错误详情

#### Scenario: 刷新失败保留 last-good 快照

- **WHEN** 已有成功渲染的树，后续刷新失败
- **THEN** 面板 MUST 继续渲染旧树
- **AND** MUST NOT 切换到整页错误态
