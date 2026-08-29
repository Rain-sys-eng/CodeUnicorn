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

- child workspace 与 parent workspace 相同；
- child source engine 必须等于 parent target engine；
- parent 指向只允许 existing older run，新 child 使用全新 run identity，因此 run graph 不提供回指 ancestor 的结构入口；
- recursive explosion 继续由 max depth、per-parent child 与 global active limit 控制。

### 5. 第一批 Core 使用明确 state machine 与幂等 settlement

Run registry 拒绝 terminal → non-terminal 回退；重复相同 terminal settlement 幂等；cancel/complete race 只允许一个 terminal owner。

### 6. Context policy 默认 Explicit

```text
Explicit
Portable
Inherited
```

默认 `Explicit`；Portable/Inherited 后续复用已有 context compiler 与 budget/omission contract。

### 7. Execution scope 三态

```text
Observe
SharedWorkspace
IsolatedWorktree
```

Bridge 只保存 scope fact；Git provisioning/cleanup 在独立 integration 中完成。

### 8. MCP Gateway 只做 transport adapter

`agent_list/agent_delegate/agent_status/agent_wait/agent_result/agent_send/agent_cancel` handler 只做 validation/source identity resolution 与 Bridge service 调用，禁止直接 spawn CLI。

### 9. Event attribution 复用 AgentEventBus

Target engine events 继续进入现有 `AgentEventBus`，以 delegated `run_id` 归属；不创建平行 streaming event system。

### 10. Permission 采用“不得提升”原则

Delegated target 可以继承更严格权限，但不能因为 source 调用 Bridge 就提升 access mode/sandbox/MCP/file/network permission。

### 11. Engine availability 在 run creation 前 fail closed

Bridge 只接受当前 built-in engine registry 的 canonical engine ids。source/target id 会先 canonicalize；未知或 disabled engine 直接拒绝。target availability 复用 `EngineManager` status cache；缓存没有已安装证据时才走现有 refresh gate。CLI 未安装、不可达或 runtime policy disabled 时，不创建 delegated run。

这一步只做 target validation，不启动 target process；实际 dispatch 仍由后续 dispatcher 通过现有 send/session boundary 完成。

### 12. Existing Multi-Agent V1 后续改为 Bridge consumer

现有 Plan/Implement/Review V1 暂不迁移。Bridge 稳定后，可把 V1 每个 stage dispatch 改为通过 `AgentBridgeService` 发起，从而统一 runtime ownership/observability；迁移必须保持 V1 projection 与用户确认行为兼容。

### 13. Durable facts 与 live deltas 分离

持久化 identity、lineage、target、scope、status、session binding、result/artifact metadata；不持久化全部 token/tool deltas。

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
