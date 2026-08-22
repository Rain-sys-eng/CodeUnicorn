## ADDED Requirements

### Requirement: Qoder requested execution configuration MUST fail closed

When a Native Qoder turn specifies a model or reasoning effort, mossx MUST receive a successful ACP response for each requested setting before it sends `session/prompt`.

#### Scenario: invalid model rejects before prompt

- **WHEN** `session/set_model` returns an ACP error for a requested Qoder model
- **THEN** mossx MUST emit a contextual turn error
- **AND** MUST NOT send `session/prompt` for that turn

#### Scenario: invalid reasoning effort rejects before prompt

- **WHEN** `session/set_config_option` for `reasoning_effort` returns an ACP error
- **THEN** mossx MUST emit a contextual turn error
- **AND** MUST NOT silently continue with the previous or default effort

### Requirement: Qoder cancel MUST preserve authoritative terminal evidence

For an active Native Qoder turn, `session/cancel` MUST be sent before process cleanup. The ACP prompt response is the authoritative terminal evidence; process kill is only a bounded fallback.

#### Scenario: typed cancelled response settles the turn

- **WHEN** Qoder responds to the active prompt with `stopReason: "cancelled"` after cancellation is requested
- **THEN** mossx MUST emit one typed cancelled terminal result
- **AND** MUST NOT replace it with a generic `Session stopped.` error

#### Scenario: cancel response is absent beyond the bounded fallback

- **WHEN** cancellation is requested and the same turn remains active beyond the cancellation grace period
- **THEN** mossx MAY kill that child process
- **AND** MUST settle the exact requested turn once as cancelled

### Requirement: Qoder runtime configuration discovery MUST share the configured home root

Qoder runtime, on-demand model discovery and status probes that receive `EngineConfig` MUST use the same resolved `home_dir` / config root.

#### Scenario: custom home exposes matching models

- **WHEN** a Qoder engine configuration supplies a custom `home_dir`
- **THEN** the runtime and model catalog probe MUST launch Qoder with that root
- **AND** MUST NOT silently use models from the default Qoder home

### Requirement: Qoder prompt usage and fork MUST be product-visible Native semantics

Mossx MUST project vendor-verified Qoder prompt usage and route Native fork requests through ACP.

#### Scenario: prompt usage reaches the unified usage channel

- **WHEN** a successful Qoder prompt result includes `usage.inputTokens` or `usage.outputTokens`
- **THEN** mossx MUST emit `EngineEvent::UsageUpdate` with the available values before turn settlement

#### Scenario: a Qoder native fork creates the child session

- **WHEN** the Native send route supplies a Qoder `fork_session_id`
- **THEN** mossx MUST call ACP `session/fork` using that source id
- **AND** MUST use the returned child `sessionId` for configuration and prompt
- **AND** MUST promote the visible thread through the existing `SessionStarted` path

### Requirement: Qoder disk history MUST degrade to ACP only when local facts are unusable

Qoder history listing MUST use readable matching JSONL facts as its fast primary path and ACP as fallback when local discovery is unavailable or unusable. A readable matching directory with no session files remains a valid soft-empty result.

#### Scenario: unreadable local project source falls back to ACP

- **WHEN** a matching Qoder project directory or its session artifacts cannot be read or summarized
- **THEN** mossx MUST call ACP session listing instead of returning an authoritative empty list

#### Scenario: readable empty local project remains fast soft-empty

- **WHEN** the matching local Qoder project directory is readable and contains no session artifacts
- **THEN** mossx MUST return an empty local result without spawning ACP
