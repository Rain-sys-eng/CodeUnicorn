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
- [ ] 2.5 增加 source/target engine registry validation 与 cycle semantics（需要 runtime identity integration）。

## 3. Runtime Integration

- [ ] 3.1 将 bridge service/state 以 narrow owner 接入 `AppState`。
- [ ] 3.2 复用 EngineManager / EngineAdapterRegistry 验证 target engine availability/capability。
- [ ] 3.3 复用 Shared Session/engine send core 完成单跳 delegated dispatch，不直接 spawn CLI。
- [ ] 3.4 将 native/logical session binding 写回 delegated run。
- [ ] 3.5 通过现有 AgentEventBus 以 delegated `run_id` 归属 target engine events。

## 4. Result / Continuation / Cancellation

- [ ] 4.1 从 terminal event/native result 生成 normalized delegated result。
- [ ] 4.2 实现 `agent_send` continuation，对 Persistent/OneShot engine 保持统一上层 contract。
- [ ] 4.3 实现 `agent_cancel` 与 cancellation propagation；cleanup 失败保留 owner 便于 retry/diagnostics。
- [ ] 4.4 approval request 不自动放行，沿现有 approval contract 转发。

## 5. Persistence / Recovery

- [ ] 5.1 设计 versioned durable run fact schema。
- [ ] 5.2 复用 storage lock + atomic write 持久化 identity/lineage/status/session/result metadata。
- [ ] 5.3 App 重启后恢复 run facts，不持久化全部 live deltas。
- [ ] 5.4 stale native binding fail-closed，并提供 recoverable state。

## 6. Agent-facing MCP Gateway

- [ ] 6.1 新增 bridge MCP transport adapter。
- [ ] 6.2 暴露 `agent_list` / `agent_delegate` / `agent_status` / `agent_wait` / `agent_result` / `agent_send` / `agent_cancel`。
- [ ] 6.3 source identity 从 runtime/tool session binding 解析，禁止由 prompt 参数伪造。
- [ ] 6.4 将 bridge MCP 提供给支持 MCP 的 CodeUnicorn-managed engine，且不覆盖用户配置。

## 7. Context Policy

- [ ] 7.1 默认 Explicit：仅 task + explicit file refs/context。
- [ ] 7.2 Portable/Inherited 复用现有 context compiler 与 budget/omission contract。
- [ ] 7.3 增加敏感/超预算/不可迁移 context 的 fail-closed evidence。

## 8. Worktree Isolation

- [ ] 8.1 实现 `Observe` / `SharedWorkspace` / `IsolatedWorktree` scope mapping。
- [ ] 8.2 并行写任务 provision 独立 worktree/branch，记录 ownership。
- [ ] 8.3 result 返回 changed files/diff/branch/artifact metadata；默认不自动 merge。
- [ ] 8.4 cleanup 遵循 owner-retention-on-failure contract。

## 9. Orchestration Expansion

- [ ] 9.1 在现有 `agent_orchestration` 上增加 Parallel / DAG plan model，不建第二套 orchestrator。
- [ ] 9.2 dependency scheduler 仅通过 Agent Bridge 调度 delegated runs。
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
- [ ] 11.3 MCP contract tests、parallel/cancel/recovery integration tests、fake-engine tests。
- [ ] 11.4 手工验收 Claude→Codex、Codex→Claude、并行三 Agent、nested delegation、worktree isolation。
- [ ] 11.5 strict OpenSpec validate / consistency sync。
- [ ] 11.6 更新 foundation ADR，写 verification，sync main specs，archive change。
