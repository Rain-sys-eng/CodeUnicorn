# qoder-dual-distribution Specification

## Purpose
Qoder Global（`qodercli`）与 Qoder CN（`qoderclicn`）双 distribution 在同一 `qoder` engine 下的隔离与凭据注入契约：binary、config directory、PAT 环境变量、模型目录、history source 各自独立，spawn 子进程时 PAT 注入优先级与认证状态可见性一致。
## Requirements
### Requirement: Qoder PAT spawn precedence SHALL be stored-over-env and visibly consistent

A PAT stored in the mossx auth file MUST win over the same-named variable inherited from the mossx process environment when the system injects a PAT into a spawned Qoder child process (`QODER_PERSONAL_ACCESS_TOKEN` / `QODERCN_PERSONAL_ACCESS_TOKEN`, stored in `~/.ccgui/qoder-auth.json` / `qoder-cn-auth.json`). Only when no PAT is stored for the selected distribution MAY the child inherit the process environment value. The auth status surface MUST make the coexistence of a stored PAT and a process environment variable visible, and the effective credential shown in UI MUST match the credential actually injected on spawn.

#### Scenario: stored PAT overrides inherited process env

- **WHEN** a PAT is stored for the selected distribution and the mossx process
  environment also contains that distribution's PAT variable
- **THEN** every spawned child MUST receive the stored PAT via an explicit
  environment set that overrides the inherited value
- **AND** the auth status MUST report state `configured` with
  `envPresent: true`
- **AND** the settings UI MUST indicate that the environment variable is
  ignored in favor of the stored PAT

#### Scenario: process env used only when nothing is stored

- **WHEN** no PAT is stored for the selected distribution and the mossx process
  environment contains that distribution's PAT variable
- **THEN** the child MUST inherit the process environment value unchanged
- **AND** the auth status MUST report state `env`

#### Scenario: precedence is distribution-scoped

- **WHEN** the user stores a PAT for Qoder CN while the process environment
  contains only `QODER_PERSONAL_ACCESS_TOKEN` (Global)
- **THEN** CN spawns MUST receive the stored CN PAT
- **AND** the Global variable MUST remain removed from CN children
- **AND** Global spawns MUST remain unaffected by the CN stored PAT

### Requirement: Qoder SHALL expose two isolated distributions under one engine

The system SHALL retain one `qoder` engine identity and SHALL expose exactly two
selectable Qoder distributions: Global and CN. Each distribution MUST resolve its
own binary, configuration directory, PAT environment name, model catalog scope,
runtime owner, and history source. The system MUST NOT register `qoderclicn` as a
separate top-level engine.

#### Scenario: Global and CN resolve independently

- **WHEN** a caller resolves the Global and CN Qoder launch descriptors
- **THEN** Global MUST use the `qodercli` / `QODER_CONFIG_DIR` /
  `QODER_PERSONAL_ACCESS_TOKEN` contract
- **AND** CN MUST use the `qoderclicn` / `QODERCN_CONFIG_DIR` /
  `QODERCN_PERSONAL_ACCESS_TOKEN` contract
- **AND** their runtime and catalog keys MUST differ

#### Scenario: legacy Qoder binding stays Global

- **WHEN** an existing Qoder thread has no distribution binding or uses
  `__local_qoder__`
- **THEN** the system MUST resolve it as Global
- **AND** the system MUST NOT rewrite or delete its existing session data merely
  to migrate it

### Requirement: Qoder distribution launch SHALL be a single source of runtime truth

The system SHALL resolve one distribution launch descriptor before status detection,
doctor, ACP model discovery, Native send, fork, interrupt or history fallback.
Those operations MUST use that same descriptor. The descriptor MUST apply the
distribution's config directory and PAT environment to every spawned child process.

#### Scenario: CN model discovery follows CN launch configuration

- **WHEN** the caller requests models for the CN Qoder profile
- **THEN** the ACP probe MUST spawn `qoderclicn --acp` with CN config/auth
  environment
- **AND** it MUST NOT read or spawn the Global Qoder binary as a fallback

#### Scenario: distribution failure is diagnostic

- **WHEN** one Qoder distribution is not installed, not authenticated, or returns
  no ACP models
- **THEN** its status MUST identify that distribution and its remediation command
- **AND** the other distribution's status and catalog MUST remain usable

### Requirement: Qoder UI SHALL use one parent entry and dual configuration tabs

The New Session menu SHALL present one Qoder CLI parent entry with Global and CN
children. The Vendor Settings area SHALL present one Qoder page with Global and CN
tabs and exactly one independently operable visible configuration panel. Global SHALL
be selected by default; a Qoder CN settings deep link SHALL select the CN tab.
Selecting a child MUST create a Qoder thread bound to that distribution without
creating a second top-level CLI engine.

#### Scenario: user creates a CN Qoder session

- **WHEN** the user chooses New Session → Qoder CLI → CN
- **THEN** the create action MUST carry the CN distribution binding
- **AND** the new thread MUST preserve that binding for future sends
- **AND** no Global settings switch is required before creation

#### Scenario: configuration tabs are independent

- **WHEN** the user edits a CN binary/path/PAT or launches CN login
- **THEN** only the CN configuration and command MUST change
- **AND** the Global binary/path/PAT and login state MUST remain unchanged

#### Scenario: switching configuration tabs only changes presentation

- **WHEN** the user switches the Qoder Vendor Settings page from Global to CN
- **THEN** the CN configuration panel MUST become visible without rendering Global
  controls in parallel
- **AND** the switch MUST NOT refresh an ACP catalog or change any existing thread
  binding

### Requirement: Qoder model selection SHALL be distribution-scoped

The model picker MUST first resolve the Qoder distribution binding and then render
only the ACP catalog for that distribution. A selected runtime model MUST be sent to
the same distribution's ACP session via the existing `session/set_model` path.

#### Scenario: Global and CN models do not leak

- **WHEN** Global and CN have different ACP model catalogs
- **THEN** selecting CN MUST display only CN rows and metadata
- **AND** a CN catalog error or empty result MUST NOT display Global rows

#### Scenario: historical session preserves selected distribution

- **WHEN** the user opens an existing Qoder CN thread after changing current
  Qoder Settings
- **THEN** its model picker and send path MUST continue to use the thread's CN
  binding
- **AND** they MUST NOT use the currently selected Global configuration

### Requirement: Qoder distribution history SHALL remain isolated

Qoder history list/load/fallback operations MUST resolve one distribution at a time.
The system MUST only read that distribution's configured root or call that
distribution's ACP endpoint; it MUST NOT scan or merge the other distribution as a
fallback.

#### Scenario: CN history source is unavailable

- **WHEN** the configured CN history root has no usable local artifact
- **THEN** the system MAY use CN ACP list/load as the fallback
- **AND** it MUST NOT import Global sessions into the CN result

