# fix-topbar-tab-close-empty-canvas · Design

## 现状行为链（修复前）

```text
点 tab × / 右键关闭全部 / close-current-session 快捷键
  → useLayoutTopbarSessionTabs.applyTopbarWindowMutation
  → active tab 被移除，pickAdjacentTopbarSessionFallbackTab = null（无剩余 tab）
  → selectWorkspace(activeWorkspaceId)
  → app-shell handleSelectWorkspace
  → planWorkspaceNavigationThread({ lastThreadId: peekWorkspaceLastThreadId(ws) })
  → setActiveThreadId(lastThreadId, ws)   // lastThreadId == 刚关闭的会话
  → 画布继续渲染已关闭会话（幽灵内容）
  → 激活变化清 dismissedTopbarTabKeysRef → 已关闭 tab 在 topbar 复活
```

## 修复后行为链

```text
同上入口
  → applyTopbarWindowMutation：无相邻 fallback
  → onClearActiveThread(activeWorkspaceId)
  → app-shell handleClearActiveThread
  → exitDiffView() + setCenterMode("chat") + setActiveThreadId(null, ws)
  → activeThreadIdByWorkspace[ws] = null
  → 画布落到既有「workspace 无 active thread」态（空白 timeline + composer，
    与归档当前会话后的既有行为一致）
  → dismissedTopbarTabKeysRef 保留 → 已关闭 tab 不复活
```

## 关键决策

1. **清空语义放 app-shell，hook 只发意图**：`useLayoutTopbarSessionTabs` 不知道 `setActiveThreadId` 的存在，只新增 `onClearActiveThread(workspaceId)` 回调；具体的 chrome 清理（diff 退出、centerMode 归位）由 app-shell `handleClearActiveThread` 负责，与 `handleSelectWorkspace` 的职责分层一致。
2. **不复用 `handleSelectWorkspace`**：它的契约是「进入 workspace 并恢复 last thread」（`planWorkspaceNavigationThread` 注释明确 *Workspace navigation must keep the last selected thread*），与「关闭全部页签后留空」语义冲突；为关闭路径单设 handler，避免污染导航契约。
3. **identity + chrome only**：`handleClearActiveThread` 只调 `setActiveThreadId(null)` 与本地 chrome setter，不触发 `refreshEngineModels` / `get_engine_models` / `vendor_switch_*`（`session-switch-catalog-fetch-pitfall.md` 硬红线 1/2）。
4. **dismissed key 保留**：清空选择后 `currentActivation.threadId` 为 null，render 期的「activation 变化即删 dismissed key」分支不会执行，被关闭 tab 保持 dismissed 状态；之后用户从侧栏重新点开该会话时，既有「激活即移出 dismissed」逻辑自然恢复其 tab。
5. **空画布复用既有态**：`Messages` 在 `threadId === null` 时已渲染空 timeline；composer 在无 active thread 时已是既有路径（新建会话草稿）。本 change 不新增视觉空态组件。

## 影响面

| 文件 | 改动 |
|---|---|
| `src/features/layout/hooks/useLayoutTopbarSessionTabs.tsx` | input + mutation 分支 |
| `src/features/layout/hooks/layoutNodesTypes.ts` | options 类型 +1 字段 |
| `src/features/layout/hooks/useLayoutNodes.tsx` | 透传 +1 行 |
| `src/app-shell/sections/layoutNodes/useAppShellLayoutNodesSection.tsx` | 新增 `handleClearActiveThread` 并接线 |
| `src/features/layout/hooks/useLayoutTopbarSessionTabs.test.tsx`（新增） | hook 级回归 |

phone / tablet / compact 不渲染 topbar tabs，行为不变。editor split / diff 查看中关闭最后一个 tab：归位 chat，无会话内容残留。

## 风险与回退

- 风险：用户原本依赖「关完 tab 自动回到 last thread」当快捷恢复。缓解：侧栏会话列表一点即回；spec 明确该行为为 bug 而非 feature。
- 回退：恢复 `applyTopbarWindowMutation` 无 fallback 分支的 `selectWorkspace` 调用即可，无数据 / 持久化变更。
