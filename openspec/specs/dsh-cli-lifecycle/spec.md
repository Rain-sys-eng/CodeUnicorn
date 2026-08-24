# dsh-cli-lifecycle Specification

## Purpose
TBD - created by archiving change add-dsh-engine. Update Purpose after archive.
## Requirements
### Requirement: DSH CLI can be installed and diagnosed

`CliInstallEngine` SHALL include `Dsh` with npm package `@deepseek-ai/dsh@latest`
and binary name `dsh`. Doctor SHALL check Node version, `dsh --version`, and
optional `host.describe`.

DSH install/update SHALL use a hardened npm global command on every platform
(Windows / macOS / Linux), not a bare `npm install -g @deepseek-ai/dsh@latest`.

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

#### Scenario: One-click install serializes npm extract

- **WHEN** the user confirms DSH installLatest or updateLatest
- **THEN** command preview and the executed command SHALL both be
  `npm install -g --maxsockets=1 --fetch-retries=5 --no-audit --no-fund @deepseek-ai/dsh@latest`
- **AND** the installer timeout SHALL be longer than the default npm-engine timeout
- **AND** Codex / Kimi / OpenCode / Pi install commands SHALL stay on their existing npm args

#### Scenario: Leftover global tree is cleaned before retry

- **WHEN** `{npm prefix}/node_modules/@deepseek-ai/dsh` or
  `{npm prefix}/lib/node_modules/@deepseek-ai/dsh` exists without `package.json`
- **THEN** the installer SHALL remove that leftover directory before the first attempt
- **AND** SHALL NOT delete `$DSH_HOME`

#### Scenario: Extract-race failure is retried once

- **WHEN** the first DSH npm install exits with `-4058` / `4058`, or stderr
  contains `Cannot cd into` / `seems to be corrupted` / (`ENOENT` and `tar`)
- **THEN** the installer SHALL remove the leftover global package directory
- **AND** SHALL run the same hardened npm command once more
- **AND** if that retry still fails, details SHALL name the concurrent extract race
  and include the hardened manual command

