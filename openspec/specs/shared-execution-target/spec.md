# shared-execution-target Specification

## Purpose
TBD - created by archiving change compose-shared-session-execution-target. Update Purpose after archive.
## Requirements
### Requirement: Next Target and Active Turn Target MUST Be Separate Stores

The system MUST maintain two distinct target concepts: `selectedNextTarget` (the mutable composer selection affecting only the next send) and `activeTurnTarget` (the immutable `TurnExecutionSnapshot` captured when a turn attempt is created). The system MUST NOT use the current picker value to annotate in-flight or completed turns.

#### Scenario: picker change does not rewrite active turn badge

- **WHEN** a turn is running with an `activeTurnTarget` snapshot and the user changes the four-level picker
- **THEN** the running turn's badge MUST continue to display the snapshot values
- **AND** the new picker value MUST only affect the next send

#### Scenario: completed turn attribution survives later picker changes

- **WHEN** a turn has completed and the user later changes CLI, provider, model, or reasoning in the picker
- **THEN** the completed turn's attribution MUST remain the original snapshot
- **AND** the picker change MUST NOT create any turn fact or binding

### Requirement: Target Picker MUST Be Four-Level CLI Provider Model Reasoning

The shared session composer MUST expose a four-level execution target picker: CLI (engine), Provider profile, Model, Reasoning. The picker MUST only update `selectedNextTarget`; it MUST NOT create bindings or dispatch turns.

#### Scenario: picker levels are hierarchical

- **WHEN** the user opens the shared session target picker
- **THEN** the picker MUST offer selection in the order CLI → Provider → Model → Reasoning
- **AND** the model catalog MUST be scoped to the selected provider profile

#### Scenario: picker update is selection-only

- **WHEN** the user changes any picker level without submitting a message
- **THEN** the system MUST update only `selectedNextTarget`
- **AND** the system MUST NOT create a hidden binding or start a native session

### Requirement: Turn Attribution MUST Read TurnExecutionSnapshot

Every turn badge, usage record, error, retry, recovery action, and reload projection MUST be attributed to the immutable `TurnExecutionSnapshot`. The snapshot MUST freeze engine id plus readable CLI name, provider profile identity plus `providerProfileNameSnapshot`, model id plus readable model name, and reasoning at `conversation.turnRequested` creation. Current picker or binding state MUST NOT annotate historical Turns.

Only an explicit absent Provider Profile representing local/default semantics MAY display “本地配置”. A legacy Turn whose Provider identity cannot be proven MUST display an unknown-history label and MUST NOT fabricate local/default identity.

#### Scenario: deleted provider still renders explainable badge

- **WHEN** a provider profile referenced by a completed turn's snapshot has been deleted
- **THEN** the turn badge MUST display the snapshot's provider name
- **AND** the badge MUST mark the provider as unavailable without rewriting the snapshot

#### Scenario: two provider turns preserve distinct attribution after reload

- **WHEN** a Shared Session sends one Turn through Claude Provider A and the next through Codex Provider B, then reloads history
- **THEN** each Turn MUST display its frozen CLI, Provider, and Model identity
- **AND** neither Turn MUST be relabeled from the current picker or the other Turn's binding

#### Scenario: legacy provider identity is unknown

- **WHEN** a legacy Turn lacks both an explicit local/default semantic and a durable Provider Profile snapshot
- **THEN** the badge MUST display a human-readable unknown-history label
- **AND** MUST NOT display “本地配置” as a guess

### Requirement: Bindings MUST Be Keyed By Engine Plus Provider Profile

Hidden bindings MUST be indexed by the pair `(engine, providerProfileId)` instead of engine alone. Model MUST NOT be part of the binding key unless a runtime capability explicitly requires a new native session per model.

#### Scenario: same engine with two providers holds two bindings

- **WHEN** a shared session sends turns to `Claude/Official` and `Claude/OpenRouter`
- **THEN** the session MUST hold two distinct hidden bindings
- **AND** each turn MUST execute against the binding matching its snapshot

#### Scenario: model switch within same engine and provider reuses binding

- **WHEN** the user changes only the model while keeping the same engine and provider profile
- **THEN** the system MUST reuse the existing binding
- **AND** the system MUST NOT create a new native session for the model change alone

#### Scenario: switching back reuses the original binding

- **WHEN** a shared session switches `Claude/Official → Codex/OpenAI → Claude/Official`
- **THEN** the third turn MUST resume the original `Claude/Official` binding
- **AND** the session MUST hold exactly two hidden bindings

### Requirement: Legacy Engine-Keyed Bindings MUST Migrate to Default Provider Semantics

When loading a persisted `bindingsByEngine` map, the system MUST migrate each entry to `bindingsByTarget` with `providerProfileId = None` (local/default provider semantics). The system MUST NOT guess or fabricate a managed provider profile for legacy bindings.

#### Scenario: legacy binding restores as default provider binding

- **WHEN** a shared session persisted before this change contains an engine-keyed binding
- **THEN** the migrated binding MUST be keyed as that engine with default-provider semantics
- **AND** the legacy session MUST remain loadable and continuable

#### Scenario: migration does not invent managed provider identity

- **WHEN** a legacy engine-keyed binding is migrated
- **THEN** its `providerProfileId` MUST remain unset rather than being assigned to any managed provider profile

### Requirement: Owner Routing MUST Carry Full Execution Target

Interrupt, approval, pending rebind, and recovery operations MUST be routed by the full execution target (`engine` + `providerProfileId`), not by engine alone.

#### Scenario: dual providers of one engine do not cross-wire operations

- **WHEN** two turns are active on `Claude/Official` and `Claude/OpenRouter` in the same workspace
- **THEN** an interrupt issued for one turn MUST reach only the runtime owning that turn's target
- **AND** the other provider's turn MUST remain unaffected

### Requirement: Shared realtime items MUST freeze execution target identity

When a Native runtime event is owner-routed into a Shared Session, every realtime assistant item for the active Turn MUST carry the immutable `activeTurnTarget` snapshot before entering the Conversation assembler. The renderer MUST NOT subscribe to or infer identity from the mutable Picker.

#### Scenario: realtime assistant displays target badge
- **WHEN** a Shared Turn is running and an assistant realtime item is normalized
- **THEN** the item MUST carry the active Turn's CLI, Provider, Model, and Reasoning snapshot
- **AND** the realtime Badge MUST match the later history Badge

#### Scenario: picker mutation cannot relabel active item
- **WHEN** the next-target Picker changes after a Turn snapshot is frozen
- **THEN** realtime items for the active Turn MUST retain the frozen snapshot
- **AND** MUST NOT read the new Picker value

### Requirement: Explicit local target MUST freeze canonical Provider semantics

The system MUST treat an Execution Target with no Provider Profile ID as explicit local/default
execution.
At the send/freeze boundary, the mutable selection source `"disk"` MUST be converted to
canonical `providerProfileSource = "local"` and persisted with a readable local Provider name.
This normalization MUST NOT apply to legacy Turns whose execution target is unknown.

#### Scenario: new local Turn reloads as local configuration

- **WHEN** a new Shared Turn is sent with no Provider Profile ID
- **THEN** its frozen canonical snapshot MUST identify local Provider semantics with
  `providerProfileSource = "local"`
- **AND** realtime and history badges MUST display “本地配置” rather than “历史配置未知”

#### Scenario: unknown legacy identity remains unknown

- **WHEN** a legacy Turn lacks both explicit local/default semantics and Provider identity
- **THEN** history MUST keep the unknown-history label
- **AND** MUST NOT fabricate local Provider semantics

### Requirement: Selected Next Target MUST Survive Shared Session Reload

The Shared Session metadata MUST persist the complete selected next Execution Target, including engine, provider profile identity, model, reasoning, and readable provider snapshot fields. Loading the Shared Session MUST restore that target into `selectedNextTarget`. Legacy metadata that lacks optional target fields MUST remain readable without inventing values.

#### Scenario: sent managed target survives reload

- **WHEN** a user sends a Turn using a Shared target containing CLI, managed Provider, Model, and Reasoning and later reloads the Shared Session
- **THEN** the composer MUST restore the same complete `selectedNextTarget`
- **AND** the next send MUST use that restored target unless the user changes it

#### Scenario: legacy partial target remains compatible

- **WHEN** a legacy Shared Session contains only Engine or Engine plus Provider in `selectedTarget`
- **THEN** the session MUST load successfully
- **AND** missing Model, Reasoning, or readable snapshot fields MUST remain absent rather than being guessed

### Requirement: Selection Provider Source MUST Convert To Canonical Source At Freeze Boundary

The system MUST keep Provider catalog selection source separate from canonical snapshot source. Provider catalog and mutable `selectedNextTarget` MAY use the selection-domain source `"disk" | "managed"`. `TurnExecutionSnapshot` and canonical Shared facts MUST use the Foundation source `"local" | "managed"`. The system MUST perform this conversion exactly once while freezing the Turn snapshot. Canonical IPC and storage MUST reject `"disk"` and unknown source values rather than silently normalizing them.

#### Scenario: local selection freezes canonical local source

- **WHEN** a Shared Turn freezes a local/default selection whose catalog source is `"disk"`
- **THEN** its `TurnExecutionSnapshot.providerProfileSource` MUST be `"local"`
- **AND** the canonical `conversation.turnRequested` fact MUST pass schema validation

#### Scenario: managed selection preserves managed source

- **WHEN** a Shared Turn freezes a managed Provider selection
- **THEN** its canonical source MUST remain `"managed"`
- **AND** Provider identity, Model, and Reasoning MUST remain unchanged

#### Scenario: invalid canonical source fails closed

- **WHEN** canonical IPC or event validation receives `"disk"` or an unknown `providerProfileSource`
- **THEN** the payload MUST be rejected before runtime side effects
- **AND** the canonical schema MUST NOT be widened to accept the selection-domain value

### Requirement: Shared Provider Channel Switch MUST Reload Model Catalog Before Updating Target

Shared Session 模型选择器在同一 CLI 下切换 Provider 时，MUST 先加载该 Provider 的 model catalog，再更新 `selectedNextTarget`；MUST NOT 在 catalog 未就绪时沿用上一 Provider 的 model id。

#### Scenario: switch claude provider reloads models for next send

- **WHEN** 用户在 Shared Session 的 Claude 目标 Picker 中将 Provider 从 A 切换为 B（不发送消息）
- **THEN** 系统 MUST 按 `engine=claude + providerProfileId=B` 拉取（或命中缓存）模型目录
- **AND** 对话框模型列表 MUST 展示 B 的模型，而不是 A 的模型
- **AND** 系统 MUST 将 `selectedNextTarget` 更新为包含 B 与 B catalog 内合法 model 的完整 target（在 catalog 非空时）
- **AND** 系统 MUST NOT 创建新会话、MUST NOT 走 Native Provider 续接流程

#### Scenario: empty catalog does not keep previous provider model id

- **WHEN** 用户切换到 Provider B 且 B 的 model catalog 当前为空（仍在加载或加载失败）
- **THEN** 系统 MUST NOT 把上一 Provider A 的 `modelCatalogEntryId` / `model` 写入 B 的 `selectedNextTarget`
- **AND** 加载成功后用户再次选择或切换完成时 MUST 使用 B 的模型

#### Scenario: picker still selection-only

- **WHEN** 用户仅切换 Shared Provider/Model 而不提交消息
- **THEN** 系统 MUST 只更新 `selectedNextTarget`（及为展示所需的 catalog/mapping）
- **AND** MUST NOT 创建 hidden binding 或启动 native session（与既有 four-level picker 契约一致）

### Requirement: Shared Claude Model Labels Prefer Provider-Scoped Catalog Runtime Names

当 Shared/Atomic catalog 返回带 `providerProfileId` 的 Claude 模型行时，选择器展示名 MUST 优先使用该行的 provider-scoped runtime name（如 `model.model`），MUST NOT 被全局 localStorage ANTHROPIC 映射中的上一渠道值永久盖住。

#### Scenario: scoped runtime name wins over stale global mapping

- **WHEN** 全局 Claude model mapping 仍为上一渠道（如 deepseek-v4-pro），而当前 Shared 渠道 catalog 行为 MiniMax runtime
- **THEN** 模型列表行 MUST 显示 MiniMax runtime 名（或 catalog 已写入的 label/model）
- **AND** MUST NOT 全部显示为上一渠道映射名

### Requirement: Frozen Model Identity MUST Separate Catalog And Runtime Values

Every new Shared Turn target MUST freeze both `modelCatalogEntryId` and runtime `model` when a
catalog entry is selected. The backend MUST validate both values against the same
Provider-scoped catalog entry. Runtime adapters MUST consume only runtime `model`; a catalog-only
ID MUST NOT cross the Runtime boundary. Legacy snapshots without `modelCatalogEntryId` MAY be
validated by runtime `model`, but MUST NOT treat a catalog ID as a runtime model.

#### Scenario: catalog id differs from runtime model

- **WHEN** the selected catalog entry has `id != model`
- **THEN** the frozen Turn snapshot MUST preserve both values
- **AND** the CLI request MUST contain only the entry's runtime `model`

#### Scenario: mismatched model pair fails before side effect

- **WHEN** `modelCatalogEntryId` and runtime `model` do not identify the same entry for the
  frozen Engine and Provider
- **THEN** the Turn MUST fail closed before process start, Binding materialization, or prompt send
- **AND** the system MUST NOT substitute a default Provider or Model

### Requirement: Turn Snapshot MUST Be The Sole Runtime Authority

After `conversation.turnRequested` is durably appended, every operation for that attempt MUST
derive Engine, Provider, Model, and Reasoning from the persisted snapshot. Frontend or legacy flat
Target fields MUST NOT override the snapshot. Picker changes after freeze MUST affect only the
next Turn.

#### Scenario: stale legacy fields disagree with durable snapshot

- **WHEN** a durable attempt snapshot selects Target A while stale legacy fields contain Target B
- **THEN** Runtime dispatch, Binding, Context Delivery, terminal commit, and badge MUST all use
  Target A
- **AND** Target B MUST cause no Runtime side effect

#### Scenario: changing picker does not rewrite history

- **WHEN** the user changes `selectedNextTarget` after an earlier Turn was requested
- **THEN** the earlier Turn's Runtime owner and visible label MUST remain bound to its immutable
  snapshot

#### Scenario: stale collaboration mode cannot override durable model

- **WHEN** `collaborationMode.settings` still contains Model or Reasoning from a prior Provider
  while the durable Attempt snapshot selects a different Target
- **THEN** the Runtime request MUST rewrite those settings from the Attempt snapshot
- **AND** the stale Model or Reasoning MUST cause no Runtime side effect

### Requirement: New Shared Session MUST Start With A Complete Execution Target

A newly created Shared Session MUST persist a complete resolved `initialTarget` before it becomes
visible. The target MUST include Engine, Provider semantics, `modelCatalogEntryId`, runtime
`model`, and a readable Provider snapshot. `selectedEngine` MAY remain as a legacy rollback
mirror, but MUST be derived from `initialTarget.engine`; it MUST NOT be an independent creation
authority. Legacy partial metadata MAY remain readable, but MUST NOT define the creation contract
for new sessions.

Create-time model rows for `initialTarget` MUST come from the **provider-scoped authoritative
catalog** of the default create Provider (first ordered profile for the selected engine). The
system MUST NOT build `initialTarget.model*` from a bare `get_engine_models(engine)` / non-force-
refreshed engine status cache while labeling the snapshot as local/default.

#### Scenario: complete initial target is persisted atomically

- **WHEN** a user creates a Shared Session with a resolved local or managed Target
- **THEN** the first persisted legacy metadata and `shared_sessions_v2.selected_target_json` row
  MUST contain that complete Target
- **AND** the returned Session and Composer MUST expose the same Engine, Provider, catalog model,
  runtime model, and readable snapshot
- **AND** no Runtime Binding or canonical Turn fact may be created by Session creation

#### Scenario: missing or partial initial target fails before creation

- **WHEN** a caller omits `initialTarget` or supplies only Engine/Provider without the required
  catalog/runtime model pair and readable Provider snapshot
- **THEN** Session creation MUST fail with an actionable invalid-target error
- **AND** no Shared Session directory, metadata row, Binding, or Turn fact may be created

#### Scenario: selected engine conflicts with initial target

- **WHEN** a compatibility caller supplies `selectedEngine` that differs from
  `initialTarget.engine`
- **THEN** Session creation MUST fail closed
- **AND** the system MUST NOT silently choose either value

#### Scenario: create-time models match the default provider profile

- **WHEN** Shared Session creation resolves default Provider P for engine E
- **THEN** `initialTarget` model catalog entry id and runtime model MUST be chosen from models
  loaded for `(E, P)` under authoritative load rules
- **AND** if P is local/default, the load MUST force-refresh local settings rather than reuse a
  stale engine-wide model cache
- **AND** if P is managed, the load MUST use provider-scoped configuration for P
- **AND** `providerProfileNameSnapshot` / `providerProfileSource` MUST describe P (local →
  disk + local label; managed → managed id/name)

### Requirement: Shared Target Selection MUST Have One Complete Authority

The Shared Composer MUST expose only the complete CLI → Provider → Model → Reasoning selector.
An Engine-only selector or callback MUST NOT be reachable on a Shared Session. A selected Target
MUST be persisted successfully before it is published to the in-memory `selectedNextTarget`
store. Persistence failure MUST keep the previous Target visible and effective.

#### Scenario: CLI switch uses the complete target selector

- **WHEN** a user changes CLI in a Shared Session
- **THEN** the change MUST resolve and persist a complete Target through the four-level selector
- **AND** no Engine-only action may replace the existing Target with a partial value

#### Scenario: CLI navigation does not persist a transitional target

- **WHEN** a user navigates from Codex CLI to Claude Code before selecting a concrete Provider
  Model row
- **THEN** the Picker MUST keep that navigation state local to the open menu
- **AND** it MUST NOT invoke the persistence boundary with an Engine-only or otherwise partial
  Target
- **AND** selecting the concrete Model MUST emit exactly one complete `ResolvedExecutionTarget`

#### Scenario: selection persistence fails

- **WHEN** persisting a newly selected Target fails
- **THEN** the Composer MUST keep the previous durable Target selected
- **AND** it MUST surface a readable error
- **AND** a later send MUST NOT use the unpersisted Target

#### Scenario: parallel sessions persist targets independently

- **WHEN** Target persistence for Shared Session A is pending while the user selects a Target in
  Shared Session B
- **THEN** Session B MUST persist through its own Workspace/Thread queue without waiting for A
- **AND** a delayed failure from A MUST NOT be surfaced as Session B's selection failure

#### Scenario: legacy partial target cannot persist reasoning alone

- **WHEN** a legacy Shared Session exposes a partial Target that lacks the complete model pair or
  readable Provider snapshot
- **THEN** changing Reasoning MUST NOT enqueue Target persistence
- **AND** the user MUST first resolve a complete Target through the four-level selector

### Requirement: Shared Execution Target MUST Support Five Provider-scoped CLIs

Shared `ExecutionTarget`、Binding Key、mutable selection、frozen snapshot and owner routing MUST
support Claude Code、Codex CLI、Kimi CLI、Grok CLI and OpenCode CLI with the same Provider
provenance contract.

#### Scenario: newly supported CLI target survives reload

- **WHEN** a user selects a resolved Kimi、Grok or OpenCode Target and reloads the Shared Session
- **THEN** the complete Engine、Provider、Model and Reasoning selection MUST be restored
- **AND** no field MAY be rewritten from global Engine or Model state

#### Scenario: same CLI with two Providers owns two bindings

- **WHEN** Shared turns target two managed Providers under Kimi、Grok or OpenCode
- **THEN** the system MUST persist two distinct `engine + providerProfileId` bindings
- **AND** switching back MUST reuse the original binding

#### Scenario: local profile freezes canonical local provenance

- **WHEN** a Kimi、Grok or OpenCode local Profile is selected
- **THEN** mutable selection MUST use `providerProfileId=null + providerProfileSource=disk`
- **AND** the frozen canonical snapshot MUST use `providerProfileSource=local`

#### Scenario: local target is revalidated across Shared boundaries

- **WHEN** Kimi、Grok or OpenCode local Target is used to create a Shared Session or begin a V2 turn
- **THEN** both boundaries MUST resolve a non-empty local Model catalog for the selected CLI
- **AND** the same strict catalog pair validation MUST run before durable state changes

### Requirement: Shared Target Change MUST Survive Identity Projection Loss

系统 MUST 在 Shared Session 中乐观更新 target 并防御 history reload 导致的 target 清空或降级。

#### Scenario: optimistic update renders before persist completes

- **WHEN** 用户在 Shared Session 中通过 Atomic 选择器切换 target
- **THEN** UI 的 `selectedNextTarget` MUST 在 persist 返回之前就已更新（乐观更新）
- **AND** UI MUST NOT 在 persist 期间被强制显示为「无 target / 全局 Native 回落」

#### Scenario: stale history reload does not clear selected target

- **WHEN** `sharedHistoryLoader` 返回不完整或为 null 的 `selectedTarget`
- **AND** store 中已有完整的 `selectedNextTarget`
- **THEN** loader MUST NOT 用 null 或不完整值覆盖 store

#### Scenario: generation advanced during load skips overwrite

- **WHEN** history load 开始后、结束前，store 的 persist generation 因 hydrate 递增
- **THEN** loader MUST 跳过本次 hydrate 覆盖

### Requirement: Atomic Model Selection MUST Link Reasoning Effort To Target Model Capability

When the Atomic target picker (Shared Session or create-session) writes a complete `ExecutionTarget` for a model selection or provider-channel switch, the system MUST resolve `reasoning.effort` from the **target** engine and model capability, not from a cross-engine stale effort and not from an unrelated global `activeEngine` selection.

For Codex models that declare catalog/custom reasoning metadata, the system MUST seed a supported default when inheritance does not apply. For Claude and Grok, the system MUST keep their fixed allowlists and MAY leave effort `null` to mean engine Default when inheritance does not apply.

#### Scenario: Grok to Codex catalog model seeds model default

- **WHEN** the user changes Shared Atomic target from Grok to Codex model `gpt-5.6-sol` (or equivalent catalog entry whose `defaultReasoningEffort` is `low`)
- **THEN** the written `selectedNextTarget.reasoning.effort` MUST be `low`
- **AND** MUST NOT retain the previous Grok effort
- **AND** MUST NOT leave effort as `null` solely because the previous engine was Grok

#### Scenario: same-profile Codex model switch keeps compatible effort

- **WHEN** Shared Atomic target is already Codex on profile P with effort `high`
- **AND** the user selects another Codex model on the same profile that still supports `high`
- **THEN** the written effort MUST remain `high`

#### Scenario: same-profile Codex model switch drops unsupported effort

- **WHEN** Shared Atomic target effort is `ultra`
- **AND** the user selects a Codex model whose supported efforts do not include `ultra`
- **THEN** the written effort MUST fall back to that model’s default (or first supported effort)
- **AND** MUST NOT keep `ultra`

#### Scenario: unknown runtime Codex model stays capability-neutral

- **WHEN** the selected Codex model has no catalog/custom reasoning metadata
- **THEN** the system MUST NOT invent supported options
- **AND** effort MAY be `null`

### Requirement: Shared Atomic Reasoning Options MUST Follow Selected Next Target

While Shared Session or create-session Atomic mode is active, the composer ReasoningSelect options MUST be derived from `selectedNextTarget` / Atomic `executionTarget` engine and model capability. The options MUST NOT be taken solely from the global composer `activeEngine` fixed allowlist when that engine differs from the Atomic target engine.

#### Scenario: Codex target shows catalog options after leaving Grok

- **WHEN** Shared `selectedNextTarget.engine` is `codex` and the selected model is `gpt-5.6-sol`
- **AND** the global app-shell `activeEngine` is still `grok` or another non-codex engine
- **THEN** ReasoningSelect options MUST include the Codex model’s supported efforts (including `xhigh` / `max` / `ultra` when declared by catalog)
- **AND** MUST NOT be limited to Grok’s fixed `low` / `medium` / `high` allowlist alone

#### Scenario: Claude or Grok target keeps fixed allowlist

- **WHEN** Shared `selectedNextTarget.engine` is `claude` or `grok`
- **THEN** ReasoningSelect options MUST use that engine’s fixed allowlist
- **AND** the Default (`null`) option MAY remain available for those engines

### Requirement: Shared Codex Effort MUST Reconcile Null Or Unsupported Values

When Shared Session holds a Codex `selectedNextTarget` with a known catalog/custom model, the system MUST reconcile `reasoning.effort` that is `null` or outside the model’s supported set to the model default (or first supported effort). Reconciliation MUST apply to composer display and MUST apply again at Shared send boundary so UI and dispatch payload cannot diverge. Unknown runtime models without metadata remain capability-neutral and MUST NOT invent efforts.

#### Scenario: hydrated null effort seeds catalog default before send

- **WHEN** Shared history hydrates Codex `gpt-5.6-sol` with `reasoning` absent or `effort: null`
- **THEN** composer display MUST show the model default (`low`) rather than a sticky empty Default state
- **AND** the Shared send payload effort MUST also be `low` after reconciliation

#### Scenario: unsupported effort is clamped on model capability

- **WHEN** Shared Codex target effort is `ultra` but the selected model does not support `ultra`
- **THEN** display and send MUST use that model’s default or first supported effort
- **AND** MUST NOT dispatch `ultra`

### Requirement: Shared Session Initialization MUST NOT Borrow Native Composer Reasoning State

Creating or activating a Shared Session MUST derive reasoning options and effort from the Shared `selectedNextTarget` (or the create-session Atomic target), not from the global Native composer `activeEngine` / `selectedEffort` / model reasoning catalog. After a user has used Native Codex, initializing Shared Grok MUST show only Grok’s fixed allowlist and Default; it MUST NOT show Codex-only tiers such as `xhigh` / `max` / `ultra`, and MUST NOT preselect a leftover Native Codex effort.

#### Scenario: Native Codex then Shared Grok init

- **WHEN** the global Native composer last used Codex with a non-null effort and full model reasoning options
- **AND** the user creates a Shared Session with initial engine Grok and a local default model
- **THEN** the composer ReasoningSelect options MUST be limited to Grok’s fixed `low` / `medium` / `high` (plus Default)
- **AND** MUST NOT include `xhigh` / `max` / `ultra`
- **AND** the selected effort MUST NOT inherit the previous Native Codex effort solely because `activeEngine` is still Codex

#### Scenario: Shared without hydrated target fail-closed for reasoning UI

- **WHEN** the active conversation is Shared but `selectedNextTarget` is not yet available
- **THEN** the composer MUST NOT fall back to Native/global reasoning options or effort
- **AND** MAY show an empty option set and null effort until the Shared target hydrates

### Requirement: Atomic Closed Trigger MUST Prefer Execution Target Snapshot For Selection Display

When the composer Atomic target picker is active (`targetGroups` / Shared or create-session Atomic mode), the closed-state model trigger MUST treat `executionTarget` model identity as the selection-display authority. Provider-scoped model catalog rows MAY enrich the label when a matching row is loaded, but catalog miss MUST NOT collapse a present `executionTarget` model identity into the empty “select model” placeholder.

#### Scenario: complete shared target shows model before catalog load

- **WHEN** a Shared Session has a complete `selectedNextTarget` with engine, model identity, and local/managed provider snapshot
- **AND** the Atomic model catalog for that engine+profile has not been loaded yet (user has not opened the menu)
- **THEN** the closed model trigger MUST display a non-empty model label derived from `executionTarget.modelCatalogEntryId` and/or `executionTarget.model`
- **AND** MUST NOT show only the empty select-model placeholder

#### Scenario: wrong parent models do not hide shared selection

- **WHEN** Atomic mode is active with a complete `executionTarget` for engine Grok
- **AND** the parent composer `models` prop still contains only another engine’s catalog (non-empty)
- **THEN** the closed trigger MUST still display the Grok `executionTarget` model identity
- **AND** MUST NOT require a catalog hit in the foreign parent models list

#### Scenario: catalog hit still preferred when available

- **WHEN** Atomic mode has a complete `executionTarget` and the matching provider-scoped catalog row is loaded
- **THEN** the closed trigger MAY use the catalog row’s display label / provider-scoped runtime name
- **AND** the selected identity MUST remain the same `executionTarget` model entry

### Requirement: Shared Composer MUST NOT Borrow Global Model Selection For Atomic Selected State

While the active conversation is a Shared Session, the Atomic picker selected-state props MUST NOT fall back to the global/Native composer `selectedModelId` when `selectedNextTarget` is absent or incomplete. Empty next-target MUST render as unselected in the picker and MUST remain fail-closed for V2 send.

#### Scenario: null next target stays unselected

- **WHEN** the active thread is Shared and `selectedNextTarget` is null or not a resolved execution target
- **AND** the global composer still holds a non-null Native/global `selectedModelId`
- **THEN** the Atomic closed trigger MUST show the unselected state
- **AND** the Shared send path MUST continue to reject incomplete targets (existing V2 contract)

#### Scenario: complete next target ignores global selectedModelId

- **WHEN** Shared `selectedNextTarget` is complete with model M
- **AND** global `selectedModelId` is a different model N
- **THEN** the Atomic closed trigger and selection identity MUST follow M
- **AND** MUST NOT display N as the Shared selection

### Requirement: Shared Complete Next Target MUST Eagerly Ensure Provider Catalog As Enrichment

When Shared Session holds a complete `selectedNextTarget`, the composer MUST request the provider-scoped model catalog for that target’s engine and provider profile (mapping local/default to the engine’s local profile sentinel). Catalog load failure MUST NOT clear `selectedNextTarget` or revert the closed trigger to empty placeholder solely due to load failure.

#### Scenario: ensure models after shared target hydrate

- **WHEN** Shared history or create hydrates a complete `selectedNextTarget`
- **THEN** the system MUST invoke catalog ensure for that engine+profile without requiring the user to open the model menu first
- **AND** a later successful catalog load MAY upgrade the display label without changing the selected identity

#### Scenario: ensure failure does not wipe target

- **WHEN** catalog ensure for the current Shared next target fails or returns empty
- **THEN** `selectedNextTarget` MUST remain unchanged
- **AND** the closed trigger MUST continue to display snapshot-based model identity when present

### Requirement: Shared Session Open MUST Not Re-Seed Create Defaults

Hydrating or activating an existing Shared Session MUST publish the durable next target as the
Composer authority. The create-time “first provider + default model” algorithm MUST run only on
new session creation, never as a silent reseed on open.

#### Scenario: activate existing session keeps durable next target

- **WHEN** a Shared Session already stores a complete `selectedTarget`
- **AND** the client activates that session
- **THEN** `selectedNextTarget` MUST equal that durable target
- **AND** the system MUST NOT replace it with a newly computed first-provider default

#### Scenario: create and open remain separate authorities

- **WHEN** session A is newly created with first-provider default D
- **AND** session B was previously used with target T ≠ D
- **THEN** activating B MUST show T
- **AND** activating A MUST show D until the user changes the picker

