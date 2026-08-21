---
type: index
status: active
---

<!-- DOC-LIFECYCLE: active-index -->
# Analysis 文档索引

> [!IMPORTANT]
> **Lifecycle: Active section index.** 本索引校准于 2026-08-08，当前产品版本为 `0.8.5`。Analysis 解释实现与决策背景，不是行为事实源；current contract 以 OpenSpec main specs 与代码为准。

## Current reference

- [Canvas live tool projection matrix](./canvas-live-tool-projection-matrix-2026-08-01.md) — Active technical reference；Grok history projection change 已归档。
- [Conversation canvas structure](./conversation-canvas-structure-2026-07-31.md) — Active architecture reference。
- [Live settle assistant/tool order](./live-settle-assistant-tool-order-2026-08-04.md) — Active incident analysis；Shared×Claude 已确认「流式对 / 结束后偶发错序 / 历史恢复」；Shared+Native 跨引擎同源矩阵。
- [Native session provider select vs disk overwrite](./native-session-provider-select-vs-disk-overwrite-2026-07-31.md) — Active session-selection contract explanation。
- [Native vs Shared CLI explained](./native-vs-shared-cli-explained.md) — Active product/engineering guide。
- [Shared create / open local catalog stale mapping](./shared-create-local-catalog-stale-mapping-2026-08-08.md) — Active fix reference；Shared 创建权威 catalog + 打开历史文案/图标 mapping 同源。
- [Workspace switch session catalog performance regression](./workspace-switch-session-catalog-performance-regression-2026-08-08.md) — Active incident analysis；校准 v0.7.16/v0.8.0 commits、exhaustive projection 主根因、首轮修复证伪与性能治理顺序。
- [左侧会话列表拉取：0.8.9 对照](./sidebar-session-list-fetch-0.8.9-vs-current-2026-08-18.md) — Historical 主线对照；N0 投影不蒸发 + N1–N6。合同：[`complete-native-sidebar-session-index`](../../openspec/changes/complete-native-sidebar-session-index/proposal.md)。Shared 维持现状不进本轮。
- [左侧 Session 六条回归（2026-08-19）](./sidebar-session-list-regression-bundle-2026-08-19.md) — Active 定位；标签 / 绑回 / 草稿 / Shared sqlite / 列表跳动。合同：`fix-sidebar-session-list-regressions`。计划：[`../plans/2026-08-19-sidebar-session-list-regression-bundle.md`](../plans/2026-08-19-sidebar-session-list-regression-bundle.md)。
- [React #185 / ErrorBoundary Crash playbook](./react-185-maximum-update-depth-playbook.md) — Active troubleshooting runbook；主线 `#185` + 并列家族 `RangeError` 栈溢出（AP-08）；最新 case `C-20260811-01`（0.8.6 Markdown table row count / #1066；前案 C-20260805-01 等）。
- [Windows cold-start click freeze（版本记录 + 权限选择 + first-click）](./windows-cold-start-click-freeze-release-notes-and-composer-2026-08-14.md) — Active incident analysis；2026-08-14 P0。执行禁令见 `dev-guidelines/guides/windows-cold-start-click-freeze-pitfall.md`。
- [DSH k3 超长 goal 客户端假死](./dsh-k3-long-goal-client-stall-2026-08-21.md) — Active incident analysis；2026-08-21。DSH host 仍活、mossx 被 token 级 delta 灌满；修复仅 DSH mux 50ms/4KB coalesce，不改公共队列。
- [PR #1092 性能复盘](../perf/pr-1092-performance-retrospective.md) — 流式 / AppShell / 长历史 / 冷启动的主因、解法与防再犯；冷启只是其中一条战线。

## Resolved incidents and closure evidence

- [Cold-start click freeze postmortem](./cold-start-click-freeze-postmortem-2026-08-10.md) — **Resolved 2026-08-10**；6 天全链路追踪，三层根因模型，最终通过 `applyUiScale` 条件 CSS 清除根治。关联：`windows-cold-start-click-freeze-and-uiscale-0.8-2026-08-07.md`、`windows-ccgui-startup-hang-2026-08-05.md`。
- [Shared session model picker native fallback](./shared-session-model-picker-native-fallback-2026-08-02.md) — Resolved 2026-08-03；identity、optimistic persistence 与 stale hydrate protection 已闭环。
- [Unify conversation canvas review](./unify-conversation-canvas-review-2026-08-01.md) — Implemented review/closure evidence。

## Historical snapshots

- [Client shortcuts and priorities, 2026-07](./client-shortcuts-and-priorities-2026-07.md) — Historical priority snapshot；不得作为 current backlog。

## Canonical pointers

- [OpenSpec main specifications](../../openspec/specs/README.md)
- [Archived unify-conversation-canvas change](../../openspec/changes/archive/2026-08-03-unify-conversation-canvas/)
- [Archived scroll-ownership change](../../openspec/changes/archive/2026-08-03-refactor-conversation-canvas-scroll-ownership/)
- [Archived shared target race-and-merge change](../../openspec/changes/archive/2026-08-03-fix-shared-session-target-race-and-merge/)
- [Archived Grok history projection change](../../openspec/changes/archive/2026-08-03-fix-grok-history-tool-projection/)
