## ADDED Requirements

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
