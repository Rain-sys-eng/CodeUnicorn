# open-with-targets-ux Specification

## Purpose
TBD - created by archiving change open-with-cross-platform-ux. Update Purpose after archive.
## Requirements
### Requirement: Platform-aware file manager labeling

系统 MUST 在「打开方式」设置 UI 中将 `kind: "finder"` 目标展示为当前操作系统的文件管理器名称，而不是在所有平台固定显示「Finder / 访达」。

#### Scenario: macOS shows Finder/访达

- **WHEN** 运行平台为 macOS 且列表或编辑器中存在 `kind: "finder"` 目标
- **THEN** 类型/副标题文案 MUST 使用 macOS 文件管理器名称（中文「访达」或英文「Finder」等 i18n）
- **AND** MUST NOT 在 macOS 上强制显示「资源管理器」

#### Scenario: Windows shows Explorer

- **WHEN** 运行平台为 Windows 且存在 `kind: "finder"` 目标
- **THEN** 类型/副标题文案 MUST 使用 Windows 文件管理器名称（中文「资源管理器」或英文「File Explorer」等 i18n）
- **AND** MUST NOT 要求用户理解「访达」为正确术语

#### Scenario: help text is not macOS-exclusive

- **WHEN** 用户查看打开方式帮助文案
- **THEN** 文案 MUST 描述跨平台启动行为（应用/命令 + 路径参数）
- **AND** MUST NOT 仅描述「应用使用 macOS open」且不提及其它平台

### Requirement: Novice add flow with presets and browse

系统 MUST 提供小白可用的添加路径：从本机预设选择或通过系统文件对话框浏览应用，而不是仅依赖空文本框填写应用名。

#### Scenario: add opens preset picker

- **WHEN** 用户在打开方式设置中点击「添加应用 / 添加打开方式」
- **THEN** 系统 MUST 展示预设选择界面（含搜索或等价筛选）
- **AND** MUST 提供「浏览本机应用」入口
- **AND** MAY 提供「自定义命令」作为次级/高级入口

#### Scenario: selecting a detected preset creates an app target

- **WHEN** 用户选择一个标记为已检测的预设（例如 VS Code / Cursor）
- **THEN** 系统 MUST 创建或填充一个 `kind: "app"` 打开目标，带有可用的显示名与应用引用（名称或路径）
- **AND** 用户 MUST 无需手打可执行文件完整路径即可完成添加

#### Scenario: browse selects application path

- **WHEN** 用户通过 Browse 在系统对话框中选择应用（macOS `.app` 或 Windows `.exe` 等）
- **THEN** 系统 MUST 将所选路径写入该目标的应用引用字段
- **AND** 显示名称 MUST 有合理默认值（例如 basename）

#### Scenario: missing preset offers browse path

- **WHEN** 用户选择一个未检测到的预设
- **THEN** 系统 MUST 引导浏览定位或打开 Browse，而不是静默写入必然失败的目标

### Requirement: Lazy open-app probing without startup cost

系统 MUST 将对打开方式预设/健康的探测限制在用户进入打开方式设置区域之后，且 MUST NOT 在应用冷启动或 AppShell 根链上周期性扫描。

#### Scenario: no probe on cold start

- **WHEN** 应用启动且用户未打开「打开方式」设置 section
- **THEN** 系统 MUST NOT 仅为打开方式预设探测而发起批量应用扫描 IPC

#### Scenario: probe when section active

- **WHEN** 「打开方式」设置 section 变为 active
- **THEN** 系统 MAY 发起最多一次（或会话缓存命中后的零次）预设探测
- **AND** 探测结果 MUST 仅用于该设置 UI（列表健康态 / 预设已检测标记）
- **AND** MUST NOT 使用秒级 interval 轮询刷新

#### Scenario: icons remain gated

- **WHEN** 打开方式 section 未 active
- **THEN** 系统 MUST NOT 因图标解析而批量请求本机应用图标（保持既有 enabled 门控语义）

### Requirement: Backward compatible open targets

系统 MUST 继续加载并执行既有 `openAppTargets` 配置（含 `kind: "finder" | "app" | "command"`），不得因本 change 使旧配置失效。

#### Scenario: existing targets still open

- **WHEN** 用户已配置 app/command/finder 目标并在标题栏或文件预览选择打开
- **THEN** 系统 MUST 仍按既有 `openPathInTarget` / `open_workspace_in` / `reveal_in_file_manager` 契约启动
- **AND** MUST NOT 要求用户重新配置才能打开工作区路径

#### Scenario: absolute app path is accepted

- **WHEN** 目标 `kind: "app"` 且应用引用为绝对路径（Browse 结果）
- **THEN** 启动路径 MUST 优先使用该路径（或平台等价 open 行为）
- **AND** 若路径不存在，设置列表 MAY 标记失效，但 MUST NOT 崩溃

