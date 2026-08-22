## ADDED Requirements

### Requirement: Shared Provider Failures MUST Retry On The Same Target

Shared V2 MUST treat a committed vendor-pool / timeout / rate-limit / overload failure as a finished attempt, then MAY start a new attempt on the same CLI / Provider / Model with the configured resume prompt.

#### Scenario: pool 403 starts a countdown then resends

- **GIVEN** a Shared session whose last attempt committed failed with `API Key is not assigned to any group`
- **AND** retry is enabled with `maxAttempts >= 1`
- **WHEN** the send path unlocks the composer
- **THEN** the canvas MUST show a one-line wait hint
- **AND** after the first delay the client MUST send the resume prompt as a new user message on the same target
- **AND** the client MUST NOT replay the previous user text or images

#### Scenario: vendor 401 invalid key is treated as pool rotation

- **GIVEN** a Shared session whose last attempt committed failed with `unexpected status 401 Unauthorized` and `INVALID_API_KEY`
- **AND** retry is enabled with `maxAttempts >= 1`
- **WHEN** the send path unlocks the composer
- **THEN** the classifier MUST treat it as retryable pool failure
- **AND** the canvas MUST start the same wait-then-resend series as a pool 403

#### Scenario: silent CLI process exit is treated as a temporary interrupt

- **GIVEN** a Shared session whose last attempt committed failed with `Claude exited with status: exit code: 1` and `No stdout/stderr diagnostics were observed`
- **AND** retry is enabled with `maxAttempts >= 1`
- **AND** the current attempt was not interrupted by the local stop control
- **WHEN** the send path unlocks the composer
- **THEN** the classifier MUST treat it as retryable `soft-cancel`
- **AND** the canvas MUST start the same wait-then-resend series as other vendor-temporary failures
- **AND** SIGINT / SIGTERM style exits (`130` / `137` / `143`) MUST stay fail-closed

#### Scenario: user stop does not auto-resend

- **GIVEN** the current attempt was interrupted by the local stop control
- **WHEN** the failed or cancelled terminal arrives
- **THEN** the client MUST NOT start an automatic retry series

#### Scenario: recovery-required stays on the recovery bar

- **GIVEN** Shared send state is `recovery-required` or `target-unavailable`
- **WHEN** a vendor-looking error text is also present
- **THEN** the provider-retry overlay MUST NOT start
- **AND** the existing Shared recovery bar remains the only control

### Requirement: Retry Settings MUST Be Per Shared Session CLI And Memory-Only

Each Shared session CLI MUST have its own in-memory retry settings, copied from compiled defaults on first use. Refreshing the process MUST restore defaults.

#### Scenario: Claude and Codex settings do not overwrite each other

- **GIVEN** the current Shared session is on Claude with `maxAttempts = 5`
- **WHEN** the user switches the same session to Codex
- **THEN** Codex MUST start from the compiled default
- **AND** switching back to Claude MUST restore `maxAttempts = 5` for that session

#### Scenario: another session does not inherit overrides

- **GIVEN** session A changed Codex `resumePrompt`
- **WHEN** the user opens session B on Codex
- **THEN** session B MUST use the compiled default prompt

### Requirement: Retry Status MUST Stay On The Canvas

Retry wait / sending / exhausted copy MUST render in the conversation canvas, not in the composer status bar. Canvas hint buttons MUST be compact text actions on one row.

#### Scenario: wait hint sits under the failed turn

- **WHEN** a retryable failure enters `wait`
- **THEN** the hint MUST appear in the messages scroll area
- **AND** the composer input chrome MUST NOT grow a retry status bar
- **AND** the actions MUST be inline text buttons `立即` and `停止`

### Requirement: Composer Retry Settings MUST Sit Beside Collaboration

Shared composer MUST expose a retry pill to the right of the collaboration pill. The popover edits the current session CLI settings only.

#### Scenario: Shared footer shows the retry pill

- **GIVEN** the active thread is a resolved Shared session
- **WHEN** the composer footer renders
- **THEN** a retry pill MUST appear beside collaboration
- **AND** opening it MUST edit only that session's current CLI settings
