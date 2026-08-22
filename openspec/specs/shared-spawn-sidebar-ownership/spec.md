# shared-spawn-sidebar-ownership Specification

## Purpose

Defines the shared-spawn-sidebar-ownership behavior contract, covering Sidebar membership uses Shared transcript ownership.

## Requirements

### Requirement: Sidebar membership uses Shared transcript ownership

侧栏 native 行的 membership MUST 以 transcript / parent 的 Shared 所有权为准，MUST NOT 仅以当前 binding UUID 或预览标题为准。

Claude Session Index writer MUST 在入库前检查 jsonl 首条真实 user 正文。若正文以 `MOSSX_CONTEXT_PACKAGE` / `MOSSX_SHARED_CONTEXT_V1` / `MOSSX_NATIVE_CONTEXT_V1` 开头，Index MAY 保留协议标题行供 protocol hide 收录文件 sessionId，但侧栏根列表 MUST NOT 把它展示为用户会话。`history.jsonl` 的友好 display 标题（如「继续」）MUST NOT 覆盖此协议标题。

protocol hide MUST 收录这些协议拥有的 **文件 sessionId**（以及 `claude:{fileUuid}`），使子代理 parent 能命中 hide set。

empty-prune MUST NOT 把完整协议 token 标题的会话当空草稿删盘。

Codex Windows 首条 user 常为 `<environment_context>`。标题 / 协议判定 MUST 跳过该信封，把后续 `MOSSX_CONTEXT_PACKAGE` / `MOSSX_SHARED_CONTEXT` 视为协议 owner。Index MUST 保留该协议标题行（不得当 helper omit），protocol hide MUST 收录 **文件 canonical uuid**，MUST NOT 只收录哨兵 `codex:default`。

#### Scenario: history-friendly title does not index a protocol owner

- **WHEN** Claude jsonl 首条真实 user 以 `MOSSX_SHARED_CONTEXT_V1` 开头
- **AND** `history.jsonl` 对该 session 的 display 为「继续」
- **THEN** Session Index 标题 MUST 仍以 `MOSSX_` 协议 token 开头
- **AND** 侧栏根列表 MUST NOT 出现标题为「继续」的该 native 行

#### Scenario: protocol hide includes the file session id

- **WHEN** 上述协议 owner 的磁盘文件名为 `{fileUuid}.jsonl`
- **AND** 信封 binding 为另一 id `claude:{bindingUuid}`
- **THEN** protocol hide set MUST 包含 `{fileUuid}` 与 `claude:{fileUuid}`
- **AND** MUST NOT 只收录 `{bindingUuid}`

#### Scenario: live list cannot re-add omitted owners via index merge

- **WHEN** live Claude list 已因 `MOSSX_` firstMessage 丢弃某 owner
- **AND** Index 曾用友好标题持有同一 session
- **THEN** Index merge MUST NOT 把该 owner 重新写入侧栏根

### Requirement: Shared-owned children stay out of the sidebar tree

parent 指向 Shared-owned native（文件 UUID、binding、`shared:`，含 Codex canonical / rollout-stem 变体）的 child session，侧栏 MUST NOT 展示为根，也 MUST NOT 在展开 Shared 时作为可见子行。隐藏 MUST 限于侧栏树投影。threads store MAY 保留摘要供幕布 / Strip / `childSubagentThreads`。

Codex child 的 authoritative parent MUST 来自 `session_meta.source.subagent.thread_spawn.parent_thread_id`。系统 MUST NOT 把 child meta `session_id` 当作 child 自己的 id。

系统 MUST NOT 仅凭「Base directory」、希腊名、`originator=ccgui|mossx` 推断 Shared 所有权。

#### Scenario: claude subagent of a protocol owner is not a sidebar root

- **WHEN** parent 文件 `{fileUuid}.jsonl` 是 Shared 协议 owner
- **AND** child 为 `{fileUuid}/subagents/agent-{agentId}.jsonl` 或 id `subagent:{fileUuid}:{agentId}`
- **THEN** 侧栏 MUST NOT 将该 child 展示为根
- **AND** store MAY 仍保留该 child

#### Scenario: shared-owned codex thread_spawn pup is hidden

- **WHEN** Codex child 的 `thread_spawn.parent_thread_id` 命中 Shared hide set（uuid / `codex:uuid` / `rollout-*-{uuid}`）
- **THEN** 侧栏 MUST NOT 展示该 child（含 Socrates 式昵称标题）
- **AND** store MAY 仍保留该 child

#### Scenario: native tui pup stays visible

- **WHEN** Codex child parent 为用户自己的 TUI/Desktop 会话（例如 Socrates `01a00d8f-…` parent `01a00d6c-…`，Singer `019fc810-…` parent `019fc7da-…`）
- **AND** 该 parent 不是 Shared-owned
- **THEN** 侧栏 MUST 继续在该 native parent 下展示 child
- **AND** MUST NOT 因 `thread_spawn` 或昵称将其隐藏

#### Scenario: canvas rules stay unchanged

- **WHEN** 侧栏隐藏 Shared-owned owner / child
- **THEN** 幕布 / Strip / `childSubagentThreads` 展示规则 MUST NOT 因本隐藏改写
