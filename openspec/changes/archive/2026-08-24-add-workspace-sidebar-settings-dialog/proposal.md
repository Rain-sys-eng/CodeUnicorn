## Why

侧栏每个工作区折叠态默认露出 12 条 root 会话，入口藏在「会话管理」且按 workspace 单独存。用户需要一个对所有项目生效的工作区设置，并把默认改成 5。后续还会加其他工作区级偏好，所以入口应放在「工作区」段头，而不是某个项目内部。

## 目标与边界

### 目标

- 「工作区」标题旁、「添加项目」右侧增加设置按钮，打开工作区设置弹窗。
- 弹窗第一项：默认显示会话数。出厂默认 `5`，可调范围 `1..20`，立即对所有项目生效。
- 弹窗按可扩展的 preference list 搭，后续可加其他工作区设置。
- 未单独覆盖的 workspace 都跟这个全局默认；已有 `visibleThreadRootCount` 的项目仍可保留覆盖。

### 边界

- 只改侧栏折叠态默认露出条数与其 first-paint / 「更多」分页对齐。
- 不改置顶区、不改会话管理的批量删档。
- 不把该入口塞进底部全局设置菜单。

## 非目标

- 第一刀不做更多工作区设置项。
- 不强制清掉已保存的 per-workspace `visibleThreadRootCount`。
- 不改 Session Index 热路径架构。

## 技术方案（对比）

| 方案 | 做法 | 取舍 |
|------|------|------|
| A 继续 per-workspace | 只改默认 12→5 | 每个项目还要单独改，入口仍在会话管理 |
| **B 全局 AppSettings + 侧栏弹窗（采用）** | `defaultVisibleThreadRootCount` 对所有项目生效；workspace 字段仅作覆盖 | 符合「入口在工作区、对所有项目生效」 |
| C 只改常量 | 硬编码 5，无 UI | 无法自己调 1..20 |

## What Changes

- `AppSettings.defaultVisibleThreadRootCount`：默认 `5`，clamp `1..20`。
- 出厂 `DEFAULT_VISIBLE_THREAD_ROOT_COUNT` 从 `12` 改为 `5`。
- 侧栏「添加项目」右侧增加设置按钮与 `WorkspaceSettingsDialog`。
- resolve / first-paint / Session Index page size 以「workspace 覆盖 ?? 全局默认」为准。

## Capabilities

### New Capabilities

- `workspace-sidebar-settings`：侧栏工作区段头设置弹窗，维护对所有项目生效的 sidebar 偏好。

### Modified Capabilities

- `workspace-sidebar-visual-harmony`：默认露出条数改为全局 5，范围 1..20；workspace 覆盖仍可用。

## 验收标准

1. 未配置过的项目折叠态默认露出 5 条；点「更多」按 5 / 10 / 15… 扩。
2. 设置按钮在「添加项目」右侧；弹窗可改 1..20，保存后所有未覆盖项目立即跟新值。
3. 非法输入 clamp，不会空白、全量展开或分页漂移。
4. zh / en 及其他 locale 无 raw key。

## Impact

- `src/features/app/constants.ts`、Sidebar、AppSettings、Rust `AppSettings`
- Session Index / thread list first-paint page size
- `src/i18n/locales/*/sidebar.ts`
- focused vitest + 既有 12 断言回归
