## ADDED Requirements

### Requirement: Qoder CLI detection and doctor

mossx SHALL detect `qodercli` on PATH, at the vendor install location
(`$QODER_HOME/bin/qodercli` or `~/.qoder/bin/qodercli`), or at a
user-configured custom path, report version and login state, and provide a
`qoder_doctor` diagnostic. Detection SHALL distinguish not-installed from
not-authenticated. Detection SHALL NOT require the current process PATH to
already include the vendor directory.

#### Scenario: Binary present and logged in

- **WHEN** `qodercli --version` succeeds and `qodercli status -o json` reports `logged_in: true`
- **THEN** the engine status SHALL be installed with version and models

#### Scenario: Windows vendor install without process PATH

- **WHEN** `qodercli.exe` exists at `%USERPROFILE%\.qoder\bin\qodercli\qodercli.exe`
- **AND** the current process PATH does not include that directory
- **THEN** detection SHALL still report the engine as installed
- **AND** the IDE dispatcher `%USERPROFILE%\.qoder\entry\qoder.cmd` SHALL NOT be treated as `qodercli`

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
