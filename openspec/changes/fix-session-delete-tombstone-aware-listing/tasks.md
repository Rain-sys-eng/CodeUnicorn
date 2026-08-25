# Tasks: fix-session-delete-tombstone-aware-listing

## 1. TombstoneFilter 基础层

- [x] `src-tauri/src/session_index/store.rs`：新增 `list_tombstoned_session_keys(connection)` 查询（`SELECT engine, session_id FROM session_index WHERE tombstoned_at IS NOT NULL`）；`strip_known_engine_prefix` 升为 `pub(crate)`。
- [x] 新建 `src-tauri/src/session_index/tombstone_filter.rs`：`TombstoneFilter { keys, qoder_raw_ids }`，`load_fail_open()`（index 不可用 → 空过滤器 + warn）、`is_tombstoned(engine, session_id)`（直接命中 / 剥 engine 前缀 / qoder canonical→raw）、`retain(engine, &mut Vec<T>, id_of)`（空过滤器早退）。
- [x] `src-tauri/src/session_index/mod.rs` 挂 `pub(crate) mod tombstone_filter;`。

## 2. list 出口接过滤

- [x] `session_history_commands.rs`：`list_claude_sessions` / `list_gemini_sessions` / `list_kimi_sessions` / `list_pi_sessions` / `list_qoder_sessions` / `list_grok_sessions` / `list_dsh_sessions` 七个命令在序列化前 `retain`（remote mode 分支不动）。
- [x] `commands_opencode.rs`：`opencode_session_list` 命令出口过滤（core 不动，writer 复用不受影响）。
- [x] `session_management.rs`：`list_workspace_sessions_core`（build_catalog_page 前）、`get_workspace_session_projection_summary_core`（counts 前）、`list_global_codex_sessions_core` 出口过滤（entry 按自身 engine + session_id / canonical_session_id 判）；`reject_tombstoned_catalog_entries` 为 pub(crate)。
- [x] `session_management_related.rs`：`list_project_related_sessions_core` 出口过滤。
- [x] 明确排除：`local_usage_snapshot` / `list_codex_session_summaries`（usage 统计语义，删除不应抹掉历史 token/cost）。

## 3. 诊断日志

- [x] `session_delete_v2.rs`：结算 `MARKED_DELETED` 时 `log::warn!`（engine + native_session_id + error），为 P1 候选（pi resident 自锁 / codex 多 root）取证。

## 4. 测试与门禁

- [x] `store.rs` 单测：tombstone 后 `list_tombstoned_session_keys` 只含已标记对。
- [x] `tombstone_filter.rs` 单测：直接命中 / 前缀剥离 / qoder canonical→raw / 未知 engine 不误伤 / 空过滤器早退。
- [x] `cargo test --lib session_index` 全绿（81/81，含 store/tombstone_filter 7 个新用例）；`cargo check --no-default-features` 过。
- [x] 改动 `.rs` 文件 `rustfmt --edition 2021 --check` 过。
- [x] `openspec validate fix-session-delete-tombstone-aware-listing` 过。

## 5. 收口

- [ ] review diff 只含本 change 文件（工作区有他人 in-flight 改动，禁止扫入）。
- [ ] 提交：`fix(session): 磁盘扫描 list 出口过滤 tombstone 根除已删会话复活`。
