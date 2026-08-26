## ADDED Requirements

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

## MODIFIED Requirements

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
