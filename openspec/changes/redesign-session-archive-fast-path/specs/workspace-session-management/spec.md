# workspace-session-management spec delta

## MODIFIED Requirements

### Requirement: Session Archive/Unarchive SHALL Use Fast Path

归档与取消归档 MUST 走 `archive_workspace_sessions_v2` / `unarchive_workspace_sessions_v2`（Index First 定位 + metadata-only 结算），归档耗时 MUST 与项目会话总量无关；语义保持 metadata soft-archive 不变（磁盘数据保留，列表按 `archived_at` 过滤）。

#### Scenario: archive duration is independent of session count

- **WHEN** 归档一条会话
- **THEN** 后端 MUST NOT 全量扫描 engine 磁盘会话历史
- **AND** 单条归档 P95 SHOULD < 200ms（index hit，本地盘）

#### Scenario: archived sessions remain hidden across views

- **WHEN** 一条会话被归档
- **THEN** 侧栏、项目会话列表与全局归档中心的 active 视图 MUST 过滤该会话
- **AND** archived 视图 MUST 能检索到该会话并支持 unarchive
