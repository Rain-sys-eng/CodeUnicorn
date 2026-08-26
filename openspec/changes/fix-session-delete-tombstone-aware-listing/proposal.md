# fix-session-delete-tombstone-aware-listing

## Why

用户实测反馈：**有些会话删不掉——删的时候行消失了，过几分钟又从侧栏刷出来**（幽灵会话复活）。

根因（代码链路全程走查确认）：`redesign-session-delete-architecture` 落地的 v2 删除是 marker-first——用户确认即 tombstone Session Index 行，物理删除失败仍返回 `MARKED_DELETED` 成功；ghost 路径（归属解析失败）甚至不尝试物理删除。**但侧栏会话列表是多源 union，只有 Session Index（SQLite）读路径认 tombstone**（`store.rs` upsert 的 `WHERE tombstoned_at IS NULL` 守卫只挡 importer/sync 再导入）。以下磁盘扫描合并源对 tombstone 零感知：

- `list_workspace_sessions_core` catalog（codex/claude 等，非首屏刷新、importer 90s tick 触发的 `mergeExistingThreads` 合并都会扇出）
- `list_claude_sessions`（claude fallback 盘扫 seed）
- `list_gemini_sessions` / `list_kimi_sessions` / `list_pi_sessions` / `list_qoder_sessions` / `list_grok_sessions` / `list_dsh_sessions`
- `opencode_session_list`

于是：物理文件还在（删除失败 / ghost 未删）→ 下一次合并刷新（≈90s 到几分钟）→ 行复活。时间特征与用户报告完全吻合。

## What Changes

- **新增 `TombstoneFilter`（`session_index/tombstone_filter.rs`）**：一次性装载全部 tombstoned `(engine, session_id)` 键（`store.rs` 新增 `list_tombstoned_session_keys` 查询），提供 `is_tombstoned(engine, session_id)` / `retain(...)`；qoder canonical id（`qoder:<profile>:<raw>`）提取 raw 后双向可匹配；带 engine 前缀的 id 剥前缀后再判。index 不可用（打开/查询失败）时 **fail-open**（返回空过滤器不过滤），保持现状可用性并 warn 日志。
- **所有磁盘扫描 list 出口接过滤**：`list_workspace_sessions_core`、`get_workspace_session_projection_summary_core`、`list_global_codex_sessions_core`（session_management.rs），7 个 engine history list 命令（session_history_commands.rs），`opencode_session_list` 命令（commands_opencode.rs 出口，不动 core——core 还被 index writer 复用）。
- **诊断日志**：v2 删除结算为 `MARKED_DELETED` 时打 warn（engine + session + error），为后续 P1（pi resident 自锁 / codex 多 root 副本）立项提供现场证据。
- **remote mode**：`call_remote` 早期返回的分支不在本 change 过滤范围内（daemon 侧 index 归属另议），design 中声明为已知限制。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `session-delete-v2`: 删除语义补齐最后一块——tombstone 不再只挡 index 再导入，磁盘扫描 list 出口 MUST 同样排除已 tombstone 会话；`MARKED_DELETED` MUST 落诊断日志。
- `workspace-session-catalog-projection`: catalog / projection summary 出口 MUST 排除 tombstoned index 行对应的磁盘会话。

## Impact

- Affected code：
  - `src-tauri/src/session_index/store.rs`（+`list_tombstoned_session_keys`；`strip_known_engine_prefix` 升 pub(crate)）
  - `src-tauri/src/session_index/tombstone_filter.rs`（新）
  - `src-tauri/src/session_index/mod.rs`（挂模块）
  - `src-tauri/src/engine/session_history_commands.rs`（7 个 list 命令出口）
  - `src-tauri/src/engine/commands_opencode.rs`（`opencode_session_list` 出口）
  - `src-tauri/src/session_management.rs`（catalog / projection summary / global codex 三个 core 出口）
  - `src-tauri/src/session_management_related.rs`（`list_project_related_sessions_core` 出口）
  - `src-tauri/src/session_delete_v2.rs`（MARKED_DELETED 诊断日志）
- 明确不过滤：`local_usage_snapshot` / `list_codex_session_summaries`（usage 统计面，历史 token/cost 不应因会话删除而蒸发）；各 engine history 模块内部函数与 index writer 复用的 core（过滤只放命令出口）。
- APIs：无新增命令 / 事件；既有 list 命令的返回集语义变化（排除已删除会话）。
- Data：无 schema 变更，复用 `session_index.tombstoned_at`。
- 行为变更声明：
  1. 物理删除失败 / ghost 未删的会话将从**所有** list 出口消失（含 Session Management 页），不再有「磁盘 merge 复活」这个意外逃生口；tombstone 无 UI 恢复入口，CLI 侧数据仍在。
  2. 两个 workspace 指向同一项目目录时，一处删除（物理失败残留）在另一处也随之隐藏——认为是一致性改善。
- Performance：每个 list 出口多一条有界 SQLite 查询（行数 = 累计删除数），可忽略。
