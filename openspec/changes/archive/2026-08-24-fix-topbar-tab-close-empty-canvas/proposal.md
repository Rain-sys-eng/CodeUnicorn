# fix-topbar-tab-close-empty-canvas

## Why

用户反馈（macOS / Windows 一致）：**关闭 topbar 最后一个会话页签后，画布仍显示刚被关闭的会话内容（幽灵内容）**；关闭页签后的默认落点是「最后打开的会话」，而不是用户预期的相邻页签 / 空状态。

根因链（代码事实）：

1. `src/features/layout/hooks/useLayoutTopbarSessionTabs.tsx` 的 `applyTopbarWindowMutation`：active tab 被移除且无相邻 fallback 时调用 `selectWorkspace(...)`。
2. app-shell `handleSelectWorkspace`（`src/app-shell/sections/layoutNodes/useAppShellLayoutNodesSection.tsx`）内部走 `planWorkspaceNavigationThread({ lastThreadId: peekWorkspaceLastThreadId(workspaceId) })`，**恢复 workspace 的 last thread——正是刚被关闭的会话**。
3. activeThreadId 指回已关闭会话 → 画布继续渲染其内容；同时激活事件清掉 `dismissedTopbarTabKeysRef` 中的记录，被关闭的页签在 topbar 复活。

设计选款稿：`docs/designs/session-close-behavior/`（A 浏览器式相邻激活 + 真实空状态 / B 常驻开始页 / C 软关闭 + 撤销），**用户拍板方案 A**。

## 目标与边界

- 关闭 topbar 页签后仍有剩余 tab：维持既有「右侧相邻优先、其次左侧相邻」fallback（`pickAdjacentTopbarSessionFallbackTab`），不改。
- 关闭后**无剩余 tab**（单个关闭 / 关闭全部 / 快捷键关闭共用 `applyTopbarWindowMutation`）：清空当前 workspace 的 active thread 选择（`setActiveThreadId(null, workspaceId)`），画布落到既有「无 active thread」空画布态，**禁止**经 `selectWorkspace` 恢复 last thread。
- 被关闭页签不得因本次清空操作复活（`dismissedTopbarTabKeysRef` 语义保持）。

## 非目标

- 不改有剩余 tab 时的相邻 fallback 顺序（右优先于左），本轮不做「左相邻优先」调整。
- 不做设计稿 A 中的装饰性空态卡（app mark + 「没有打开的会话」+ 新建会话 CTA）：当前复用既有「workspace 无 active thread」画布（与归档当前会话后一致），视觉 polish 另立 change。
- 不做方案 B（常驻开始页）/ 方案 C（⇧⌘T 撤销栈）。
- 不改 thread 生命周期：关闭页签仍只是窗口管理，不删除 / 不归档 thread，不终止运行中 turn。
- 不自动 git commit（交用户验收后提交）。

## What Changes

- `useLayoutTopbarSessionTabs.tsx`：input 新增 `onClearActiveThread(workspaceId)`；`applyTopbarWindowMutation` 无相邻 fallback 分支改调 `onClearActiveThread`，不再调 `onSelectWorkspace`（该 input 在 hook 内不再使用则移除）。
- `layoutNodesTypes.ts` / `useLayoutNodes.tsx`：options 增加并透传 `onClearActiveThread`。
- `useAppShellLayoutNodesSection.tsx`：新增 `handleClearActiveThread`（`exitDiffView` + `setCenterMode("chat")` + `setActiveThreadId(null, workspaceId)`；identity + chrome only，零 IPC，符合 `dev-guidelines/guides/session-switch-catalog-fetch-pitfall.md` 红线）。
- 测试：hook 级测试覆盖「关最后一个 tab → onClearActiveThread 被调用、onSelectWorkspace / onSelectThread 不被调用」。
- OpenSpec capability：`workspace-topbar-session-tabs`（MODIFIED）。

## 方案取舍

- **方案 A（采用）**：浏览器式相邻激活 + 无剩余 tab 时清空选择落真实空画布。改动最小、用户心智成本最低。
- **方案 B（不采用）**：常驻「开始」页签。需新增页签类型 + 最近会话数据层，超出 bug 修复面。
- **方案 C（不采用）**：软关闭 + ⇧⌘T 撤销栈。可在 A 之上后续叠加，本 change 不做。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `workspace-topbar-session-tabs`：无剩余 tab 时由「仅清空 topbar 高亮」收紧为「清空 active thread 选择并落空画布，禁止恢复 workspace last thread」。
