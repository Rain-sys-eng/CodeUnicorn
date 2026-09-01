# CU-A2A-001 Verification

> 状态：Automated verification complete；PR 保持 Draft。真实 runtime 手工闭环按用户安排作为最后一项执行。
> Change：`add-cross-engine-agent-delegation`
> Branch：`feat/cross-engine-agent-delegation`

## 1. Architecture invariants

| Invariant | Evidence |
| --- | --- |
| 不重写 Agent Runtime | delegated dispatch 只调用 Shared V2 worker lifecycle 与 existing `EngineManager` runtime；Bridge 无 CLI stdout parser/spawn owner |
| 不建第二套 orchestrator/event bus | Bridge、graph coordinator 均位于 existing `agent_orchestration`；runtime/control/settlement events 复用 process-wide `AgentEventBus` |
| MCP 只是 transport | 七工具调用链为 managed transport → `mcp_runtime` → `mcp_gateway` → `AppState`/`AgentBridgeService` |
| source/parent identity 不可由参数伪造 | Claude/Codex/Qoder route 使用 bearer、workspace、CodeUnicorn-minted locator、exact live runtime turn/native session；legacy/idle/stale/ambiguous route fail closed |
| delegated permission 不提升 | `ApprovalRequest` 只同步 `WaitingApproval`；existing native/UI control owner 发布 `ApprovalResolved` 后 Bridge 才恢复或拒绝，没有 auto-approve path |
| durable ownership | run/lineage/binding/result、worktree owner 与 DAG node→run mapping disk-first；future schema、corrupt graph、stale active runtime 均 fail closed |

## 2. Focused automated evidence

| Check | Result |
| --- | --- |
| `git diff --check` | ✅ pass |
| `node scripts/check-agent-domain-event-schema.mjs` | ✅ pass |
| `node scripts/check-engine-adapter-registry.mjs` | ✅ pass（9 built-ins） |
| `node scripts/check-engine-capability-matrix.mjs` | ✅ pass（15 capabilities） |
| strict OpenSpec validate | ✅ `OPENSPEC_TELEMETRY=0 npm exec --offline --yes @fission-ai/openspec@latest -- validate add-cross-engine-agent-delegation --strict --no-interactive` 已通过；当前 executor 无本地 openspec binary，后续离线复跑受连接策略阻断 |
| GitHub CI run 13 `memory-kind-contract` | ✅ success；真实 Rust 编译确认 daemon fail-closed Bridge stubs 与 Qoder boundary 可编译 |
| GitHub CI run 14 | ❌ 首轮新增 graph test 编译发现 backend trait object 缺 `Sync`，使 spawned observer future 非 `Send`；已在窄 contract 增加 `Sync` 上界，等待后续 CI 复验 |
| GitHub CI run 15 `memory-kind-contract` | ✅ success；`Sync` 修复通过真实 Rust 编译 |
| GitHub CI run 15 full Rust | ⚠️ 2647 passed / 15 failed；Agent Bridge/Qoder/DAG focused tests 全部通过，15 项均在 existing app-server/Claude history/DSH/runtime/session-management baseline；无 change-side test failure |
| GitHub CI run 15 rustfmt | ❌ 检出本 PR 多批 Rust 文件存在 formatting diff；后续由 CI artifact 导出并原样应用 |
| GitHub CI run 20 changed-file rustfmt | ✅ 声明的 27 个 Rust changed files 以 `skip_children=true` 隔离 existing unlisted-module baseline 后全部通过；未降低 `--check`，无 patch artifact |
| GitHub CI run 20 `memory-kind-contract` | ✅ success；最新 Bridge/Qoder/DAG/daemon 边界在格式化与稳定 match arm 后完成真实 Rust 编译复验 |

## 3. Contract coverage

- Core：immutable run/lineage、depth/child/global limits、atomic dispatch claim、terminal idempotency。
- Approval：Running → WaitingApproval → Running/Failed；requestId correlation、accept/reject、late/duplicate control fact。
- Runtime：real single-hop Shared V2 dispatch、canonical `conversation.turnCommitted` result、continuation native binding reuse、exact-attempt cancel。
- Persistence/recovery：malformed quarantine、future schema/I/O fail closed、stale Running/WaitingApproval recovery-required。
- MCP：七工具 schema/call、legacy route denial、bearer rejection、unknown/stale locator、delegate→wait/result、send、cancel、nested source ownership。
- Managed ingress：Claude MCP、Codex app-server process overlay、Qoder ACP per-turn HTTP descriptor；均不覆盖 user config。Kimi/OpenCode capability 为 `mcp=false`，Gemini runtime policy disabled，不伪造 transport。
- Context/worktree：Explicit/Portable/Inherited、checksum/provenance、omission fail closed、isolated worktree durable owner/diff metadata。
- Parallel/DAG：validated deterministic graph、mapping-before-dispatch、restart reconcile、settlement wake；fake Bridge 并发 tick 验证 root→双 fan-out→join 每个 run 只创建/dispatch 一次。
- UI：workspace-scoped durable tree/card、bounded usage/tool state、cancel/retry/result/diff/open-session；无 visible run 时不影响 Single Agent/V1 surface。

## 4. CI baseline classification

CI 中以下失败在本 change 前后保持同一现有基线，不作为 Agent Bridge 假绿处理：

- lint：`workerAdapterCrashBackoff.test.ts` existing `prefer-const`，并伴随既有 warnings。
- test-js：`app-shell.startup.test.tsx` existing maximum-update-depth failures。
- typecheck job：runtime contracts / AppShell governance 通过后，在 existing messages boundary gate 失败。
- docs：existing repository documentation governance backlog。

Agent Bridge 自身引入的首轮 daemon compile failure已修复，并由后续 CI 单独复验；PR 在自动化与真实 runtime 手工证据齐全前保持 Draft。

## 5. Manual runtime acceptance — final local gate

以下作为最后唯一需要用户本地 Windows/真实 CLI 环境执行的联调批次：

- [ ] Claude → Codex：delegate → wait/result；覆盖一次 approval approve 与 reject。
- [ ] Codex → Claude：managed Codex MCP source identity 与 reverse delegation。
- [ ] Parallel three-agent：两个并行 child + join/result，确认无 duplicate run。
- [ ] Nested delegation：child source/parent/root/depth 与 workspace ownership 正确。
- [ ] Continuation：`agent_send` 创建 immutable continuation，并复用原 backing/native binding。
- [ ] Cancellation：queued/pre-dispatch/live runtime exact owner 三种路径不误停其他会话。
- [ ] IsolatedWorktree：owned branch/workspace、changed files/diff、无 auto merge/cleanup。
- [ ] Restart recovery：stale Running/WaitingApproval fail closed，不自动重启越权 runtime。

## 6. Closure rule

完成 GitHub CI automated evidence 后，只保留第 5 节手工 runtime acceptance。用户提交本地结果后，再更新本文、执行最终 consistency check，并归档 OpenSpec change/将 PR 从 Draft 收口；在此之前不声称真实 runtime 已验收。
