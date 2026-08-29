## 1. OpenSpec / Architecture

- [x] 1.1 创建 `add-cross-engine-agent-delegation` proposal/design/tasks/spec delta。
- [x] 1.2 校准落位：复用现有 `agent_orchestration` domain，在其下新增 `bridge/`，不创建平行 orchestrator。
- [ ] 1.3 将 change 加入 active change index，并在实现推进时维护 progress/gate。
- [ ] 1.4 收口前回写 multi-CLI foundation ADR 最近校准与事实源。

## 2. Agent Bridge Core

- [x] 2.1 新增 `agent_orchestration/bridge` domain 与核心 DTO：endpoint、context policy、execution scope、run status、result。
- [x] 2.2 实现 thread-safe `DelegationRunRegistry`：create/get/list/transition/settle/cancel。
- [x] 2.3 实现 root/parent lineage、max depth、per-parent child limit、global active-run limit。
- [x] 2.4 补 Core unit tests：lineage、terminal 幂等、terminal reopen 拒绝、depth limit。
- [x] 2.5 增加 source/target engine canonical validation；nested child source 必须匹配 parent target、workspace 必须一致；run graph 使用新 child identity + immutable parent 指向保持结构无环，递归爆炸由 depth/concurrency guard 限制。

## 3. Runtime Integration

- [x] 3.1 将 `AgentBridgeService` 以单一 long-lived owner 接入 `AppState`，并在 AppState boundary 先验证 workspace identity。
- [x] 3.2 复用 EngineManager status cache/refresh 与现有 engine enable gate 验证 target availability；未知、禁用或不可达 target 在 run 创建前 fail closed；创建时冻结 resolved Execution Target snapshot。
- [x] 3.3 对当前 Shared V2 已支持 target（Claude/Codex/Kimi/Grok/OpenCode/Pi/Qoder）复用 `begin_squad_worker_turn_core -> prepare_delivery -> dispatch_turn -> await_terminal` 完成单跳 delegated dispatch；Bridge 不直接 spawn/parse CLI。
- [x] 3.4 将 backing logical thread / attempt / binding / native session / runtime turn identity 写回 delegated run，并以 atomic dispatch claim 防止重复发送。
- [x] 3.5 复用 `EngineManager.agent_event_bus()` 与现有 Shared runtime event sink；Bridge 对自身 backing thread 做 scoped re-attribution，将 live EngineEvent / settlement 以 delegated `run_id` 再发布，同时保留 native session/turn identity，且不创建第二套 event bus。
- [x] 3.6 Bridge backing Shared Session 在 runtime side effect 前写入 canonical `agent-bridge.internal-backing-session` control marker；App 启动时按 durable `backingThreadId` 补齐缺失 marker；普通 Shared Session 列表按 projection marker 过滤，而底层 Shared/native binding ownership 与 visibility seed 保持完整。注意 `start_shared_session` 返回到 marker append 之间仍存在极窄 orphan crash window，后续如需完全原子化应下沉到 Shared create transaction/专用 orphan sweep，不在 presentation 层伪装解决。
- [x] 3.7a DSH parity：只对 scoped Shared worker lifecycle 开放 DSH，复用 existing Host RPC runtime、request-response ACK、mux EngineEvent、approval control 与 exact-turn cancel；普通 Shared Session target 集合保持不变，不新建第二套 CLI parser。
- [ ] 3.7b Gemini parity：当前 `GEMINI_RUNTIME_ENABLED=false`，Bridge 保持 run-creation fail closed；只有既有 runtime policy 正式解除后才能接 worker dispatch，不允许 Bridge 绕开编译期 gate。

## 4. Result / Continuation / Cancellation

- [x] 4.1 复用 `conversation.turnCommitted` 生成 normalized delegated result：assistant text summary + terminal status + artifact locator；changed-files/diff 后续由 worktree/result 层补齐。
- [x] 4.2 continuation 使用新的 immutable `DelegationRun` identity + `continuationOfRunId`，不重开 terminal run；dispatcher 沿 continuation chain 回溯原 backing Shared lane 与 stable scoped binding owner，复用同一 native CLI session，同时与 nested `parentRunId/depth` 语义分离。AppState 已提供 continue boundary，`agent_send` MCP 复用该层。
- [x] 4.3 实现 `agent_cancel` 与 cancellation propagation：Queued 本地取消；durable attempt 先走 Shared V2 live interrupt，无 runtime owner 时仅允许 existing pre-dispatch cancel；控制失败保留 run/binding owner；当前 Claude managed MCP ingress 已暴露 `agent_cancel`，不做 workspace-wide fallback。
- [x] 4.4 approval request 不自动放行，沿现有 approval contract 转发；process-wide Bridge approval observer 只消费 re-attributed AgentEventBus 事件。`ApprovalRequest` 按 `requestId` 记录 pending gate 并将 durable run 置为 `WaitingApproval`；native runtime control owner 接受用户 decision 后发布 `ApprovalResolved`，全部批准才恢复 `Running`，任一拒绝立即 `Failed`；heartbeat/usage/unrelated tool progress 均不能绕过 pending approval。

## 5. Persistence / Recovery

- [x] 5.1 新增 schemaVersion=1 的 durable run store，仅保存 run identity/lineage/frozen target/status/session binding/result metadata，不保存 live delta。
- [x] 5.2 复用 storage lock + atomic JSON write；registry 每次 mutation 先持久化 candidate snapshot，成功后才替换内存 state，避免 disk failure 产生内存假成功。
- [x] 5.3 production registry 默认从 durable store 恢复；malformed JSON 仅在 parse failure 时 quarantine，I/O/未知未来 schema 均 fail closed，避免覆盖有效 store。
- [x] 5.4 App 重启后 `Running/WaitingApproval` 或不一致的已启动 Queued run fail closed 为 `Failed + recovery-required`，保留 backing/native/runtime identity 供 retry/diagnostics；terminal/clean Queued facts 保持。

## 6. Agent-facing MCP Gateway

- [x] 6.1 新增 bridge MCP transport adapter：复用现有 bearer-authenticated、runtime-bound Claude managed HTTP MCP server；Bridge handler 保持独立于 MCP transport，不直接 spawn CLI。
- [x] 6.2 暴露 `agent_list` / `agent_delegate` / `agent_status` / `agent_wait` / `agent_result` / `agent_send` / `agent_cancel`；`agent_wait` 单次调用 hard cap 30 秒，所有 run control 均做 workspace/source ownership 校验。`agent_delegate/agent_send` 在 durable run 已创建后即使 dispatch 失败也返回该 terminal run；若 settlement 本身缺失，MCP error 必须显式携带已创建 `runId`。
- [x] 6.3 source identity 不进入 tool schema；当前 Claude ingress 从 CodeUnicorn-minted runtime locator + live active turn + native session 解析可信 source，legacy workspace-only route 对 Bridge fail closed。其他 engine 在接入 6.4 前必须实现等价 runtime-bound resolver。
- [ ] 6.4 将 bridge MCP 提供给所有支持 MCP 的 CodeUnicorn-managed engine，且不覆盖用户配置。**当前首个 ingress 已完成：Claude managed MCP server 的 `tools/list/tools/call` 已接 7 个 Bridge tools。MCP source 已进一步抽象为 transport-neutral `TrustedMcpRuntimeBinding -> ResolvedMcpSource` fail-closed contract，Codex/Kimi/OpenCode ingress 可复用同一安全边界；Codex caller 的 remaining gate 是拿到 thread+turn 级可信 runtime locator，禁止退化成 workspace-only source。**

## 7. Context Policy

- [x] 7.1 默认 Explicit：每个 delegated run 使用 fresh backing lane；仅 target task + explicit file refs 进入当前 prompt，不继承 source transcript。
- [ ] 7.2 Portable/Inherited 复用现有 context compiler 与 budget/omission contract。
- [ ] 7.3 增加敏感/超预算/不可迁移 context 的 fail-closed evidence。

## 8. Worktree Isolation

- [ ] 8.1 实现 `Observe` / `SharedWorkspace` / `IsolatedWorktree` scope mapping；当前 dispatcher 已将 Observe/SharedWorkspace 映射到既有 squad permission class，IsolatedWorktree 在 provision 前 fail closed。
- [ ] 8.2 并行写任务 provision 独立 worktree/branch，记录 ownership。
- [ ] 8.3 result 返回 changed files/diff/branch/artifact metadata；默认不自动 merge。
- [ ] 8.4 cleanup 遵循 owner-retention-on-failure contract。

## 9. Orchestration Expansion

- [x] 9.1 在现有 `agent_orchestration` 上增加 Parallel / DAG plan model，不建第二套 orchestrator：新增 `graph` domain，提供 node/dependency model、去重与规范化、unknown/self/cycle fail-closed、deterministic topological order 与 ready-node projection。
- [ ] 9.2 dependency scheduler 仅通过 Agent Bridge 调度 delegated runs。**scheduler core 已加入：`dispatch_ready_batch` 会 reconcile Bridge run 状态、block failed dependency、将所有 ready nodes 经 `create_delegation_run -> dispatch_delegation_run` 发起；图级 durable ownership、automatic wake-up/reconcile loop 尚未实现，因此本项不提前打勾。**
- [ ] 9.3 nested delegation 支持 root/parent lineage 与 cycle protection。
- [ ] 9.4 评估并迁移现有 Plan/Implement/Review V1 stage dispatch 为 Bridge consumer，保持 projection/approval 兼容。

## 10. Collaboration UI

- [ ] 10.1 新增 delegation tree/card：agent、task、status、elapsed、tokens/tool activity。
- [ ] 10.2 支持 approval、Stop、Retry、Open Session、View Result、View Diff。
- [ ] 10.3 不把 live delta 高频 state 挂到 AppShell root；复用现有 event/live channel 性能契约。
- [ ] 10.4 Single Agent Mode 与 Multi-Agent V1 视觉/行为保持兼容。

## 11. Validation / Closure

- [ ] 11.1 Rust focused tests + rustfmt check（仅改动文件）。
- [ ] 11.2 frontend focused tests + typecheck + runtime contracts/governance gates。
- [ ] 11.3 MCP contract tests、parallel/cancel/recovery integration tests、fake-engine tests。**已加入 managed Claude transport contract coverage：authenticated `tools/list` 精确枚举七个 Bridge tools、legacy route fail closed、unknown runtime locator、bearer rejection 与 unknown-tool JSON-RPC error；仍缺带 fake AppState/runtime 的 delegate/wait/result/send/cancel integration harness，因此本项不提前打勾。**
- [ ] 11.4 手工验收 Claude→Codex、Codex→Claude、并行三 Agent、nested delegation、worktree isolation。
- [ ] 11.5 strict OpenSpec validate / consistency sync。
- [ ] 11.6 更新 foundation ADR，写 verification，sync main specs，archive change。
