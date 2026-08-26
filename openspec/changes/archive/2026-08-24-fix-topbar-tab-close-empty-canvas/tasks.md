# fix-topbar-tab-close-empty-canvas · Tasks

## 1. Hook 行为修复

- [x] 1.1 `useLayoutTopbarSessionTabs` input 新增 `onClearActiveThread(workspaceId)`；`applyTopbarWindowMutation` 无相邻 fallback 分支改调 `onClearActiveThread`，不再调 `onSelectWorkspace`（移除 hook 内不再使用的 `onSelectWorkspace` input）
- [x] 1.2 `layoutNodesTypes.ts` options 类型新增 `onClearActiveThread`
- [x] 1.3 `useLayoutNodes.tsx` 透传 `onClearActiveThread` 至 `useLayoutTopbarSessionTabs`

## 2. App-shell 接线

- [x] 2.1 `useAppShellLayoutNodesSection.tsx` 新增 `handleClearActiveThread`（`exitDiffView` + `setCenterMode("chat")` + `setActiveThreadId(null, workspaceId)`；identity + chrome only，零 IPC）
- [x] 2.2 将 `handleClearActiveThread` 接入 layoutNodes options

## 3. 回归测试

- [x] 3.1 新增 `useLayoutTopbarSessionTabs.test.tsx`：关闭最后一个 active tab → `onClearActiveThread` 被调用、`onSelectThread` 不被调用、清空后 tab 不复活
- [x] 3.2 同文件覆盖：关闭 active tab 且有剩余 tab → 仍走相邻 fallback（`onSelectThread` 相邻 tab），不调 `onClearActiveThread`
- [x] 3.3 focused vitest 通过（topbar / layoutNodes / app-shell layoutNodes section 相关测试）

## 4. OpenSpec

- [x] 4.1 proposal / design / tasks / spec delta（`workspace-topbar-session-tabs` MODIFIED）
- [x] 4.2 `openspec/changes/README.md` active 表登记
- [x] 4.3 `openspec validate --strict --no-interactive` 通过
- [x] 4.4 用户 macOS 本机验收通过（2026-08-26 截图确认：关最后一个页签 → 空画布 + composer、tab 不复活）；修复位于平台无关 renderer 层，Win / Linux 同路径覆盖；archive 可另排
