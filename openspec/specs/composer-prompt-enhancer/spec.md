# composer-prompt-enhancer Specification

## Purpose
TBD - created by archiving change add-prompt-enhancer-manual-provider-timeout. Update Purpose after archive.
## Requirements
### Requirement: Prompt enhancer dialog manual run

The Composer prompt enhancer SHALL open as a configuration and review dialog without starting an enhancement request automatically.

#### Scenario: Opening dialog does not run enhancement

- **WHEN** the user triggers prompt enhancement from Composer
- **THEN** the system SHALL open the prompt enhancer dialog with the current draft as the original prompt
- **AND** the system SHALL NOT call the engine runtime until the user explicitly starts enhancement

#### Scenario: Empty composer draft does not open runnable enhancement

- **WHEN** the user triggers prompt enhancement with an empty Composer draft
- **THEN** the system SHALL NOT start an enhancement request

### Requirement: Per-run enhancer engine selection

The prompt enhancer dialog SHALL allow the user to select the engine used for the next prompt enhancement run.

#### Scenario: User selected engine is used for enhancement

- **WHEN** the user selects an enhancer engine and starts enhancement
- **THEN** the system SHALL call the engine runtime with the selected engine
- **AND** the selected engine SHALL apply only to the current prompt enhancement run

#### Scenario: Non-Claude selected engine fails without Claude fallback

- **WHEN** the user selects a non-Claude engine and that engine fails
- **THEN** the system SHALL show a traceable failure for that selected engine
- **AND** the system SHALL NOT silently retry through Claude fallback

### Requirement: Per-run enhancer timeout control

The prompt enhancer dialog SHALL allow the user to configure the timeout used for the next prompt enhancement run.

#### Scenario: User configured timeout is applied

- **WHEN** the user enters a valid timeout and starts enhancement
- **THEN** the system SHALL apply that timeout to the enhancement request

#### Scenario: Invalid timeout is sanitized

- **WHEN** the user enters an invalid or out-of-range timeout
- **THEN** the system SHALL normalize the value to a safe bounded timeout before running

### Requirement: Per-run enhancer model selection

The prompt enhancer dialog SHALL allow the user to select a model for the selected enhancer engine when models are available.

#### Scenario: Engine model list is shown

- **WHEN** the user selects an enhancer engine with available models
- **THEN** the dialog SHALL show a model selector populated from that engine model list

#### Scenario: Selected model is used for enhancement

- **WHEN** the user selects an engine model and starts enhancement
- **THEN** the system SHALL call the engine runtime with that selected model

#### Scenario: Engine without models can still run

- **WHEN** the selected enhancer engine has no available models
- **THEN** the dialog SHALL allow the model selection to be empty
- **AND** the system SHALL call the engine runtime with no explicit model

### Requirement: Enhancement result adoption remains explicit

The prompt enhancer SHALL require explicit user action before replacing Composer content with the enhanced prompt.

#### Scenario: Successful enhancement can be adopted

- **WHEN** an enhancement run succeeds and returns normalized enhanced text
- **THEN** the dialog SHALL enable the use-enhanced action
- **AND** activating that action SHALL replace the Composer draft with the enhanced prompt

#### Scenario: Keeping original does not mutate composer draft

- **WHEN** the user keeps the original prompt or closes the dialog
- **THEN** the Composer draft SHALL remain unchanged

### Requirement: Prompt enhancer run lifecycle safety

The prompt enhancer SHALL prevent duplicate concurrent runs and ignore stale results after closure or a newer run.

#### Scenario: Running state blocks duplicate execution

- **WHEN** an enhancement request is already running
- **THEN** the dialog SHALL prevent starting another enhancement request from the same dialog state

#### Scenario: Closed dialog invalidates in-flight result

- **WHEN** the user closes the dialog while an enhancement request is in flight
- **THEN** the system SHALL ignore the eventual result from that stale request

### Requirement: Discoverable Composer tool entry

The Composer prompt enhancer SHALL expose an accessible quick-action entry in the Composer tool popover in addition to the existing keyboard shortcut.

#### Scenario: Tool entry opens the existing enhancer dialog

- **WHEN** the user activates the prompt enhancer quick action from the Composer tool popover
- **THEN** the system SHALL invoke the same prompt enhancement action used by `Cmd+/` on macOS and `Ctrl+/` on Windows
- **AND** the system SHALL open the existing prompt enhancer dialog without starting enhancement automatically

#### Scenario: Running enhancement disables duplicate tool activation

- **WHEN** an enhancement request is already running
- **THEN** the prompt enhancer quick action SHALL be disabled

#### Scenario: Tool entry is accessible and localized

- **WHEN** assistive technology inspects the prompt enhancer quick action
- **THEN** the action SHALL expose a localized accessible name describing prompt enhancement

#### Scenario: Quick actions use a consistent icon surface

- **WHEN** the Composer tool popover shows prompt enhancement, output collapse, or rewind quick actions
- **THEN** those actions SHALL use the same icon-only button dimensions
- **AND** output collapse and rewind SHALL NOT render persistent surface labels
- **AND** their tooltip and accessible names SHALL remain available

#### Scenario: Tool popover uses compact vertical spacing

- **WHEN** the Composer tool popover is open
- **THEN** the quick-action row, primary menu rows, and separators SHALL use a compact vertical rhythm
- **AND** the 34px icon-only quick-action hit area SHALL remain unchanged

### Requirement: Supported prompt enhancer providers

The prompt enhancer SHALL offer only Claude Code and Codex as selectable enhancement providers.

#### Scenario: Provider dropdown excludes OpenCode

- **WHEN** the user opens the prompt enhancer provider dropdown
- **THEN** the system SHALL show Claude Code and Codex
- **AND** the system SHALL NOT show OpenCode

#### Scenario: Legacy OpenCode context uses a valid default

- **WHEN** prompt enhancement is opened while the current Composer provider is OpenCode
- **THEN** the prompt enhancer SHALL select Claude Code as the default provider

### Requirement: Light theme primary action contrast

The prompt enhancer SHALL keep primary actions recognizable and readable in the light theme across enabled and disabled states.

#### Scenario: Enabled primary action uses the light-theme accent

- **WHEN** a prompt enhancer primary action is enabled in the light theme
- **THEN** the action SHALL use the classic blue `#2563eb` treatment with readable foreground content

#### Scenario: Disabled primary action remains distinguishable

- **WHEN** a prompt enhancer primary action is disabled in the light theme
- **THEN** the action SHALL use a light-blue disabled treatment instead of a low-contrast gray block
- **AND** the action SHALL remain visibly disabled

### Requirement: enhancer system prompt MUST follow UI locale

润色指令 MUST 随界面语言本地化：zh / zh-TW 使用中文指令，其余语言使用英文指令。

#### Scenario: Chinese UI sends Chinese instruction

- **WHEN** 界面语言为 zh 或 zh-TW 且用户触发 prompt enhancement
- **THEN** 发送给引擎的 system instruction MUST 为中文版本
- **AND** 指令结构（角色、要求列表、用户草稿段）与英文版一致

#### Scenario: English UI keeps English instruction

- **WHEN** 界面语言为 en（或其他非中文语言）
- **THEN** 发送的 system instruction MUST 为英文版本

### Requirement: enhancer result MUST be cached by content key

同一文本在相同引擎、模型与界面语言下的重复润色 MUST 命中缓存，MUST NOT 重复调用引擎。

#### Scenario: repeated enhancement hits cache

- **WHEN** 用户对同一文本以相同 engine + model + locale 第二次执行润色
- **THEN** 系统 MUST 直接返回首次结果
- **AND** MUST NOT 发起新的 `engineSendMessageSync` 调用

#### Scenario: failures are not cached

- **WHEN** 一次润色以超时、引擎错误或空结果失败
- **THEN** 该结果 MUST NOT 写入缓存
- **AND** 后续相同请求 MUST 重新调用引擎

### Requirement: enhancer errors MUST be structurally classified

错误分类与 fallback 重试决策 MUST 基于结构化 kind，MUST NOT 在决策点直接匹配错误文案。

#### Scenario: timeout propagates as typed kind

- **WHEN** 润色请求超出配置的超时时间
- **THEN** 系统 MUST 以 kind = timeout 的 typed error 传播
- **AND** 用户可见提示 MUST 为本地化文案并携带超时秒数

#### Scenario: retry decision reads kind only

- **WHEN** claude 引擎润色失败且错误 retryable
- **THEN** 系统 MUST 基于 kind/retryable 标志决定是否 fallback 到 codex
- **AND** 决策代码 MUST NOT 调用 `message.includes`

#### Scenario: failure copy is localized

- **WHEN** 润色失败展示错误
- **THEN** timeout / workspace / empty / generic 四类提示 MUST 使用当前界面语言

### Requirement: Prompt enhancer cache and async results MUST be workspace isolated

Prompt Enhancer 的 cached result 与 in-flight result MUST 绑定发起请求时的 `workspaceId`，不得跨 workspace 复用或写回。

#### Scenario: Same prompt runs in two workspaces

- **WHEN** workspace A 已缓存某 text/engine/model/locale 的增强结果，用户在 workspace B 对相同输入运行增强
- **THEN** workspace B MUST NOT 命中 workspace A 的 cache entry
- **AND** 系统 MUST 使用 workspace B 发起独立 engine request

#### Scenario: Workspace changes while enhancement is running

- **WHEN** workspace A 的增强请求仍在执行且当前 Composer 切换到 workspace B
- **THEN** workspace A 的 eventual result MUST 被视为 stale
- **AND** 该结果 MUST NOT 写入 workspace B 的 dialog 或 cache identity

### Requirement: Prompt enhancer engines follow vendor-enabled CLIs

The prompt enhancer SHALL only offer engines that are both executable by product policy and currently enabled in vendor settings.

#### Scenario: Disabled CLI is hidden

- **WHEN** an executable engine id is present in `disabledCliEngines`
- **THEN** the enhancer model picker SHALL NOT show that engine
- **AND** the system SHALL NOT start an enhancement run with that engine

#### Scenario: Empty enabled list blocks enhancement

- **WHEN** no executable engine is currently enabled
- **THEN** the dialog SHALL tell the user to enable a CLI in vendor settings
- **AND** the start-enhancement action SHALL stay disabled

#### Scenario: Current composer engine is used when still enabled

- **WHEN** the user opens prompt enhancement and the current Composer engine is enabled and executable
- **THEN** that engine SHALL be the default enhancer engine

### Requirement: Prompt enhancer reuses Composer model picker

The prompt enhancer SHALL select engine and model through the Composer `ModelSelect` interaction, not a native HTML select of engine ids.

#### Scenario: Engine submenu then models

- **WHEN** the user opens the enhancer model picker
- **THEN** the menu SHALL list enabled engines first
- **AND** choosing an engine SHALL reveal that engine's models
- **AND** selecting a model SHALL bind both engine and model for the next run

### Requirement: Prompt enhancer intensity controls rewrite strategy

The prompt enhancer SHALL offer light / structured / executable intensity. Intensity SHALL change the rewrite instruction only, not model reasoning effort.

#### Scenario: Light intensity does not template a short draft

- **WHEN** intensity is light and the draft is a short request
- **THEN** the instruction SHALL tell the engine to polish wording without expanding into Goal/Context/Acceptance sections

#### Scenario: Intensity is part of cache identity

- **WHEN** the same draft/engine/model/locale is enhanced under a different intensity
- **THEN** the system SHALL NOT reuse the previous intensity's cached result

### Requirement: Enhancement results MUST NOT contain duplicated payload

The prompt enhancer SHALL strip duplicated rewritten text before showing or adopting a result.

#### Scenario: Exact repeated blocks are collapsed

- **WHEN** the engine returns the same paragraph or sentence block twice in succession
- **THEN** the dialog SHALL show that block only once
- **AND** the adopted Composer draft SHALL contain that block only once

#### Scenario: Instruction forbids template restatement

- **WHEN** the enhancer builds the system instruction
- **THEN** the instruction SHALL forbid restating the draft, repeating the same sentence, and using Goal/Background/Acceptance filler unless intensity is structured or executable and the extra structure adds new constraints

