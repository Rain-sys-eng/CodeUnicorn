# claude-provider-management Specification

## Purpose

Defines Claude provider management behavior for managed provider ordering, backend-driven model discovery, and safe default provider settings.
## Requirements
### Requirement: Claude provider order SHALL be user-controlled and storage-safe

系统 SHALL 允许用户持久化重排 managed Claude providers，且 reorder MUST NOT 改变任何现有或新建会话的 provider binding。

#### Scenario: local provider remains pinned
- **WHEN** the Claude provider list is rendered
- **THEN** the `Local settings.json` provider SHALL appear before managed providers
- **AND** it SHALL NOT be included in the draggable provider list

#### Scenario: managed provider reorder is persisted
- **WHEN** the user drags a managed Claude provider to a new position
- **THEN** the frontend SHALL send the full managed provider id order to the backend
- **AND** the backend SHALL persist deterministic `sortOrder` values for existing managed providers
- **AND** missing or legacy `sortOrder` values SHALL fall back to `createdAt` order for migration compatibility

#### Scenario: reorder failure rolls back from durable state
- **WHEN** persisting a Claude provider reorder fails
- **THEN** the frontend SHALL reload providers from the backend
- **AND** the visible order SHALL return to the durable backend state

### Requirement: Claude Conversation Creation MUST Select A Provider Profile

系统 MUST 将 Claude 供应商选择建模为新建会话的启动决策，而非仅为全局 active provider 切换。

#### Scenario: local settings.json is the intentional default profile

- **WHEN** 用户打开新建 Claude 会话入口的供应商子菜单
- **THEN** 选择器 MUST 包含代表本地 `~/.claude/settings.json` 的默认项（`__local_settings_json__`）
- **AND** 选择该项 MUST 保持现有 Claude 启动行为不变
- **AND** UI MUST 明确该项跟随 disk/global settings，不承诺与全局切换隔离

#### Scenario: provider selection is persisted with the created thread

- **WHEN** 用户以选定的 managed provider 创建 Claude 会话
- **THEN** 该 thread 的 state MUST 记录 provider profile id、source 与用户可见名称
- **AND** 该 thread 后续所有发送 MUST 使用持久化绑定而非当前菜单选择

#### Scenario: menu selection only affects the next new conversation

- **WHEN** 用户在新建会话菜单的供应商子菜单中勾选某个 provider
- **THEN** 系统 MUST 仅记忆该选择（localStorage）供下一次新建会话使用
- **AND** MUST NOT 改变任何已有会话的绑定
- **AND** MUST NOT 触发全局 `~/.claude/settings.json` 写入

### Requirement: Claude Provider MUST Take Effect Via Per-Turn Launch Configuration

绑定 managed provider 的 Claude 会话 MUST 通过 spawn 时的 normalized environment 与 command-line settings override 使供应商生效，而非写入全局 settings.json。

#### Scenario: managed provider env is injected per turn

- **WHEN** 绑定 managed provider 的 Claude thread 发送消息
- **THEN** 后端 MUST 从 `~/.ccgui/config.json` 的 `claude.providers[id].settingsConfig.env` 解析键值对
- **AND** MUST 在该 turn 的 `claude` 进程中通过 `cmd.env` 注入全部键值（含 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` 等，不过滤键名）

#### Scenario: parent routing env is cleared before provider env apply

- **WHEN** 绑定 managed provider 的 Claude thread 发送消息
- **THEN** 后端 MUST 先清除 child 进程中的 Claude provider routing 环境键（`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_*` / `ANTHROPIC_REASONING_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` / `CLAUDE_CODE_USE_*` 等既有 routing 列表）
- **AND** 再写入当前 profile 的 normalized env
- **AND** MUST NOT 让父进程残留的 model 槽（如 `k3`）在缺失 profile 键时继续生效

#### Scenario: command-line settings override global settings.json

- **WHEN** 全局 `~/.claude/settings.json` 的 `env` 块与绑定 provider 的 `settingsConfig.env` 存在相同键
- **THEN** backend MUST 为该 turn 物化 private settings override，并通过 `--settings` 传给 Claude Code
- **AND** override MUST 与 process env 使用同一份 normalized provider environment
- **AND** turn 结束后 MUST 清理 private settings artifact

#### Scenario: missing provider fails the send with a clear error

- **WHEN** 绑定指向的 provider id 在 `~/.ccgui/config.json` 中已不存在
- **THEN** 该次发送 MUST 以包含 provider 标识的错误失败
- **AND** MUST NOT 静默回退到其他供应商

#### Scenario: --model uses provider-scoped runtime not foreign residue

- **WHEN** 发送参数携带 model 且会话绑定 managed provider
- **THEN** 传给 Claude CLI 的 `--model` MUST 为当前 profile catalog/env 解析后的 runtime
- **AND** MUST NOT 使用其它供应商残留模型名（例如 DeepSeek profile 下的 `k3`）

### Requirement: Claude provider model fetch SHALL use backend networking and suggestion-only UI

The system SHALL fetch Claude-compatible model suggestions through a Rust Tauri command using the dialog's current API URL and API key, and SHALL present returned models as optional suggestions for the model mapping inputs.

#### Scenario: model fetch uses current unsaved dialog values
- **WHEN** the user clicks `Fetch models` in the Claude provider dialog
- **THEN** the request SHALL use the currently entered API URL and API key
- **AND** the provider SHALL NOT need to be saved before fetching models

#### Scenario: model fetch is routed through Rust backend
- **WHEN** the frontend requests Claude provider models
- **THEN** it SHALL invoke `vendor_fetch_claude_models`
- **AND** the backend SHALL perform the HTTP request with native networking rather than frontend `fetch()`

#### Scenario: backend tries compatible model list endpoints
- **WHEN** the backend receives a non-empty provider base URL
- **THEN** it SHALL derive ordered `/v1/models` endpoint candidates
- **AND** it SHALL return the first endpoint with a successful parseable model response
- **AND** it SHALL include the successful endpoint in the result

#### Scenario: model ids are extracted from common response shapes
- **WHEN** a provider model response contains `data`, a top-level array, or `models`
- **THEN** the backend SHALL extract non-empty string model ids
- **AND** duplicate model ids SHALL be removed while preserving first-seen order

#### Scenario: fetched models remain optional suggestions
- **WHEN** model ids are fetched successfully
- **THEN** the Sonnet, Opus, and Haiku model inputs SHALL expose those ids through a shared datalist
- **AND** users SHALL still be able to type model ids manually

#### Scenario: fetch errors are visible
- **WHEN** the API URL is missing, all endpoints fail, HTTP status is unsuccessful, or JSON parsing fails
- **THEN** the dialog SHALL show a diagnosable error or empty-result message
- **AND** the dialog SHALL remain editable

### Requirement: Claude provider defaults SHALL preserve managed settings shape

The system SHALL create new Claude provider settings from a complete managed template that separates top-level Claude Code settings from environment variables.

#### Scenario: default template includes top-level settings
- **WHEN** the user creates a new Claude provider
- **THEN** the default JSON config SHALL include managed top-level fields such as `alwaysThinkingEnabled`, `autoDreamEnabled`, `cleanupPeriodDays`, `effortLevel`, `hasCompletedOnboarding`, `language`, `model`, `skipAutoPermissionPrompt`, `teammateMode`, and `tui`
- **AND** those fields SHALL NOT be nested under `env`

#### Scenario: default template includes tiered model env values
- **WHEN** the default Claude provider JSON config is generated
- **THEN** the `env` object SHALL include tier-specific model variables for Haiku, small-fast, Sonnet, and Opus defaults
- **AND** the provider dialog SHALL keep manual model mapping edits synchronized with the JSON config

#### Scenario: unsafe env defaults are excluded
- **WHEN** the default Claude provider JSON config is generated
- **THEN** it SHALL NOT include `CLAUDE_CODE_ATTRIBUTION_HEADER`
- **AND** it SHALL NOT include `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`

#### Scenario: managed fields are written as managed settings
- **WHEN** a Claude provider is saved with managed top-level settings
- **THEN** the backend SHALL recognize those fields as provider-managed settings
- **AND** it SHALL write them to the provider settings shape without incorrectly treating them as environment variables

### Requirement: Claude Model Mapping Storage MUST Converge To One Canonical Key

Claude model mapping MUST write only the canonical storage key; legacy keys MUST be read only by an idempotent migration.

#### Scenario: canonical and legacy values coexist

- **WHEN** canonical storage contains a valid newer value
- **THEN** migration MUST preserve canonical value
- **AND** legacy data MUST NOT overwrite it

#### Scenario: only legacy value exists

- **WHEN** a valid legacy mapping exists and canonical value is absent
- **THEN** migration MUST write canonical value once
- **AND** repeated migration MUST produce the same result

### Requirement: Claude Provider Actions MUST Propagate Typed Errors

Provider load、save、switch、delete and migration operations MUST return typed success/error results with actionable context.

#### Scenario: backend save fails

- **WHEN** provider persistence returns an error
- **THEN** UI MUST not report success
- **AND** the user MUST receive an actionable error while durable state remains authoritative

#### Scenario: legacy cleanup fails after canonical write

- **WHEN** canonical migration succeeds but deleting a legacy key fails
- **THEN** canonical success MUST remain
- **AND** diagnostics MUST expose cleanup warning

### Requirement: Claude Managed Provider Rows MUST Describe New-Conversation Availability

Claude provider management UI MUST represent managed providers as selectable launch profiles for new conversations, not as active runtime switches.

#### Scenario: managed provider row is available for new sessions

- **WHEN** 设置页渲染任意 managed Claude provider
- **THEN** status cell MUST 显示“新会话可选”的 localized badge
- **AND** row MUST NOT 显示“启用”按钮或触发 `vendor_switch_claude_provider`

#### Scenario: provider management does not mutate global Claude settings

- **WHEN** 用户在设置页 reorder、edit 或查看 managed Claude provider
- **THEN** 系统 MUST NOT 因 status interaction 写入 `~/.claude/settings.json`
- **AND** 既有 managed-bound conversations MUST 保持原 provider binding

#### Scenario: managed provider dialog describes isolated storage

- **WHEN** 用户新增或编辑 managed Claude provider
- **THEN** dialog description MUST 明确配置独立存储于 desktop-cc-gui
- **AND** MUST 明确不会写入 `~/.claude/settings.json`
- **AND** MUST NOT 使用“立即应用到 `~/.claude/settings.json`”之类的 global-switch 文案

#### Scenario: local official config remains explicit

- **WHEN** 设置页渲染 local `~/.claude/settings.json` official card
- **THEN** UI MUST 明确它是 local/default configuration
- **AND** MUST 保留编辑入口
- **AND** MUST NOT 把它描述成隔离的 managed provider

### Requirement: Claude Managed Enable MUST NOT Overwrite Local Disk Settings

启用 Claude managed provider（配置页「启用」或新建菜单选择）MUST 只更新 app 内 active 标记，MUST NOT merge 盖写用户 `~/.claude/settings.json`。

#### Scenario: settings enable managed provider leaves settings.json intact

- **WHEN** 用户在 Claude 供应商设置页点击 managed provider 的「启用」
- **THEN** 系统 MUST 将 `claude.current` 设为该 provider id（配置页显示「使用中」）
- **AND** 系统 MUST NOT 将该 provider 的 settingsConfig.env merge 进 `~/.claude/settings.json`
- **AND** 用户本地 `~/.claude/settings.json` 中既有 env/model 等字段 MUST 保持不变

#### Scenario: menu select managed provider same as non-covering enable

- **WHEN** 用户在新建会话菜单选择 Claude managed provider P
- **THEN** 系统 MUST 同步 L1 `claude.current = P`（配置页「使用中」）且 MUST NOT 盖写 `~/.claude/settings.json`
- **AND** 系统 MUST 记忆 P 供创建会话写入 thread `providerProfileId`

### Requirement: Global Enable And Session Binding MUST Remain Separate Layers

Claude L1「使用中」与 L2 会话 binding MUST 分层：L1 不盖盘；L2 负责 managed 会话 env。

#### Scenario: settings enable does not rewrite bound sessions

- **WHEN** 已存在携带 managed `providerProfileId` 的 Claude native 会话，用户在设置页启用另一 provider
- **THEN** 已绑定会话的后续发送 MUST 继续使用其 thread binding
- **AND** MUST NOT 因全局启用而改写该 thread 的 `providerProfileId`

#### Scenario: managed session launch uses profile not disk current

- **WHEN** 用户创建并发送绑定 managed provider P 的 Claude 会话
- **THEN** 进程 env MUST 来自 P 的 launch profile / turn-scoped `--settings`
- **AND** MUST NOT 依赖「先把 P 盖进 ~/.claude/settings.json」才能跑通

### Requirement: Claude Managed Providers MUST Persist Provider-Owned Custom Models

Claude managed provider profiles MUST support an optional `customModels` collection with the same structural fields as Codex custom models (`id`, `label`, optional `description`). Add, update, load, and delete of Claude providers MUST preserve `customModels` through the vendors config store. Local settings provider MUST NOT require `customModels`.

#### Scenario: update Claude provider preserves customModels
- **WHEN** the client updates a managed Claude provider with a non-empty `customModels` array
- **THEN** a subsequent load of Claude providers MUST return those custom models on that provider
- **AND** other provider fields (name, settingsConfig, sortOrder) MUST remain intact

#### Scenario: legacy providers without customModels still load
- **WHEN** a stored Claude provider JSON omits `customModels`
- **THEN** loading providers MUST succeed
- **AND** `customModels` MUST be treated as empty / absent

#### Scenario: model manager write uses Claude provider update path
- **WHEN** the custom model manager binds a Claude custom model to managed provider B
- **THEN** the system MUST persist the model via the Claude provider update path into B’s `customModels`

