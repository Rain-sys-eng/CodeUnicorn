# Delta: session-delete-v2

## ADDED Requirements

### Requirement: Disk-Scan List Exports MUST Exclude Tombstoned Sessions

所有以磁盘（或 engine host）扫描为数据源的会话 list 出口 MUST 排除 Session Index 中已 tombstone 的 `(engine, session_id)` 行，包括但不限于：`list_workspace_sessions` catalog、`get_workspace_session_projection_summary`、`list_global_codex_sessions`、`list_claude_sessions`、`list_gemini_sessions`、`list_kimi_sessions`、`list_pi_sessions`、`list_qoder_sessions`、`list_grok_sessions`、`list_dsh_sessions`、`opencode_session_list`。

标记优先（marker-first）结算下，物理删除失败（`MARKED_DELETED`）或 ghost 路径（`GHOST_CLEANED`，不碰磁盘）都会把会话文件留在磁盘上；list 出口过滤是「用户删了就不再显示」语义的最终闸门，MUST NOT 依赖物理删除成功。

过滤 MUST 按 `(engine, session_id)` 精确匹配，允许剥除已知 engine 前缀后匹配；qoder 行 MUST 同时接受 canonical（`qoder:<profile>:<raw>`）与 raw id 形态。MUST NOT 跨 engine 扩大化匹配。

Session Index 不可用（打开 / 查询失败）时过滤 MUST fail-open（不过滤、保持列表可用）并记录 warn 日志，MUST NOT 因 index 故障清空会话列表。

#### Scenario: physically surviving session stays hidden after delete

- **WHEN** 用户删除会话，tombstone 已落但物理文件残留（`MARKED_DELETED` 或 `GHOST_CLEANED`）
- **AND** 后续 importer tick / focus 刷新触发磁盘扫描 list 出口
- **THEN** 该会话 MUST NOT 出现在任何 list 出口返回集中
- **AND** 侧栏 MUST NOT 复活该行

#### Scenario: tombstone filter is engine-scoped

- **WHEN** 某 engine 的 session id 被 tombstone
- **THEN** 其他 engine 下相同 id 形态的会话 MUST NOT 被过滤（裸 id 全 engine 落标记的既有行为除外，过滤不得再扩大）

#### Scenario: index unavailable fails open

- **WHEN** Session Index 数据库打开或查询失败
- **THEN** list 出口 MUST 返回未过滤的磁盘扫描结果
- **AND** MUST 记录 warn 日志

### Requirement: MARKED_DELETED Settlement SHALL Emit Diagnostic Log

v2 删除结算为 `MARKED_DELETED`（tombstone 已落、物理删除失败）时 MUST 记录 warn 级诊断日志，包含 engine、native session id 与物理删除错误，为残留根因（文件锁 / 多 root 副本等）的后续治理提供现场证据。

#### Scenario: physical delete failure is diagnosable

- **WHEN** 物理删除失败且不符合 `should_settle_delete_as_success`
- **THEN** 结果 MUST 为 `MARKED_DELETED`
- **AND** 日志 MUST 含 engine、session id 与 error 文本
