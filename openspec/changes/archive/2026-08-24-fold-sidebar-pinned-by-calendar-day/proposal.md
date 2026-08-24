## Why

侧栏全局置顶区 `PinnedThreadList` 现在是无分区头的扁平列表，且 `isExpanded` 写死、不能收起。置顶一多就把「工作区」顶出视口。用户已选定按本地日历日 `yyyy-mm-dd` 分组，最新日展开、更早日期收起；落地后校正为去掉「已固定」层，日期头直接顶到最外层并与工作区 section 对齐。

## 目标与边界

### 目标

- 置顶区最外层直接是 `yyyy-mm-dd` 组头，不要「已固定」段头。
- 组头只写本地时区 `updatedAt` 的 `yyyy-mm-dd`，禁止「今天 / 昨天 / 更早」。
- 默认：最新有 pinned 的那天开；更早日期收着。
- 日期头视觉与「工作区」对齐，不要折叠 chevron / 钉子 / 数量。
- 折叠状态写入 clientStorage；当前会话所在日若被收，自动打开那天。
- 全部 locale 补齐日期折叠 i18n。

### 边界

- 只改全局置顶区，不把置顶搬进「拓展」。
- 组内仍按现有 pin 序；跨 workspace 可进同一天，不再套一层项目头。
- 行右侧相对时间（6分 / 2时）不参与分组。

## 非目标

- 不复用工作区「先露 12 条 + 更多」分页。
- 第一刀不做「天 × workspace」双层。
- 不改 pin / unpin 语义，不改工作区雷达。

## 技术方案（对比）

| 方案 | 做法 | 取舍 |
|------|------|------|
| A 整段折 | 只加「已固定 · N」 | 止血，展开仍是长平铺 |
| **B 段 + 日历日（采用）** | 整段折 + `yyyy-mm-dd` 组折 | 与用户定稿和雷达日期键一致 |
| C 天 × 工作区 | 天下再套项目名 | 窄栏 header 税过高 |

## What Changes

- `PinnedThreadList` 增加段头 + 日历日分组折。
- 新增 grouping helper 与 fold persist hook。
- 侧栏 CSS 增加钉子头 / 日期头样式。
- 全 locale 增加 collapse / expand / count 文案。
- focused tests 钉死默认态、日期头、钉子 icon、i18n。

## Capabilities

### New Capabilities

- `sidebar-pinned-calendar-fold`：全局置顶区按日历日折叠，默认只开最新日。

### Modified Capabilities

- 无。既有 `workspace-sidebar-visual-harmony` 的 pin/unpin 语义不变。

## 验收标准

1. 默认：无「已固定」层；只开最新 `yyyy-mm-dd`；更早日期头收着。
2. 日期头视觉与「工作区」对齐，无 chevron。
3. 点某个日期头只开关那天，不并进相对日桶。
4. 刷新后折叠状态保留；当前会话所在日被收时只打开那天。
5. zh / en 及其他 locale 不出现 raw key。

## Impact

- `src/features/app/components/PinnedThreadList.tsx` 及 helper / hook / CSS
- `src/i18n/locales/*/sidebar.ts`、`src/test/vitest.setup.ts`
- `PinnedThreadList.test.tsx` 与 grouping / fold 单测
- OpenSpec change `fold-sidebar-pinned-by-calendar-day`
