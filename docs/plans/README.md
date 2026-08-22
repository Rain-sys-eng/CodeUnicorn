---
type: index
status: active
---

<!-- DOC-LIFECYCLE: active-index -->
# Plans 文档索引

> [!IMPORTANT]
> **Lifecycle: Active section index.** 当前**正式执行**仍以 active OpenSpec change 为准。下列含 draft plan 时，需经确认并 OpenSpec 化后才能当 backlog 执行；implemented 文件中的 unchecked checkbox 不构成 active backlog。

## Draft / pending confirmation

- [幕布历史顶部丢失 + 消息顺序/用户气泡连堆](./2026-08-18-conversation-curtain-history-missing-and-order.md) — P0 Bug A 已落地（`fix-claude-history-disk-window-load-more`，待 T5 真机手滑）；P1 Bug B 另开 `fix-canvas-user-bubble-stack-and-merge-order`。
- [0.8.9 → 0.9 通读盘点](./2026-08-15-port-0.8.9-capabilities-to-0.9.md) — 判定表；验收逐条见 [acceptance matrix](./2026-08-16-0.8.9-to-0.9-acceptance-matrix.md)。
- [Shared Session recovery exit closure](./2026-08-04-shared-session-recovery-exit-closure.md) — P0：恢复出口闭环（跨平台）；**尚未** OpenSpec 化、未改代码。

## Active execution plans

- [左侧 Session 六条回归一起收](./2026-08-19-sidebar-session-list-regression-bundle.md) — 标签全局开关 / 历史绑回 / 草稿隐藏 / Shared 读 `shared_sessions_v2` / 列表不蒸发。诊断：[`../analysis/sidebar-session-list-regression-bundle-2026-08-19.md`](../analysis/sidebar-session-list-regression-bundle-2026-08-19.md)。
- [AppShell 高内聚低耦合优化](./2026-08-11-app-shell-cohesion-optimization.md) — **活文档**：P0-0 度量 → bag 瘦身 → Host 子树化 → 物理模块化；完成 Todo 后必须回写进度与 Progress Log。
- [AppShell S4 结构手术前现状盘点](./2026-08-14-app-shell-s4-inventory.md) — PR #1092 内 S4 PR-A~F 的施工底图与完成回写；整包复盘见 [`../perf/pr-1092-performance-retrospective.md`](../perf/pr-1092-performance-retrospective.md)。

## Implemented historical plans

- [终端工具输出 live ingest 预算](./2026-08-22-tool-output-live-ingest-budget.md) — P0 已落地：`liveItemDeltaChannel` + `appendToolOutput` 复用 `boundToolOutput`（256KiB 头+尾），published 快照只发最后 200 行；`fileChange` / reasoning 不走帽；`ccgui.perf.toolOutputBudget=off` 可回退。
- [Composer popup fix](./2026-02-10-composer-popup-fix.md)
- [Unified workspace search](./2026-02-10-unified-workspace-search.md)
- [Project session management center](./2026-04-19-project-session-management-center-implementation.md)
- [Claude compact command adaptation](./2026-04-20-claude-compact-command-adaptation-implementation.md)
- [Context ledger then task center](./2026-05-03-context-ledger-then-task-center-implementation.md)
- [Browser dock phase 3](./2026-06-01-browser-dock-phase3.md)
- [Project map relationship dashboard](./2026-06-05-project-map-relationship-dashboard.md)
- [Project map API contract detail view](./2026-06-07-refine-project-map-api-contract-detail-view.md)
- [Claude provider drag reorder](./2026-06-20-claude-provider-drag-reorder.md)
- [Claude provider fetch models](./2026-06-20-claude-provider-fetch-models.md)
- [Multi-CLI provider/session foundation checklist](./2026-07-27-multi-cli-provider-session-foundation-task-checklist.md)

## Implemented architecture plans

- [Conversation canvas scroll ownership architecture](./2026-08-01-conversation-canvas-scroll-ownership-architecture.md) — Durable contract 已进入 main specs。
- [Unified conversation canvas architecture](./2026-08-01-unified-conversation-canvas-architecture.md) — Implementation 已归档。

## Superseded roadmaps

- [Phase 2 roadmap](./2026-02-10-phase2-roadmap.md) — 被后续 Project Memory/OpenSpec contracts 替代。

## Earlier archived plans

- [Archived plans index](./archived/README.md)

## Current planning source

- [OpenSpec changes](../../openspec/changes/)
- [OpenSpec main specifications](../../openspec/specs/README.md)
