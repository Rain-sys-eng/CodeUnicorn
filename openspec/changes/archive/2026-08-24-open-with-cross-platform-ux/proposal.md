# Proposal: open-with-cross-platform-ux

## Why

设置 →「打开方式」对小白几乎不可用：添加目标只有文本框，用户必须猜 macOS Bundle 名或 Windows 可执行路径；类型与帮助文案硬编码「访达 / Finder / macOS open」，Windows 心智断裂。当前产品处于性能优化窗口，补全该能力时必须避免启动期扫描、秒级轮询或根链高频 setState。

## What Changes

- **平台文案与帮助**：文件管理器类型/默认项/帮助文案按 OS 显示（mac 访达、Win 资源管理器、Linux 文件管理器）；去掉「仅 macOS open」表述。
- **添加主路径（小白）**：添加时优先展示「本机预设网格」（已检测 / 未检测）+「浏览本机应用…」；「自定义命令」收为高级入口。
- **编辑增强**：应用目标支持 Browse 选择 `.app` / `.exe`；列表展示轻量健康态（可用 / 未检测 / 路径失效），探测仅在打开方式设置页激活时一次性执行并缓存。
- **兼容**：既有 `kind: "finder" | "app" | "command"` 与已存 `openAppTargets` 继续可读；不强制破坏旧配置（对外展示名平台化，持久化 kind 保持兼容或读入时归一）。
- **性能护栏**：禁止启动全局扫应用、禁止秒级轮询健康态、禁止把探测状态挂到 AppShell 根链。

## 目标与边界

### 目标

1. Win/mac 用户都能在 3 次点击内添加可用的 VS Code / Cursor（或等价预设）。
2. 平台文案与启动帮助正确，不再暴露错误的「访达 / macOS open only」。
3. 不引入冷启动/根渲染回归（探测懒加载、单次 IPC、settings-local state）。

### 非目标

- 不做完整「本机所有 App 枚举器」（Raycast 级索引）。
- 不做参数宏 `$PATH$` / 试运行 dry-run 完整实现（可预留 UI 文案，逻辑放后续 change）。
- 不改 OpenApp 菜单在标题栏的交互骨架（仅设置页配置体验 + 既有 open 路径）。
- 不重写 Windows 应用图标提取（可继续 generic icon）。

## Capabilities

### New Capabilities

- `open-with-targets-ux`：打开方式配置的跨平台 UX、预设探测、Browse 与健康态行为契约。

### Modified Capabilities

- （无强制修改既有 main capability 文件；本 change 以新 capability 承载行为。若后续归档需与 settings/app 相关 spec 交叉引用，再在 archive 时 sync。）

## Impact

- Frontend：`OpenAppsSection.tsx`、settings open-app actions、i18n（至少 zh/en，其它语言可回退 en 或补键）、`filePickers` 增加选应用。
- Backend（按需）：一次性 `list_open_app_presets` / probe 命令（或复用现有候选解析，仅 settings 激活时调用）。
- 存储：`AppSettings.openAppTargets` 字段语义扩展（appName 可存绝对路径）；兼容旧数据。
- 测试：OpenAppsSection / openApp normalize / 平台文案 / 探测懒加载相关 Vitest；Rust 候选解析单测如触及。
- 性能：只允许 settings 打开方式 tab 激活后触发探测；结果 session 缓存；无 interval。

## 技术方案取舍（≥2 选项）

| 选项 | 说明 | 取舍 |
|------|------|------|
| A. 仅改文案 + Browse，无预设探测 | 改动小 | 小白仍难发现 Cursor/VS Code → **不足** |
| B. 预设网格 + Browse + 懒探测（推荐） | 对齐 Unity/IDEA 主路径 | **采用**：收益高，探测可性能隔离 |
| C. 启动时全盘扫 Applications | 最像 Raycast | **拒绝**：冷启动与 IO 风险，违反性能门禁 |

## 验收标准

1. mac 设置页文件管理器显示「访达」；Win 显示「资源管理器」（或 i18n 等价）；帮助文案不 exclusive 于 macOS open。
2. 点击「添加」出现预设列表；点已检测预设可写入目标；点「浏览」可选择本机 app/exe 并保存。
3. 探测仅在打开方式 section `active` 时发生；关闭设置或切换离开后不持续轮询。
4. 既有 open 路径（标题栏 OpenAppMenu）仍可用；旧配置不丢。
5. 相关 Vitest 绿；手动/脚本确认无新增启动期 open-app 扫描 IPC。
