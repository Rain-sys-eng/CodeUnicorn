# composer-model-selector-config-actions Specification

## Purpose

Define provider-scoped add-model and refresh-config actions in the composer model selector so users can update model catalogs without changing provider context or starting conversations.
## Requirements
### Requirement: Model Selector Footer MUST Expose Add And Refresh Actions

The composer model selector MUST provide two provider-scoped footer actions when the current provider supports model configuration: left-side add model and right-side refresh config.

#### Scenario: Codex selector shows split actions
- **WHEN** the user opens the model selector while the current provider is `Codex`
- **THEN** the selector footer MUST show `添加模型` on the left
- **AND** it MUST show `刷新配置` on the right

#### Scenario: Claude Code selector shows split actions
- **WHEN** the user opens the model selector while the current provider is `Claude Code`
- **THEN** the selector footer MUST show `添加模型` on the left
- **AND** it MUST show `刷新配置` on the right

#### Scenario: Gemini selector shows split actions
- **WHEN** the user opens the model selector while the current provider is `Gemini`
- **THEN** the selector footer MUST show `添加模型` on the left
- **AND** it MUST show `刷新配置` on the right

#### Scenario: footer actions remain independent
- **WHEN** the selector footer renders both actions
- **THEN** clicking `添加模型` MUST NOT trigger config refresh
- **AND** clicking `刷新配置` MUST NOT navigate to model settings

### Requirement: Add Model Action MUST Route To Current Provider Configuration

The left footer action MUST open the model/provider configuration surface for the provider currently selected in the composer.

#### Scenario: Codex add model opens Codex configuration
- **WHEN** the current provider is `Codex`
- **AND** the user clicks `添加模型`
- **THEN** the system MUST open the Codex model/provider configuration entry
- **AND** it MUST NOT open Claude Code or Gemini configuration

#### Scenario: Claude Code add model opens Claude configuration
- **WHEN** the current provider is `Claude Code`
- **AND** the user clicks `添加模型`
- **THEN** the system MUST open the Claude Code model/provider configuration entry
- **AND** it MUST NOT open Codex or Gemini configuration

#### Scenario: Gemini add model opens Gemini configuration
- **WHEN** the current provider is `Gemini`
- **AND** the user clicks `添加模型`
- **THEN** the system MUST open the Gemini model/provider configuration entry
- **AND** it MUST NOT open Codex or Claude Code configuration

### Requirement: Refresh Config Action MUST Reload Only The Current Provider

The right footer action MUST refresh the current provider's model/config snapshot without refreshing unrelated provider catalogs.

#### Scenario: Codex refresh reloads Codex model config
- **WHEN** the current provider is `Codex`
- **AND** the user clicks `刷新配置`
- **THEN** the system MUST refresh the Codex model list and config-derived model
- **AND** it MUST NOT refresh Claude Code or Gemini model catalogs as part of that action

#### Scenario: Claude Code refresh reloads settings overrides and custom models
- **WHEN** the current provider is `Claude Code`
- **AND** the user clicks `刷新配置`
- **THEN** the system MUST reread Claude model overrides from `~/.claude/settings.json` and supported environment sources
- **AND** it MUST merge user-added Claude custom models into the refreshed selector catalog

#### Scenario: Claude Code refresh preserves custom models not listed by settings
- **WHEN** Claude Code config refresh returns a settings/env model catalog
- **AND** the user has custom Claude models that are not present in the CLI output
- **THEN** the selector MUST keep those custom models visible and selectable
- **AND** it MUST NOT remove them solely because settings/env did not list them

#### Scenario: Claude Code refresh does not synthesize fallback models
- **WHEN** Claude Code config refresh succeeds
- **AND** settings/env overrides and user custom models are empty
- **THEN** the selector MUST NOT synthesize `sonnet`, `opus`, `haiku`, or `claude-sonnet-4-6`
- **AND** it MUST clear stale configured models from previous provider sources

#### Scenario: refreshed Claude labels override stale local mapping cache
- **WHEN** Claude config refresh returns a model catalog with updated labels
- **AND** localStorage still contains an older Claude model mapping
- **THEN** the selector SHALL display the parent-provided refreshed catalog label
- **AND** the selector SHALL NOT treat stale localStorage mapping as a source of truth

#### Scenario: hydrated Codex catalog is not merged twice
- **WHEN** the current provider is `Codex`
- **AND** the parent composer already passes a hydrated model catalog
- **THEN** the selector MUST render that catalog directly
- **AND** it MUST NOT append a second local fallback merge that duplicates existing runtime choices

#### Scenario: model selector remains presentational after refresh
- **WHEN** `ModelSelect` renders provider model options
- **THEN** display labels SHALL come from the `models` prop and default i18n fallback
- **AND** the selector SHALL NOT independently reread provider mapping caches on mount

#### Scenario: Gemini refresh reloads Gemini settings
- **WHEN** the current provider is `Gemini`
- **AND** the user clicks `刷新配置`
- **THEN** the system MUST reread Gemini model configuration from Gemini settings/vendor sources and supported CLI discovery sources
- **AND** the refreshed selector MUST include newly configured Gemini models when parsing succeeds

#### Scenario: refresh does not start a conversation
- **WHEN** the user clicks `刷新配置`
- **THEN** the system MUST NOT send a message
- **AND** it MUST NOT create a new user-visible native conversation solely because of refresh

### Requirement: Refresh Config Action MUST Be Serialized And Observable

The system MUST expose refresh progress and prevent overlapping refreshes for the same provider selector action.

#### Scenario: refresh shows progress
- **WHEN** a provider config refresh is in progress
- **THEN** the `刷新配置` action MUST enter a visible loading or disabled state
- **AND** the user MUST be able to distinguish refreshing from idle state

#### Scenario: repeated refresh does not run concurrently
- **WHEN** a provider config refresh is already in progress
- **AND** the user clicks `刷新配置` again
- **THEN** the system MUST NOT start another concurrent refresh for that provider
- **AND** the final model catalog state MUST remain deterministic

#### Scenario: refresh failure is diagnosable
- **WHEN** provider config refresh fails due to invalid config, read errors, or command failure
- **THEN** the system MUST expose a diagnosable failure reason through UI feedback or debug diagnostics
- **AND** it MUST keep the selector usable

### Requirement: Refresh MUST Preserve Valid Selection And Existing Catalog On Failure

Refreshing model config MUST be fail-safe: it MUST keep the current selection when still valid, and MUST retain the prior catalog when refresh fails.

#### Scenario: valid current selection remains selected
- **WHEN** refresh completes successfully
- **AND** the previously selected model still exists in the refreshed model catalog
- **THEN** the selector MUST keep that model selected

#### Scenario: missing current selection falls back by existing rules
- **WHEN** refresh completes successfully
- **AND** the previously selected model no longer exists in the refreshed model catalog
- **THEN** the selector MUST choose the next model using the existing default/preferred model selection rules

#### Scenario: failed refresh keeps previous catalog
- **WHEN** refresh fails
- **THEN** the selector MUST keep the previously visible model catalog
- **AND** it MUST NOT replace the catalog with an empty list solely because refresh failed

#### Scenario: failed refresh keeps current selection
- **WHEN** refresh fails
- **THEN** the selector MUST keep the current selected model value
- **AND** it MUST NOT clear the selection solely because refresh failed

### Requirement: Codex Selector Refresh MUST Be Catalog-Only

The composer model selector `刷新配置` action for Codex MUST refresh Codex model catalog facts without restarting, replacing, stopping, or disconnecting connected Codex runtimes.

#### Scenario: Codex selector refresh does not reload runtime
- **WHEN** the current provider is `Codex`
- **AND** the user clicks the model selector `刷新配置` action
- **THEN** the system MUST refresh the Codex model list and config-derived model
- **AND** it MUST NOT call `reload_codex_runtime_config`

#### Scenario: explicit settings runtime reload remains available
- **WHEN** the user clicks the explicit Codex runtime reload action in settings
- **THEN** the system MAY call `reload_codex_runtime_config`
- **AND** the action MUST remain visually distinct from the model selector `刷新配置` action

#### Scenario: refresh while Codex turn is running
- **WHEN** a Codex runtime has active foreground work
- **AND** the user refreshes the Codex model selector catalog
- **THEN** the running conversation MUST remain connected
- **AND** the user MUST NOT receive a runtime-ended notice with `shutdownSource=settings_restart` solely because of that catalog refresh

### Requirement: Codex Custom Models MUST Survive Hydrated Catalogs

Codex model selector catalog composition MUST keep user custom models visible even when the parent already supplies a hydrated runtime or config-derived model catalog.

#### Scenario: custom model appears with dynamic catalog
- **WHEN** the parent composer passes a non-empty Codex model catalog
- **AND** the user has a Codex custom model
- **THEN** the selector MUST include the custom model
- **AND** it MUST not duplicate equivalent runtime choices

#### Scenario: custom label wins for matching model id
- **WHEN** a Codex custom model has the same model id as a runtime or built-in model
- **THEN** the visible option MUST preserve the custom model label
- **AND** the selector MUST keep only one selectable row for that model identity

### Requirement: Codex Custom Model Options MUST Retain Provider Origin

Codex model selector catalog composition MUST retain managed provider origin metadata for user custom models so downstream send paths can distinguish disk/default models from managed-provider models.

#### Scenario: managed provider custom model carries provider profile id

- **WHEN** a Codex managed provider exposes a custom model
- **THEN** the composed model selector option for that custom model MUST include the provider's profile id
- **AND** the option MUST remain selectable with its configured label

#### Scenario: hydrated catalog keeps custom model provider origin

- **WHEN** the parent composer passes a hydrated Codex model catalog
- **AND** a managed provider custom model is merged into that catalog
- **THEN** the merged custom model option MUST retain its provider profile id
- **AND** equivalent runtime choices MUST NOT duplicate the custom model row

#### Scenario: disk and config-derived models do not claim managed origin

- **WHEN** a Codex model option comes from disk config, built-in defaults, or runtime discovery rather than a managed provider custom model
- **THEN** the option MUST NOT carry a managed provider profile id

### Requirement: Custom Model Id Validation MUST Be Consistent Across Surfaces
`isValidModelId` 与 `MODEL_ID_PATTERN` MUST 在 `composer/types/provider.ts` 保持单一实现，`vendors/types.ts` MUST re-export 同一实现，保证 dialog 录入侧与 runtime hydration 侧校验口径一致，不得存在两份漂移的正则字面量或长度上限。

#### Scenario: single validation semantics across composer and vendors
- **WHEN** 同一 model id 分别经过 `vendors/types.ts` 与 `composer/types/provider.ts` 的 `isValidModelId` 校验
- **THEN** 两侧 MUST 返回相同结果
- **AND** 两侧 MUST 共享同一 `MODEL_ID_PATTERN` 与长度上限(≤128)

#### Scenario: bracketed model ids remain valid
- **WHEN** model id 含方括号(如 `[L]gemini-3-flash-preview`)
- **THEN** `isValidModelId` MUST 接受该 id
- **AND** `validateCodexCustomModels` MUST 在 runtime 校验后保留该 custom model

#### Scenario: invalid characters are rejected at the dialog surface
- **WHEN** 用户在 `CustomModelDialog` 输入含空白或非法字符的 model id
- **THEN** `isValidModelId` MUST 拒绝该 id
- **AND** 被拒绝的 id MUST NOT 在 runtime hydration 时被静默丢弃(因为录入侧与 runtime 侧口径一致)

### Requirement: Add Model Open Path MUST Prefer Active Or Requested Provider For Binding Default

When the composer (or host) opens the custom model manager in add mode for Claude or Codex, the dialog’s provider binding default MUST prefer an explicit requested provider profile id when provided; otherwise it MUST prefer the engine’s currently active managed provider; it MUST NOT silently force local configuration when an active managed provider exists.

#### Scenario: active managed provider becomes default binding
- **WHEN** Codex has an active managed provider A
- **AND** the user opens the custom model manager in add mode without an explicit preferred provider profile id
- **THEN** the add form’s provider selector MUST default to A

#### Scenario: explicit preferred provider profile wins
- **WHEN** the open request carries `preferredProviderProfileId` equal to managed provider B
- **AND** B is present in the engine provider list
- **THEN** the add form’s provider selector MUST default to B even if another provider is active

#### Scenario: no managed provider falls back to local
- **WHEN** the engine has no managed third-party providers
- **AND** the user opens the custom model manager in add mode
- **THEN** the provider selector MUST default to local configuration

### Requirement: Qoder Model Selector MUST Expose The Bound Distribution

The Composer model selector MUST render Qoder Global/CN as distribution channels
under the Qoder engine, not as separate engines or ordinary provider CRUD entries.
Its refresh and settings actions MUST target the selected distribution only.

#### Scenario: CN picker refresh

- **WHEN** the current Qoder execution target is CN and the user refreshes models
- **THEN** the selector MUST request only the CN catalog scope
- **AND** its configuration action MUST open the Qoder CN card

#### Scenario: Qoder channel change chooses a valid model

- **WHEN** the user changes a Qoder target from Global to CN
- **THEN** the selector MUST load or use a CN catalog before persisting the target
- **AND** it MUST NOT carry a Global-only model id into the CN target

#### Scenario: Qoder is available in a Shared Session

- **WHEN** Qoder is ready and the current thread is a Shared Session
- **THEN** the Composer MUST use Qoder's actual availability status
- **AND** it MUST NOT render a stale “not available in Shared Session” override

