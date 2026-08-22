## MODIFIED Requirements

### Requirement: OpenCode CLI Doctor

The settings CLI validation surface SHALL provide an `opencode_doctor` command that verifies
binary reachability, version, default-model usability, and OpenCode native-artifact containment
status. The containment status MUST distinguish active platform policy from embedded Bun runtime
provenance and MUST NOT infer Bun safety solely from an OpenCode version string.

#### Scenario: doctor on a healthy install

- **WHEN** the user runs OpenCode doctor with a reachable binary
- **THEN** the report SHALL pass binary and version checks
- **AND** the report SHALL include a structured native-artifact containment status

#### Scenario: doctor detects broken default model

- **WHEN** the configured default model is not usable by the CLI (e.g. `Model not found`)
- **THEN** the report SHALL surface a dedicated check failure advising explicit model selection or config repair

#### Scenario: doctor cannot verify embedded Bun provenance

- **WHEN** the doctor cannot independently map the resolved OpenCode binary to a Bun runtime version
- **THEN** the report SHALL mark runtime provenance as `unverified`
- **AND** the report SHALL recommend upgrading the external `opencode-ai` runtime
- **AND** the report SHALL not label the binary safe only because `opencode --version` succeeded
