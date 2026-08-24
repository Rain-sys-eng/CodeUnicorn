# redesign-session-delete-architecture

## Why

删除会话是用户反馈最集中的慢操作。现行链路 `delete_workspace_sessions` 存在三层结构性根因（分析见 `docs/plans/2026-08-24-session-delete-architecture-redesign.md` §1）：

1. **定位成本 O(全部会话)**：每次删除先 `build_workspace_scope_catalog_data(Exhaustive + Full + Related)` 全量扫描所有 engine 磁盘会话，只为解析 owner workspace。
2. **codex 删除是磁盘考古**：遍历全部 jsonl，文件名不匹配就逐个打开逐行解析 `session_meta`。
3. **前端零乐观更新**：确认后侧栏行要等完整后端链路（含 dsh daemon / opencode CLI 网络尾巴）走完才消失；批量删除被排除 engine 还会串行逐条重付全量成本。

同时用户明确提出：**删除是"用户删了就不再显示"的语义**——即使磁盘原始数据还在或物理删除失败，侧栏也必须按条件过滤掉。现链路只在磁盘删除成功后才打 tombstone，磁盘删失败就回滚不显示，与该诉求直接冲突。

## What Changes

- **新增 `delete_workspace_sessions_v2` 命令**：立即返回 `requestId`，进度与结果经 `session-delete:progress` / `session-delete:settled` 事件通道回推。
- **Resolve 改为 Index First**：session index（SQLite，已有 `engine/session_id/workspace_path/physical_path`）点查定位；miss 时按 engine 已知路径规则定向查找（单文件 stat/glob）；无前缀且查不到 → `GHOST_CLEANED`（只摘 index 行，不碰磁盘）。**禁止全量 catalog 扫描**。
- **Execute 改为受控并发执行器**：`Semaphore(4)` + 每条超时（默认 10s，dsh 15s）；codex 按 `physical_path` 直接删文件，不再 collect 全量逐个解析。
- **Settle 改为标记优先（marker-first）**：用户确认即 tombstone（占位行 + `tombstoned_at IS NULL` 守卫，复用现有机制），物理删除失败返回 `MARKED_DELETED`（侧栏保持隐藏，后台低优先重试收尾）；只有 tombstone 本身失败才整项回滚报 `IO_FAILED`。
- **统一错误码 `SessionDeleteCode`**：`OK / ALREADY_MISSING / GHOST_CLEANED / MARKED_DELETED / INDEX_MISS / ENGINE_UNSUPPORTED / ENGINE_BUSY / IO_FAILED / METADATA_CLEANUP_FAILED / REQUEST_TIMEOUT`，替换字符串猜测。
- **前端乐观删除**：点确认立即摘行（轻量快照）+ flag `ccgui.delete.v2`（默认 on）；settled 对账失败走 reducer 单动作 `rollbackThread` 归位 + 错误码 toast + 可重试；30s 无 settled 视为超时回滚。批量删除恒为一次 IPC，删除逐条回退路径。
- **兼容过渡**：旧 `delete_workspace_sessions` 保留（M3 切换为 v2 同步壳后下线）。

## Capabilities

### New Capabilities

- `session-delete-v2`: 删除会话 v2 协议（Index First 定位 / 受控并发执行 / 标记优先结算 / 事件通道 / 乐观删除 / 统一错误码 / 批量单 IPC）。

### Modified Capabilities

- `workspace-session-management`: 删除语义升级为"标记优先"（物理删除失败不影响侧栏隐藏），结果以 `SessionDeleteCode` 为准。

## Impact

- Affected code（M1 backend）：`src-tauri/src/session_delete_v2.rs`（新）、`src-tauri/src/session_index/store.rs`（lookup 查询）、`src-tauri/src/local_usage/session_delete.rs`（codex 直接删/快速定位）、`src-tauri/src/session_management.rs`（`with_catalog_metadata_mutation` 等改 pub(crate)）、`src-tauri/src/command_registry.rs`、`src-tauri/src/lib.rs`。
- Affected code（M2 frontend）：`src/services/tauri/sessionManagement.ts`、`src/features/threads/utils/sessionDeleteV2.ts`（新）、`src/features/threads/hooks/useThreads.ts`、`src/features/threads/hooks/useDeleteThreadPrompt.ts`。
- APIs: 新增 Tauri 命令 `delete_workspace_sessions_v2`；新增事件 `session-delete:progress` / `session-delete:settled`。
- Data: 复用 `session_index` 现有 `tombstoned_at` 列与占位行机制，**无 schema 变更**。
- Compatibility: 旧命令行为不变（M1）；`ccgui.delete.v2=off` 可整体回退旧路径。

## 目标与边界

- 目标：单条删除 P95 < 200ms（index hit，本地盘）；批量 50 条 < 2s；删除耗时与会话总量无关；"用户删了就不再显示"无条件成立。
- 边界：
  - 不做回收站/软删除恢复；不重建 index 表；不做跨进程删除队列持久化（进程内有界重试 + 占位标记兜底）。
  - 用户手动重置/清空 session index 库导致 tombstone 丢失 → 列为非目标（磁盘白名单同目录同样丢失，不额外建独立存储）。
  - 不重构 session catalog 读取路径；Session Management Center 的旧命令切换放 M3。
