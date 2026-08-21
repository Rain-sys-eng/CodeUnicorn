## ADDED Requirements

### Requirement: Qoder CLI detection and doctor

mossx SHALL detect `qodercli` on PATH or at a user-configured custom path,
report version and login state, and provide a `qoder_doctor` diagnostic.
Detection SHALL distinguish not-installed from not-authenticated.

#### Scenario: Binary present and logged in

- **WHEN** `qodercli --version` succeeds and `qodercli status -o json` reports `logged_in: true`
- **THEN** the engine status SHALL be installed with version and models

#### Scenario: Binary present but not logged in

- **WHEN** the binary works but `logged_in` is false
- **THEN** the status SHALL carry a not-authenticated diagnostic pointing at `qodercli login`
- **AND** the model catalog SHALL be empty

#### Scenario: Custom CLI path

- **WHEN** the user configures a custom Qoder CLI path
- **THEN** detection and spawn SHALL use that path
- **AND** the IDE launcher `qoder` SHALL NOT be accepted as `qodercli`

### Requirement: Qoder CLI install and upgrade plan

The CLI install planner SHALL accept engine `qoder` and produce an install
or upgrade plan using the official Qoder distribution channel.

#### Scenario: Install plan for Qoder

- **WHEN** the user requests an install plan for `qoder`
- **THEN** the plan SHALL reference the official install channel
- **AND** SHALL include a post-install doctor step
