# fix-turn-terminal-live-text-commit-loss

## Why

实时对话**小概率**在回合结束后「缺少渲染」：assistant 终稿气泡只剩建壳首 delta（用户截图里只剩「完全」，正文整段消失），但脚注已呈 final 态并带 `耗时`；**关闭会话重开历史后全文完整回显**。Native（codex-native）与 Shared 会话均出现。

证据表明会话本身正确结束、后端投影完整，丢失的只是 renderer durable 终稿提交。根因（已逐行核实，见 `docs/analysis/turn-terminal-live-text-commit-loss-2026-08-25.md`）：

- codex / `shared:` / `agent-canvas:` 走 normalized 路由（`useAppServerEvents.ts` `shouldRouteDirectly`）。assistant 文本 delta（增量式 `appendAgentMessageDelta`）进入 **contract realtime batcher**（`realtimeEventBatcher.ts`）：first-token 同步提交、后续按 key coalesce，cadence flush（32ms）以 `startTransition` **延迟**提交。
- `turn/completed` 到来时，`onTurnCompletedTracked` 先 `flushPendingRealtimeEvents()`，但它只 flush 两条 legacy 队列（`pendingRealtimeDeltaOpsRef` / `pendingNormalizedRealtimeOpsRef`），**不 drain contract batcher 的积压 delta**；随后 `settleCompletedTurn` **同步**安装 terminal barrier（`markRealtimeTurnTerminal`）。
- batcher cadence 定时器在 barrier 之后触发 → `applyNormalizedRealtimeEventNow` / `run()` 的 `isRealtimeTurnTerminal` 守卫把积压 delta **静默丢弃**（计入 `droppedLateRealtimeEventCountRef`）。末段全文若在 barrier 前只提交了 first-token 壳（如「完全」），durable 就冻结在该前缀。
- 迟到的 `completeAgentMessage`（cross-channel 乱序，item 事件晚于 turn 事件到达）同样被 exact-turn 守卫丢弃——normalized 路由**没有** direct 路由的 `onAgentMessageCompleted` terminal-salvage 分支。
- direct 路由（claude/gemini/grok/kimi/pi/dsh/qoder/opencode native）免疫：delta 同步进 `liveAssistantTextChannel`，turn 结算时 `flushRealtimeDeltaOps` 同步提交 + `settleLiveAssistantFullText` 从通道取全文落 durable，另有 complete 的 terminal-salvage 分支。

小概率成因：末段全文与 `turn/completed` 落在同一 32ms cadence 窗口（native IPC 批量送达 / 主线程被长 Markdown 编译或 AppShell 根渲染 jank 卡住定时器）才会输。`realtime-event-batching-performance` spec 已声明「Terminal Events MUST Flush Pending Batches」，但实现只覆盖「terminal 事件经 batcher.push 路过」的场景；`completeAgentMessage` 根本不进 batcher（`shouldUseContractRealtimeBatcher` 仅命中 `appendAgentMessageDelta`），`turn/completed` 也不触发 batcher drain——spec 与实现存在缺口。

## What Changes

- **Fix 1（主修）**：turn terminal 结算路径（`onTurnCompletedTracked` / `onTurnErrorTracked` / `settleDurableRealtimeTurn` / 线程切换 / unmount 共用）在 `flushPendingRealtimeEvents` 内**同步 drain contract batcher**（`flush("terminal")`），把积压 delta 在 barrier 建立**之前**落 durable。与 direct 路由 `flushRealtimeDeltaOps` 的同步语义对齐。
- **Fix 2（兜底）**：normalized 路由为 barrier 之后到达的 `completeAgentMessage`（非空 assistant 正文）增加 **terminal salvage**：不再静默丢弃，改为同步合入 durable（复用 reducer `mergeCompletedAgentText` 的更长者优先语义），且**不**复燃 processing。语义对齐 direct 路由既有 `onAgentMessageCompleted` terminal-salvage 分支。
- 固化不变式：**terminal barrier 建立前，所有已入队的正文事件必须同步提交；barrier 之后到达的终稿事件必须可 salvage，不得静默丢全文**。
- 补 Vitest 回归（replay 顺序：末段 burst → turn/completed → cadence flush；barrier 后 completeAgentMessage）与诊断计数（salvage 与 drop 分开计数）。
- **不改** reducer 文本合并、不改 `liveAssistantTextChannel` 契约、direct 路由零改动、不改 provider 适配器与 history loader。

## 目标与边界

- **目标**
  1. 消除「结束后缺渲染 / 只剩建壳首字」：回合结束后不重开会话，终稿气泡 MUST 显示与历史一致的全文。
  2. 跨引擎一次修好：normalized 路由（codex-native / shared / agent-canvas）共用路径全部受益；direct 路由不受影响。
  3. 用可重复 replay 回归锁死 barrier 相位；`thread/session:realtime-late-event-drop` 不再因本类事件增长。
  4. 保持 A4 live-text 性能预算：禁止恢复逐 delta 根 reducer；terminal drain 为一次性小批量同步提交。
- **边界**
  - 仅前端 thread realtime 事件路由 / contract batcher / turn settlement 及相关测试、契约。
  - 行为变更以 OpenSpec delta 为准；分析文档可回链更新状态。

## 非目标

- 不重写 `liveAssistantTextChannel` 或让 normalized 路由改走 live channel（改动面大、渲染行为变化，另议）。
- 不改 provider 协议、不改 history loader 主路径、不把「重开历史」当修复。
- 不触碰 direct 路由既有逻辑（其三重兜底已足够；仅观测，不重构）。
- 不处理「interrupt / 手动停止」的尾段回显（那是另一条 drain 路径，已有实现）。
- 不在本 change 处理 codex snapshot 滞后可见性等其他历史遗留。

## 技术方案对比

| 方案 | 描述 | 优点 | 风险 | 结论 |
|------|------|------|------|------|
| A. 仅文档 + 用户「重开会话」 | 不改代码 | 零风险 | 信任与 parity 合同持续破损 | **否决** |
| B. 结束后强制 history reload 纠错 | turn 完成后强制 loader 重投影 | 实现省事 | 闪烁、丢 live 态、掩盖根因、perf 差 | **否决为主路径** |
| C. normalized 路由改走 live channel | 与 direct 路由同构，结算复用 `settleLiveAssistantFullText` | 架构最对称 | 渲染文本源切换，MessageRow 行为面大，回归风险高 | **暂缓** |
| **D. terminal drain + late-complete salvage（推荐）** | 结算前同步 drain contract batcher；barrier 后迟到 complete 走 salvage | 对准根因；改动面小且局部；不改变流式渲染路径；spec 缺口直接闭合 | 需精确处理 salvage 的 processing 复燃与去重 | **采用** |

## Capabilities

### New Capabilities

- `turn-terminal-text-commit-integrity`: turn terminal barrier 前后，正文事件提交与终稿落盘的完整性契约——barrier 前已入队正文 MUST 同步提交；barrier 后迟到终稿 MUST 可 salvage；durable 不得冻结在 live 前缀而历史完整。

### Modified Capabilities

- `realtime-event-batching-performance`: 精确化「Terminal Events MUST Flush Pending Batches」——terminal 结算 MUST drain contract batcher 积压（含 `turn/completed` 自身触发的结算路径，而不只是 terminal 事件路过 batcher）。
- `conversation-realtime-history-parity`: 补充「live settle 后不得冻结在流式前缀」的 parity 约束（live 终稿与 history hydrate 的正文 MUST 一致）。

## Impact

| 层 | 影响面 |
|----|--------|
| Frontend core | `useThreadItemEvents.ts`（`flushPendingRealtimeEvents` 增加 batcher drain；`dispatchNormalizedRealtimeEvent` / `run` / `applyNormalizedRealtimeEventNow` 增加 salvage 分支；`onNormalizedRealtimeEventTracked` exact-guard 放宽仅限 salvageable complete）、`realtimeEventBatcher.ts`（如需要暴露 `flush("terminal")` 复用，仅接口层微调）、`useThreadEventHandlers.ts`（仅接线处，可能无需改） |
| Tests | `realtimeEventBatcher.test.ts` 扩展；新增 `useThreadItemEvents` 层 replay 顺序回归（末段 burst + barrier + cadence flush；barrier 后 completeAgentMessage）；既有 `useThreadTurnEvents.test.tsx` / `liveTextSegment` / `realtimeBoundaryGuard` / `Messages.live-behavior` 保持绿 |
| Specs | 新 capability + 两条 main spec delta |
| Docs | 新增 `docs/analysis/turn-terminal-live-text-commit-loss-2026-08-25.md`（证据链）；无需产品文案 |
| Perf | **禁止**恢复 per-delta 根 reducer；terminal drain 单次小批量同步，不新增轮询 |

## 验收标准

1. **P0 复现形态**：codex-native 与 shared 会话，长终稿回合结束后**不关会话**，终稿气泡显示完整正文（等于历史）；不再出现「只剩建壳首字」。
2. **Race 回归**：replay 顺序「末段 delta burst → `turn/completed`（barrier 同步建立）→ cadence flush」时，终稿 MUST 完整；「barrier 之后 `completeAgentMessage`」时，终稿 MUST salvage 落盘且**不**复燃 processing（`isProcessing` 不复活、`activeTurnId` 不复活）。
3. **first-token / 流式中**既有行为保持：first delta 仍同步建壳；cadence 延迟提交仅存在于流式中，不得影响结算。
4. **去重与顺序**：同一 item 多次 complete / late complete 不产生双气泡；`markThreadAgentCompletionSeen` 去重语义不变。
5. **跨引擎**：codex-native / shared / agent-canvas 共用路径单测覆盖；direct 路由既有测试全绿（零改动验证）。
6. `liveTextExternalization` 默认开；tsc + focused Vitest + `openspec validate --strict` 通过；无磁盘 schema 变更、无 BREAKING API。
7. `thread/session:realtime-late-event-drop` 诊断中不再出现被丢弃的 assistant 终稿事件（或新增 `salvaged` 计数可核对）。

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| terminal drain 把其他线程积压 delta 同步提交 | 语义正确（本就会在 ≤32ms 提交），batch 极小；如需可后续按 thread 收窄 |
| salvage 误收旧 turn 终稿污染新 turn | 事件按 turnId/itemId 作用域；reducer merge 取更长者；`markThreadAgentCompletionSeen` 去重 |
| salvage 复燃 processing | salvage 分支显式 `skipProcessingMark`；不得触碰 `activeTurnId` / lifecycle |
| 双气泡 | 复用既有 merge 语义；补同 item 多 complete 回归 |
| cadence 定时器与 drain 双触发 | drain 后 pending 清空，定时器再触发返回 null，无重复提交 |

回滚：revert 本 change 前端提交即可；无迁移、无 schema 变更。
