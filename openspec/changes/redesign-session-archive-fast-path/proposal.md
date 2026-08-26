# redesign-session-archive-fast-path

## Why

归档是用户反馈的慢操作。现行链路 `archive_workspace_sessions` 存在三层结构性根因（全链路分析见本次会话结论，对照 delete 同根因分析 `docs/plans/2026-08-24-session-delete-architecture-redesign.md` §1）：

1. **定位成本 O(全部会话)**：每次归档先 `build_workspace_scope_catalog_data(Exhaustive + Full + Related)` 全量扫描项目 scope 内所有 engine（codex 磁盘 + provider home、claude/gemini/kimi/grok/dsh/pi/qoder 历史，limit = `usize::MAX`），只为解析 session → owner workspace。
2. **Codex 逐条串行 RPC**：每个 codex 会话一次 `thread/archive` app-server RPC，单条 timeout 1500ms 串行累加，批量 N 条最坏 N×1.5s。
3. **前端归档后再全量重扫**：侧栏归档成功后 `ensureWorkspaceThreadListLoaded(force: true)` 触发 full-catalog 多引擎 fan-out，等于同一项目短时间两次全源扫描；Session Management 多选归档成功后再发 reloadPrimary + reloadRelated + reloadProjectionSummary 三个 catalog 查询。

同时发现一个语义 bug：快捷键 `archiveThread`（cmd+ctrl+a）的 handler `handleArchiveActiveThread` 实际调用 `removeThread` 走的是**删除**链路，与「归档」名字和菜单语义直接冲突。

## What Changes

- **新增 `archive_workspace_sessions_v2` / `unarchive_workspace_sessions_v2` 命令**：同步返回 `WorkspaceSessionBatchMutationResponse`（复用现有 contract，含 `ownerWorkspaceId` / `stableSessionKey` / `archivedAt`），无事件通道（归档无重物理操作，metadata 落盘即结算）。
- **Resolve 改为 Index First**：session index（SQLite）点查定位 `engine` / `workspace_path` → owner workspace / `provider_profile_id`；index miss 时按 engine 前缀定向，owner 回退为请求 workspace。**禁止全量 catalog 扫描**。
- **Settle 改为 metadata-only**：stable key 由纯函数 `metadata_stable_key_for_session_id(owner, session_id)` 推导，不依赖 catalog entry；按 owner 分组一次 `with_catalog_metadata_mutation` 写入/移除 `archived_at`。归档幂等：已归档返回 `ALREADY_ARCHIVED`（ok=true，回传既有 `archivedAt`）；未归档的 unarchive 返回 `NOT_ARCHIVED`（ok=false，保持旧语义）。
- **Codex `thread/archive` RPC 后台化**：metadata 落盘成功后 `tokio::spawn` fire-and-forget（1.5s timeout），不进结果码；未连接的 workspace session 快速失败跳过，MUST NOT 为归档拉起 app-server。
- **统一错误码**：`OK / ALREADY_ARCHIVED / NOT_ARCHIVED / INVALID_SESSION_ID / METADATA_WRITE_FAILED`。
- **前端侧栏归档免重扫**：v2 成功后本地摘行（`removeThreadLocally`），MUST NOT 再 `force: true` 触发 full-catalog hydration。
- **Session Management 收敛 reload**：多选归档/取消归档成功后以本地 patch 为准，MUST NOT 默认 reloadPrimary + reloadRelated + reloadProjectionSummary；仅部分失败时 reload 对账。
- **修正快捷键语义**：`archiveThread` 快捷键改为真实归档当前会话（不再删除）。
- **移除旧链路**：删除 `archive_workspace_sessions` / `unarchive_workspace_sessions` / `archive_thread` 三个 Tauri 命令及其 core 实现、daemon `archive_thread` 分支、前端 `archiveThread` service 与 `createArchiveThreadAction` / `createArchiveClaudeThreadAction`；无 feature flag，硬切换。

## Capabilities

### New Capabilities

- `session-archive-v2`: 会话归档 v2 协议（Index First 定位 / metadata-only 结算 / Codex RPC 后台化 / 统一错误码 / 侧栏免重扫 / 管理视图 reload 收敛）。

### Modified Capabilities

- `workspace-session-management`: 归档/取消归档语义不变（metadata soft-archive），但实现切换为 v2 fast path；归档耗时与会话总量无关。

## Impact

- Affected code（backend）：`src-tauri/src/session_archive_v2.rs`（新）、`src-tauri/src/session_index/store.rs`（archive lookup 复用/泛化）、`src-tauri/src/session_management.rs`（删旧命令与 core；`metadata_stable_key_for_session_id` 等改 pub(crate)）、`src-tauri/src/codex/mod.rs`（删 `archive_thread` 命令）、`src-tauri/src/command_registry.rs`、`src-tauri/src/bin/cc_gui_daemon.rs` + `daemon_state.rs`（删 `archive_thread` 分支）、`src-tauri/src/lib.rs`。
- Affected code（frontend）：`src/services/tauri/sessionManagement.ts`、`src/services/tauri/session.ts`（删 `archiveThread`）、`src/services/tauri.ts`（facade）、`src/app-shell/sections/layoutNodes/useAppShellLayoutNodesSection.tsx`、`src/app-shell/sections/useAppShellWorkspaceFlowsSection.ts`（快捷键改归档）、`src/features/settings/components/settings-view/hooks/useWorkspaceSessionCatalog.ts`、`src/features/settings/components/settings-view/sections/SessionManagementSection.tsx`、`src/features/threads/hooks/useThreadActions.ts` + `.sessionActions.ts`（删 legacy creators）、`src/features/threads/hooks/useThreads.ts`（暴露 `removeThreadLocally`）、`src/features/project-map/services/projectMapGenerationWorker.ts`（改 v2）。
- APIs: 新增 Tauri 命令 `archive_workspace_sessions_v2` / `unarchive_workspace_sessions_v2`；移除 `archive_workspace_sessions` / `unarchive_workspace_sessions` / `archive_thread`。
- Data: 复用 catalog metadata 现有 `archived_at_by_session_id` 结构，**无 schema 变更**；metadata key 推导规则不变（`{engine}:{workspace_id}:{canonical}` 及 legacy 兼容 key 仍由既有纯函数生成）。
- Compatibility: 旧命令直接移除（前端全部调用点同 PR 切换）；remote mode 的 daemon `archive_thread` 分支同步移除。

## 目标与边界

- 目标：单条归档 P95 < 200ms（index hit，本地盘）；批量 50 条 < 1s；归档耗时与会话总量无关；侧栏归档后行即时消失且零全量重扫。
- 边界：
  - 不改动 catalog 列表/投影读取路径本身（`list_workspace_sessions` 等的扫描策略不在本 change 范围）。
  - 不引入归档回收站 / 批量 unarchive 之外的新交互；Session Management 筛选与分页行为不变。
  - codex app-server 侧归档状态（`thread/archive`）保持 best-effort 语义：失败不回滚 metadata（与旧行为一致，仅时序后台化）。
  - index 被用户手动清空导致 owner 解析回退为请求 workspace：metadata 写在请求 workspace 下，project scope evidence 读取合并 scope 内全部 workspace metadata，归档仍然生效（列为已知可接受行为）。
