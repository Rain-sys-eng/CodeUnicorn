# tasks

## M1 Backend v2

- [x] 1.1 `src-tauri/src/session_archive_v2.rs` 新建：`ArchiveWorkspaceSessionsV2Request` / target 类型、`archive_workspace_sessions_v2_core` / `unarchive_workspace_sessions_v2_core`（Index First resolve → metadata settle → codex 后台 RPC），统一错误码 `OK / ALREADY_ARCHIVED / NOT_ARCHIVED / INVALID_SESSION_ID / METADATA_WRITE_FAILED`
- [x] 1.2 `src-tauri/src/session_index/store.rs`：确认/泛化 archive 用点查（复用 `lookup_rows_for_delete` 或新增别名），单测覆盖 full/bare id 命中
- [x] 1.3 `src-tauri/src/session_management.rs`：`metadata_stable_key_for_session_id` / `with_catalog_metadata_mutation` / `read_catalog_metadata` 等改为 `pub(crate)` 供 v2 复用；删除 `archive_workspace_sessions` / `unarchive_workspace_sessions` 命令与 `archive_workspace_sessions_core` / `unarchive_workspace_sessions_core`
- [x] 1.4 `src-tauri/src/codex/mod.rs`：删除 `archive_thread` 命令（保留 `codex_core::archive_thread_core` / `archive_thread_best_effort_core`）；`src-tauri/src/command_registry.rs` 注册 v2 命令、移除三个旧命令
- [x] 1.5 `src-tauri/src/bin/cc_gui_daemon.rs` + `daemon_state.rs`：移除 `archive_thread` 远程分支
- [x] 1.6 后端单测：resolve（index hit / prefix fallback / 裸 codex id）、幂等（ALREADY_ARCHIVED / NOT_ARCHIVED）、metadata key 与 evidence 读取互通、不触发 Exhaustive 扫描（用 fake catalog builder 或计数守卫）；更新 `session_management_archive_delete_tests.rs` 等引用旧 core 的测试
- [x] 1.7 `cargo test` 相关模块 + `cargo clippy` 过检（遵守 Rust Format Gate：只对改动叶子文件 rustfmt）

## M2 Frontend 接入

- [x] 2.1 `src/services/tauri/sessionManagement.ts`：`archiveWorkspaceSessionsV2` / `unarchiveWorkspaceSessionsV2`（targets 带 engine hint）；删除旧 wrapper；`src/services/tauri/session.ts` 删 `archiveThread`，`src/services/tauri.ts` facade 同步
- [x] 2.2 本地摘行快路径：`useThreadActions.listThreadsForWorkspace` 新增 `localRemovalOnly`（清 loadedThreadsRef / cached summaries / live channels + dispatch removeThread 后立即返回，零 IPC）；`useWorkspaceThreadListHydration.ensureWorkspaceThreadListLoaded` 透传。注：原计划的 `removeThreadLocally` 独立 key 因 layoutContext hard budget（35）先出后进约束改为复用 `ensureWorkspaceThreadListLoaded`
- [x] 2.3 侧栏 `useAppShellLayoutNodesSection.handleArchiveThread`：改 v2 + 本地摘行，删除 `force: true` 重扫
- [x] 2.4 `useAppShellWorkspaceFlowsSection.handleArchiveActiveThread`：快捷键改为真实归档（复用同一链路）
- [x] 2.5 `useWorkspaceSessionCatalog.mutate`：archive/unarchive 切 v2；`SessionManagementSection.handleMutation`：全成功不 reload，部分失败才 reload
- [x] 2.6 删除 `createArchiveThreadAction` / `createArchiveClaudeThreadAction` 及 useThreadActions 导出；`projectMapGenerationWorker.ts` 改 v2 best-effort
- [x] 2.7 前端测试更新：`useWorkspaceSessionCatalog.test.tsx`、`SessionManagementSection.test.tsx`、`tauri.test.ts`、layoutNodes / workspaceFlows 相关测试

## M3 收口

- [x] 3.1 `openspec validate redesign-session-archive-fast-path --strict --no-interactive`
- [x] 3.2 `npm run typecheck` + 相关 vitest；`cargo test` session 相关模块
- [ ] 3.3 目视验收：侧栏单条归档即时消失；Session Management 多选归档（跨 workspace）即时 patch；快捷键归档当前会话；archived 视图可 unarchive
- [ ] 3.4 性能抽查：大历史项目归档单条 < 200ms（debug 日志或手测）
