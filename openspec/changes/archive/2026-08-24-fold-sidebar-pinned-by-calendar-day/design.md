## 背景

全局置顶区在市场 / 拓展下面、工作区上面，与工作区共用同一条 `ScrollArea`。`PinnedThreadList` 只按连续 workspace 切段，没有分区头，`isExpanded` 写死为 true，`showPagingControls={false}`。

用户已确认默认态，并在落地后校正视觉：去掉「已固定」层，日期头直接顶到最外层，和工作区 section 对齐，不要折叠 chevron。

```
2026-08-18          ← 最新日，默认开；视觉同「工作区」
  …threads
2026-08-17          ← 默认收
2026-08-15
工作区
```

## 方案

**选定：yyyy-mm-dd 作为最外层；无段头 / 无 chevron**

| Option | Summary | Trade-off |
|--------|---------|-----------|
| A 整段折 | 只加 header | 展开仍扫不动 |
| **B 段 + yyyy-mm-dd（采用）** | 两层折，最新日默认开 | 组内排序保持 pin 序 |
| C 天 × workspace | 再套项目头 | 窄栏过密，明确不做 |

### 分组

- 键：本地时区 `updatedAt`，算法与雷达 `formatDateKey` 相同：`${year}-${month}-${day}`。
- 子会话跟 root；continuation family 跟 representative（非 `provider-continuation` 的成员，否则第一个）。
- 同一天内保持现有 pin 序；天与天按日期倒序。
- 一天内仍按连续 workspace 切成多个 `ThreadList`（单实例只能吃一个 `workspaceId`），不渲染 workspace 头。

### 默认与持久化

clientStorage `layout.pinnedSectionFold`：

```ts
{ sectionExpanded?: boolean; collapsedDays?: string[]; expandedDays?: string[] }
```

- 不再渲染段头；`sectionExpanded` 不再驱动 UI。
- 日：最新日开，除非在 `collapsedDays`；更早的日关，除非在 `expandedDays`。
- 当前会话所在日若关闭，调用 `ensureDayExpanded`。

### 日期头

复用 `.sidebar-section-header` / `.sidebar-section-title`，与「工作区」同一套字号、颜色、行高、左内边距。不要钉子、不要 chevron、不要数量。仍可点击折叠，`aria-expanded` + i18n collapse/expand。

### i18n

日期头动作名：

- `sidebar.collapsePinnedDay` / `expandPinnedDay`

日期本身是 `yyyy-mm-dd`，不翻译。段头相关 key 可保留但不渲染。

## 风险

- 时区：测试必须用本地 `new Date(y, m-1, d)`，禁止 `Date.UTC`。
- persist 泄漏：测试 `beforeEach` 调 `resetClientStorageForTests`。
- sticky 双头：置顶头 `z-index: 3`，工作区头保持 2；第一刀接受重叠，不改工作区 sticky 合同。
