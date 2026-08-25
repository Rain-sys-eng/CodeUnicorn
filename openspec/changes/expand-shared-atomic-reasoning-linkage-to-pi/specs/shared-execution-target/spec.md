## MODIFIED Requirements

### Requirement: Atomic Model Selection MUST Link Reasoning Effort To Target Model Capability

When the Atomic target picker (Shared Session or create-session) writes a complete `ExecutionTarget` for a model selection or provider-channel switch, the system MUST resolve `reasoning.effort` from the **target** engine and model capability, not from a cross-engine stale effort and not from an unrelated global `activeEngine` selection.

For Codex models that declare catalog/custom reasoning metadata, the system MUST seed a supported default when inheritance does not apply. For Claude and Grok, the system MUST keep their fixed allowlists and MAY leave effort `null` to mean engine Default when inheritance does not apply. For PI, the system MUST resolve `reasoning.effort` from the target PI model's catalog allowlist (mirroring the native `modelSelection.ts: getReasoningOptionsForModel` rule against `supported_thinking_levels_for_pi_model` projection), seed the model's `defaultReasoningEffort` when inheritance does not apply, and MUST NOT retain a Codex / Claude / Grok effort that is outside the PI model's allowlist.

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
- **THEN** the written effort MUST fall back to that model's default (or first supported effort)
- **AND** MUST NOT keep `ultra`

#### Scenario: unknown runtime Codex model stays capability-neutral

- **WHEN** the selected Codex model has no catalog/custom reasoning metadata
- **THEN** the system MUST NOT invent supported options
- **AND** effort MAY be `null`

#### Scenario: cross-engine to PI model seeds PI model default

- **WHEN** the user changes Shared Atomic target from Codex (effort `high`) or Grok (effort `medium`) or any non-PI engine to a PI target whose selected model has `supportedReasoningEfforts` and `defaultReasoningEffort = "low"`
- **THEN** the written `selectedNextTarget.reasoning.effort` MUST be `"low"`
- **AND** MUST NOT retain the previous engine's effort
- **AND** MUST NOT leave effort as `null` solely because the previous engine was non-PI

#### Scenario: same-profile PI model switch keeps effort that is still in the PI allowlist

- **WHEN** Shared Atomic target is already PI on profile P with effort `high`
- **AND** the user selects another PI model on the same profile that still supports `high` (e.g. a non-`thinkingLevelMap`-holes row)
- **THEN** the written effort MUST remain `high`

#### Scenario: same-profile PI model switch drops effort outside the new model's allowlist

- **WHEN** Shared Atomic target is PI with effort `xhigh`
- **AND** the user selects a PI model whose `supportedReasoningEfforts` do not include `xhigh` (e.g. a `--list-models` fallback row that only lists `off / minimal / low / medium / high`)
- **THEN** the written effort MUST fall back to that PI model's `defaultReasoningEffort` (or first supported effort)
- **AND** MUST NOT keep `xhigh`

#### Scenario: PI runtime-only model without catalog metadata stays capability-neutral

- **WHEN** the selected PI model has no catalog `supportedReasoningEfforts` and no `defaultReasoningEffort`
- **THEN** the system MUST NOT invent supported options
- **AND** effort MAY be `null`
- **AND** Shared send boundary MUST NOT dispatch a non-null effort for that turn

### Requirement: Shared Atomic Reasoning Options MUST Follow Selected Next Target

While Shared Session or create-session Atomic mode is active, the composer ReasoningSelect options MUST be derived from `selectedNextTarget` / Atomic `executionTarget` engine and model capability. The options MUST NOT be taken solely from the global composer `activeEngine` fixed allowlist when that engine differs from the Atomic target engine.

For PI, the system MUST derive ReasoningSelect options from the target PI model's catalog `supportedReasoningEfforts`, NOT from a fixed static list, and MUST render the ReasoningSelect whenever the target model's allowlist is non-empty.

#### Scenario: Codex target shows catalog options after leaving Grok

- **WHEN** Shared `selectedNextTarget.engine` is `codex` and the selected model is `gpt-5.6-sol`
- **AND** the global app-shell `activeEngine` is still `grok` or another non-codex engine
- **THEN** ReasoningSelect options MUST include the Codex model's supported efforts (including `xhigh` / `max` / `ultra` when declared by catalog)
- **AND** MUST NOT be limited to Grok's fixed `low` / `medium` / `high` allowlist alone

#### Scenario: Claude or Grok target keeps fixed allowlist

- **WHEN** Shared `selectedNextTarget.engine` is `claude` or `grok`
- **THEN** ReasoningSelect options MUST use that engine's fixed allowlist
- **AND** the Default (`null`) option MAY remain available for those engines

#### Scenario: PI target shows catalog allowlist after leaving Codex

- **WHEN** Shared `selectedNextTarget.engine` is `pi` and the selected model has catalog `supportedReasoningEfforts` (e.g. `[low, medium, high]` or `[high, max]` from `thinkingLevelMap` holes)
- **AND** the global app-shell `activeEngine` is still `codex` or another non-pi engine
- **THEN** ReasoningSelect options MUST equal exactly the target PI model's `supportedReasoningEfforts`
- **AND** MUST NOT be limited to a static seven-level list that includes efforts the model does not support
- **AND** the Default (`null`) option MUST be available (mirroring native PI composer semantics)

#### Scenario: PI model with no supportedReasoningEfforts hides ReasoningSelect

- **WHEN** Shared `selectedNextTarget.engine` is `pi` and the selected model's catalog `supportedReasoningEfforts` is empty (e.g. a non-reasoning PI model or `--list-models` `thinking=no` row)
- **THEN** the composer MUST NOT render a ReasoningSelect for that target
- **AND** Shared send boundary MUST NOT dispatch a non-null `effort` for that turn

### Requirement: Shared Codex Effort MUST Reconcile Null Or Unsupported Values

When Shared Session holds a Codex `selectedNextTarget` with a known catalog/custom model, the system MUST reconcile `reasoning.effort` that is `null` or outside the model's supported set to the model default (or first supported effort). Reconciliation MUST apply to composer display and MUST apply again at Shared send boundary so UI and dispatch payload cannot diverge. Unknown runtime models without metadata remain capability-neutral and MUST NOT invent efforts.

The same reconciliation rule MUST apply to PI `selectedNextTarget`: when Shared Session holds a PI target whose model has a non-empty `supportedReasoningEfforts`, the system MUST reconcile `reasoning.effort` that is `null` or outside the PI model's allowlist to the PI model's `defaultReasoningEffort` (or first supported effort). Reconciliation MUST apply to composer display and MUST apply again at Shared send boundary so UI and dispatch payload cannot diverge. PI runtime-only models without catalog metadata remain capability-neutral and MUST NOT invent efforts.

#### Scenario: hydrated null effort seeds catalog default before send

- **WHEN** Shared history hydrates Codex `gpt-5.6-sol` with `reasoning` absent or `effort: null`
- **THEN** composer display MUST show the model default (`low`) rather than a sticky empty Default state
- **AND** the Shared send payload effort MUST also be `low` after reconciliation

#### Scenario: unsupported effort is clamped on model capability

- **WHEN** Shared Codex target effort is `ultra` but the selected model does not support `ultra`
- **THEN** display and send MUST use that model's default or first supported effort
- **AND** MUST NOT dispatch `ultra`

#### Scenario: hydrated PI null effort seeds catalog default before send

- **WHEN** Shared history hydrates a PI target with `reasoning` absent or `effort: null` and the selected PI model has `supportedReasoningEfforts` and `defaultReasoningEffort = "low"`
- **THEN** composer display MUST show `low` rather than a sticky empty Default state
- **AND** the Shared send payload effort MUST also be `low` after reconciliation

#### Scenario: PI effort outside allowlist is clamped on model capability

- **WHEN** Shared PI target effort is `xhigh` but the selected PI model's `supportedReasoningEfforts` does not include `xhigh`
- **THEN** display and send MUST use that PI model's `defaultReasoningEffort` or first supported effort
- **AND** MUST NOT dispatch `xhigh`

#### Scenario: PI effort compatible with model allowlist is preserved

- **WHEN** Shared PI target effort is `high` and the selected PI model's `supportedReasoningEfforts` contains `high`
- **THEN** display MUST remain `high`
- **AND** the Shared send payload effort MUST also be `high`

#### Scenario: PI runtime-only model with null effort stays capability-neutral

- **WHEN** the selected PI model has no catalog `supportedReasoningEfforts` and no `defaultReasoningEffort`
- **THEN** composer display MUST NOT show a non-null effort
- **AND** Shared send boundary MUST NOT dispatch a non-null `effort` for that turn
- **AND** the system MUST NOT invent effort values
