# session-delete-v2 spec delta

## ADDED Requirements

### Requirement: Session Deletion SHALL Resolve Targets Via Session Index First

系统 MUST 通过 session index（SQLite）点查定位删除目标，MUST NOT 为解析 owner workspace 而全量扫描 engine 磁盘会话。index miss 时系统 MUST 按 engine 已知路径规则定向查找（单文件 stat / 文件名 glob），仍无法定位且无 engine 前缀时 MUST 按 ghost 处理（只摘 index 行，不碰磁盘）。

#### Scenario: index hit resolves in O(1)

- **WHEN** 用户删除一条已入 session index 的会话
- **THEN** 系统 MUST 通过 index 点查取得 `engine` / `workspace_path` / `physical_path`
- **AND** MUST NOT 触发 `SessionCatalogScanMode::Exhaustive` 级别的全量 catalog 构建

#### Scenario: index miss with engine prefix falls back to targeted locate

- **WHEN** 删除目标的 threadId 带已知 engine 前缀（如 `claude:` / `shared:`）但 index 无行
- **THEN** 系统 MUST 按该 engine 的路径规则定向查找候选文件
- **AND** MUST NOT 回退到全量磁盘扫描

#### Scenario: unresolved target without prefix is ghost-cleaned

- **WHEN** 删除目标既无 index 行也无 engine 前缀
- **THEN** 系统 MUST 返回 `GHOST_CLEANED` 并 tombstone index 行
- **AND** MUST NOT 触碰磁盘文件

### Requirement: Session Deletion SHALL Be Marker-First

用户确认删除后，系统 MUST 先落删除标记（tombstone），再执行磁盘物理删除。物理删除失败 MUST NOT 影响侧栏隐藏语义；只有标记本身失败时 MUST 整项回滚并报 `IO_FAILED`。

#### Scenario: physical delete failure keeps session hidden

- **WHEN** 删除标记已落但磁盘物理删除失败（IO 错误 / daemon 不可用 / 超时）
- **THEN** 系统 MUST 返回 `MARKED_DELETED`
- **AND** 侧栏 MUST 保持不显示该会话（`tombstoned_at IS NULL` 过滤 + ON CONFLICT 守卫防 rescan 复活）
- **AND** 系统 SHOULD 在后台低优先重试物理删除残留

#### Scenario: marker failure rolls back the item

- **WHEN** tombstone 写入失败
- **THEN** 系统 MUST 返回 `IO_FAILED`
- **AND** 前端 MUST 回滚该会话行恢复显示

### Requirement: Deletion Command SHALL Return Immediately And Report Via Events

`delete_workspace_sessions_v2` MUST 立即返回 `requestId`，删除进度与最终结果 MUST 通过 `session-delete:progress` / `session-delete:settled` 事件通道回推。批量删除 MUST 恒为一次 IPC，MUST NOT 存在逐条回退路径。

#### Scenario: command returns requestId without waiting

- **WHEN** 前端调用 `delete_workspace_sessions_v2`
- **THEN** 命令 MUST 立即返回 `{ requestId }`
- **AND** 最终结果 MUST 经 `session-delete:settled` 事件送达

#### Scenario: batch delete is a single IPC

- **WHEN** 用户批量删除任意 engine 组合的多条会话
- **THEN** 前端 MUST 只发起一次 `delete_workspace_sessions_v2` 调用
- **AND** 每条结果 MUST 在 settled 事件中按 sessionId 对账

### Requirement: Frontend SHALL Delete Optimistically With Rollback

前端 MUST 在用户确认删除后立即从侧栏摘除会话行（乐观删除），并以 settled 结果对账：失败项 MUST 通过 reducer 单动作回滚归位并提示错误码；30s 未收到 settled MUST 按超时回滚。

#### Scenario: row disappears immediately on confirm

- **WHEN** 用户在删除确认框点击确认且 flag `ccgui.delete.v2` 开启
- **THEN** 侧栏行 MUST 立即消失，确认框 MUST 立即关闭

#### Scenario: failed deletion rolls back the row

- **WHEN** settled 结果中该项为失败码（非 `OK` / `ALREADY_MISSING` / `GHOST_CLEANED` / `MARKED_DELETED`）
- **THEN** 前端 MUST 将该会话行按 `updatedAt` 归位恢复
- **AND** MUST 向用户展示错误提示

### Requirement: Deletion Results SHALL Use Unified SessionDeleteCode

删除结果 MUST 使用统一 `SessionDeleteCode` 枚举，MUST NOT 依赖错误字符串猜测判定成功/失败。幂等成功收敛为 `OK` / `ALREADY_MISSING` / `GHOST_CLEANED` / `MARKED_DELETED`。

#### Scenario: already-missing file is idempotent success

- **WHEN** 目标文件在磁盘上已不存在
- **THEN** 系统 MUST 返回 `ALREADY_MISSING` 并视为成功

#### Scenario: dsh daemon unavailable is retryable

- **WHEN** dsh 删除因 daemon 连接超时（5s）失败
- **THEN** 系统 MUST 返回 `ENGINE_BUSY`
- **AND** 前端 MUST 允许用户重试
