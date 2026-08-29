## Why

CodeUnicorn 已经能够在同一桌面应用内原生承载 Claude Code、Codex、Gemini、Kimi、OpenCode 等多个 CLI engine，并具备 `EngineAdapterRegistry`、`AgentEventBus`、Shared Session V2、Execution Target 与 context compiler 等跨引擎基础设施。仓库同时已有 `agent_orchestration` Multi-Agent V1，用于用户配置的 Plan → Implement → Review 线性阶段编排，但它明确不提供 DAG scheduler，也不提供 **Agent-to-Agent delegation**。

当前缺口是：一个正在运行的 Agent 不能主动把子任务委派给另一个 Agent、跟踪其状态、获取结果并继续自己的工作。CodeUnicorn 需要在不重写各家 Agent Runtime、不牺牲原生 CLI 能力的前提下，为现有 orchestration domain 增加统一 Agent Bridge，并逐步扩展为真正的 multi-agent collaboration。

## 目标与边界

- 在现有 `agent_orchestration` domain 内增加 engine-agnostic Agent Bridge，统一表达 delegation、continuation、status/result/cancel。
- 复用现有 EngineManager / EngineAdapterRegistry / AgentEventBus / Shared context 能力，禁止新建第二套 engine runtime、event bus 或平行 orchestration domain。
- 允许任意支持的 Agent 作为 source/target，不写死 Claude 为 supervisor。
- 支持异步 delegation、parent/child lineage、并发上限、depth/cycle guard、cancellation propagation。
- 支持 `Observe`、`SharedWorkspace`、`IsolatedWorktree` execution scope。
- 建立 Agent-facing MCP Gateway，使 CodeUnicorn 启动的 Agent 能通过统一 MCP tools 调用 Agent Bridge。
- 保持现有 Multi-Agent V1 linear workflow 与所有 Single Agent Mode 行为不回退。

## What Changes

- 新增 `src-tauri/src/agent_orchestration/bridge/**`：delegation DTO、run registry、service boundary、lineage、result、context policy、permission/cancel contract 与后续 durable persistence/dispatcher。
- `AppState` 持有唯一 long-lived `AgentBridgeService`；workspace identity、engine canonical id、enable gate 和 target availability 在 run creation 前校验。
- 在现有 `agent_orchestration` 上扩展 Parallel / DAG / nested delegation，避免创建第二套 orchestrator。
- 将 Agent Bridge dispatch 接入现有 EngineManager / Shared Session execution target，而不是直接 spawn/parse 各 CLI。
- 新增 Agent Bridge MCP tools：`agent_list`、`agent_delegate`、`agent_status`、`agent_wait`、`agent_result`、`agent_send`、`agent_cancel`。
- 新增 collaboration frontend domain：delegation tree、run status、tool activity、approval、result/diff、stop/retry/open session。
- 新增 worktree isolation 与 delegated task artifact/result metadata；只持久化 durable facts，不持久化全部 streaming delta。

## 非目标

- 不重写 Claude Code、Codex、Gemini、Kimi、OpenCode 的 Agent Loop。
- 不把所有 engine 强制统一为 stdin/stdout。
- 不直接嵌入 PAL/clink、CAO、Reeves 等外部 orchestrator 作为 runtime dependency。
- 不默认绕过 sandbox/approval。
- 不要求所有 delegated task 共享完整 source Agent transcript；默认 context policy 为 Explicit。
- 当前 Core/Service 批次不改 UI、不改现有 Multi-Agent V1 execution path。

## Capabilities

### New Capabilities

- `cross-engine-agent-delegation`: 跨 engine delegation、run lifecycle、lineage、context/scope、result/cancel 与 permission contract。
- `agent-bridge-mcp-gateway`: Agent-facing MCP tools、source identity 与 bridge service boundary。
- `delegated-worktree-isolation`: 并行写任务 worktree scope、artifact/diff/result contract。
- `multi-agent-collaboration-surface`: delegation tree、状态、approval、result 可观测性 UI。

### Modified Capabilities

- `multi-agent-orchestration`: 将现有线性 Plan/Implement/Review V1 扩展为可消费 Agent Bridge 的 Parallel / DAG / nested delegation，同时保持原 V1 workflow 兼容。

## Impact

- Backend：主要新增 `agent_orchestration/bridge/**`，并窄接线 `state.rs`；后续进入 shared/engine dispatch boundary。
- Frontend：后续新增 collaboration domain；普通聊天及现有 Multi-Agent V1 保持兼容。
- Runtime：复用各 engine native session 与 AgentEventBus；Bridge 只持有 logical run ownership。
- Storage：后续新增 delegated run durable facts，遵循 lock + atomic write。
- Git：写任务可采用 isolated worktree。
- Security：delegation 不提升 target 权限，approval 继续走现有确认链。

## 当前实现进度

- 已完成 Core DTO、run registry、lineage/depth/concurrency/terminal settlement。
- 已完成 `AgentBridgeService` 与 AppState single owner。
- 已完成 canonical source/target validation、engine enable gate、target CLI availability fail-closed、workspace identity gate。
- 未开始实际 target dispatch、AgentEventBus result binding、persistence、MCP、worktree、UI。

## 验收标准

- Claude → Codex 与 Codex → Claude 均可完成 delegation。
- Claude 可同时 delegate Codex + Gemini + Kimi，run 可独立并行、查询、取消和结算。
- 支持 Claude → Codex → Gemini 等 nested delegation，并有 depth/cycle guard。
- target events 通过现有 AgentEventBus 归属 delegated run。
- 并行写任务可使用独立 worktree，返回 branch/diff/changed-files metadata。
- durable delegated run facts 可恢复；streaming delta 不要求完整持久化。
- Single Agent Mode 与现有 Multi-Agent V1 无回归。
- 不新增第二套 engine parser、event bus 或平行 orchestration domain。
- strict OpenSpec、focused tests、runtime contracts、typecheck 与受影响 gates 通过。
