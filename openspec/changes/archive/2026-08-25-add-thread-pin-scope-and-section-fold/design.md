# design: add-thread-pin-scope-and-section-fold

## 背景

现状事实源（代码核对 2026-08-25）：

- 全局置顶存储：`PinnedThreadsMap = { "<wsId>:<threadId>": timestamp }`，clientStorage `threads`/`pinnedThreads`，由 `src/features/threads/hooks/useThreadStorage.ts` 的 `pinThread / unpinThread / isThreadPinned / getThreadPinTimestamp` 管理，`pinnedThreadsVersion` 驱动刷新。
- 行拆分：`src/features/app/hooks/useThreadRows.ts` `getThreadRows(threads, isExpanded, workspaceId, getPinTimestamp, visibleCount)` 把 root 拆成 `pinnedRows`（pin 时间**升序**）与 `unpinnedRows`（createdAt 倒序、分页截断）。
- 全局置顶区：`PinnedThreadList.tsx` 按 `yyyy-mm-dd` 日历日分组（`pinnedThreadCalendarGroups.ts`），日折叠态在 `usePinnedSectionFold`（clientStorage `layout.pinnedSectionFold`）。**`sectionExpanded` / `toggleSection` 已存在但未接 UI**（0.9.1 去掉段头后成为死状态）；i18n `sidebar.collapsePinnedSection / expandPinnedSection / pinned / pinnedCount` 10 locale 全在。
- pin 入口：右键菜单 `useSidebarMenus.ts` L2247 单 pin 项（`RendererContextMenuItem`，支持 `submenu` 类型，leaf 无 `selected` 字段）；hover 图标 `ThreadList.tsx` L299-314 直接调 `onToggleThreadPin`（Sidebar `handleToggleThreadPin` L1735：pinned→unpin，否则 pin 全局）。
- AppShell：`pinThread / unpinThread / pinnedThreadsVersion / isThreadPinned / getThreadPinTimestamp` 由 `runtimeThreadContext` domain 持有（`appShellDomainContexts.ts` L93 附近）。

## 决策记录（用户确认 2026-08-25）

| # | 决策点 | 结论 |
| --- | -------- | ------ |
| 1 | 两作用域互斥 or 叠加 | **互斥**：`pinThread` 清 workspace pin，`pinThreadToWorkspace` 清 global pin |
| 2 | hover 图标行为 | 未置顶点击**直接弹 2 选菜单**；已置顶点击直接取消置顶 |
| 3 | 项目内置顶行样式 | 沿用现有 pin 图标，排项目列表顶部 |

## 方案

### 1. 总折叠行（PinnedThreadList）

```text
📌 已固定 · 12  ⌄   ← 总折叠行（新增，复用 .sidebar-section-header）
2026-08-25          ← 日组头（不变）
  …threads
2026-08-24
工作区
```

- `PinnedThreadList` 顶部渲染总折叠行：pin icon + `t("sidebar.pinned")` + `t("sidebar.pinnedCount", { count })` + chevron，`aria-expanded` / `aria-label` 用既有 `collapsePinnedSection / expandPinnedSection`。
- `sectionExpanded === false` 时整区只渲染该行，day groups 不渲染。
- active 日 `ensureDayExpanded` effect 仅在 `sectionExpanded` 时运行：总折叠是显式用户状态，不被 active thread 冲开。
- 行内 count = 置顶 root 总数（`rows.length` 中 depth 0 计数，沿用 dayGroups 输入）。

### 2. 数据模型（useThreadStorage）

新增同构 map，互斥在写路径强制：

```ts
// clientStorage "threads" store, key "workspacePinnedThreads"
type WorkspacePinnedThreadsMap = Record<string, number>; // "<wsId>:<threadId>" → ts

pinThread(ws, id)              // 原逻辑 + delete workspacePinned[key]
pinThreadToWorkspace(ws, id)   // 对称上限检查 + delete pinned[key]
unpinThread(ws, id)            // 两个 map 都清（互斥下最多命中一个）
isThreadWorkspacePinned(ws, id): boolean
getWorkspacePinTimestamp(ws, id): number | null
```

- 上限：沿用全局 pin 的 per-workspace 上限检查逻辑（`pinThread` L190 附近），项目内置顶共用同一上限语义。
- `pinnedThreadsVersion` 任一 map 写都 bump（消费方无需新增 version）。
- 无 legacy localStorage 迁移：`migrateLocalStorage.ts` 不动。

### 3. 行拆分（useThreadRows）

`getThreadRows` 增加参数 `getWorkspacePinTimestamp`，返回增加 `workspacePinnedRows`：

- root 分类顺序：global pinned → `pinnedRows`；workspace pinned → `workspacePinnedRoots`（pin 时间升序，与全局同约定）；其余 → `unpinnedRoots`。
- `workspacePinnedRows` 不占 `visibleThreadRootCount` 配额、不计入 `totalRoots`（与全局 pinned 一致）。
- 子会话跟随 root（`appendThread` 同一递归）。

Sidebar 消费点：`rowsByWorkspace` 存 `workspacePinnedRows`，工作区 `ThreadList` 由 `pinnedRows={[]}` 改为 `pinnedRows={workspacePinnedRows}`（ThreadList 本就先渲染 pinnedRows 再 unpinnedRows）；全局区 L1276 仍只用 `pinnedRows`。

### 4. pin 入口（useSidebarMenus + ThreadList）

右键菜单（`RendererContextMenuItem` 已有 `submenu` 类型）：

```text
置顶 ▸
  ✓ 置顶到全局      ← 当前作用域标注；点当前作用域 = 取消置顶
    置顶到项目内    ← 点另一作用域 = 迁移（互斥由 storage 层保证）
```

- leaf 无 `selected` 字段：当前作用域在 label 前加 `✓` 前缀标注（最小改动，不扩展菜单组件类型）。
- hover pin 图标（ThreadList）：新增 prop `onShowPinScopeMenu(event, workspaceId, threadId)`。
  - 未置顶：点击调 `onShowPinScopeMenu` → `useSidebarMenus.showPinScopeMenu` 构建同款 2 项 `RendererContextMenuState` 弹在点击坐标。
  - **坐标存原始 `clientX/clientY`，不做预 clamp**（手测回归沉淀）：`clampRendererContextMenuPosition` 默认 height=420 会把下半屏点击翻转成「弹在上方老远」，且翻转固化进 `menu.x/y` 后组件实测重 clamp 无法恢复；`RendererContextMenu` 自身有 estimate + measured 两段 clamp，预 clamp 多余且有害。
  - 已置顶（任一作用域）：点击调 `onToggleThreadPin` → 取消当前作用域（`handleToggleThreadPin` 改判两个作用域）。
- `isPinned` 视觉 = `isThreadPinned(ws, id) || isThreadPinned(ws, id, "workspace")`，pin 图标两作用域同一样式。

### 5. AppShell domain 接线（scope 参数化，零新增 domain key）

实施时命中 AppShell Structure Gate：`runtimeThreadContext` hard budget 咬死 51（先出后进），+3 keys 被 `check:app-shell:governance` 拦下。改为**扩既有 key 签名**：`pinThread / isThreadPinned / getPinTimestamp` 增加可选第 3 参 `scope?: ThreadPinScope`（默认 `"global"`，向后兼容全部既有 2 参调用点），`unpinThread` 语义改为双作用域清除。domain bag 零新增 key，`Sidebar` props / `layoutNodesTypes` / `useSidebarMenus` handlers 同步只改签名不加 key。

`ThreadPinScope = "global" | "workspace"` 定义在 `threads/utils/threadStorage.ts`，供 storage / rows / menus / components 共用。

### 6. i18n

`threads` namespace 新增（10 locale：`en zh zh-TW es fr hi ja ko pt-BR ru`）：

| key | zh | en |
| ----- | ---- | ---- |
| `pinToGlobal` | 置顶到全局 | Pin to global |
| `pinToProject` | 置顶到项目内 | Pin in project |

parity 由 `sidebarPinnedLocaleParity.test.ts` 模式扩 key 列表或新增 threads parity 断言。

## 风险与缓解

| 风险 | 缓解 |
| ------ | ------ |
| `getThreadRows` 签名变更波及 Sidebar 6+ 调用点 | 新参数追加在尾部带默认值；focused vitest 覆盖 pin integration |
| 项目内置顶行绕过 folder 投影 | 设计边界内（与全局置顶一致），spec 明确 |
| AppShell owned-keys 膨胀被 governance gate 拦 | scope 参数化既有 key（零新增 domain key），`check:app-shell:governance` 必须绿 |
| 右键 submenu 在窄栏溢出 | 复用现有 `RendererContextMenu` submenu 定位/翻转逻辑，不新增 |
| 老数据无 workspacePinnedThreads key | 读取回退 `{}`，与 pinnedThreads 初始化同款 |

## 回退

两段功能独立可拆：总折叠行是纯 UI 接线（状态已持久化），项目内置顶是新 map + 新桶。任一 revert 不影响另一段，老 `pinnedThreads` 数据始终兼容。
