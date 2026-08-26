# session-archive-v2 spec delta

## ADDED Requirements

### Requirement: Session Archive SHALL Resolve Targets Via Session Index First

系统 MUST 通过 session index（SQLite）点查定位归档目标，MUST NOT 为解析 owner workspace 而构建 `SessionCatalogScanMode::Exhaustive` 级别的全量 catalog。index miss 时系统 MUST 按 engine 前缀定向解析（`claude:` / `shared:` / 已知 engine 前缀），owner workspace 回退为请求 workspace；裸 codex id 按 codex engine 处理。

#### Scenario: index hit resolves in O(1)

- **WHEN** 用户归档一条已入 session index 的会话
- **THEN** 系统 MUST 通过 index 点查取得 `engine` / `workspace_path` / `provider_profile_id`
- **AND** 由 `workspace_path` 反查 owner workspace id
- **AND** MUST NOT 触发 engine 磁盘历史全量扫描

#### Scenario: index miss falls back to engine prefix with requesting workspace as owner

- **WHEN** 归档目标的 id 带已知 engine 前缀（如 `claude:`）但 index 无行
- **THEN** 系统 MUST 以请求 workspace 作为 owner workspace 写归档 metadata
- **AND** MUST NOT 回退到全量 catalog 扫描

### Requirement: Session Archive SHALL Settle Via Catalog Metadata Only

归档结算 MUST 仅写 catalog metadata 的 `archived_at_by_session_id`；metadata key MUST 由纯函数从 `(owner_workspace_id, session_id)` 推导（与列表读取路径的 lookup key 规则一致），MUST NOT 依赖全量 catalog entry。归档 MUST 幂等。

#### Scenario: archive writes stable metadata key

- **WHEN** 归档目标解析成功
- **THEN** 系统 MUST 按 owner workspace 分组，一次 metadata mutation 写入 `archived_at`
- **AND** 写入的 key MUST 能被 `archived_at_for_entry` / archive evidence 读取路径命中

#### Scenario: archive is idempotent

- **WHEN** 归档一条已归档的会话
- **THEN** 系统 MUST 返回 `ok=true` 且 code 为 `ALREADY_ARCHIVED`，回传既有 `archivedAt`
- **AND** MUST NOT 改写既有 `archived_at` 时间戳

#### Scenario: unarchive of non-archived session reports NOT_ARCHIVED

- **WHEN** 取消归档一条 metadata 中无归档记录的会话
- **THEN** 系统 MUST 返回 `ok=false` 且 code 为 `NOT_ARCHIVED`

### Requirement: Codex App-Server Archive RPC SHALL Be Background Best-Effort

Codex 会话的 `thread/archive` app-server RPC MUST 在 metadata 落盘成功后以后台任务执行（fire-and-forget，有界 timeout），MUST NOT 阻塞命令返回，MUST NOT 进入结果码；workspace session 未连接时 MUST 快速跳过，MUST NOT 为归档冷拉起 app-server。

#### Scenario: archive returns without waiting for app-server RPC

- **WHEN** 归档一批包含 codex 会话的目标
- **THEN** 命令 MUST 在 metadata 写入完成后立即返回
- **AND** RPC 耗时 MUST NOT 累加进命令耗时

### Requirement: Sidebar Archive SHALL Remove Row Locally Without Full Rescan

侧栏归档成功后，前端 MUST 通过本地状态移除该会话行（含 cached summaries / live channels 清理），MUST NOT 触发 `force: true` 的 full-catalog 线程列表重建。归档当前活动会话时 MUST 同时清空 active thread 选择。

#### Scenario: archived row disappears immediately

- **WHEN** 侧栏归档一条会话成功
- **THEN** 该行 MUST 即时从侧栏消失
- **AND** MUST NOT 发起 full-catalog hydration

### Requirement: Session Management Archive SHALL NOT Reload On Full Success

Session Management 多选归档/取消归档全部成功时，前端 MUST 以本地 patch（移除行或更新 `archivedAt`）作为最终状态，MUST NOT 默认触发 primary / related / projectionSummary 的 catalog 重查；存在失败项时 SHOULD reload 对账。

#### Scenario: multi-select archive patches locally

- **WHEN** 多选归档全部成功
- **THEN** 列表 MUST 本地更新
- **AND** MUST NOT 发出三个 catalog reload 查询

### Requirement: Archive Shortcut SHALL Archive Instead Of Delete

`archiveThread` 快捷键（默认 cmd+ctrl+a）MUST 归档当前活动会话（与侧栏归档同链路），MUST NOT 走删除链路。

#### Scenario: shortcut archives active thread

- **WHEN** 用户按下 archive 快捷键
- **THEN** 当前会话 MUST 被归档并从侧栏本地移除
- **AND** 磁盘会话数据 MUST NOT 被删除

### Requirement: Legacy Archive Commands SHALL Be Removed

旧链路命令 `archive_workspace_sessions` / `unarchive_workspace_sessions` / `archive_thread`（Tauri 命令、core 实现、daemon 分支、前端 service 与 action creators）MUST 移除，前端所有调用点 MUST 切换到 v2 命令。`codex_core::archive_thread_core` / `archive_thread_best_effort_core` 作为内部复用函数保留（rewind / delete / v2 后台任务使用）。

#### Scenario: no caller references legacy archive commands

- **WHEN** 全仓搜索 `archive_workspace_sessions`（非 v2）/ `archive_thread` 命令名
- **THEN** 前端与 command registry MUST 无残留引用
