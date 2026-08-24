# session-directory-grant Specification

## Purpose
TBD - created by archiving change session-directory-grant. Update Purpose after archive.
## Requirements
### Requirement: Session L1 Allowlist MUST Be First-Class Session State

系统 MUST 将会话允许根目录集合（L1 session allowlist）作为一等会话状态维护。L1 MUST 至少包含：workspace root（cwd）、启动时注入的额外目录（例如 `--add-dir` / custom spec root）、以及用户在本会话中通过 DirectoryGrant 授权的根。

#### Scenario: new session starts with workspace root only
- **WHEN** 用户在某 workspace 内开启新会话且未附加额外目录
- **THEN** L1 MUST 仅包含该 workspace root（及引擎启动契约已声明的启动目录）
- **AND** MUST NOT 继承上一会话的 `session` / `once` grant

#### Scenario: granted session root joins L1 until session ends
- **WHEN** 用户对越界路径选择 scope=`session` 并允许
- **THEN** 系统 MUST 将该授权根加入当前会话 L1
- **AND** 同一会话内后续对该根下路径的访问 MUST 不再因「不在 L1」而再次强制弹出同一路径的 grant（除非根被撤销）

### Requirement: Outside-Allowlist Tool Failures MUST Synthesize DirectoryGrantRequest

当引擎工具（含 Read 与 Bash/command）因路径位于当前 L1 之外而失败，且错误信号表明 sandbox / allowed working directories 限制时，系统 MUST 合成可交互的 `DirectoryGrantRequest`，而不是仅留下不可操作的工具失败文本。

#### Scenario: read outside workspace synthesizes grant card
- **WHEN** 模型在 Claude `default` 会话中 Read 位于 L1 外的绝对路径
- **AND** 运行时报告该路径不在 allowed working directories
- **THEN** 系统 MUST 向当前会话发出 `DirectoryGrantRequest`
- **AND** UI MUST 渲染内联授权卡（方案 A）
- **AND** MUST NOT 将该失败伪装为已授权成功

#### Scenario: bash outside allowlist synthesizes grant when path is recoverable
- **WHEN** Bash/command 失败且错误表明越界，且可从 tool input 或错误文本解析出目标目录
- **THEN** 系统 MUST 合成 `DirectoryGrantRequest`（而非仅 command `modeBlocked`，若路径可恢复）
- **AND** 若无法解析可授权根，系统 MUST 给出可诊断文案且 MUST NOT 静默失败

### Requirement: DirectoryGrant Decision MUST Support Scoped Authorization

`DirectoryGrantRequest` MUST 允许用户选择授权范围：`once`、`session`（默认）、`workspace`。系统 MUST NOT 提供默认的「全局 always 任意目录」选项。

#### Scenario: default scope is session
- **WHEN** 授权卡首次展示
- **THEN** scope 选择 MUST 默认 `session`

#### Scenario: once grant does not persist across tools beyond intended use
- **WHEN** 用户选择 `once` 并允许
- **THEN** 系统 MUST 仅在约定的单次重试/临时根语义内放行
- **AND** MUST NOT 将根持久写入 workspace store

#### Scenario: workspace scope persists for the project
- **WHEN** 用户显式选择 `workspace` 并允许
- **THEN** 系统 MUST 将该根绑定到当前 workspace 的持久 allowlist
- **AND** 同 workspace 新会话 MUST 可将该根计入启动 L1（或等价注入）

### Requirement: Accept MUST Map Grant Into Engine And Retry Original Tool

用户允许 DirectoryGrant 后，系统 MUST 将授权根映射到当前引擎的 allowed roots 机制，并自动重试触发该 grant 的原工具（在 `retryContext` 允许时）。

#### Scenario: accept session grant retries read
- **WHEN** 用户对越界 Read 的 grant 选择 `session` 并允许
- **AND** 引擎映射成功（热扩或已声明的下一 turn 生效策略）
- **THEN** 系统 MUST 自动重试原 Read
- **AND** 成功时用户 MUST 能看到恢复后的结果或明确的进行中状态

#### Scenario: hot-expand unavailable surfaces honest next-turn effect
- **WHEN** 用户允许 grant 但当前引擎不支持同会话热扩 allowed dirs
- **THEN** 系统 MUST 明示「下一 turn 生效」或等价降级
- **AND** MUST NOT 将映射失败报告为已授权成功

### Requirement: Decline MUST Remain Fail-Closed And Diagnosable

用户拒绝 DirectoryGrant 时，系统 MUST 保持 fail-closed，并向会话提供可操作诊断（含手动扩权指引），MUST NOT 静默吞掉失败。

#### Scenario: user declines grant
- **WHEN** 用户点击拒绝
- **THEN** 原工具 MUST 保持失败/被拒状态
- **AND** 会话 MUST 显示可诊断文案（至少包含：当前 L1 边界、手动 `--add-dir` 或打开对应 workspace 的指引之一）
- **AND** 系统 MUST NOT 自动扩大 L1

### Requirement: Path Canonicalization MUST Be OS-Aware And Escape-Safe

系统 MUST 在写入 L1 与判界前对路径做 OS 感知的 canonicalization，并在 symlink/junction 解析后判定是否落在授权根内。canonical 失败 MUST fail-closed。

#### Scenario: windows path normalization before grant
- **WHEN** 目标路径为 Windows 风格（盘符与反斜杠）
- **THEN** 系统 MUST 规范化后再写入 L1 与比较
- **AND** 等价路径 MUST 不因分隔符差异重复弹窗

#### Scenario: symlink escape is rejected
- **WHEN** 授权根内路径经 symlink/junction 解析后落在授权根之外
- **THEN** 系统 MUST 拒绝将该逃逸路径视为已授权
- **AND** 写操作 MUST 继续受 L2 与 workspace apply gate 约束

#### Scenario: sensitive root defaults to narrowed suggestion
- **WHEN** 解析出的授权候选为敏感根（家目录根、系统盘根、或 `~/.ssh` 等）
- **THEN** 授权卡 MUST 给出强提示
- **AND** 默认建议根 MUST 优先收窄到目标文件的父目录（而非整个敏感根），除非用户显式扩大

### Requirement: Multi-OS UX MUST Share Model And Branch Only Presentation

macOS / Windows / Linux MUST 共用 L1/L2 语义；系统 MUST NOT 在 Windows/Linux 上伪造 OS 级隐私弹窗。仅 macOS 可追加 L3/TCC 相关提示文案。

#### Scenario: windows shows directory grant not system privacy dialog
- **WHEN** Windows 上发生 L1 越界 Read
- **THEN** UI MUST 展示 DirectoryGrant 内联卡
- **AND** MUST NOT 伪装为系统隐私授权对话框

#### Scenario: macos may append l3 privacy hint
- **WHEN** macOS 上展示 DirectoryGrant 且目标可能受系统隐私目录影响
- **THEN** 卡片 MAY 附加 L3 提示
- **AND** L1/L2 决策流程 MUST 与其它平台保持一致

