## ADDED Requirements

### Requirement: First-run setup SHALL collect IDE habit and at least one CLI

新用户首次进入主窗口时，系统 MUST 在 StartupGate 之后展示全屏 First-run Setup。向导 MUST 按 Welcome → IDE → CLI → Done 顺序推进。CLI 步 MUST 允许验证通过后继续，也 MUST 允许显式稍后设置。

#### Scenario: Fresh install sees the wizard

- **WHEN** 主窗口启动且 `setupProfile` 不存在，并且没有 legacy 豁免信号
- **THEN** 系统 MUST 展示 First-run Setup，且不得在 about / detached 窗口展示

#### Scenario: User completes a validated CLI

- **WHEN** 用户选择 IDE，并让至少一个 setup engine 通过安装或探测校验，再点进入应用
- **THEN** 系统 MUST 将 profile level 记为 `ready`，把 IDE habit 写入 `setupProfile.preferredIde`，若该习惯对应外部编辑器则同步 `selectedOpenAppId`，并关闭向导

#### Scenario: Done step echoes the selected installed engine

- **WHEN** 多个 setup engine 已安装，用户在 CLI 步点选其中一个（例如 DeepSeek Harness），再进入 Done
- **THEN** 完成页的引擎摘要 MUST 显示该选中引擎
- **AND** 系统 MUST NOT 仅因 detect 顺序把摘要回落到第一个已装引擎（例如 Claude Code）
- **AND** 进入应用时 MUST 把该选中引擎写成 `setupProfile.primaryEngine` 与 composer `selectedEngine`

#### Scenario: User skips CLI setup

- **WHEN** 用户在 CLI 步选择稍后设置
- **THEN** 系统 MUST 将 profile level 记为 `partial`，进入主界面，并展示可重新打开 CLI 步的 soft banner

### Requirement: Missing CLI cards MUST offer in-place install without probe noise

CLI 步 MUST 把「未安装」做成卡片内动作，而不是卡片外的第二个按钮。探测未安装引擎时返回的 `Failed to execute … (os error 2)` 这类 missing-binary 诊断 MUST NOT 展示给用户。只有真正的安装失败 / 安装阻断才允许在该卡片下方显示错误。

#### Scenario: Hover or select a missing engine reveals Install

- **WHEN** 某引擎未安装，且用户 hover 该卡片，或用键盘 / 点击选中该卡片
- **THEN** 卡片右侧的「未安装」文案 MUST 变成可点的「安装」按钮
- **AND** 卡片外 MUST NOT 再出现独立的「安装」按钮

#### Scenario: Clicking a missing engine reveals Install

- **WHEN** 用户点击未安装引擎卡片
- **THEN** 系统 MUST 选中该引擎，并把「未安装」切成卡片内「安装」按钮
- **AND** 系统 MUST NOT 仅因这次选中就启动安装

#### Scenario: Clicking the in-card Install starts setup

- **WHEN** 用户点击未安装引擎卡片内的「安装」按钮
- **THEN** 系统 MUST 启动 `installLatest`
- **AND** 系统 MUST NOT 把 detect 阶段的 missing-binary 诊断当作卡片错误展示

#### Scenario: Detection missing-binary is not an install error

- **WHEN** `detectEngines` 对未安装引擎返回 `installed: false` 且 error 为 `Failed to execute opencode: No such file or directory (os error 2)` 或等价 missing-binary 文本
- **THEN** 该卡片 MUST 只显示「未安装 / 安装」状态
- **AND** MUST NOT 渲染 `first-run-engine-error`

### Requirement: Existing users MUST NOT be forced through first-run setup

系统 MUST 把已有工作区、已看过 Release Notes、或已持久化引擎选择视为 legacy 豁免，不得强制展示向导。

#### Scenario: Legacy workspace user opens the app

- **WHEN** sidebar snapshot 已有 workspace，且用户未请求重新运行
- **THEN** 系统 MUST NOT 展示 First-run Setup

#### Scenario: Settings rerun

- **WHEN** 用户在设置中选择重新运行新手设置
- **THEN** 系统 MUST 再次打开向导，并保留已选 IDE，除非用户改选

### Requirement: Editor habit MUST be visible and changeable in Settings

系统 MUST 把 first-run 收集到的编辑器习惯作为独立 preference 展示在设置里，并允许用户更换。该值 MUST 作为后续文件打开、Git 展示等适配的事实源，而不仅是「打开项目文件」的一次性副作用。

#### Scenario: User changes editor habit in Settings

- **WHEN** 用户在设置 → 行为 中选择另一个编辑器习惯
- **THEN** 系统 MUST 更新 `setupProfile.preferredIde`；若新习惯对应外部编辑器，MUST 同步 `selectedOpenAppId`

#### Scenario: User chooses unused editors

- **WHEN** 用户在 first-run 或设置中选择「都没使用过」
- **THEN** 系统 MUST 把 habit 记为 `none`，且 MUST NOT 改写已有的 `selectedOpenAppId`
