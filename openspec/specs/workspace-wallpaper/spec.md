# workspace-wallpaper Specification

## Purpose
TBD - created by archiving change add-fluid-motion-presets. Update Purpose after archive.
## Requirements
### Requirement: Fluid wallpaper SHALL expose orthogonal motion presets

流体模式下系统 MUST 持久化 `workspaceWallpaper.fluidMotion`，取值 MUST 是 `drift` | `taiji` | `storm` | `tornado` | `chase`。缺字段或非法值 MUST sanitize 为 `drift`。动势 MUST 与 `fluidPreset` 正交：换配色 MUST NOT 改动势，换动势 MUST NOT 改配色。系统 MUST 用同一条 WebGL2 shader 的 `u_motionMode` 切换场，MUST NOT 另开第二条 GPU 管线。first-run 向导 MUST 继续使用 `drift`，MUST NOT 读取工作台 `fluidMotion`。`taiji` MUST 保持居中双鱼慢转；`chase` MUST 是 1–2 条中国龙走幕布式单向游走（出场边 ≠ 入场边），MUST NOT 钉在画面中心，MUST NOT 在同一位置折返，MUST NOT 复用 `taiji` 的居中双鱼盘。

#### Scenario: Missing motion falls back to drift

- **WHEN** 已保存的 `workspaceWallpaper` 没有 `fluidMotion`，或值为未知字符串
- **THEN** sanitize 后 MUST 使用 `drift`
- **AND** MUST NOT 因这次回退改写用户尚未确认的磁盘值，直到下一次合法保存

#### Scenario: User picks a structured motion

- **WHEN** wallpaper mode 为 `fluid` 且用户选择太极、暴风雨、龙卷风或游走
- **THEN** 系统 MUST 立即把该 id 写入 `workspaceWallpaper.fluidMotion`
- **AND** 主窗口 fluid 层 MUST 在不重挂 WebGL context 的前提下切换场
- **AND** 当前 `fluidPreset` MUST 保持不变

#### Scenario: Color and motion stay independent

- **WHEN** 用户在 `tornado` 下把配色从 `mist` 换成 `ash`
- **THEN** 系统 MUST 只更新 `fluidPreset`
- **AND** `fluidMotion` MUST 仍为 `tornado`

#### Scenario: Chase wanders instead of locking to center

- **WHEN** 用户选择 `chase`
- **THEN** 主窗口 fluid 层 MUST 渲染 1–2 条中国龙（最少 1 条常驻，最多 2 条同屏）
- **AND** 龙形 MUST 使用原版中国龙 SDF（鹿角、火焰鬃、后飘长须、四肢龙爪、脊刺与尾鳍），MUST NOT 叠加墨线描边 / 鳞片瓦 / 巨型体
- **AND** 每条龙 MUST 走单向幕布轨迹：从一侧进、从另一侧出，下一次 MUST 从不同边再入场
- **AND** 新入场的龙大小 MUST 按 generation 随机
- **AND** 朝向 MUST 沿路径前瞻平滑转向，MUST NOT 在场内原地折返
- **AND** Mac 工作台 chase MUST 使用 full profile（全分辨率），MUST NOT 把 Windows lite 半分辨率路径套到 Mac
- **AND** Mac full 的结构化动势（含 chase）MUST 以 display refresh（约 60fps）present，MUST NOT 把 30fps 量化套到游走
- **AND** MUST NOT 复用 `taiji` 的居中双鱼盘

### Requirement: Settings appearance SHALL list fluid motions next to palettes

Settings → 基础 → 外观在 `mode === "fluid"` 时 MUST 在配色点下方展示五个动势芯片：流动、太极、暴风雨、龙卷风、游走。当前选中项 MUST 与持久化 `fluidMotion` 一致。`mode` 不是 `fluid` 时 MUST NOT 展示动势芯片。Windows 上 MUST 继续隐藏整段 wallpaper 入口。

#### Scenario: Fluid mode shows five motion chips

- **WHEN** 用户打开设置外观且 wallpaper 为流体
- **THEN** 系统 MUST 展示五个动势芯片
- **AND** 点击某一芯片 MUST 写入对应 `fluidMotion`

#### Scenario: Motion chips hide when wallpaper is not fluid

- **WHEN** wallpaper mode 为 `none` 或 `custom`
- **THEN** 系统 MUST NOT 展示动势芯片

### Requirement: Fluid palette SHALL include a low-chroma ash wash

`WorkspaceWallpaperFluidPreset` MUST 包含 `ash`。`ash` MUST 以低饱和灰白渲染（light / dark 皆然），MUST NOT 复用现有高饱和 hue ramp。非法 / 未知 preset 仍 MUST 回落 `mist`。

#### Scenario: User selects ash palette

- **WHEN** 用户在流体配色中选择深灰白
- **THEN** 系统 MUST 把 `fluidPreset` 写成 `ash`
- **AND** shader 三色 MUST 为低饱和灰白，与 `ink` 的偏青可区分

#### Scenario: Unknown preset still falls back to mist

- **WHEN** 已保存的 `fluidPreset` 不是已知 id
- **THEN** sanitize 后 MUST 使用 `mist`

### Requirement: Workspace fluid SHALL animate slower than the first-run backdrop

工作台 fluid wallpaper MUST 使用低于 `SITE_FLUID_PARAMS.speed` 的速度（约定 9，现状 first-run 为 14）。first-run 向导 MUST 保持原速。结构化动势 MUST 仍保持可辨识的转动 / 雨幕 / 涡旋，不得因减速停死。

#### Scenario: Workspace backdrop is slower than first-run

- **WHEN** 主窗口渲染 fluid wallpaper
- **THEN** 传入 shader 的 speed MUST 低于 first-run 默认 14
- **AND** first-run 向导 MUST 仍使用 `SITE_FLUID_PARAMS.speed`

#### Scenario: Reduced motion still paints one frame

- **WHEN** 系统处于减少动态效果或性能兼容模式，且 wallpaper 为 `fluid`
- **THEN** 系统 MUST 最多绘制静态帧
- **AND** MUST NOT 持续运行 fluid RAF loop

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

