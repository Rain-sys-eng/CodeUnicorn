# add-thread-pin-scope-and-section-fold

## Why

侧栏全局置顶区自 `fold-sidebar-pinned-by-calendar-day`（0.9.1）起按日历日折叠，但段级总折叠被一并移除：置顶一多，「工作区」仍被顶出视口，用户无法一键收起整个置顶区。同时置顶只有「全局顶」一种语义，用户希望会话可以只在自己项目内沉顶，不占用全局置顶区。

用户已确认三项产品决策：

1. 两种置顶作用域**互斥**：同一会话同一时刻只能是「全局置顶」或「项目内置顶」之一。
2. 未置顶会话点击 hover 置顶图标时**直接弹 2 选菜单**（接受多一次点击）；已置顶会话点击图标直接取消置顶。
3. 项目内置顶行沿用现有 pin 图标样式，排项目会话列表顶部。

## 目标与边界

### 目标

- 置顶区恢复总折叠行：pin icon + 本地化「已固定」文案 + 数量 + chevron，点击整体折叠/展开；折叠态持久化。
- 置顶拆成两个互斥作用域：`global`（现状，进全局置顶区）与 `workspace`（项目内置顶，排该项目会话列表顶部）。
- 右键菜单 pin 项改为 submenu，提供两个作用域选项并标注当前作用域；hover pin 图标在未置顶时弹同款 2 选菜单。
- 项目内置顶持久化到 clientStorage，重启保留。
- 全 locale 补齐新文案，过 locale parity 门禁。

### 边界

- 只改侧栏置顶语义与展示；不改 pin 排序基准（沿用 pin timestamp 序）、不改工作区「先露 12 条 + 更多」分页。
- 项目内置顶行不参与项目会话 folder 投影（与全局置顶一致，folder 只组织普通会话）。
- 总折叠是显式用户状态：当前会话落在置顶区时只触发日级 auto-expand，不冲开总折叠。

## 非目标

- 不做置顶拖拽排序。
- 不做「天 × workspace」双层分组。
- 不改 `workspace-sidebar-settings` 的 pinned entries（设置项钉选是另一套）。

## What Changes

- `usePinnedSectionFold` 的 `sectionExpanded` / `toggleSection` 接入 `PinnedThreadList` 总折叠行 UI（状态与 i18n key 已存在，纯接线）。
- `useThreadStorage` 新增 `workspacePinnedThreads` map（clientStorage `threads`/`workspacePinnedThreads`），新增 `pinThreadToWorkspace` / `isThreadWorkspacePinned` / `getWorkspacePinTimestamp`；`pinThread` 与 `pinThreadToWorkspace` 互斥清理，`unpinThread` 同时清两个 map。
- `useThreadRows.getThreadRows` 新增第三桶 `workspacePinnedRows`（项目内置顶 root 按 pin 时间升序排最前，与全局 pinnedRoots 同序约定），不进 `pinnedRows`（全局区）、不占分页配额。
- `useSidebarMenus` 线程右键菜单 pin 项改 submenu（`置顶到全局` / `置顶到项目内`，当前作用域标注）；新增 `showPinScopeMenu` 供 hover 图标弹出同款菜单。
- `ThreadList` pin 图标：未置顶点击弹 2 选菜单，已置顶点击直接取消置顶；`isPinned` 视觉覆盖两种作用域。
- AppShell `runtimeThreadContext` domain 新增 owned keys 并接线到 `Sidebar` props。
- OpenSpec：MODIFIED `sidebar-pinned-calendar-fold`（总折叠行回归）与 `workspace-sidebar-visual-harmony`（pin 交互改 2 选菜单），新增 capability `sidebar-thread-pin-scope`。

## Capabilities

### New Capabilities

- `sidebar-thread-pin-scope`：置顶作用域（global / workspace）互斥语义、项目内置顶排序与持久化、双作用域入口与本地化。

### Modified Capabilities

- `sidebar-pinned-calendar-fold`：置顶区重新引入段级总折叠行；日期头仍是展开态内容层最外层。
- `workspace-sidebar-visual-harmony`：「Thread Pin Toggle Interaction」改为未置顶弹 2 选菜单、已置顶直接取消，仍不得误触发线程切换。

## 验收标准

1. 置顶区顶部有总折叠行；点击整区收起只留该行，再点展开；刷新后折叠态保留。
2. 总折叠收起时，当前会话即使在置顶区也不冲开总折叠；展开时日级折叠行为与现状一致（最新日默认开、active 日自动开）。
3. 未置顶会话：点 hover pin 图标弹「置顶到全局 / 置顶到项目内」2 选菜单，不触发会话切换；右键菜单 pin submenu 同款两选项。
4. 选「置顶到项目内」：会话排该项目列表顶部、带 pin 图标，不出现全局置顶区；再选「置顶到全局」则迁移到全局区（互斥）。
5. 已置顶会话点 pin 图标直接取消置顶，回到普通列表，无残留重复行。
6. 重启后两种置顶都保留；zh / en 及其余 locale 无 raw key。
7. `npm run check:app-shell:governance` 通过（新 domain keys 已登记）。

## Impact

- `src/features/threads/hooks/useThreadStorage.ts`（+workspace pin map，scope 参数化 pin API）
- `src/features/app/hooks/useThreadRows.ts`（+workspacePinnedRows 桶）
- `src/features/app/hooks/useSidebarMenus.ts`（pin submenu + showPinScopeMenu）
- `src/features/app/components/ThreadList.tsx`、`PinnedThreadList.tsx`、`Sidebar.tsx`
- `src/app-shell/domains/*`（零新增 key，仅签名扩展）与 `src/app-shell/hosts/useAppShellAssemblyHost.ts`
- `src/i18n/locales/*/threads.ts`、`sidebar.ts`（10 locale）
- 测试：`useThreadStorage.test.tsx`、`useThreads.pin.integration.test.tsx`、`usePinnedSectionFold.test.ts`、`PinnedThreadList.test.tsx`、`useSidebarMenus.test.tsx`、`sidebarPinnedLocaleParity.test.ts`
- OpenSpec change `add-thread-pin-scope-and-section-fold`
