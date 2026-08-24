# show-workspace-home-on-last-tab-close

## Why

`fix-topbar-tab-close-empty-canvas`（已归档 `2026-08-24-` 前缀）修掉了幽灵内容，但落地态是「裸空画布 + 底部 composer」（`今天想构建什么？` 一行小字），用户验收后反馈 **不够友好**，并明确拍板：**tab 都关闭时直接显示 workspace home 首页**（`HomeChat`：「创造任何东西」hero + 居中 composer + workspace chip，即 `showWorkspaceHome` 既有 surface）。

## 目标与边界

- 关闭 topbar 最后一个会话页签（单个 / 关闭全部 / close-current-session 快捷键）后，画布渲染 **workspace home**（`HomeChat`），不再是裸空画布。
- 复用既有 `showWorkspaceHome` 通路：`handleClearActiveThread` 在清空选择的同时 `setWorkspaceHomeWorkspaceId(workspaceId)` + `setHomeOpen(false)`。
- 反向路径保持既有契约：从首页 / 侧栏激活任一会话时 `commitThreadSelection` 已会重置 `workspaceHomeWorkspaceId` / `homeOpen`，回到消息画布。

## 非目标

- 不改 `HomeChat` 组件本身的视觉 / 文案 / 交互。
- 不改有剩余 tab 时的相邻 fallback。
- 不改 app 级 home（`homeOpen`）的进入退出语义。
- 不自动 git commit（交用户验收后提交）。

## What Changes

- `useAppShellLayoutNodesSection.tsx`：`handleClearActiveThread` 追加 `setHomeOpen(false)` + `setWorkspaceHomeWorkspaceId(workspaceId)`。
- `handleSelectWorkspace.policy.test.ts`：`handleClearActiveThread` policy 断言追加 workspace home 路由。
- OpenSpec capability：`workspace-topbar-session-tabs`（MODIFIED，空画布落点收紧为 workspace home）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `workspace-topbar-session-tabs`：无剩余 tab 时的画布落点由「workspace 无 active thread 空画布」改为「workspace home 首页」。
