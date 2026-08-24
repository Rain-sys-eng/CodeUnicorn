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

