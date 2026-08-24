## 1. Grouping and fold state

- [x] 1.1 抽出 `formatPinnedCalendarDateKey` / `groupPinnedRowsByCalendarDay`（本地 `yyyy-mm-dd`，子会话跟 root，family 跟 representative）
  - 验证：grouping 单测覆盖最新日倒序、跨天、子会话、family
- [x] 1.2 新增 `usePinnedSectionFold`（`layout.pinnedSectionFold`：段默认开，最新日开，更早收）
  - 验证：hook 单测覆盖默认、toggle、persist、active-day ensure

## 2. PinnedThreadList UI

- [x] 2.1 去掉「已固定」段头；`yyyy-mm-dd` 作为最外层
  - 验证：无 Pinned / 钉子 / chevron；日期头复用工作区 section class
- [x] 2.2 日期头默认可折，只开最新日
  - 验证：旧日行不可见；点旧日只开那天
- [x] 2.3 当前会话所在日自动展开
  - 验证：activeThreadId 落在旧日时该日可见

## 3. i18n

- [x] 3.1 全 locale `sidebar.ts` 补 `pinnedCount` / collapse / expand keys
  - 验证：zh/en 及其余 locale 无 raw key
- [x] 3.2 `vitest.setup.ts` 与 `PinnedThreadList.test.tsx` mock 同步
  - 验证：现有 PinnedThreadList / Sidebar 用例不因缺 key 失败

## 4. Tests and OpenSpec

- [x] 4.1 扩展 `PinnedThreadList.test.tsx`：默认态、段折、日折、钉子、i18n
  - 验证：focused vitest 绿
- [x] 4.2 本 change artifacts 齐：proposal / design / spec / tasks
  - 验证：`openspec status --change fold-sidebar-pinned-by-calendar-day`
