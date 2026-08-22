## ADDED Requirements

### Requirement: Main window SHALL render a configurable workspace wallpaper

主窗口进入后 MUST 按 `AppSettings.workspaceWallpaper` 渲染背景。默认 mode MUST 是 `none`：缺字段或尚未被用户改过时 MUST NOT 自动开背景。用户 MUST 能在 Settings 外观中选择 `none`（不要背景）、`fluid`（流体背景）或 `custom`（上传本地图片）。该设置 MUST 跨重启保持。系统 MUST NOT 把 wallpaper 状态写入 AppShell domain bag。

#### Scenario: Fresh settings keep wallpaper off

- **WHEN** 主窗口启动且 `workspaceWallpaper` 缺省或尚未被用户改过
- **THEN** 系统 MUST 保持实色主题底，MUST NOT 挂 wallpaper 层
- **AND** MUST NOT 在 about / detached 窗口渲染该背景

#### Scenario: User turns wallpaper off

- **WHEN** 用户在设置中选择「不要背景」
- **THEN** 系统 MUST 立即移除 wallpaper 层并恢复实色主题底
- **AND** 重启后 MUST 仍保持 `none`

#### Scenario: User uploads a custom image

- **WHEN** 用户选择「自定义」并挑中一张本地 png / jpg / jpeg / webp / gif
- **THEN** 系统 MUST 把该绝对路径写入 `workspaceWallpaper.customImagePath`
- **AND** 主窗口 MUST 以 cover 方式铺满该图片

#### Scenario: Custom path is missing or invalid

- **WHEN** mode 为 `custom` 但路径为空、扩展名非法，或资源无法加载
- **THEN** 系统 MUST 安全回退到 `fluid`
- **AND** MUST NOT 因这次回退改写用户尚未确认的合法存储值（仅运行时显示回退；sanitize 可在读入时把非法值写成 `fluid`）

### Requirement: Settings appearance SHALL expose a scannable wallpaper entry

Settings → 基础 → 外观 MUST 用 preference row + segmented control 提供三个选项。自定义态 MUST 额外提供选择图片与清除。弹层 / Dialog MUST 保持不透明。

#### Scenario: Appearance section lists three wallpaper modes

- **WHEN** 用户打开设置外观
- **THEN** 系统 MUST 展示「默认背景 / 不要背景 / 自定义」分段控件
- **AND** 当前选中项 MUST 与持久化 mode 一致

#### Scenario: Custom controls appear only for custom mode

- **WHEN** 当前 mode 不是 `custom`
- **THEN** 系统 MUST NOT 展示上传 / 清除控件
- **WHEN** 用户切到 `custom`
- **THEN** 系统 MUST 展示选择图片入口；已有路径时 MUST 可清除

### Requirement: Wallpaper MUST preserve workspace readability and degrade safely

开启 wallpaper 时，shell 留白可以半透明透出背景，但消息气泡、输入正文、popover 与设置浮层 MUST 保持可读。`performanceCompatibilityModeEnabled` 或 `prefers-reduced-motion: reduce` 时，fluid wallpaper MUST NOT 持续动画。

#### Scenario: Conversation surfaces stay readable over wallpaper

- **WHEN** wallpaper mode 为 `fluid` 或 `custom` 且用户在对话页
- **THEN** 消息气泡与 composer 输入区 MUST 保持不透明或足够对比
- **AND** 设置 Dialog / popover MUST 保持不透明

#### Scenario: Chrome shares one wallpaper veil

- **WHEN** wallpaper mode 为 `fluid` 或 `custom`
- **THEN** sidebar、`.main` 与 `.right-panel` MUST 共用同一层轻色洗，不得再用可调灰蒙层盖图
- **AND** 毛玻璃 MUST 画在 wallpaper host 上，不得挂在 sidebar / `.main` / `.right-panel` 上另建 stacking context
- **AND** `.messages` / `.composer` MUST 保持透明，不得再叠一层
- **AND** `.main` MUST 取消 desktop 圆角，避免壁纸从四角缺口露出，也不得把项目行 `+` 裁掉
- **AND** sidebar 与 `.main` 之间 MUST 保留 1px 分割线
- **AND** `.app` MUST 整层叠在 wallpaper host 之上
- **AND** `prefers-reduced-transparency` 时 MUST 关掉 frost（blur=0）

#### Scenario: Titlebar controls stay clickable over wallpaper frost

- **WHEN** wallpaper mode 为 `fluid` 或 `custom`
- **THEN** 全宽 `.drag-strip` MUST 点击穿透，不得盖住 sidebar / main / right-panel 标题栏按钮
- **AND** Home 空态顶部空白条 MUST 仍可作为窗口拖拽区
- **AND** 搜索、Quick Switcher、侧栏折叠、右侧工具栏等标题栏控件 MUST 保持可点

#### Scenario: Wallpaper opens without automatic frost

- **WHEN** wallpaper mode 为 `fluid` 或 `custom`
- **THEN** `--workspace-wallpaper-frost` MUST 为 0px
- **AND** `.workspace-wallpaper::after` MUST NOT 使用 `backdrop-filter: blur(...)`
- **AND** 已持久化的 `veilOpacity`（含旧默认 12 与残留值如 6）MUST 视为未设置
- **AND** 壁纸 MUST 以原图呈现，不得自动叠一层毛玻璃

#### Scenario: User adjusts wallpaper frost

- **WHEN** wallpaper mode 不是 `none`
- **THEN** Settings 外观 MUST 提供毛玻璃强度滑杆，范围 0–20px，默认 0
- **AND** 拖动 MUST 立即写入 `workspaceWallpaper.veilOpacity` 并更新 `--workspace-wallpaper-frost`
- **WHEN** mode 为 `none`
- **THEN** 系统 MUST NOT 展示该滑杆

#### Scenario: Reduced motion paints a static fluid frame

- **WHEN** 系统处于减少动态效果或性能兼容模式，且 wallpaper 为 `fluid`
- **THEN** 系统 MUST 最多绘制静态帧
- **AND** MUST NOT 持续运行 fluid RAF loop
