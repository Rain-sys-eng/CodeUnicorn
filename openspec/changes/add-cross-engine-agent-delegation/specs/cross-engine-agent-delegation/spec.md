## ADDED Requirements

### Requirement: CodeUnicorn SHALL Support Cross-Engine Agent Delegation

系统 SHALL 允许一个由 CodeUnicorn 管理的 source Agent 将子任务委派给另一个已安装且可用的 target Agent，并为每次委派创建独立 logical run identity。Delegation MUST 复用现有 engine runtime/adapter，不得重新实现 target Agent Runtime。

#### Scenario: Source delegates to another engine

- **WHEN** source Agent 请求 `agent_delegate` 指向一个可用 target engine
- **THEN** 系统 MUST 创建新的 delegated run 并返回稳定 `runId`
- **AND** delegated run MUST 记录 source/target/workspace/task/context policy/execution scope
- **AND** target execution MUST 通过现有 EngineManager/adapter/runtime boundary 启动
- **AND** bridge MUST NOT 直接以第二套 parser/runtime 替代现有 engine integration

#### Scenario: Source and target may be reversed

- **WHEN** Claude delegates to Codex 或 Codex delegates to Claude
- **THEN** 两个方向 MUST 使用同一个 delegation contract
- **AND** 系统 MUST NOT 写死 Claude 为 supervisor

#### Scenario: Execution target is frozen before runtime side effects

- **WHEN** delegated run 创建成功
- **THEN** run MUST 保存 fully-resolved engine/provider/model/reasoning/provenance snapshot
- **AND** caller 未显式指定模型时 MUST 在 run creation 阶段解析当前 target 默认模型
- **AND** 后续用户切换模型或 Provider MUST NOT 改变该 run 已冻结的 target
- **AND** invalid/unresolved target MUST 在 runtime side effect 前 fail closed

### Requirement: Delegated Runs SHALL Have Explicit Lifecycle And Idempotent Settlement

每个 delegated run SHALL 使用明确状态机：`queued`、`running`、`waitingApproval`、`completed`、`failed`、`cancelled`。Terminal run MUST NOT 回退到 non-terminal 状态；重复相同 terminal settlement MUST 幂等。

#### Scenario: Run completes once

- **WHEN** target Agent 产生 terminal success
- **THEN** run MUST settle 为 `completed`
- **AND** completed timestamp/result metadata MUST 只归属该 run
- **AND** 后续重复 success settlement MUST NOT 产生第二次副作用

#### Scenario: Terminal state cannot reopen

- **WHEN** run 已为 `completed`、`failed` 或 `cancelled`
- **AND** 之后收到 late `running`/`waitingApproval` update
- **THEN** registry MUST 拒绝该 transition
- **AND** terminal evidence MUST 保持不变

#### Scenario: Concurrent dispatch has one owner

- **WHEN** 两个 caller 同时尝试 dispatch 同一 `queued` delegated run
- **THEN** 只有一个 caller MUST 原子取得 dispatch ownership
- **AND** 第二个 caller MUST NOT 再次启动 target runtime turn

### Requirement: Delegation SHALL Preserve Parent And Root Lineage

系统 SHALL 为 nested delegation 持久记录 `rootRunId`、`parentRunId` 与 `depth`，并对深度、循环和并发实施保护。

#### Scenario: Nested delegation records lineage

- **WHEN** root Claude run delegates Codex，Codex 再 delegates Gemini
- **THEN** Gemini run MUST 指向 Codex run 作为 parent
- **AND** Gemini 与 Codex MUST 共享同一 root run
- **AND** Gemini depth MUST 比 Codex depth 大 1
- **AND** child source MUST 与 parent target identity 一致

#### Scenario: Depth limit blocks recursive explosion

- **WHEN** 新 delegation 将超过 configured `maxDepth`
- **THEN** 系统 MUST 拒绝创建 child run
- **AND** MUST NOT 启动 target engine process/session

#### Scenario: Managed target delegates a nested child

- **WHEN** delegated target 在其 active managed runtime turn 中调用 `agent_delegate`
- **THEN** MCP ingress MUST 从可信 runtime turn/native identity 推断唯一 active parent
- **AND** tool arguments MUST NOT 提供或覆盖 source/parent identity
- **AND** isolated parent MUST 以其 durable runtime workspace 作为 child workspace owner
- **AND** zero owner match MUST 创建 root delegation，ambiguous owner match MUST fail closed

#### Scenario: Durable nested lineage is inconsistent on restart

- **WHEN** persisted child 的 parent 缺失，或 root/depth/source/runtime-workspace ownership 与 parent 不一致
- **THEN** Agent Bridge registry MUST fail closed
- **AND** MUST NOT 从不可信 lineage 启动 target runtime

### Requirement: Delegation SHALL Use Controlled Context Policies

Delegation SHALL 支持 `Explicit`、`Portable`、`Inherited` context policy，默认 MUST 为 `Explicit`。Portable/Inherited MUST 复用已有 context compiler/budget contract，不得默认复制完整 source transcript。

#### Scenario: Default delegation is explicit

- **WHEN** caller 未指定 context policy
- **THEN** target prompt MUST 仅包含 task、显式 file refs 和显式 context
- **AND** source Agent 完整 transcript MUST NOT 自动注入
- **AND** runtime backing lane MUST NOT accidentally inherit ordinary source-session history

#### Scenario: Portable context uses the existing bounded compiler

- **WHEN** caller 选择 `Portable`
- **THEN** Bridge MUST 从可信 source Shared lane 或既有 NativeHistoryReader 取得 allowlisted semantic entries
- **AND** MUST 通过既有 context compiler、budget、manifest、artifact 与 Shared V2 delivery contract 投递
- **AND** provider-private wire blocks、unsupported roles 与历史 control MUST NOT 被伪装成 portable transcript
- **AND** continuation MUST NOT 重复注入已经由同一 native binding 持有的外部 context

#### Scenario: Inherited context retains durable parent provenance

- **WHEN** nested delegated run 选择 `Inherited`
- **THEN** Bridge MUST 合并直接 source semantic spine 与 parent run durable context package
- **AND** MUST 对合并结果重新执行同一个 compiler budget/omission contract
- **AND** run MUST 保存 package/artifact/source checksum、projection mode 与 policy evidence
- **AND** target backing delivery cursor MUST 使用 backing Tx1 前 sequence，不得使用外部 source entry count

#### Scenario: Degraded context cannot bypass user confirmation

- **WHEN** Portable/Inherited compile 产生需要确认的 omission、超过预算、缺失 stable cursor、无可信 source identity或没有既有 reader
- **THEN** delegation MUST 在 target runtime side effect 前 fail closed
- **AND** Bridge MUST NOT 自动批准 degraded context transfer
- **AND** durable run error MUST 保留可诊断的 package/omission 或 source capability evidence

### Requirement: Delegated Execution SHALL Expose Workspace Scope

Delegated run SHALL 声明 `Observe`、`SharedWorkspace` 或 `IsolatedWorktree` execution scope。并行写任务 SHOULD 使用 `IsolatedWorktree`，review/research MAY 使用 `Observe`。

#### Scenario: Parallel writers use isolated worktrees

- **WHEN** 两个 delegated run 同时需要修改代码并选择 `IsolatedWorktree`
- **THEN** 系统 MUST 为其提供不同 worktree/branch ownership
- **AND** 一个 run 的文件写入 MUST NOT 直接覆盖另一个 run 的 working tree
- **AND** result MUST 可返回 branch/diff/changed-files metadata

#### Scenario: Unprovisioned isolated scope fails closed

- **WHEN** delegated run 请求 `IsolatedWorktree`
- **AND** worktree 尚未完成 provision
- **THEN** dispatcher MUST NOT 将其降级成 shared working tree 执行

#### Scenario: Isolated runtime ownership is durable and exact

- **WHEN** isolated delegated run 完成 worktree provision
- **THEN** run dispatch binding MUST 保存与 source workspace 分离的 runtime workspace identity
- **AND** backing session、context delivery、runtime dispatch、await 与 cancel MUST 使用该 runtime workspace
- **AND** path、branch 或 parent workspace ownership 不匹配时 MUST fail closed

#### Scenario: Isolated result uses existing Git evidence

- **WHEN** isolated delegated run canonical outcome 为 completed
- **THEN** result MUST 通过既有 Git status/worktree-against-ref service，以 provision 时冻结的 exact base commit 返回 owned branch 与 committed/uncommitted changed files
- **AND** text diff MUST 遵循 durable-result budget；binary/oversized change MAY 只返回 changed-files evidence
- **AND** 系统 MUST NOT 自动 merge delegated branch

#### Scenario: Terminal worktree owner is retained

- **WHEN** isolated delegated run completed、failed 或 cancelled
- **THEN** Bridge MUST NOT 自动删除 worktree/branch 或释放 durable owner
- **AND** failure/cancellation 的现场 MUST 保留供恢复与诊断
- **AND** 显式删除仍 MUST 经过既有 workspace lifecycle

### Requirement: Delegation SHALL Reuse Existing AgentEventBus

Target Agent 的 text/tool/approval/terminal events SHALL 通过现有 AgentEventBus 归属到 delegated run。系统 MUST NOT 建立第二套平行 streaming event bus。

#### Scenario: Target approval remains user-controlled

- **WHEN** delegated target Agent 请求 shell/file/tool approval
- **THEN** approval event MUST 保留 target run attribution
- **AND** CodeUnicorn MUST 使用现有 approval/user-confirmation contract
- **AND** delegation MUST NOT 自动提升权限或自动批准

#### Scenario: Approval decisions settle the delegated lifecycle exactly

- **WHEN** delegated target Agent 进入一个或多个 pending approval requests
- **THEN** run MUST 保持 `waitingApproval`，直到所有 pending requests 均由用户批准
- **AND** heartbeat、usage 或 unrelated tool progress MUST NOT 绕过仍未解决的 approval gate
- **AND** 全部批准后 run MUST 恢复 `running`
- **AND** 任一请求被用户拒绝后 run MUST fail closed 为 `failed`
- **AND** approval decision MUST 先由 existing native runtime control owner 接受，再通过 existing `AgentEventBus` 同步给 Bridge

### Requirement: Agent-facing MCP SHALL Be A Transport Adapter Over AgentBridgeService

系统 SHALL 向支持 MCP 的 CodeUnicorn-managed Agent 提供 Agent Bridge MCP tools。MCP handler MUST 只做 validation/source identity resolution/service invocation，不得直接 spawn target CLI。

#### Scenario: Agent delegates through MCP

- **WHEN** source Agent 调用 `agent_delegate`
- **THEN** MCP gateway MUST 将请求交给 `AgentBridgeService`
- **AND** service MUST 创建/调度 delegated run
- **AND** MCP gateway MUST 返回 run identity/status
- **AND** 若 run 已 durable create 但 runtime dispatch 失败，response/error MUST 保留该 `runId`，不得让 caller 丢失后续 status/result ownership

#### Scenario: Prompt cannot spoof source identity

- **WHEN** caller 在 tool arguments 中伪造另一个 source engine/session id
- **THEN** gateway MUST 以 runtime/tool binding 的 authenticated source identity 为准
- **AND** MUST NOT 信任 prompt-provided source identity

#### Scenario: Internal backing session is not user-visible

- **WHEN** Agent Bridge 使用 Shared V2 session 作为 delegated runtime backing lane
- **THEN** backing session MUST 保留 Shared ownership/native-session hiding 语义
- **AND** backing session MUST NOT 出现在普通用户 Shared Session 列表
- **AND** MCP/UI gateway MUST NOT 对外开放，直到该 hidden presentation contract 已实现

#### Scenario: DSH is available only through the scoped worker runtime boundary

- **WHEN** Agent Bridge delegates a run to an available DSH runtime
- **THEN** dispatch MUST reuse the existing DSH Host RPC adapter through the Shared V2 worker lifecycle
- **AND** request-response ACK、mux terminal、approval response 与 cancel MUST retain the exact delegated attempt owner
- **AND** ordinary Shared Session engine selection MUST remain unsupported for DSH
- **AND** Bridge MUST NOT parse DSH Host RPC or WebSocket frames itself

#### Scenario: Disabled Gemini policy cannot be bypassed by delegation

- **WHEN** Gemini remains disabled by the existing compile-time runtime policy
- **THEN** Agent Bridge MUST reject Gemini before durable run creation
- **AND** MCP engine listing MUST report Gemini delegation as unsupported

### Requirement: Delegated Terminal Result SHALL Come From Canonical Settlement

Bridge SHALL 使用 existing Shared V2 terminal settlement / `conversation.turnCommitted` 作为 delegated result 的事实源，而不是重新解析 CLI stdout。

#### Scenario: Target completes successfully

- **WHEN** matching delegated attempt 产生 `conversation.turnCommitted` 且 outcome 为 completed
- **THEN** Bridge MUST 从 canonical assistant text 生成 result summary
- **AND** artifact metadata MAY 从 canonical artifact refs 生成
- **AND** changed-files/diff MUST NOT 在没有可靠 worktree/result evidence 时伪造

#### Scenario: Target terminal error is normalized

- **WHEN** canonical outcome 为 failed、cancelled 或 replaced
- **THEN** Bridge MUST 将其映射到对应 delegated terminal state
- **AND** MUST NOT 把 failed/cancelled target 伪报为 completed

### Requirement: Delegated Run Facts SHALL Survive Renderer Or App Restart

系统 SHALL 持久化 delegated run 的 durable facts：identity、lineage、target、scope、status、session binding 与 result/artifact metadata；无需持久化全部 live deltas。

#### Scenario: App restarts after delegated run creation

- **WHEN** delegated run 已创建并写入 durable store
- **AND** renderer/App 重启
- **THEN** 系统 MUST 能恢复该 run 的 durable facts
- **AND** stale native binding MUST fail closed 或进入 recoverable state
- **AND** MUST NOT 伪造 run 为成功

### Requirement: Existing Single-Agent Behavior SHALL Remain Compatible

引入 Agent Bridge 后，用户仍 SHALL 能像当前版本一样单独使用 Claude Code、Codex、Gemini、Kimi、OpenCode 等 engine。

#### Scenario: User never uses delegation

- **WHEN** 用户只在普通 Session 中使用单一 engine
- **THEN** send/session/tool/MCP/permission 行为 MUST 与 change 前保持兼容
- **AND** Agent Bridge MUST NOT 自动创建 delegated run 或额外 context

### Requirement: Parallel And DAG Scheduling SHALL Use Durable Bridge Runs

Parallel / DAG scheduler SHALL 位于 existing `agent_orchestration` domain，并且只能通过 Agent Bridge 创建与调度 target run。系统 MUST 在 target runtime side effect 前持久化 node→Bridge run mapping，MUST 复用 existing `AgentEventBus` terminal settlement 唤醒 downstream，且 MUST NOT 创建第二套 engine runtime owner 或 completion bus。

#### Scenario: Parallel ready nodes are dispatched exactly once

- **WHEN** 多个 dependency 已满足的 graph node 同时 ready
- **THEN** scheduler MUST 为每个 node 创建不同 immutable Bridge run
- **AND** graph mapping MUST 在对应 target runtime 启动前 durable
- **AND** 并发 settlement wake-up MUST NOT 为同一 node 创建重复 run

#### Scenario: App restarts between graph mapping and runtime dispatch

- **WHEN** graph 已持久化 node→Bridge run mapping，但 app 在 Queued run 被 runtime claim 前重启
- **THEN** startup reconciliation MUST 恢复并 exact-dispatch 该 mapped Queued run
- **AND** MUST NOT 创建 replacement run
- **AND** missing 或 stale Bridge identity MUST fail closed，再按 dependency outcome 将 downstream 标记 ready 或 blocked

### Requirement: Collaboration UI SHALL Project Durable Runs Without Owning Runtime

Collaboration UI SHALL 通过 workspace-scoped Agent Bridge commands 读取 durable run，并通过 existing `AgentEventBus` 的 renderer adapter 接收 live activity。UI MUST NOT 读取 hidden backing session 作为事实源，MUST NOT 建立第二套 event bus，且 MUST NOT 把 high-frequency live delta state 挂到 AppShell root。

#### Scenario: Source workspace lists an isolated delegation tree

- **WHEN** root run 在 source workspace 创建，并在 isolated runtime workspace 产生 nested descendants
- **THEN** source workspace projection MUST 保留完整 root lineage
- **AND** isolated workspace MAY 查看其 runtime-owned runs
- **AND** unrelated workspace MUST NOT list/get/cancel those runs

#### Scenario: A queued delegated run is cancelled before runtime starts

- **WHEN** user 或 owning Agent 取消尚未 dispatch 的 Queued run
- **THEN** durable run MUST settle 为 cancelled
- **AND** existing `AgentEventBus` MUST 发布一次 deduplicated cancelled settlement
- **AND** DAG scheduler 与 subscribed UI MUST 能观察该 terminal fact

#### Scenario: High-frequency runtime delta reaches the collaboration surface

- **WHEN** renderer adapter 转发 delegated run 的 high-frequency delta lane event
- **THEN** card-local consumer MUST NOT 将该 delta 写入 AppShell root 或 durable run projection state
- **AND** critical lifecycle/control fact MAY 触发去重的 workspace-scoped durable refresh
- **AND** listener、refresh timer 与 elapsed timer MUST 在 scope change 或 surface unmount 时清理

#### Scenario: Canonical usage and tool activity reaches a visible delegated run

- **WHEN** existing `AgentEventBus` 为 visible run 发布 `usage.updated`、`tool.started` 或 `tool.completed`
- **THEN** card-local projection MAY 保存 bounded token totals 与 latest tool state
- **AND** projection MUST NOT 保存完整 tool input/output delta
- **AND** activity cache MUST 有显式 cardinality 上限并在 workspace scope change 时清空

#### Scenario: User explicitly retries a failed or cancelled delegated run

- **WHEN** user 在 source workspace 对 visible `Failed` 或 `Cancelled` run 选择 Retry
- **THEN** Bridge MUST 创建新的 immutable run identity，并通过 `retryOfRunId` 保留 retry lineage
- **AND** original terminal run MUST 保持不变
- **AND** new run MUST 复用 frozen request/target snapshot，但 MUST NOT 复用 original backing/native/runtime binding
- **AND** current workspace、engine enablement、target availability 与 dispatch ownership MUST 重新验证

#### Scenario: User inspects a delegated run

- **WHEN** terminal run 具有 canonical result/error/diff metadata
- **THEN** collaboration surface MUST 提供 View Result，并在存在 text diff 时提供 View Diff
- **AND** displayed summary/error/branch/artifact/changed-files/diff MUST 只来自 durable run result

#### Scenario: User explicitly opens a delegated backing session

- **WHEN** run 具有 exact durable backing thread binding，且 user 选择 Open Session
- **THEN** existing thread-selection path MUST 使用 binding 的 runtime workspace + backing thread identity
- **AND** ordinary session list filtering MUST 继续隐藏该 internal backing session
