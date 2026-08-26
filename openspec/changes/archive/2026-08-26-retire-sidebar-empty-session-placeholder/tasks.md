# Tasks: retire-sidebar-empty-session-placeholder

## 1. 空态下线（已完成）

- [x] 1.1 `Sidebar.tsx` 删 `showThreadEmptyState` 分支与 `<ThreadEmptyState />` 渲染；`WorktreeSection` 不再传 `hydratedThreadListWorkspaceIds`。验证：tsc 0 error。
- [x] 1.2 `WorktreeSection.tsx` 删 `showWorktreeEmptyState` 分支、`ThreadEmptyState` import、`hydratedThreadListWorkspaceIds` prop。验证：tsc 0 error。
- [x] 1.3 删除 `ThreadEmptyState.tsx`；`sidebar.css` 删 `.thread-empty-state*`。验证：全仓 grep 零残留。

## 2. loading 终态对齐（已完成）

- [x] 2.1 settle（`scheduleUnconfirmedEmptyFirstPaintSettle`）的 `.finally()` 无条件标 hydrated 改为看结果：仅 `applied && (visibleCount>0 || authoritativeEmpty)` 才标；未证实则 arm `EMPTY_SETTLE_LOADING_GRACE_MS = 20s` 宽限，到期兜底终态。armed 集合在 settle 结束摘除（可再 settle）。验证：hook 测试 24/24 绿。
- [x] 2.2 `markWorkspaceThreadListHydrated` 统一终态出口（标 hydrated + 取消宽限）；unmount 清理 grace 定时器。验证：tsc 0 error。

## 3. loading 阶段文案（已完成）

- [x] 3.1 `ThreadLoadingState` 本地计时：初始 `loadingWorkspaceSessionsIndex`，4s（对齐 first-paint 预算）后切 `loadingWorkspaceSessionsDeep`。验证：新增 `ThreadLoadingState.test.tsx`（fake setTimeout）绿。
- [x] 3.2 11 locale 补两个 key；`Sidebar.test-utils.tsx` mock 字典同步。验证：Sidebar 测试断言改用 "Reading session index…" 后全绿。
- [x] 3.3 回滚跨层 phase plumbing（13 触点版曾给 soft-cancel 时序测试引入并发抖动）：app-shell domain bag / layoutNodes / Sidebar prop 全部还原，文案切换收敛进组件。验证：组合跑 99/99 绿且时序测试不再超时。

## 4. 测试翻转（已完成）

- [x] 4.1 `Sidebar.test.tsx`：empty / disconnected 两处断言翻转为「不渲染任何占位」；loading 断言改索引文案。
- [x] 4.2 `WorktreeSection.test.tsx`：同上翻转 + 移除全部 `hydratedThreadListWorkspaceIds` prop（11 处）。
- [x] 4.3 回归：99/99 绿；typecheck exit 0。存量红 `Sidebar.session-folders.test.tsx` 3 个分页测试 HEAD 即挂，与本 change 无关。

## 5. 收口

- [x] 5.1 用户手测：冷启动观察 索引文案 →（慢则）扫描文案 → 会话行，全程无空白期、无「暂无会话」——用户 2026-08-26 目视确认「目前效果还行」。
- [x] 5.2 commit + verify / sync specs / archive：随归档提交收口；主 spec `workspace-sidebar-session-loading` 已同步三条新 requirement（空态下线 / loading 终态对齐 / 阶段文案）。
