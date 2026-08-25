# Design: fix-session-delete-tombstone-aware-listing

## 复活链路（现状）

```
用户删除 → v2: tombstone index 行 + 乐观摘行 + 尝试物理删除
                ├─ 物理删除成功 → 磁盘无文件 → 任何源都刷不出 ✅
                ├─ MARKED_DELETED（物理失败，5s/30s 重试后放弃）──┐
                └─ GHOST_CLEANED（归属失败，不碰磁盘）─────────────┤
                                                                 ▼
importer 90s tick / focus 刷新 / 首刷后 pi 盘扫 → 非首屏 merge 刷新
  → list_workspace_sessions catalog / claude fallback seed / pi 盘扫 / …
  → 这些源直接扫盘，零 tombstone 感知 → 残留文件被重新并入侧栏 ❌
```

index upsert 的 `tombstoned_at IS NULL` 守卫只能挡住「再导入 index」这一路；侧栏行是 union 多源的，磁盘源绕过了 index。

## 决策

### D1：过滤放在后端 list 出口，不放前端 merge stage

- 前端 merge stage 数量多且分散（`useThreadActions.ts` 里 codex catalog / claude seed / pi / gemini / kimi / grok / qoder / dsh / opencode 各自合并点），且不覆盖 Session Management 页等其他消费者。
- 后端出口过滤是单点事实源：所有现有与未来消费者自动受益。
- 代价：~10 个出口各加 2-3 行；过滤逻辑集中在 `TombstoneFilter` 单测覆盖。

### D2：fail-open，不 fail-closed

index DB 打开/查询失败时返回空过滤器（不过滤）。理由：tombstone 过滤是「已删会话保持隐藏」的增强，不能反过来让 index 故障把整个会话列表清空（可用性优先）。失败打 warn 日志可诊断。

### D3：只挡 list 出口，不动 writer / delete 解析路径

- `opencode_session_list_core` 被 index writer 复用（`session_index/commands.rs:559`），过滤放在 `opencode_session_list` 命令出口而非 core。
- `build_workspace_scope_catalog_data` 被旧 v1 delete 的 owner 解析复用，过滤放在 `list_workspace_sessions_core` 等 core 出口、catalog 构建之后，避免 v1 删除重试时解析不到 tombstoned 行。
- qoder：index 里以 canonical `qoder:<profile>:<raw>` 存，磁盘/ACP list 出 raw id；过滤器预建 qoder raw id 集合，双向匹配。

### D4：MARKED_DELETED 诊断日志（为 P1 取证）

物理删除失败时打 `warn`（engine + session_id + error）。用户侧幽灵会话的 engine 与失败原因目前无现场证据；P1 候选（pi resident 自锁 / codex 多 root 副本）是否立项依赖该日志。

## 已知限制

- remote mode（`call_remote` 分支）不过滤：daemon 侧 session index 归属需要单独评估，本 change 不动。
- tombstone 无 UI 恢复入口（见 proposal 行为变更声明 1）。
- codex 多 home root 副本、pi resident 文件锁导致的物理删除失败本身不在本 change 修（P1 候选），但出口过滤保证残留文件不再可见。

## 验证

- `store.rs`：`list_tombstoned_session_keys` 只返回 tombstoned 对（in-memory SQLite）。
- `tombstone_filter.rs` 单测：直接命中 / 带 `engine:` 前缀剥离 / qoder canonical→raw / 未知 engine 不误伤 / 空过滤器零开销早退。
- `cargo test --lib session_index` 全绿；`cargo check --no-default-features` 过。
- 改动 `.rs` 文件 `rustfmt --edition 2021 --check` 过（Rust Format Gate：保持 clean）。
- `openspec validate fix-session-delete-tombstone-aware-listing` 过。
