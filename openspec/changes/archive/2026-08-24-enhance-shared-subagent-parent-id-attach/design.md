## Context

- Shared hide set 隐藏 `nativeThreadIds`（binding owner），子代理仍作为独立 native 行进入列表。
- 产品意图（已有）：子代理 **保留** 并改挂 `shared:`，供侧栏树 / Strip / `childSubagentThreads`。
- 缺口：`nativeToShared.get(parent)` 只 exact match；Codex live 常为 raw uuid，binding 常为 `codex:uuid`（expand 写进 map，但 child parent 只带一侧时对端 lookup 失败）。
- Claude 侧多为 `claude:owner` / bare；Grok 异步 list 带 `parentSessionId` 并已 prefix `grok:`，但仍可能与 binding 形态不一致。
- `useThreadRows`：`threadIds.has(parentId)` 为 false → 升根（「下崽」）。

## Goals / Non-Goals

**Goals:**

- 单一 lookup：parent 任意支持形态 → shared threadId。
- 批量 remap 与 Grok merge 内联 remap 共用。
- 低回归：无 parent / parent 非 shared owner → 恒等。

**Non-Goals:**

- 后端 catalog 填 parent（Grok/Kimi 仍可能 `parent_session_id: None`）。
- 无 parent 时启发式归树。
- 修改 hide strip 删除规则。

## Decisions

### D1 引擎无关 lookup，不新增 Codex 分支

在 `sharedSessionSummaries.ts` 增加 `lookupSharedOwnerByNativeParent`：

1. exact `map.get(parent)`
2. 若含 `:` → 再试 bare
3. 若无 `:` 或 pending 形态 → 再试 `claude|codex|kimi|grok|opencode` 前缀

与 `expandHiddenSharedBindingIds` / `SHARED_HIDE_ENGINE_PREFIXES` 对称。`remapParentThreadIdToSharedOwner` 改为调用 lookup；未命中返回原 parent。

### D2 不新增并行「attach」管线

批量仍走 `remapThreadParentsToSharedOwners`，避免双路径漂移。Grok merge 内联 `map.get` 改为同一 lookup。

### D3 sidebarInternals Shared 改挂对齐 expand

live 子树路径对 `nativeThreadIds` 使用 `expandHiddenSharedBindingIds`（或等价变体集合），避免只补「无冒号 → 加前缀」而漏 strip 形态。

### D4 不整链 hide 子孙

只改直接 `parentThreadId` 命中 owner 的行；中间层子代理改挂后，孙代理仍挂中间层，树自然落在 Shared 下。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 两 Shared 共用同一 native id | map 先写先得，与现 `buildNativeOwnerToSharedThreadMap` 一致 |
| 过宽前缀误匹配 | 仅固定 engine 列表 + exact/strip，禁止标题 |
| 无 parent 的 catalog 子会话仍顶层 | 非本 change 能力；文档标明 follow-up |
| 幂等 / 双次 remap | remapped === current 不写；测试锁恒等路径 |

## Migration Plan

- 纯 FE 逻辑；无存储迁移。
- 回滚：还原 lookup 为 exact `map.get` 即可。

## Open Questions

- 无。Grok catalog parent=None 记为 follow-up，不阻塞本 change。
