# tasks: add-thread-pin-scope-and-section-fold

## 1. Storage：workspace 作用域置顶（useThreadStorage）

- [x] 1.1 `useThreadStorage.ts` 新增 `workspacePinnedThreads` map（clientStorage `threads`/`workspacePinnedThreads`），读写 / reload 路径与 `pinnedThreads` 对齐
  - 验证：单测覆盖初始化空回退、写入持久化、reload 恢复
- [x] 1.2 新增 `pinThreadToWorkspace / isThreadWorkspacePinned / getWorkspacePinTimestamp`；`pinThread` 清 workspace pin、`pinThreadToWorkspace` 清 global pin、`unpinThread` 两 map 都清；任一写 bump `pinnedThreadsVersion`
  - 验证：互斥单测（global→workspace 迁移、workspace→global 迁移、unpin 双清）

## 2. 行拆分（useThreadRows）

- [x] 2.1 `getThreadRows` 尾部追加可选参数 `getWorkspacePinTimestamp`，返回新增 `workspacePinnedRows`（pin 时间升序、不占分页配额、子会话随 root）
  - 验证：`useThreads.pin.integration.test.tsx` 扩项目内置顶排序 / 不进全局桶 / 不占配额定用例

## 3. AppShell domain 接线（scope 参数化）

- [x] 3.1 不新增 domain key：`pinThread` / `isThreadPinned` / `getPinTimestamp` 增加可选 `scope?: ThreadPinScope` 第 3 参（默认 `"global"`），`runtimeThreadContext` owned keys 不变
  - 验证：`npm run check:app-shell:governance` 通过（hard 51 不超）
- [x] 3.2 `useThreads` / `layoutNodesTypes` / `useLayoutNodes` / `Sidebar` props 签名同步透传 scope 参数
  - 验证：tsc 无错

## 4. pin 入口（useSidebarMenus + ThreadList + Sidebar）

- [x] 4.1 右键菜单 pin 项改 submenu（`置顶到全局` / `置顶到项目内`，当前作用域 `✓` 标注；点当前=取消，点另一=迁移）
  - 验证：`useSidebarMenus.test.tsx` 覆盖三态（未置顶 / 全局 / 项目内）
- [x] 4.2 新增 `showPinScopeMenu(event, workspaceId, threadId)` 构建同款 2 项 `RendererContextMenuState`
  - 验证：菜单内容与右键 submenu 一致
- [x] 4.3 `ThreadList` 新增 `onShowPinScopeMenu` prop；未置顶点击弹菜单、已置顶点击 `onToggleThreadPin` 取消；`isPinned` 视觉覆盖两作用域；Sidebar `handleToggleThreadPin` 改判两个 map
  - 验证：`PinnedThreadList.test.tsx` / Sidebar 行测试覆盖两作用域点击行为与不得触发会话选中

## 5. 总折叠行（PinnedThreadList）

- [x] 5.1 顶部渲染总折叠行（pin icon + `sidebar.pinned` + `pinnedCount` + chevron，`aria-expanded` / `aria-label` 用既有 collapse/expandPinnedSection），点击调 `toggleSection`
  - 验证：折叠时 day groups 不渲染、再点恢复且日折叠态不变
- [x] 5.2 `ensureDayExpanded` effect 仅在 `sectionExpanded` 时运行
  - 验证：总折叠态下 active 置顶会话不冲开总折叠
- [x] 5.3 CSS：总折叠行复用 `.sidebar-section-header`，chevron 旋转态
  - 验证：目视 + class 断言

## 6. i18n

- [x] 6.1 10 locale `threads.ts` 补 `pinToGlobal` / `pinToProject`
  - 验证：locale parity 测试扩 key 后全绿

## 7. Tests and OpenSpec

- [x] 7.1 focused vitest 全绿：`useThreadStorage` / `useThreads.pin.integration` / `usePinnedSectionFold` / `PinnedThreadList` / `useSidebarMenus` / `sidebarPinnedLocaleParity`
  - 验证：`npx vitest run <files>`
- [x] 7.2 `openspec validate add-thread-pin-scope-and-section-fold --strict --no-interactive` 通过
  - 验证：命令输出无 error
