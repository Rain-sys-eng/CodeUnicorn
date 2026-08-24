# redesign-session-delete-architecture design

> 完整架构设计（动机 / 三段式协议 / 事件通道 / 乐观删除 / 性能目标 / 风险）以
> [`docs/plans/2026-08-24-session-delete-architecture-redesign.md`](../../../docs/plans/2026-08-24-session-delete-architecture-redesign.md)
> 为 canonical 设计稿（用户已确认 4 项关键决策 + 删除标记落点决策）。本文只记录 OpenSpec 层面的决策固化与实现映射。

## 决策固化（用户已确认）

1. **命令语义**：`delete_workspace_sessions_v2` 立即返回 `requestId`，结果走事件通道（`session-delete:progress` / `session-delete:settled`）。
2. **前端乐观删除**：轻量快照 + `rollbackThread` 单动作归位；失败错误码 toast + 可重试；30s 无 settled 视为超时。
3. **dsh 语义**：5s 连接超时 + `ENGINE_BUSY` 可重试，不阻塞等待。
4. **批量恒为一次 IPC**：删除逐条回退路径。
5. **删除标记落点**：SQLite `session_index.tombstoned_at`（复用占位行 + ON CONFLICT 守卫），**不建磁盘白名单**；语义升级为**标记优先**——用户确认即 tombstone，物理删除失败返回 `MARKED_DELETED` 不影响侧栏隐藏。

## 实现映射

| 设计组件 | 落点 |
|---|---|
| Resolve（Index First + 定向查找 + ghost） | `src-tauri/src/session_delete_v2.rs` + `session_index/store.rs::lookup_row_for_delete`（新） |
| codex 直接删 / 文件名快速定位 | `src-tauri/src/local_usage/session_delete.rs` 新增小函数 |
| Execute（Semaphore(4) + 超时 + per-engine deleter 复用） | `session_delete_v2.rs` 编排层；复用 `engine::*_history` / `local_usage` / `shared_sessions` 现有删除函数 |
| Settle（标记优先 + catalog 元数据 + 事务） | `tombstone_session_ids`（现有）+ `with_catalog_metadata_mutation` / `catalog_metadata_lookup_keys_for_session`（session_management.rs 内改 `pub(crate)`） |
| 事件通道 | command 内 `app.emit("session-delete:progress" / "session-delete:settled")` |
| 前端 flag | `ccgui.delete.v2`（localStorage，默认 on） |
| 前端 v2 协议封装 | `src/features/threads/utils/sessionDeleteV2.ts`（新） |
| 乐观删除 / 回滚 | `useThreads.removeThread` v2 分支 + `useDeleteThreadPrompt` 确认即关框 |
| 兼容 | 旧 `delete_workspace_sessions` 保留（M3 切同步壳） |

## 错误码表（canonical）

`OK` / `ALREADY_MISSING` / `GHOST_CLEANED` / `MARKED_DELETED` 为幂等成功；`INDEX_MISS` 仅诊断；`ENGINE_UNSUPPORTED`（resolve 阶段判定，不进入标记）/ `ENGINE_BUSY` / `IO_FAILED` / `METADATA_CLEANUP_FAILED` / `REQUEST_TIMEOUT` 为失败。

## 顺序约束（标记优先）

```
resolve → classify(unsupported 快速失败) → tombstone(标记) → execute(物理删除, 并发)
        → 结果合成(OK / ALREADY_MISSING / MARKED_DELETED / …) → catalog 元数据清理
        → emit settled
```

物理删除永远发生在 tombstone 之后；`MARKED_DELETED` 项进入进程内有界重试（5s / 30s），重试只清磁盘残留、不动标记。
