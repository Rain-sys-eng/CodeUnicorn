# Delta: workspace-session-catalog-projection

## ADDED Requirements

### Requirement: Catalog Projection MUST Exclude Tombstoned Sessions

`list_workspace_sessions` catalog、`get_workspace_session_projection_summary` 与 `list_global_codex_sessions` 的返回集 MUST 排除 Session Index 中已 tombstone 的 `(engine, session_id)` 对应条目（含 `canonical_session_id` 形态匹配）。

projection summary 的计数（active/filtered/folder counts）MUST 与过滤后的 membership 一致，MUST NOT 出现「计数含已删会话但列表无行」的口径分裂。

#### Scenario: tombstoned session absent from catalog and counts

- **WHEN** 会话已 tombstone 但磁盘文件残留
- **THEN** catalog 页、project-related 列表与 global codex 列表 MUST NOT 返回该条目
- **AND** projection summary 的各项计数 MUST NOT 计入该会话

#### Scenario: non-tombstoned membership unchanged

- **WHEN** 会话未被 tombstone
- **THEN** catalog / projection 行为 MUST 与过滤引入前完全一致（排序、分页 cursor、source status、归属证据不变）
