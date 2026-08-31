## Context

CodeUnicorn current mainline already has:

- `engine::adapter_registry`: `EngineAdapterRegistry` + protocol family / execution model abstraction；
- `engine::agent_event_bus`: unified engine event backbone with logical/native session ids and run ids；
- `shared_session_v2`: cross-engine execution target dispatch、provider binding、context delivery、native continuation；
- `agent_orchestration`: Multi-Agent V1 线性 Plan → Implement → Review control plane，明确不做 DAG scheduler；
- existing engine-specific runtime owners for Claude/Codex/Gemini/Kimi/OpenCode/PI/Qoder/DSH/Grok。

因此本 change 不创建第二套 orchestrator，而是在现有 `agent_orchestration` domain 下增加 `bridge` 子域，作为 logical delegation control plane；现有 V1 stage workflow 后续也可以消费同一个 Bridge。

## Goals / Non-Goals

**Goals:**

- 提供统一、异步、可恢复的 Agent-to-Agent delegation contract。
- source/target engine 对称，不写死 supervisor engine。
- 复用 native session、event bus、context compiler、provider binding 与已有 orchestration domain。
- 并行写任务默认提供 worktree isolation；review/read-only 任务可共享 workspace。
- MCP 只是 Agent-facing transport，核心业务逻辑独立于 MCP。

**Non-Goals:**

- 不统一或替换各 engine native wire protocol。
- 不将全部 source transcript 默认传给 target。
- 不把 UI lifecycle 当成 delegated run ownership source。
- 不允许子 Agent 自动绕过 permission/approval。
- 不删除或重写现有 Plan/Implement/Review V1。

## Decisions

### 1. Bridge 落在现有 `agent_orchestration` domain

新增：

```text
src-tauri/src/agent_orchestration/bridge/
  mod.rs
  models.rs
  run_registry.rs
  service.rs
  persistence.rs      # 后续
  dispatcher.rs       # 后续
```

拒绝创建平行 `src-tauri/src/orchestrator/**`，避免 orchestration ownership 分裂。

### 2. Agent Bridge 是 logical control plane，不拥有 engine process

`AgentBridgeService` 负责 run identity、lineage、state transition、dispatch request 和 result ownership；实际 Claude/Codex/Kimi 等 process/session 继续由现有 engine manager/runtime owner 管理。

第二批实现已将唯一 long-lived `AgentBridgeService` owner 放入 `AppState`。`AppState::create_delegation_run` 先验证 workspace identity，再将请求交给 Bridge service；service 不持有 workspace/store/runtime 的第二份 ownership。

### 3. Delegation 使用异步 run identity

`agent_delegate` 不等待 target 完整退出，而是创建 `DelegationRun` 并快速返回：

```text
Queued -> Running -> WaitingApproval -> Completed | Failed | Cancelled
```

source Agent 可以继续 delegate 其他任务；`agent_wait` / `agent_result` 用于同步点。

### 4. Run identity 与 lineage 独立于 native session id

每个 delegated run 至少持有 `run_id/root_run_id/parent_run_id/depth/source/target/workspace/logical_session/native_session`。native session 可以被 continuation 复用，但不能成为 bridge run identity。

Nested child 进入 registry 前必须满足：

- child workspace 与 parent 的 actual runtime workspace 相同；non-isolated parent 即 source workspace，`IsolatedWorktree` parent 则使用 dispatch binding 中的 durable isolated workspace；
- child source engine 必须等于 parent target engine；
- Agent-facing ingress 不接受 tool argument 提供 parent/source identity；managed MCP route 以 live runtime turn、native session 与 runtime workspace 唯一反查 active parent，zero match 表示 root delegation，ambiguous match fail closed；
- parent 指向只允许 existing older run，新 child 使用全新 run identity，因此 run graph 不提供回指 ancestor 的结构入口；
- recursive explosion 继续由 max depth、per-parent child 与 global active limit 控制。

Durable store 恢复时再次校验 parent existence、root identity、严格递增 depth、source=parent target 与 runtime-workspace ownership；结构被篡改、parent 缺失或 lineage 不一致时整个 registry fail closed，不以不可信 parent graph 继续 dispatch。

### 5. 第一批 Core 使用明确 state machine 与幂等 settlement

Run registry 拒绝 terminal → non-terminal 回退；重复相同 terminal settlement 幂等；cancel/complete race 只允许一个 terminal owner。

### 6. Context policy 默认 Explicit

```text
Explicit
Portable
Inherited
```

默认 `Explicit`。`Portable` 与 `Inherited` 继续复用既有 Shared context compiler、
`ContextPackage` artifact、delivery cursor 与 typed prompt ACK：

- `Portable` 只编译直接 source Agent 的 allowlisted user/assistant semantic spine；nested
  source 从 parent 的 canonical backing lane 读取，避免把 runtime locator 或 provider-private
  wire history当成可移植事实；
- `Inherited` 在直接 source spine 前合并 parent run 已 durable 记录的 context package，随后由
  同一个 compiler 重新做全局 budget/checkpoint/omission；不递归复制完整 native transcript；
- 外部 source package 的 provenance 与 target backing cursor 分离。package 内容记录真实
  source session/inherited package ids，而 `throughSequenceInclusive` 固定为本次 backing Tx1 前
  sequence，保证 continuation 仍使用原 Shared V2 incremental cursor；
- package/artifact/source checksum、projection mode 与 policy 写入 `DelegationDispatchBinding`。
  任何需要用户确认的 omission、无 stable native cursor、无可信 source identity、无现成
  NativeHistoryReader 或空 payload 均在 runtime dispatch 前 fail closed；当前不会自动批准
  degraded context transfer。

### 7. Execution scope 三态

```text
Observe
SharedWorkspace
IsolatedWorktree
```

Bridge 只保存 scope fact；Git provisioning/cleanup 在独立 integration 中完成。

`IsolatedWorktree` integration 不直接执行 Git CLI，而是复用既有 `workspaces::add_worktree`
lifecycle（包括 remote forwarding、workspace catalog persistence 与 runtime session setup）。Bridge 在任何
workspace side effect 前，将 deterministic `codeunicorn/delegate/<run>` branch reservation 以 disk-first
方式写入 `agent-bridge-worktrees.json`；provision 后再补齐 workspace/path owner。若进程停在 reservation 与
completion 之间，只允许从 existing workspace catalog 按 exact parent + branch 恢复；任何歧义、path/branch/
parent 漂移都 fail closed。

source workspace identity 与 runtime workspace identity 分开持久化。isolated backing Shared session、context
artifact delivery、native runtime、await 与 exact-attempt cancel 全部使用 `runtimeWorkspaceId`；continuation
必须复用 original binding/worktree owner，禁止回退到 source workspace。nested target 从 isolated runtime
发起 child 时，以该 runtime workspace 作为可信 parent ownership。

terminal result 通过 existing Git status/worktree-against-ref service，以 provision 时冻结的 exact base commit
收集 committed + uncommitted change，并生成 owned branch、sorted changed files 与受更严格 durable-result
budget 限制的 text diff preview；binary/oversized 文件不会伪造 text diff。Bridge 不自动 merge，也不在 completed/failed/
cancelled 时自动删除 worktree：成功现场留给用户检查/显式 merge，失败/取消现场和 durable owner 留作恢复
与诊断。后续显式删除仍由 existing workspace lifecycle 负责。

### 8. MCP Gateway 只做 transport adapter

`agent_list/agent_delegate/agent_status/agent_wait/agent_result/agent_send/agent_cancel` handler 只做 validation/source identity resolution 与 Bridge service 调用，禁止直接 spawn CLI。

### 9. Event attribution 复用 AgentEventBus

Target engine events 继续进入现有 `AgentEventBus`，以 delegated `run_id` 归属；不创建平行 streaming event system。

### 10. Permission 采用“不得提升”原则

Delegated target 可以继承更严格权限，但不能因为 source 调用 Bridge 就提升 access mode/sandbox/MCP/file/network permission。

Approval lifecycle 继续以 native runtime/UI control response 为唯一决策入口。`ApprovalRequest`
通过既有 `AgentEventBus` 归属 delegated run；native control owner 接受用户 decision 后发布
`ApprovalResolved` control fact。Bridge 只按 `requestId` 跟踪 pending approvals：全部批准后才从
`WaitingApproval` 恢复 `Running`，任一拒绝立即 fail closed 为 `Failed`；普通 tool progress、heartbeat
或 usage event 都不能代替用户 decision。

### 11. Engine availability 在 run creation 前 fail closed

Bridge 只接受当前 built-in engine registry 的 canonical engine ids。source/target id 会先 canonicalize；未知或 disabled engine 直接拒绝。target availability 复用 `EngineManager` status cache；缓存没有已安装证据时才走现有 refresh gate。CLI 未安装、不可达或 runtime policy disabled 时，不创建 delegated run。

这一步只做 target validation，不启动 target process；实际 dispatch 仍由后续 dispatcher 通过现有 send/session boundary 完成。

DSH parity 复用同一 Shared V2 worker lifecycle，但不扩大普通 Shared Session 产品集合：

- `begin_squad_worker_turn_core` 使用独立 worker-engine gate 接受 DSH；普通 `begin_turn_core`、前端 Shared picker 与 persisted selected target 仍拒绝 DSH；
- actual send 继续调用现有 `engine_send_message -> dsh::send_user_turn`，Bridge 不接触 Host RPC/WebSocket parser；
- DSH 的 request-response ACK 补充 provider/runtime/model receipt，mux events 在 exact native session/turn identity 返回前由既有 coordinator provisioning hold 暂存，随后按 attempt replay；
- approval response 继续走 `respond_to_server_request -> dsh::respond_to_control`，cancel 继续走 exact `dsh::interrupt_turn`；
- Gemini 仍受 `GEMINI_RUNTIME_ENABLED=false` 编译期策略约束，Bridge 在 run creation 前显式 fail closed，不通过 parity 工作绕开该 policy。

### 12. Existing Multi-Agent V1 后续改为 Bridge consumer

现有 Plan/Implement/Review V1 暂不迁移。Bridge 稳定后，可把 V1 每个 stage dispatch 改为通过 `AgentBridgeService` 发起，从而统一 runtime ownership/observability；迁移必须保持 V1 projection 与用户确认行为兼容。

### 13. Durable facts 与 live deltas 分离

持久化 identity、lineage、target、scope、status、session binding、result/artifact metadata；不持久化全部 token/tool deltas。

### 14. Parallel / DAG 只编排 durable Bridge identity

Parallel / DAG 继续位于既有 `agent_orchestration` domain。graph registry 只持久化 validated plan、node state 与 node→immutable Bridge run mapping；target process/session/result 仍由 Agent Bridge 和 existing runtime owner 管理。coordinator 必须先创建 Bridge run、磁盘优先保存 mapping，再允许 dispatch runtime，并以单一 advance lock 串行化并发 settlement 触发的 downstream fan-out。

图推进复用 existing `AgentEventBus` 的 `run.settled`，不增加第二套 completion bus。应用启动时在订阅 live settlement 后扫描全部 durable graph：已映射且仍为 clean `Queued` 的 Bridge run 继续 exact dispatch；stale/missing/terminal run 由 Bridge durable facts reconcile 为 failed/cancelled/completed，再确定 downstream ready 或 blocked。普通非 DAG delegation 不会触发图创建或图推进。

### 15. Collaboration UI 使用 workspace projection + existing event bus adapter

Renderer 不直接读取 hidden backing Shared Session。Backend 提供 workspace-scoped durable run list/get/cancel/retry commands：source workspace 可查看同一 root lineage 下的 isolated descendants，isolated runtime workspace 也只能查看自身 runtime-owned lineage；其他 workspace fail closed。UI cancel 继续进入 `AppState::cancel_delegation_run`，不新增 control path。Retry 仅接受 Failed/Cancelled source，创建带独立 `retryOfRunId` 的 immutable run，复用 frozen request/target snapshot 但清空旧 backing/native/runtime owner；AppState 在重新验证 workspace、engine gate、target availability 后才允许 existing dispatcher claim 新 run。dispatch 已产生 durable terminal settlement 时返回该新 run identity，settlement 缺失时错误显式携带新 runId。

Live presentation 由 process-wide observer 订阅 existing `AgentEventBus`，仅在 `runId` 能被 durable Agent Bridge registry 确认时转发 `agent-bridge-event`。该 adapter 不是第二套 event bus，也不持久化 delta；frontend event hub 只在存在局部 subscriber 时监听。Queued/local cancellation 也通过 existing bus 发布一次 deduplicated `run.settled(cancelled)`，从而同时唤醒 DAG 与 UI。

聊天列中的 Bridge surface 使用 feature-local hook：先通过 workspace list command hydrate durable runs，再用当前 canvas 的 logical thread + active native thread identities 匹配 root source ownership；descendant 不自行声明可见性，而是随已匹配 root lineage 展示，因此 isolated runtime workspace 不会把 child 从 source 对话中割裂。renderer 收到 known run 的 lifecycle/control fact 后只做去重的 exact get refresh；unknown critical run（包括刚启动的 isolated child）触发一次 bounded workspace re-list。canonical `usage.updated` / `tool.started` / `tool.completed` 只归并到 card-local、最多 64-run 的 token totals + latest tool state；heartbeat 不触发 durable read。`delta` lane 不写 React state，elapsed 的低频本地 timer 与 event listener 都由卡片 effect cleanup。WaitingApproval 只显示 durable 状态，不复制 Approve/Reject control owner；Stop 继续调用 backend workspace-scoped cancel command。

Terminal card 保留 Retry/Open Session/View Result/View Diff 操作。Result/Diff dialog 只读取 durable `DelegationResult`/error，不解析 hidden transcript 或 CLI output。Open Session 是显式用户动作：feature-local navigation request 由 existing layout thread-selection owner 消费，使用 exact `runtimeWorkspaceId ?? workspaceId` + `backingThreadId`；不把 handler/state 加进 AppShell root，也不取消 ordinary Shared Session UI 对 backing session 的过滤。

Bridge surface 与 existing Multi-Agent V1 surface 在 ConversationHost 中并列组合，不替换 messages/composer/inspector owner。当前 conversation 没有 visible delegated run 时 Bridge 返回 null，因此 Single Agent 路径不增加卡片、锁或 runtime side effect；V1 surface 的 projection/approval 行为保持原 owner。

## Safety Guards

- configurable `max_depth`；
- per-parent child concurrency limit；
- global active run limit；
- cancellation propagation policy；
- terminal settlement idempotency；
- source identity 来自 runtime/tool binding，不能由 prompt 参数伪造；
- worktree path ownership validation；
- workspace identity 在 `AppState` boundary 验证；
- unknown/disabled/unavailable target 在 run creation 前 fail closed。

## Migration Plan

1. OpenSpec + Bridge Core data model + in-memory registry + unit tests。**已完成。**
2. 接 `AppState`/service owner + engine availability validation；不暴露 UI/MCP。**已完成。**
3. 接 existing engine/shared dispatch，完成单跳 delegation。
4. 接 AgentEventBus result/continuation/cancel。
5. durable persistence/recovery。
6. Agent-facing MCP Gateway。
7. worktree isolation。
8. 在现有 `agent_orchestration` 上增加 Parallel / DAG / nested scheduling，并评估 V1 stage migration。
9. collaboration UI。
10. strict validation、ADR 校准、verification、sync/archive。

## Rollback

Bridge 为 additive child domain；停止注册 bridge service/MCP/UI 即可回退，不影响现有 Single Agent 与 Multi-Agent V1。新持久化字段必须 versioned/defaultable。

## Open Questions

- `agent_wait` 使用 bounded long-poll 还是 notification subscription，实施 MCP transport 时确定。
- Worktree merge 首版不自动执行，默认返回 branch/diff，由 source Agent/用户决定 merge。
