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
- [x] 7.2 Portable/Inherited 复用现有 context compiler、ContextPackage artifact、Shared V2 delivery cursor 与 typed prompt ACK。Portable 编译直接 source semantic spine；Inherited 合并 parent durable package 后统一重新预算；continuation 不重复注入外部 context，而沿既有 native/binding cursor 续接。
- [x] 7.3 敏感/超预算/不可迁移 context 在 runtime side effect 前 fail closed：provider-private/unsupported role、checkpoint/omission confirmation、unstable native cursor、缺失可信 native/source provider identity 或无既有 NativeHistoryReader 都返回 durable run error；成功 transfer 保存 package/artifact/source checksum、projection mode 与 policy evidence。

## 8. Worktree Isolation

- [x] 8.1 实现 `Observe` / `SharedWorkspace` / `IsolatedWorktree` scope mapping：Observe 继续映射 existing read-only squad permission；SharedWorkspace 使用 caller workspace；IsolatedWorktree 只有在 distinct durable runtime workspace 完成 provision 后才映射 existing current-workspace permission，禁止降级到 source workspace。
- [x] 8.2 并行写任务通过既有 `workspaces::add_worktree` lifecycle provision 独立 deterministic branch/worktree；Bridge 先把 run/branch/source reservation 磁盘优先写入 `agent-bridge-worktrees.json`，再创建 workspace 并补全 workspace/path owner，reserved crash window 可从现有 workspace catalog 精确恢复，path/branch/parent ownership 不一致 fail closed。
- [x] 8.3 isolated result 复用现有 Git status 与 worktree-against-ref diff API，以 provision 时冻结的 exact base commit 同时覆盖 committed/uncommitted change，返回 sorted changed files、owned branch 与受更严格 durable-result budget 限制的 text diff；binary/oversized change 仍由 changed-files 表达，不伪造 diff。canonical runtime artifact locator 继续独立保留，默认不 merge。
- [x] 8.4 terminal settlement/cancel/error 不自动删除 delegated worktree 或 branch，也不释放 durable owner；成功保留供检查/显式 merge，失败/取消保留现场供诊断。显式 workspace cleanup 仍由既有 workspace lifecycle 负责，Bridge 不直接执行 `git worktree remove`。

## 9. Orchestration Expansion

- [x] 9.1 在现有 `agent_orchestration` 上增加 Parallel / DAG plan model，不建第二套 orchestrator：新增 `graph` domain，提供 node/dependency model、去重与规范化、unknown/self/cycle fail-closed、deterministic topological order 与 ready-node projection。
- [x] 9.2 dependency scheduler 仅通过 Agent Bridge 调度 delegated runs。图级 plan/execution 与 node→Bridge run mapping 写入 versioned durable store；coordinator 在任何 runtime side effect 前持久化 mapping，并串行化 fan-out settlement 推进。process-wide observer 复用 existing `AgentEventBus` 的 `run.settled` 唤醒相关图；应用启动时先订阅事件，再主动 reconcile 全部 durable graph，恢复已映射 Queued run、推进已完成依赖并 fail closed 处理缺失/stale Bridge identity。scheduler/coordinator 不直接创建 engine runtime。
- [x] 9.3 nested delegation 支持 root/parent lineage 与 cycle protection。Managed MCP ingress 只从 live runtime turn/native identity 推断 active parent，tool arguments 不接受 source/parent；isolated parent 以 durable runtime workspace 作为 child workspace owner。service/registry 强制 parent existing、non-terminal、child source engine=parent target、root/depth 单调、depth/child/global limits；新 immutable child id 与严格递增 depth 排除 parent cycle。durable recovery 重新验证 parent existence、root/depth/source/runtime-workspace ownership，tampered lineage fail closed。
- [ ] 9.4 评估并迁移现有 Plan/Implement/Review V1 stage dispatch 为 Bridge consumer，保持 projection/approval 兼容。

## 10. Collaboration UI

- [x] 10.1 新增 delegation tree/card：agent、task、status、elapsed、tokens/tool activity。**workspace-scoped durable projection 按当前 source logical/native session 过滤 root lineage，isolated descendants 随 root 展示；sticky tree/card 显示 target、task、durable status、elapsed。card-local bounded activity map 只消费 canonical `usage.updated` / `tool.started` / `tool.completed` normal events，每 run 仅保存 token totals + latest tool state，并设 64-run 上限；不保存 tool/text delta。**
- [x] 10.2 支持 approval、Stop、Retry、Open Session、View Result、View Diff。**`waitingApproval` 只投影 durable 状态，用户决策仍由 existing native approval UI 持有；Stop 继续复用 workspace-scoped cancel。Retry 仅允许 Failed/Cancelled，并创建带 `retryOfRunId` 的 fresh immutable run，复用 frozen request/target snapshot但清空旧 backing/native/runtime identity，重新走 workspace/engine availability/dispatcher。Open Session 通过 feature-local request 交给 existing layout thread-selection owner，使用 exact runtime workspace + hidden backing thread；普通 session list 仍过滤 internal backing。Terminal card 的 Result/Diff dialog 只展示 durable summary/error/branch/artifact/changed-files/diff。Frontend targeted 35 tests、locale parity、typecheck、production Vite build、runtime contracts/AppShell governance 与 strict OpenSpec validate 已通过；Rust toolchain 当前环境不可用，尚不计 Rust 编译证据。**
- [x] 10.3 不把 live delta 高频 state 挂到 AppShell root；复用现有 event/live channel 性能契约。**existing `AgentEventBus` → `agent-bridge-event` adapter 只转发 registry 已确认 run；feature-local hook 在聊天卡片挂载期订阅，直接丢弃 delta lane，仅用 critical/normal fact 触发去重的 workspace/run durable refresh，并在 scope change/unmount 清理 listener/timer。AppShell root 未新增 Bridge state。**
- [x] 10.4 Single Agent Mode 与 Multi-Agent V1 视觉/行为保持兼容。**Bridge 无 visible run 时不渲染；ConversationHost 继续并列挂载 existing Multi-Agent V1 surface、Bridge surface、messages 与 composer，不替换 V1 projection/approval/inspector owner。新增 focused compatibility test，并通过 AppShell governance 与 production Vite build。**

## 11. Validation / Closure

- [ ] 11.1 Rust focused tests + rustfmt check（仅改动文件）。**当前 executor 无 `cargo`/`rustfmt`；系统 apt 安装也因容器 setgroups/setegid 权限被拒，故保持未完成且不把静态审查冒充编译证据。**
- [x] 11.2 frontend focused tests + typecheck + runtime contracts/governance gates。**Agent Bridge/UI/i18n/compatibility focused 37 tests 通过；`NODE_OPTIONS=--max-old-space-size=4096 npm run typecheck`、`npm run check:runtime-contracts` 与 production `vite build` 通过。Build 仅有既存 dynamic-import/chunk-size/CSS utility warning，无本 change error。**
- [ ] 11.3 MCP contract tests、parallel/cancel/recovery integration tests、fake-engine tests。**已加入 managed Claude transport contract coverage：authenticated `tools/list` 精确枚举七个 Bridge tools、legacy route fail closed、unknown runtime locator、bearer rejection 与 unknown-tool JSON-RPC error。Gateway 新增窄 `AgentBridgeMcpBackend` seam，production implementation 仍只调用 existing `AppState` dispatcher/control；deterministic fake runtime 已覆盖七工具 delegate→status→wait/result→send→cancel 闭环、Approval accept/reject、continuation backing/native/binding reuse、nested exact runtime parent、cross-source/workspace fail closed 与 stale-runtime durable recovery projection。当前 executor 缺少 Rust toolchain，新增 Rust tests 尚未实际执行，且仍缺 graph coordinator + fake `AppState` 的 parallel fan-out integration，因此本项不提前打勾。**
- [ ] 11.4 手工验收 Claude→Codex、Codex→Claude、并行三 Agent、nested delegation、worktree isolation。
- [ ] 11.5 strict OpenSpec validate / consistency sync。**`OPENSPEC_TELEMETRY=0 npm exec --offline --yes @fission-ai/openspec@latest -- validate add-cross-engine-agent-delegation --strict --no-interactive` 已通过；consistency sync 尚未执行，因此不提前打勾。**
- [ ] 11.6 更新 foundation ADR，写 verification，sync main specs，archive change。
