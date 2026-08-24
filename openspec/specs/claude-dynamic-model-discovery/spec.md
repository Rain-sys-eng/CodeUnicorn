# claude-dynamic-model-discovery Specification

## Purpose

Define how Claude Code model discovery, selector merge, runtime resolution, diagnostics, and compatibility normalization behave when the GUI relies only on user-controlled model sources.
## Requirements
### Requirement: Claude Model Catalog MUST Combine Built-In Catalog With User-Controlled Overrides

The system MUST build the Claude Code model catalog from a hardcoded built-in catalog (mirroring the Claude CLI `/model` roster) plus Claude settings/env model overrides and user-added Claude custom models. Settings/env overrides and custom models take precedence over built-in entries with the same runtime model.

#### Scenario: settings override populates selector catalog
- **WHEN** `~/.claude/settings.json` or supported environment variables define a Claude model override
- **THEN** the Claude model selector MUST include an entry for that configured runtime model
- **AND** the entry source MUST be diagnosable as `settings-override`
- **AND** the override entry MUST be ordered before and shadow any built-in entry sharing the same runtime model

#### Scenario: help examples are not catalog entries
- **WHEN** Claude Code help text mentions aliases or example models such as `sonnet`, `opus`, `haiku`, or `claude-sonnet-4-6`
- **THEN** the system MUST NOT add those values to the Claude selector solely from help text
- **AND** it MUST NOT report them as discovered catalog entries

#### Scenario: builtin catalog is provided when overrides are empty
- **WHEN** Claude settings/env overrides are empty
- **AND** no user custom Claude models exist
- **THEN** the Claude selector MUST show the built-in catalog entries with full runtime model ids (e.g. `claude-opus-5`)
- **AND** the entry source MUST be diagnosable as `builtin`
- **AND** it MUST NOT synthesize bare alias entries such as `sonnet`, `opus`, or `haiku`
- **AND** it MUST NOT synthesize an option from the current selected value for Claude

### Requirement: Claude Model Entries MUST Separate UI Identity From Runtime Model

The system MUST treat model option identity and Claude CLI runtime model value as separate fields.

#### Scenario: option id differs from runtime model
- **WHEN** a Claude model option has `id` different from `model`
- **THEN** the selector MUST use `id` for UI selection and persistence
- **AND** send-time execution MUST use `model` as the value passed to Claude Code CLI

#### Scenario: model value is presentationally hidden
- **WHEN** a model option displays a friendly label
- **THEN** the friendly label MUST NOT replace the runtime `model` value
- **AND** debug diagnostics MUST still be able to report the final runtime model value

#### Scenario: legacy id fallback is explicit
- **WHEN** a legacy model option lacks an explicit `model` field
- **THEN** the system MUST resolve it through compatibility rules before sending
- **AND** it MUST NOT blindly pass an arbitrary UI-only id to Claude Code CLI

#### Scenario: missing source is normalized for compatibility
- **WHEN** a legacy backend, remote bridge, or cached payload returns a Claude model entry without `source`
- **THEN** the frontend boundary MUST normalize the entry source to `unknown`
- **AND** selector rendering and diagnostics MUST NOT receive an omitted or undefined source value

#### Scenario: missing model field stays compatibility-only
- **WHEN** a legacy Claude model entry lacks an explicit runtime `model`
- **THEN** normalization MAY keep the entry selectable using compatibility metadata
- **AND** send-time execution MUST still pass through explicit runtime resolution before invoking `engine_send_message`

### Requirement: Claude Custom Models MUST Remain Supported

The system MUST continue to support user-added Claude custom models even when they are not present in Claude settings/env overrides. Claude custom model normalization MUST be shape-only: the GUI MUST NOT reject a user-entered custom model id solely because it contains spaces, punctuation, Unicode characters, provider-specific syntax, or a non-official naming pattern.

#### Scenario: custom model appears beside configured models
- **WHEN** the user has added a Claude custom model
- **AND** Claude settings/env overrides contain configured models
- **THEN** the custom model MUST remain present in the merged Claude model catalog
- **AND** it MUST NOT be removed solely because settings/env did not list it

#### Scenario: custom model sends as configured
- **WHEN** the user selects a custom Claude model
- **THEN** the sent Claude runtime model MUST equal the custom model value configured by the user
- **AND** the system MUST NOT rewrite it to a built-in alias or configured model

#### Scenario: custom model wins over legacy migration
- **WHEN** a selected model value matches a user custom model
- **THEN** the system MUST treat it as user intent
- **AND** it MUST NOT migrate that value as if it were a deprecated built-in id

#### Scenario: custom model id with spaces remains selectable
- **WHEN** the user adds a Claude custom model with id `Haiku 4.5`
- **THEN** the Claude model selector MUST include that custom model
- **AND** the runtime model value MUST remain `Haiku 4.5`

#### Scenario: custom model id is not checked against official syntax
- **WHEN** the user adds a Claude custom model whose id contains punctuation, Unicode, or provider-specific syntax
- **THEN** frontend catalog normalization MUST preserve the entry when the id is a non-empty string
- **AND** it MUST NOT apply the generic model-id regex allowlist used by other providers

#### Scenario: malformed custom entries are ignored by shape only
- **WHEN** the custom model payload contains a non-object entry, a missing id, or an id that is empty after trimming
- **THEN** the malformed entry MUST be ignored
- **AND** valid user custom model entries in the same payload MUST remain available

### Requirement: Claude Model Catalog MUST Merge Sources Deterministically

The system MUST merge settings/env override models and custom models using deterministic precedence.

#### Scenario: configured and custom entries share runtime value
- **WHEN** a settings/env entry and a custom entry have the same runtime `model`
- **THEN** the merged catalog MUST avoid duplicate runtime choices
- **AND** it MUST preserve enough metadata to keep the label and source diagnosable

#### Scenario: custom entry remains explicit after dedupe
- **WHEN** a custom entry is de-duplicated with a settings override entry
- **THEN** the merged option MUST remain attributable to the custom source in diagnostics
- **AND** user selection of that model MUST continue to resolve to the user-configured runtime model

#### Scenario: default runtime survives dedupe
- **WHEN** a settings/env entry marked as default and a custom entry share the same runtime `model`
- **THEN** the surviving merged option MUST remain marked as the default runtime choice
- **AND** the selector MUST NOT lose default semantics solely because the custom entry shadowed the configured entry

#### Scenario: settings override contributes runtime model
- **WHEN** `~/.claude/settings.json` or environment variables define a Claude model override
- **THEN** the merged catalog MUST include an entry for that override
- **AND** the override MUST resolve to the configured runtime model value at send time

### Requirement: Claude Model Refresh MUST Be Fail-Safe

The system MUST replace the visible Claude backend catalog on successful refresh and preserve the previous usable catalog when refresh fails.

#### Scenario: successful refresh clears stale configured models
- **WHEN** Claude model refresh succeeds
- **AND** the refreshed settings/env catalog no longer contains models from the previous provider source
- **THEN** the selector MUST remove those stale configured models
- **AND** it MUST keep user custom models available

#### Scenario: successful empty refresh falls back to builtin catalog
- **WHEN** Claude model refresh succeeds with no settings/env model overrides
- **AND** no user custom Claude models exist
- **THEN** the selector MUST show the built-in Claude catalog entries
- **AND** it MUST NOT synthesize bare alias entries or options derived from the current selected value

#### Scenario: failed refresh preserves previous catalog
- **WHEN** Claude model refresh fails
- **THEN** the selector MUST keep the previously visible catalog
- **AND** it MUST keep custom models available

#### Scenario: failed refresh preserves selected model
- **WHEN** Claude model refresh fails
- **THEN** the selector MUST keep the current selected model if it can still resolve to a runtime model

#### Scenario: refresh failure is diagnosable
- **WHEN** Claude model refresh fails
- **THEN** the system MUST expose a diagnosable failure reason through UI feedback or debug diagnostics

### Requirement: Claude Legacy Model Selections MUST Be Migrated Before Send

The system MUST resolve known legacy Claude model selections before sending a message.

#### Scenario: legacy selection maps to configured runtime option
- **WHEN** a persisted selection references a known deprecated built-in Claude model id
- **AND** an equivalent settings override or custom model option exists
- **THEN** the system MUST migrate the selection to that valid option before sending
- **AND** the sent runtime model MUST NOT be the deprecated built-in id

#### Scenario: unmigratable legacy selection falls back safely
- **WHEN** a persisted legacy selection cannot be mapped to a current catalog option
- **THEN** the system MUST use the existing default selection rules or surface a diagnosable error
- **AND** it MUST NOT silently send a known invalid legacy id

#### Scenario: unknown custom-like model is not blocked by officialness
- **WHEN** a model value is user-specified and passes shape validation
- **THEN** the backend MUST allow passthrough to Claude Code CLI
- **AND** it MUST NOT reject the value solely because it was not configured as an official model

#### Scenario: backend validation remains shape-only
- **WHEN** the selected value passes backend shape validation
- **THEN** the backend MUST pass the value through to Claude Code CLI
- **AND** it MUST NOT introduce an official-model allowlist as part of this change

### Requirement: Claude Model Resolution MUST Be Observable

The system MUST record enough diagnostic information to understand how the final Claude runtime model was selected.

#### Scenario: send diagnostics include model source
- **WHEN** a Claude message is sent
- **THEN** debug diagnostics MUST include the selected UI id, resolved runtime model, and resolution source
- **AND** diagnostics MUST distinguish custom, settings-override, and unknown sources

#### Scenario: refresh diagnostics include source
- **WHEN** Claude model refresh completes
- **THEN** diagnostics MUST indicate whether the visible catalog came from settings/env, custom models, unknown compatibility entries, or a merge of those sources
- **AND** failures MUST include enough error detail to support troubleshooting

#### Scenario: unknown source is explicit
- **WHEN** the system cannot determine a Claude model entry source
- **THEN** it MUST mark the source as `unknown`
- **AND** it MUST NOT omit the source field from diagnostics

### Requirement: Claude Model Discovery MUST Preserve Cross-Layer Compatibility

The system MUST keep frontend, Tauri service mapping, Rust backend, daemon, and remote compatibility while adding Claude model metadata fields.

#### Scenario: service mapping preserves model metadata
- **WHEN** `get_engine_models` returns Claude model entries with `model` and `source`
- **THEN** `src/services/tauri.ts` MUST preserve those fields in the frontend response
- **AND** `src/services/tauri.test.ts` MUST assert that the fields are not dropped

#### Scenario: remote or daemon path lacks new metadata
- **WHEN** remote, web-service, or daemon compatibility path returns model entries without the new metadata
- **THEN** the frontend MUST keep the existing flow usable through compatibility normalization
- **AND** missing metadata MUST be represented as `unknown` rather than causing runtime failure

#### Scenario: non-Claude providers keep existing semantics
- **WHEN** Codex, Gemini, or OpenCode model catalogs are loaded or refreshed
- **THEN** Claude catalog logic MUST NOT alter their catalog precedence, selected model semantics, or refresh behavior
- **AND** shared type changes MUST remain backward-compatible for those providers

### Requirement: Claude Model Discovery MUST Be Protected By CI Gates

The implementation MUST include verification gates that cover OpenSpec, frontend contract mapping, frontend selection behavior, TypeScript contracts, and Rust send/catalog validation.

#### Scenario: cross-layer gates pass before completion
- **WHEN** implementation tasks are marked complete
- **THEN** OpenSpec strict validation, focused frontend tests, frontend typecheck, focused Rust tests, and service mapping tests MUST have passing evidence
- **AND** a failed required gate MUST block marking the verification task complete

#### Scenario: id/model divergence is regression-tested
- **WHEN** a Claude option has a UI `id` that differs from runtime `model`
- **THEN** frontend focused tests MUST prove selector persistence uses `id`
- **AND** send-time tests MUST prove `engine_send_message` receives runtime `model`

#### Scenario: builtin catalog behavior is regression-tested
- **WHEN** Claude settings/env and custom model catalog are empty
- **THEN** focused Rust tests MUST prove the built-in catalog is returned with full runtime model ids and a single default entry
- **AND** tests MUST prove settings/env overrides shadow built-in entries sharing the same runtime model

### Requirement: Claude Custom Models MUST Appear In Grouped Selector

Claude Code custom models MUST remain available in grouped Composer model selector surfaces, even when Claude Code is not the currently active engine.

#### Scenario: Claude custom model visible outside active Claude engine
- **WHEN** the user has added a Claude custom model
- **AND** the active Composer provider is `Codex`, `Gemini`, or another provider
- **THEN** the grouped selector MUST include that Claude custom model in the Claude Code group
- **AND** it MUST preserve the custom runtime model value exactly as configured

#### Scenario: grouped selector preserves shape-only Claude custom model ids
- **WHEN** a Claude custom model id contains spaces, punctuation, Unicode characters, or provider-specific syntax
- **AND** the grouped selector is opened
- **THEN** the Claude Code group MUST keep that model visible
- **AND** it MUST NOT apply the generic Codex/Gemini model-id regex allowlist to the Claude custom entry

### Requirement: Claude Catalog Merge MUST Emit Shared Provenance Metadata

Claude builtin、settings/env and custom model merge MUST retain its existing override behavior while projecting every result through the shared catalog DTO.

#### Scenario: custom model overrides builtin

- **WHEN** a custom or settings model has the same runtime model id as builtin
- **THEN** configured metadata MUST win according to shared precedence
- **AND** the entry MUST identify configured source and provider provenance

#### Scenario: Claude dynamic discovery is unavailable

- **WHEN** no runtime/configured update can be loaded
- **THEN** cached or generated fallback MUST remain deterministic
- **AND** failure MUST not erase user custom models

### Requirement: Claude Provider Continuation MUST Resolve Runtime Model

Claude Provider Continuation MUST 遵守 Claude catalog 的 UI `id` / runtime `model` 分离
contract，并在 target-side effect 前验证已冻结的 model identity。

#### Scenario: Native Composer selects a settings override

- **WHEN** Native Composer 从另一 Claude Provider Profile 选择 settings override entry
- **THEN** picker MUST 保留该 entry 的 UI id 用于 selection identity
- **AND** continuation execution MUST 将 entry 的 runtime model 传给 Claude CLI

#### Scenario: legacy entry lacks runtime model

- **WHEN** legacy catalog entry 没有显式 runtime `model`
- **THEN** frontend MAY 显式 fallback 到 entry `id`
- **AND** backend MUST 仍执行 Provider-scoped validation
- **AND** MUST NOT 对已知 `id != model` entry 使用 legacy fallback

### Requirement: Claude Catalog Actions MUST Not Imply Unsupported CLI Discovery

Claude Code 模型目录 MUST 允许重读 settings/env/provider configuration，但 MUST NOT
声称通过 CLI model-list 获取模型。

#### Scenario: Reload Claude configuration

- **WHEN** 用户对 Claude local 或 managed Provider 执行 `Reload Config`
- **THEN** backend MUST 重新读取对应 settings/env/provider model fields
- **AND** selector MUST 合并 custom 与 builtin catalog

#### Scenario: Claude discovery capability

- **WHEN** 当前 Claude CLI 没有已验证的 model-list protocol
- **THEN** `Discover Models` MUST NOT 显示为可执行 action
- **AND** 系统 MUST NOT 调用 HTTP、解析 help 或返回 builtin entries 冒充 discovered models

### Requirement: Claude Custom Models MAY Carry Provider Ownership Provenance

Claude user-added custom models in the engine catalog MAY include `providerProfileId` when they are owned by a managed Claude provider. Catalog merge MUST keep provider-owned and local/unscoped custom models visible and selectable. Claude custom model id validation MUST remain shape-only.

#### Scenario: provider-owned Claude custom model appears in catalog
- **WHEN** a managed Claude provider stores a custom model in `customModels`
- **THEN** the Claude model catalog MUST include that model
- **AND** the catalog entry SHOULD carry `providerProfileId` equal to that provider when projected through the custom model store

#### Scenario: local Claude custom model remains without provider binding
- **WHEN** the user has a Claude custom model without `providerProfileId`
- **THEN** the model MUST remain present in the merged Claude model catalog
- **AND** it MUST remain selectable

#### Scenario: shape-only validation still applies
- **WHEN** the user adds a Claude custom model with id containing spaces or provider-specific syntax
- **AND** the model is bound to a managed Claude provider or local configuration
- **THEN** the system MUST NOT reject the id solely for official naming pattern mismatch

