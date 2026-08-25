# Tasks: fix-sidebar-reload-force-index-sync

## 1. 重载入口强制索引同步

- [x] `useAppShellLayoutNodesSection.tsx`：新增模块级常量 `USER_RELOAD_THREAD_LIST_OPTIONS = { forceSessionIndexSync: true } as const`（附注释说明用户显式重载 = 强制发现意图，温读索引在 importer 90s 窗口内刷不出新会话）。
- [x] `handleQuickReloadWorkspaceThreads`：`listThreadsForWorkspaceTracked(target)` → `listThreadsForWorkspaceTracked(target, USER_RELOAD_THREAD_LIST_OPTIONS)`。
- [x] `handleReloadWorkspaceThreads`（确认弹窗版）：同上替换。

## 2. 测试

- [x] 新建 `src/app-shell/sections/layoutNodes/reloadWorkspaceThreads.policy.test.ts`：源码断言两个 handler 均以 `USER_RELOAD_THREAD_LIST_OPTIONS`（含 `forceSessionIndexSync: true`）调用 `listThreadsForWorkspaceTracked`。
- [x] focused vitest：`reloadWorkspaceThreads.policy.test.ts` + `useWorkspaceThreadListHydration.test.tsx` + `handleSelectWorkspace.policy.test.ts` 全绿。

## 3. OpenSpec

- [x] `openspec validate fix-sidebar-reload-force-index-sync` 通过。
