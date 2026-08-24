# claude-code-access-modes Specification

## Purpose

Defines the claude-code-access-modes behavior contract, covering Claude Code Mode Availability MUST Follow Progressive Rollout Rules.
## Requirements
### Requirement: Claude Code Mode Availability MUST Follow Progressive Rollout Rules

The system MUST expose Claude Code modes according to an explicit phased rollout policy rather than enabling all defined modes at once.

#### Scenario: current rollout exposes default plan and full access
- **WHEN** the active provider is `Claude Code`
- **THEN** UI MUST allow selecting `default`, `plan`, and `bypassPermissions`
- **AND** UI MUST continue keeping `acceptEdits` unavailable until its semantics are verified

#### Scenario: later phases may expand availability without changing mode ids
- **WHEN** rollout advances beyond the current phase
- **THEN** the system MAY enable additional existing Claude modes
- **AND** it MUST continue using the existing `default / plan / acceptEdits / bypassPermissions` mode ids

### Requirement: Claude Mode Selection MUST Be Runtime-Effective

For Claude Code sessions, selected mode MUST remain a real runtime input and MUST NOT be silently overridden by product-layer defaults.

#### Scenario: selected plan mode reaches backend send payload
- **WHEN** user selects Claude `plan` mode and sends a message
- **THEN** frontend MUST send backend access mode `read-only`
- **AND** runtime MUST NOT overwrite that selection to `full-access`

#### Scenario: selected default mode reaches backend send payload
- **WHEN** user selects Claude `default` mode and sends a message
- **THEN** frontend MUST send backend access mode `default`
- **AND** runtime MUST preserve that selection unchanged

#### Scenario: selected full access reaches backend send payload
- **WHEN** user selects Claude `bypassPermissions` mode and sends a message
- **THEN** frontend MUST send backend access mode `full-access`
- **AND** runtime MUST preserve that selection unchanged

### Requirement: Claude CLI Flag Mapping MUST Stay Deterministic Per Mode

Claude runtime MUST map each enabled access mode to a deterministic Claude CLI permission flag set.

#### Scenario: plan mode maps to claude read-only execution
- **WHEN** Claude runtime receives access mode `read-only`
- **THEN** it MUST launch Claude CLI with `--permission-mode plan`

#### Scenario: default mode maps to claude guarded execution
- **WHEN** Claude runtime receives access mode `default`
- **THEN** it MUST launch Claude CLI with `--permission-mode default`

#### Scenario: full access maps to skip-permissions execution
- **WHEN** Claude runtime receives access mode `full-access`
- **THEN** it MUST launch Claude CLI with `--dangerously-skip-permissions`

#### Scenario: accept edits remains gated until enabled
- **WHEN** Claude rollout phase does not yet allow `current`
- **THEN** user MUST NOT be able to enter `acceptEdits` through normal mode selection
- **AND** runtime contract tests MUST still preserve its mapping definition for future phases

### Requirement: Claude Default Mode MUST Use The Existing Approval Workflow For Supported File Changes

Claude `default` mode MUST NOT degrade into silent permission failure for supported file-change tools. For paths **inside** the current L1 allowlist, blocked supported file tools MUST continue to use the existing synthetic file approval workflow. For paths **outside** L1, the system MUST use DirectoryGrant recovery first (see session-directory-grant) rather than pretending a file write approval can expand the session root.

#### Scenario: claude default emits synthetic approval request for supported file tool
- **WHEN** Claude `default` mode hits a supported blocked file tool such as `Write`, `CreateFile`, or `CreateDirectory`
- **AND** the target path is inside the current L1 allowlist
- **THEN** runtime MUST emit a synthetic approval request into the existing approval pipeline
- **AND** user MUST see the normal approval UI instead of only natural-language failure text

#### Scenario: unsupported approval shapes remain explicit
- **WHEN** Claude `default` mode hits an approval shape that is not yet supported by the synthetic bridge
- **AND** the failure is not a recoverable outside-L1 DirectoryGrant case
- **THEN** the system MUST surface a recoverable diagnostic
- **AND** it MUST NOT describe the mode as fully equivalent to native CLI approvals

#### Scenario: outside-l1 path is not treated as in-root file approval only
- **WHEN** Claude `default` mode hits a blocked tool whose target path is outside L1
- **THEN** runtime MUST NOT claim that accepting a normal file approval alone expanded session working directories
- **AND** recovery MUST go through DirectoryGrant when the path is recoverable

### Requirement: Claude Approval Bridge MUST Reuse Existing Approval Workflow

Once approval-dependent Claude modes are enabled, Claude approval requests MUST reuse the existing approval workflow instead of introducing a provider-specific confirmation path.

#### Scenario: claude approval request enters existing approval pipeline
- **WHEN** Claude runtime emits a synthetic approval request
- **THEN** the system MUST surface it through the existing approval request event flow
- **AND** user decisions MUST continue to route through the existing server request response path

#### Scenario: batch approval remains possible for related requests
- **WHEN** multiple Claude file approvals are pending in the same turn
- **THEN** the UI MAY allow approving the current batch together
- **AND** runtime MUST keep the turn open until the last pending approval resolves

#### Scenario: claude approval rejection stays diagnosable
- **WHEN** user declines a Claude approval request
- **THEN** runtime MUST return a stable rejection outcome to the active conversation
- **AND** the conversation MUST remain interactive for further user action

### Requirement: Claude Default Mode MUST Recover Outside-Allowlist Access Via DirectoryGrant

Claude `default` 模式下，当工具因路径不在当前会话 allowed working directories（L1）而被拒绝时，系统 MUST 优先走 `DirectoryGrantRequest` 可恢复路径，而不是仅留下不可操作的工具失败或笼统 command `modeBlocked`（在路径可解析为授权根的前提下）。

#### Scenario: outside allowlist read becomes directory grant
- **WHEN** Claude `default` 会话中 Read/file 工具因 outside allowed working directories 失败
- **AND** 可解析目标路径
- **THEN** runtime MUST 合成 DirectoryGrant（而非 silent tool failure only）
- **AND** 用户 MUST 能在 GUI 中允许或拒绝扩权

#### Scenario: outside allowlist remains fail-closed when grant declined
- **WHEN** 用户拒绝 DirectoryGrant
- **THEN** Claude 会话 MUST 保持对该路径的拒绝结果
- **AND** 系统 MUST 提供可诊断后续指引
- **AND** MUST NOT 声称已与 native CLI 审批完全等价

