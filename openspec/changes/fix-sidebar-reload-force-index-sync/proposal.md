# Change: fix-sidebar-reload-force-index-sync

## Why

用户反馈（2026-08-25，0.9.3 测试版 Windows）：「左侧工作区历史会话……最近一条历史数据需要点击重新加载也无法加载出来」。

根因：Index First 重构（`23c52d187`）之后，侧栏两个「重新加载」入口（`handleQuickReloadWorkspaceThreads` / `handleReloadWorkspaceThreads`，`src/app-shell/sections/layoutNodes/useAppShellLayoutNodesSection.tsx`）调用 `listThreadsForWorkspaceTracked(target)` 时**不传任何 options** → hydration kind 默认 `first-paint` → `listThreadsForWorkspace` 内 Session Index 读取参数为 `syncIfNeeded: false, forceSync: false`（`src/features/threads/hooks/useThreadActions.ts` first-paint 分支）——纯温 SQLite 读，**不 rescan、不扇出引擎**。

新会话进索引依赖后端 importer 90s 轮询（`src-tauri/src/session_index/importer.rs IMPORT_INTERVAL`）。后果：

- importer 轮询窗口内（≤90s）点多少次「重新加载」都不会出现新会话；
- 若该行被 `should_omit_claude_index_row` 过滤或 importer 当 tick 失败，则**永远**刷不出来——用户没有任何 UI 路径强制发现。

「重新加载」是用户显式的强制发现意图，温读索引违背该意图。

## What Changes

- **F1 重载强制索引同步（useAppShellLayoutNodesSection.tsx）**：两个 reload handler 调 `listThreadsForWorkspaceTracked` 时传 `{ forceSessionIndexSync: true }`（模块级常量 `USER_RELOAD_THREAD_LIST_OPTIONS`，附注释）。效果：first-paint kind 不变（仍不扇出多引擎盘扫，远轻于 full-catalog），但 Session Index 写者被强制 rescan（超时预算从 2.5s 升为 6s，既有 `forceIndexSync` 分支语义），importer 轮询窗口内的新会话立即可见。
- **F2 source-policy 测试**：新建 `src/app-shell/sections/layoutNodes/reloadWorkspaceThreads.policy.test.ts`（沿用 `handleSelectWorkspace.policy.test.ts` 的源码断言模式），断言两个 handler 均携带 `forceSessionIndexSync: true` 调用 tracked loader。

## Capabilities

### Modified Capabilities

- `workspace-sidebar-session-loading`：ADDED requirement——用户显式触发的会话列表重载 MUST 强制 Session Index rescan，MUST NOT 只做温 SQLite 读。

### Non-Goals

- 不改 cold-start 期间非 active workspace 的跳过守卫（`shouldSkipWorkspaceDuringColdStart`，Windows 冷启动保护，见 `windows-cold-start-click-freeze` gate）。
- 不改 importer 90s 轮询间隔与 `should_omit_claude_index_row` 过滤语义。
- 不把重载升级为 full-catalog 多引擎扇出（重得多，且 Gemini/Grok/OpenCode 盘扫非本症状所需）。
- 不处理「加载很慢」的冷启动编排部分（单独评估）。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Frontend | `useAppShellLayoutNodesSection.tsx`（2 个 handler + 1 个常量） |
| 测试 | 新建 `reloadWorkspaceThreads.policy.test.ts` |
| 热路径 | 仅用户点击重载时多一次索引 rescan（秒级），无后台常驻开销 |
| 兼容性 | options 字段为既有契约（软重同步已在用），无 schema 变更 |

## Acceptance

1. importer 90s 轮询窗口内，新 CLI 会话点「重新加载」后立即出现在列表（索引被强制 rescan）。
2. 重载仍不触发多引擎盘扫 fan-out（kind 保持 first-paint）。
3. cold-start 非 active workspace 跳过守卫行为不变。
4. 新增 policy 测试与既有 hydration 测试全绿；`openspec validate fix-sidebar-reload-force-index-sync` 通过。
