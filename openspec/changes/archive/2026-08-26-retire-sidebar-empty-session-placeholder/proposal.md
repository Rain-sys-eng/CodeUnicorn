# Proposal: retire-sidebar-empty-session-placeholder

> OpenSpec change id: `retire-sidebar-empty-session-placeholder`  
> 现场：2026-08-25 macOS 开发版，侧栏多工作区并发 hydration 时「加载中… / 暂无会话」占位行夹在两个文件夹中间，无树缩进、归属不明；且「暂无会话」会在数据未就绪时谎报（截图取证：guanjia / Ccgui-new 先显示「暂无会话」，数秒后真实会话行才出现）。第一版只藏空态后，又暴露「loading 6s 掉线 → 空白期 → 会话突然蹦出」。  
> 产品口径（用户拍板）：**「暂无会话」占位直接下线；loading 全程在线且按阶段给描述文案（先读索引、再长查询），过程对用户可视化。**

## 背景与问题

workspace sidebar session 读取分两拍（`useWorkspaceThreadListHydration.ts`）：

1. **first-paint**：读 Session Index（SQLite，2.5s 超时 + 800ms 暖读重试）。返回 `visibleCount<=0 && !authoritativeEmpty`（Index 空但未证明权威空）时不标 hydrated，保持「加载中」，转第二拍。
2. **unconfirmed-empty settle**（`scheduleUnconfirmedEmptyFirstPaintSettle`）：`forceSessionIndexSync: true` 再确认一次（6s 窗口）。

原问题出在第二拍的 `.finally()`：**不看 settle 结果，无条件 publish hydrated**。settle 失败 / stale / 6s 再超时（仍非权威空）时照样标 hydrated → 侧栏从「加载中」跳到「暂无会话」；之后后台 importer 落盘触发 `session-index-imported` → ensure 合并填行。即 `加载中… → 暂无会话（假的） → 真实会话行`。

第一版 UI 藏掉空态后，同一根因换了个表现：settle 结束标 hydrated → loading 掉线 → **空白期** → 行到达。即 loading 的终止条件从未对齐「行真正到达」。

## 决策（最终方案）

1. **下线「暂无会话」占位**：workspace / worktree session 列表不再渲染 `ThreadEmptyState`；空列表渲染为无占位。
2. **loading 终止条件对齐「行到达」**：settle 的 finally 改为看结果——仅 `applied && (visibleCount>0 || authoritativeEmpty)` 才标 hydrated；未证实（失败 / 超时 / 仍非权威空）则**不标**，保持 loading 等 `session-index-imported` → ensure 填行。兜底：`EMPTY_SETTLE_LOADING_GRACE_MS = 20s` 宽限定时器到期仍未见行则标 hydrated 终态（真空 workspace 不永生 loading，终态即空白）。同时 `unconfirmedEmptySettleArmedIdsRef` 在 settle 结束后摘除，允许后续 ensure 再次 settle。
3. **loading 文案按阶段可视化**：`ThreadLoadingState` 组件内本地计时——初始「正在读取会话索引…」，超过 `INDEX_PHASE_LABEL_MS = 4s`（对齐 first-paint 2.5s+0.8s 预算）仍在 loading 则切「正在完整扫描本地会话…」。**刻意不做跨层 phase 状态 plumbing**（曾实现过 app-shell domain bag 全链路传递，13 个触点且给时序敏感测试引入并发抖动，已回滚）：4s 经验边界与两拍预算吻合，误差可接受。

### 加载链路（终态）

```
正在读取会话索引… →（>4s 未出）→ 正在完整扫描本地会话… → 会话行出现
                                                      ↘ 20s 宽限到期仍无行 → 空白（真空）
```

## 非目标（Known limitations）

- 阶段文案是时间近似而非真实状态机：若 first-paint 因暖读快返回而 settle 立即开始，前 4s 文案仍显示「读取索引」。可接受。
- i18n 死 key：`sidebar.emptyWorkspaceSessions`（11 locale + 测试 mock）与 `sidebar.loadingWorkspaceSessions`（基础「加载中…」，已被阶段文案取代）不再被引用；无 i18n unused-key gate，本 change 不清理。

## 影响面

- `src/app-shell/sections/useWorkspaceThreadListHydration.ts`：settle 条件标 hydrated + grace 宽限 + armed 集合可重试；`markWorkspaceThreadListHydrated` 统一终态出口；unmount 清理 grace 定时器。
- `src/features/app/components/ThreadLoadingState.tsx`：本地计时双阶段文案。
- `src/features/app/components/Sidebar.tsx`：删 `showThreadEmptyState` 分支与 `<ThreadEmptyState />`；`WorktreeSection` 不再传 `hydratedThreadListWorkspaceIds`。
- `src/features/app/components/WorktreeSection.tsx`：删 `showWorktreeEmptyState` 分支与同名 prop。
- `src/features/app/components/ThreadEmptyState.tsx`：删除；`src/styles/sidebar.css` 删 `.thread-empty-state*`。
- i18n：11 locale 新增 `sidebar.loadingWorkspaceSessionsIndex` / `sidebar.loadingWorkspaceSessionsDeep`。
- 测试：`Sidebar.test.tsx` / `WorktreeSection.test.tsx` 空态断言翻转为「不渲染任何占位」，loading 断言改索引文案；新增 `ThreadLoadingState.test.tsx`（fake setTimeout 验证 4s 文案切换）。

## 验收

- focused vitest（`--maxWorkers=2`）：Sidebar / WorktreeSection / ThreadLoadingState / useWorkspaceThreadListHydration **99/99 绿**。
- `npm run typecheck` exit 0。
- 已知存量红：`Sidebar.session-folders.test.tsx` 3 个分页测试 HEAD 即挂（git worktree 对照验证），与本 change 无关。
- 手测：冷启动展开多个有会话的工作区，观察 索引文案 →（慢则）扫描文案 → 会话行，全程无空白期、无「暂无会话」。
