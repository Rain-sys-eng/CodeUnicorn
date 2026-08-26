## 1. Core lookup & remap

- [x] 1.1 在 `sharedSessionSummaries.ts` 实现 `lookupSharedOwnerByNativeParent`（exact + bare + engine 前缀变体），并让 `remapParentThreadIdToSharedOwner` 使用它
- [x] 1.2 补充/扩展 `sharedSessionSummaries.test.ts`：Codex/Claude/Grok 变体改挂；普通 native / 无 parent 恒等

## 2. Call-site alignment

- [x] 2.1 `mergeGrokSessionSummaries` 内联 remap 改为同一 lookup（禁止继续 exact `map.get` only）
- [x] 2.2 `sidebarInternals` Shared 改挂路径用 `expandHiddenSharedBindingIds`（或等价）对齐 owner 变体
- [x] 2.3 Kimi 异步 refresh 合并后补 `remapThreadParentsToSharedOwners` + unchanged 比较含 parent（code review 补漏）

## 3. Verification

- [x] 3.1 focused Vitest：`sharedSessionSummaries` + 相关 helpers 全绿
- [x] 3.2 `openspec validate enhance-shared-subagent-parent-id-attach --strict`
- [x] 3.3 换角度 code review（回归面 / 漏路径 / 误挂）并修缺口；**不 commit**
- [x] 3.4 补 `useThreadActions` 集成测：Shared×Codex raw parent 改挂 + 未命中/无 parent 恒等 + 不删行
- [x] 3.5 纠偏：侧栏 `useThreadRows` 隐藏 Shared 下崽（parent-id）；store 保留给幕布/Strip；补 useThreadRows 单测
