## ADDED Requirements

### Requirement: DSH CLI can be installed and diagnosed

`CliInstallEngine` SHALL include `Dsh` with npm package `@deepseek-ai/dsh@latest`
and binary name `dsh`. Doctor SHALL check Node version, `dsh --version`, and
optional `host.describe`.

#### Scenario: CLI missing

- **WHEN** no `dsh` binary is on PATH or `dshBin`
- **THEN** engine status SHALL be not-installed
- **AND** the installer SHALL offer the npm global package
- **AND** other engines SHALL keep working

#### Scenario: CLI present but host down

- **WHEN** `dsh --version` succeeds and `host.describe` fails
- **THEN** status SHALL NOT report the CLI as missing
- **AND** auto-start MAY spawn `dsh web`
- **AND** an empty model list SHALL be explained as host/catalog, not missing binary

#### Scenario: Node too old

- **WHEN** `node --version` is outside `^22.19.0 || >=24.0.0`
- **THEN** doctor SHALL emit a readable Node version error
- **AND** SHALL NOT treat that as a generic unknown spawn failure
