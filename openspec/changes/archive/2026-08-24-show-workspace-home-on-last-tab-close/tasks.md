# show-workspace-home-on-last-tab-close · Tasks

## 1. 行为接线

- [x] 1.1 `handleClearActiveThread` 追加 `setHomeOpen(false)` + `setWorkspaceHomeWorkspaceId(workspaceId)`，关完全部 tab 落到 workspace home（`HomeChat`）

## 2. 回归测试

- [x] 2.1 `handleSelectWorkspace.policy.test.ts`：`handleClearActiveThread` 断言包含 `setWorkspaceHomeWorkspaceId(workspaceId)` 与 `setHomeOpen(false)`，仍禁止恢复 last thread / catalog IPC
- [x] 2.2 focused vitest 通过（policy + topbar hook + view state section）

## 3. OpenSpec

- [x] 3.1 proposal / tasks / spec delta（`workspace-topbar-session-tabs` MODIFIED）
- [x] 3.2 `openspec/changes/README.md` active 表登记
- [x] 3.3 `openspec validate --strict --no-interactive` 通过
- [x] 3.4 用户本机验收通过（2026-08-26：关完全部 tab → workspace home 首页；再点会话 → 正常回消息画布）；archive 随收口执行
