# redesign-session-delete-architecture tasks

> Canonical 设计稿：`docs/plans/2026-08-24-session-delete-architecture-redesign.md`（用户已确认）。
> 执行顺序 = M1 backend → M2 frontend → 验证。M3（批量收尾 / 旧壳下线 / 基线测量）不在本 change 首期范围。

## Phase 0 — OpenSpec

- [x] 0.1 创建 change（proposal / design / tasks / spec delta `session-delete-v2`）
- [x] 0.2 `openspec validate redesign-session-delete-architecture --strict --no-interactive` 通过

## M1 — Backend v2 core

- [x] 1.1 `src-tauri/src/session_index/store.rs`：新增 `lookup_row_for_delete(connection, full_id) -> Option<SessionIndexRow>`（full/bare 双匹配，含 tombstoned 行返回以便区分 already-deleted）+ 单测
- [x] 1.2 `src-tauri/src/local_usage/session_delete.rs`：新增 `delete_codex_session_file_at(path)`（直接删文件，missing → Ok(false)）与 `locate_codex_session_file_fast(session_id, roots)`（仅文件名 glob，不读内容）+ 单测
- [x] 1.3 `src-tauri/src/session_management.rs`：`with_catalog_metadata_mutation` / `catalog_metadata_lookup_keys_for_session` 改 `pub(crate)`
- [x] 1.4 `src-tauri/src/session_delete_v2.rs`（新）：
  - 类型：`SessionDeleteV2Target` / `DeleteWorkspaceSessionsV2Request` / `SessionDeleteV2Result` / `SessionDeleteCode`
  - Resolve：threadId 前缀解析 → index 点查 → engine 前缀定向（codex 走 1.2 快速定位；其余 engine 由 deleter 按约定路径自行定位）→ ghost 判定
  - Classify：unsupported engine 在标记前快速失败（`ENGINE_UNSUPPORTED`）
  - Settle（标记优先）：`tombstone_session_ids`（占位行）先落；失败才整项 `IO_FAILED`
  - Execute：`Semaphore(4)` 并发 + 超时（默认 10s，dsh 15s）；复用现有 per-engine 删除函数；codex 按 `physical_path`/快速定位结果直接删
  - 结果合成：`OK` / `ALREADY_MISSING` / `MARKED_DELETED` / `GHOST_CLEANED` / `ENGINE_BUSY` / `REQUEST_TIMEOUT` / `IO_FAILED`
  - catalog 元数据清理（`catalog_metadata_lookup_keys_for_session` 键集合）
  - `MARKED_DELETED` 项进程内有界重试（5s / 30s，仅清磁盘残留）
  - `run_session_delete_v2` orchestrator（可测）+ `delete_workspace_sessions_v2` command（requestId + `app.emit` 事件）
- [x] 1.5 `command_registry.rs` 注册 `delete_workspace_sessions_v2`（⚠ 无编译兜底，人工核对）+ `lib.rs` mod 声明
- [x] 1.6 Rust 单测：resolve 分类（前缀 / index hit / ghost）、标记优先顺序（tombstone 先于物理删除）、物理删除失败 → `MARKED_DELETED`、codex 快速定位文件名匹配、unsupported 快速失败
- [x] 1.7 `cargo test session_delete_v2` + `cargo test session_index` + `cargo test session_delete` 全绿（`session_management` 套件中 `workspace_session_list_keyword_finds_match_beyond_first_scan_window` 为 HEAD 既有失败，已在干净树复现确认与本 change 无关）

## M2 — Frontend 乐观删除

- [x] 2.1 `src/services/tauri/sessionManagement.ts`：`deleteWorkspaceSessionsV2` + 结果类型
- [x] 2.2 `src/features/threads/utils/sessionDeleteV2.ts`（新）：flag `ccgui.delete.v2`（默认 on）、`session-delete:settled` 事件订阅（按 requestId 路由）、`requestSessionDelete()`（30s 超时 reject）
- [x] 2.3 `useThreads.removeThread` v2 分支：快照（summary + pin + loaded 状态）→ 本地 settle（现有逻辑提取复用）→ v2 请求 → 成功收尾 / 失败 `rollbackThread`（`setThreads` 按 updatedAt 归位 + 恢复 pin/loaded）→ 返回结果
- [x] 2.4 `useDeleteThreadPrompt`：v2 开启时确认即关框（后台删除），失败走 `onDeleteError` toast
- [x] 2.5 `removeThreads` v2 分支：全量 id 单 IPC（不再排除 shared/claude 等），逐条 settled 对账 + 失败回滚
- [x] 2.6 前端测试：`sessionDeleteV2`（超时 / requestId 路由 / flag off）、`useDeleteThreadPrompt` 乐观关框 + 错误回调（`useThreads` 回滚逻辑由 prompt 层测试 + 全套 threads 回归保证；专项 rollback 集成测试列入 M3）
- [x] 2.7 `pnpm vitest run` 相关文件 + `tsc --noEmit` 全绿（`src/features/threads` 全套与 HEAD 基线 diff 一致，无新增失败；存量 93 项失败为基线既有）

## 验证

- [x] 3.1 `openspec validate redesign-session-delete-architecture --strict --no-interactive`
- [x] 3.2 `cargo test`（session 相关模块）+ 前端 targeted vitest + typecheck
- [ ] 3.3 手测脚本：codex/claude 各删 1 条（index hit / miss / ghost 三路径）、批量 10 条、dsh 不可用时 `ENGINE_BUSY`、磁盘删除失败时 `MARKED_DELETED` 且侧栏不再显示（**待真机验收**）

## Hotfix 记录（真机首轮验收后）

- [x] H1 **settled 事件竞态**：后端 command 在返回 response 前即 spawn 删除任务，快删除（ghost / index hit）毫秒级 emit `session-delete:settled`，前端 native listener 尚未建成 → 事件被 Tauri 丢弃 → 30s 超时 → 行回滚「复活」（用户反馈「有的能删有的报错、左侧又出来了」）。修复：`requestSessionDelete` 先 `await ensureSettledListener()` 再 invoke；listener 常驻不反注册；未知 requestId 的 settled 入 early buffer（cap 100），注册 pending 前先领 buffer。回归测试：`sessionDeleteV2.test.ts` 竞态用例。
- [x] H2 **orchestrator panic 兜底**：spawn 任务 panic 时永远等不到 settled。修复：command 内 `catch_unwind` 包裹 orchestrator，panic 时 emit 全量 `IO_FAILED` settled。
- [x] H3 **Session Management Center 全选删除接 v2**（用户反馈，原 M3 项提前）：`useWorkspaceSessionCatalog.mutate("delete")` 在 flag 开启时走 `requestSessionDelete`（批量恒为一次 IPC），`SessionDeleteCode` 映射进 `WorkspaceSessionCatalogMutationResult`（`deletedFromDisk` / `metadataCleaned` 语义对齐）；归档 / 取消归档 / 移文件夹保持旧命令。附：`requestSessionDelete` 默认超时随批量线性放大（`max(30s, 条数 × 1s)`），覆盖全选数百条场景。测试：v2 成功映射 + `ENGINE_BUSY` 失败保留列表项。其余删除入口审计：`app-shell` 三处调用（`useAppShellWorkspaceFlowsSection` / `useAppShellSections`）均经 `removeThread(s)` 内部 v2 分支，无需改动。
- [x] H4 **右键菜单「删除」旁追加批量删除引导链接**（用户需求）：线程右键菜单在 `delete` 项后追加 `open-session-management` 项（「在会话管理中批量删除…」，10 locale），点击直达 设置 → 项目管理 → 会话管理（`openSettings("project-management", "project-sessions")`）。链路：`useAppShellLayoutNodesSection.handleOpenSessionManagement` → chrome bag（`ChromeLayoutNodesOptions`）→ `useLayoutNodes` → `Sidebar.onOpenSessionManagement`（可选 prop）→ `useSidebarMenus` 菜单项（未注入时不渲染）。测试：菜单项位置（紧随 delete）+ onSelect 触发 + 未注入隐藏；app-shell governance 22 项通过。
- [x] R1 **rollback 竞态（收口 review 发现）**：`performV2Deletion` rollback 的存在性守卫依赖 `threadsByWorkspaceRef`（useEffect 更新），early-settled 微任务路径下 rollback 可能先于 `removeThread` render 提交执行 → 误判「行还在」跳过恢复 → 失败删除的行被永久摘掉。修复：rollback 无条件 dispatch `setThreads`（filter+append 去重归位，dispatch 保序保证终态）。
- [x] R2 **shared tombstone 局限（已知，记录不修）**：session index 不含 shared engine，`shared:` 目标物理删除失败时 `MARKED_DELETED` 无 index 占位行保护，刷新后可能复活；M3 评估 shared 级删除标记。
- [x] R3 **收口 gate 全量**：`check:docs` 通过（plan status 修 active）、`check:app-shell:governance` 22 绿、rustfmt 仅新叶子文件、`src/features/update/generated/**` 确认为 dev client 再生成本地脏文件**不提交**、OpenSpec active 索引已登记。
- [x] F1–F3 **rewind/fork 附带删除迁移 v2**（二次 review 发现）：`useThreadActionsSessionRuntime` 三处 per-engine 直删（Claude rewind 归零 / Claude fork 删源 / Codex rewind 归零）改走 `deleteSessionViaV2IfEnabled`（v2 marker-first + tombstone + 残留重试；flag off 保留旧直删）。失败语义保持：rewind 归零失败仍 throw、fork 删源失败仍 log 继续（但 v2 下物理失败 = `MARKED_DELETED` 成功，残留后台重试，根治「源会话复活」）。`requestSessionDelete` 增加 `engine` 选项（codex 裸 id 定向需要）。
- [x] F4 **死代码清理**：删除全仓零引用的 `archiveClaudeThread`（`useThreadActions` useMemo + return）与 `createArchiveClaudeThreadAction`（`useThreadActions.sessionActions`，内含 claude「归档=物理删除」直删调用）及不再使用的 import；`archiveThread` 保留（hook 公开 API 且有测试消费，走正规 `archive_thread` 服务）。
