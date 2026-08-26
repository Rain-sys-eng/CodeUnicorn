# Error / Perf 日志体检击破计划（v0.9.3，2026-08-25）

数据来源：

- `~/.ccgui/error-log/2026-08-18 ~ 08-24.jsonl`（client error log，7 天 1135 条）
- `~/.ccgui/client/diagnostics.json`（renderer diagnostics，08-19 ~ 08-25 共 579 条）

总体原则：

- 先修「有完整现场数据、范围小」的项，快速建立信心；再攻「需要复现测量」的项。
- 每项收口标准 = 对应 diagnostics label 在新日志中消失或降到阈值以下，而不是"代码看起来对了"。
- 涉及行为变更 / 跨层 contract 的项（W2、E1、E2 可能命中）先开 OpenSpec change；纯 bugfix / 降噪直接 PR。
- 改流式 / 根链渲染前重读 `docs/perf/pr-1092-performance-retrospective.md` 红线；改切会话链路前重读 `dev-guidelines/guides/session-switch-catalog-fetch-pitfall.md`。

---

## 第一梯队：范围小、现场完整（本轮先做）

### W1. MessagesAnchorRail 幂等写循环（overlay-loop-guard counter 最高 132） ✅ 2026-08-25

- 证据：`messages/overlay-loop-guard` 31 条，`threshold: idempotent-state-write`，同一 thread 内 counter 8 → 132 持续累积，reason 为 scroll/sync。
- 入口：`src/features/messages/components/MessagesCore.tsx`（`commitActiveAnchorId` / `scheduleAnchorUpdate` / `resolveIdempotentRenderLoopGuard`，~L1330-1400）、`MessagesAnchorRail.tsx`。
- 假设：guard 拦截了 commit，但触发源（scroll listener / sync effect）本身在以近每帧频率被调用；signature 里含 `messageAnchors.length`，anchors 变化会重置 budget 导致循环永不冷却。
- 动作：
  1. 加临时计数确认触发源是 scroll 还是 sync（各打一条 volatile diagnostic）。
  2. scroll 源 → rAF 节流 + passive listener 确认；sync 源 → 检查依赖是否每渲染都变（如 `messageAnchors` 数组 identity）。
  3. 消除触发源后，guard 只作兜底保留。
- 验收：同一长会话滚动 5 分钟，`overlay-loop-guard` 不再新增；`npm run check:app-shell:governance` 通过。
- 落地：`resolveAnchorSchedulePlan`（钉底且已是 latest → skip，并取消排队 rAF）。真正改 active 仍走 rAF，避免 effect 同步 setState 打乱既有跟随时序。
- 测试：`messagesAnchorSchedule.test.ts`（5）、`Messages.anchor-loop-guard.test.tsx`（3，含 pinned scroll storm 不得触发 loop-guard）。`Messages.test.tsx` 37 通过；`Messages.live-behavior` 维持基线 10 个预置失败，不再新增 `keeps the latest anchor stable` 超时。

### W2. chat-input-adapter 重复渲染（renderCount 最高 318，idle 状态也在重渲） ✅ 2026-08-25

- 证据：`perf.composer.render-budget` 38 条，`isProcessing: false`、`streamActivityPhase: idle` 下 renderCount 132~318。
- 入口：`src/features/composer/components/ChatInputBox/ChatInputBoxAdapter.tsx`；埋点在 `src/services/rendererDiagnostics.ts` L1347。
- 假设：adapter 订阅了过宽的 context / store（每次击键或外部 store 写入都穿透 memo），或 props 每渲染新建（对象/函数 identity 不稳）。
- 动作：
  1. 用 React `memoizedUpdaters` / why-did-you-render 定位穿透源（重点怀疑 composer store 的 selector 返回新对象）。
  2. selector 改浅比较稳定引用；props 用 `useMemo`/`useCallback` 固化。
  3. 命中 Render Perf 红线①（高频 setState 禁挂根链），若源头在根链 store 写入则需按红线③改事件驱动。
- 验收：连续输入 200 字符，render-budget 单条 renderCount < 50；governance 测试通过。
- 落地：① Composer `onSelectEffort` 改为 `handleSharedEffortChange` / `handleCreationEffortChange`（稳定 useCallback，禁止 JSX 现场造 lambda）；② adapter memo 对 models/engines/providerModelCatalogs/executionTarget/files/directories/reasoningOptions 做结构相等。
- 测试：`ChatInputBoxAdapter.test.tsx` 65 通过（含 catalog 结构不变不重渲 / 内容变化必重渲）；`ChatInputResponsiveness.guard.test.ts` 增加 source guard，防止 onSelectEffort 再被写成内联箭头。

### W3. 日志降噪：codex stderr 噪音 + markdown precompute 噪音 ✅ 2026-08-25

- 证据：
  - `codex-model-refresh-child-exit-timeout` 876 聚合行 / 1108 原始次，占 error log 77%（上游 Codex CLI `codex_models_manager` 已知行为，代码已分类 known-safe）。
  - `perf.messages.markdown.precompute` 86 条几乎全是 `below-threshold` + `durationMs: 0`。
- 入口：
  - 聚合写盘：`src/features/threads/hooks/threadAppServerEventDiagnostics.ts` + `src/features/debug/utils/clientErrorLog.ts`
  - precompute 埋点：`src/services/rendererDiagnostics.ts` L1433
- 动作：
  1. known-safe reason code 改为按日总量 cap（如每日首条 + 每 100 条汇总一条），不再逐条聚合成行。
  2. `unclassified-stderr` 保持全量（它是发现新上游问题的哨兵，不能降）。
  3. markdown precompute：仅 `durationMs >= 阈值` 或 `evidenceClass !== unsupported` 时落 diagnostics。
- 验收：新日志中 error log 日增量 < 100 行且真实错误占比 > 50%；precompute 只留有数值的条目。
- 落地：① `shouldPersistKnownSafeStderrAggregate`：known-safe 每日首条 + 每 100 raw 一条，`unclassified-stderr` 全量保留；② `shouldAppendMarkdownPrecomputeDiagnostic`：`unsupported` 且 `durationMs < 8` 不落盘。
- 测试：`clientErrorLog.test.ts` 11 通过；`useDebugLog.test.tsx` 15 通过（含 cap 用例，unclassified 不被误伤）；`rendererDiagnostics.test.ts` 新增 below-threshold 丢弃用例，39 通过。

---

## 第二梯队：功能性错误（用户可感知）

### E1. history-hydrate-empty：重开会话历史为空（10 条，reopenOutcome: failed） ✅ 同事已修（2026-08-25 复核）

- 证据：`thread/history readable surface`，`localItemCount: 0 / snapshotItemCount: 0 / fallbackWarningCount: 0~1`，codex 与 claude 两种 thread 都命中；同窗口伴生 `thread/history loader error`（partial_history）51 条。
- 入口：`src/features/threads/hooks/useThreadActionsResumeThread.ts`。
- 动作：
  1. 复现路径：打开 → 关闭 → 重开同一会话，确认是 hydrate 返回空还是本地 snapshot 未写入。
  2. 若 loader partial_history 与 hydrate-empty 同源（loader 失败后 snapshot 为空被采纳），修「失败结果不得覆盖本地可读历史」。
  3. 行为变更（恢复语义）→ 开 OpenSpec change。
- 验收：构造 loader 失败的单测；重开会话不再出现 readable-surface failed。
- 复核：`markHistoryRecoveryFailure` 已按 localItemCount 分叉：有本地条目 → `degraded-readable` / `last-good-local-items-preserved`（不 dispatch 空 items）；本地也空 → `failed` / `history-hydrate-empty`。生产 10 条均为 `localItemCount: 0`，是真的两端皆空，不是覆盖可读历史。既有单测覆盖 empty retry / last-good preserve / failed empty。

### E2. model catalog stale（entryCount: 0，17 条）+ model selection circuit breaker（8 条） ✅ 熔断误伤已修；empty-cache 仅可观测性

- 证据：catalog 拉取失败且缓存为空，用户模型列表空白；circuit breaker epochKey 显示多模型（gpt-5.6-terra/spark、mimo-v2.5-pro、MiniMax-M3 等）catalog 下 apply 被熔断。
- 入口：`src/features/models/hooks/useModels.ts`；改切会话 / catalog 拉取链路前必读 `dev-guidelines/guides/session-switch-catalog-fetch-pitfall.md`（点击路径禁止 IPC 拉 catalog）。
- 动作：
  1. 确认 stale 发生时机：启动预热 or 切会话（对照 Session Switch Gate 红线，排除点击路径同步拉取）。
  2. entryCount=0 时 UI 应有明确空态 + 手动重试，而不是静默空白。
  3. circuit breaker：查熔断阈值是否在 catalog 大枚举下误伤（epochKey 过长说明全量 model 参与 epoch 计算，考虑降维）。
- 验收：断网复现 → 有空态与重试；正常网络 100 次模型切换不触发熔断。
- 落地：epochKey 改为 `buildSelectionApplyEpochKey`（preferred + next selection），不再塞全量 catalog fingerprint。catalog stale 增加 `reasonCode: empty-cache | using-stale-cache`。empty-cache 本身是首次拉取失败且无缓存，不是覆盖 bug。

### E3. turn/start error（20 条）+ thread/list live timeout（29 条）+ engine/switch error（12 条） ✅ 2026-08-25 reasonCode

- 证据：payload 均 redacted，只有长度与 workspaceId；集中在 08-18（当日 508 条，疑似某次网络/上游故障窗口）。
- 动作：
  1. 先判定 08-18 是否为单次环境事件（网络抖动 / CLI 版本问题）：查当日 `unclassified-stderr` 与 stderr 总量相关性。
  2. 若为孤立事件 → 降级为观察项，加「同 workspace 连续 N 次才升级」的聚合。
  3. 若可复现 → 给这三类 label 的 payload 增加非敏感分类字段（error class / errno），否则永远无法远程定位。
- 验收：三类错误具备可分类的 reasonCode；观察一周看是否复现。
- 落地：`classifyTurnStartReasonCode`（first-packet-timeout / network-* / unclassified）；list timeout `reasonCode: thread-list-live-timeout`；engine/switch 改为 `{ reasonCode, engineType }`（disabled / not-installed / exception / codex-not-installed）。08-18 高峰仍视为环境窗口，本次只补可分类字段。

### E4. renderer 崩溃面：react/error-boundary ×4、window/error ×68、fast-markdown-worker/failed ×17 ✅ errorClass 脱敏修复

- 动作：
  1. error-boundary 4 次（08-19、08-21×3）payload 全 redacted → 增加 errorClass 白名单字段（只落异常类名，不落 message）。
  2. fast-markdown-worker `worker-runtime-error`：worker 启动即失败会 fallback 主线程编译，长文档渲染直接变慢 → 本地复现（长 markdown 会话）拿 worker 报错原文。
  3. window/error 68 条与 worker failed 时间重合度高，疑似同源，一并确认。
- 验收：worker 失败根因明确（修 or 确认为环境个例）；error-boundary 有可分类字段。
- 落地：`errorClass`（camelCase → `error_class`）原先命中 sanitizer 的 `error` token 被整段 redact。白名单补 `class`，安全 token 保留。代码里 `classifyErrorBoundaryError` 本来就有，只是落盘被洗掉。worker-runtime-error 已有 reasonCode，启动失败属环境/worker 本体，本次不改 worker 实现。

---

## 第三梯队：需要复现测量的性能项

### P1. 08-24 23:00 frame-drop 风暴（30 条全 severe，fps 5~10） ✅ 代码侧 hotspot 已收；fps 需运行时复测

- 证据：hotspot 主类 `react-commit / nested-update`（单窗口 18 次 commit / 102ms）；次要 `client-store-write`（threads:customNames、composer:selectedEngine、leida:sessionRadar.recentCompleted）、markdown-render（最大 17033ch）、流式 row render（reasoning 最大 17123ch）。
- 动作：
  1. 必读 `docs/perf/render-jank-knife-experiments-2026-07-08.md` 与 `docs/perf/pr-1092-performance-retrospective.md` §七，用归因面板 + `memoizedUpdaters` 复现。
  2. 优先追 `nested-update` 连锁源（commit 阶段 setState）；三个 client-store-write 是否命中红线①②（高频/数组追加进根链）。
  3. 与 W2 可能同源（composer store 写入风暴）→ W2 修完后复测，本项可能自然消解大半。
- 验收：`npm run dev:perf` 下同场景 fps 不掉下 30；frame-drop severe 不再按小时簇状出现。
- 落地：`saveCustomNamesBatch` 把 list hydrate 的 N 次全量 customNames IPC 收成 1 次，unchanged skip；rename alias 路径改走 `persistCustomNames`（带 prune）。W1/W2 收 nested-update / composer 重渲。selectedEngine 写入只在切引擎，未改。

### P2. dsh 流式首可见渲染延迟（firstVisibleRenderAfterDeltaMs 最高 138s） ⏸ 证据不足，不盲改 live 通道

- 证据：`stream-latency/render-amplification` 8 条，dsh engine 138s / 56s / 22s；pi engine 正常（28ms）。
- 入口：`src/features/threads/utils/streamLatencyDiagnostics.ts`；dsh 链路 `src-tauri/src/engine/dsh/`。
- 动作：
  1. 确认是 dsh 事件路由积压还是前端 buffer 未 flush（turnTrace.summary 里 appServerEventRoute / batchFlush 计数对照）。
  2. 若命中 liveTextExternalization / liveDeltaExternalization 通道在 dsh 路径未接入 → 按红线④⑤补齐。
- 验收：dsh 会话 firstVisibleRenderAfterDeltaMs < 2s（pi 当前水平）。

### P3. 长会话虚拟化被禁用（107 行 shouldVirtualize: false, thresholdReason: disabled） ⛔ 产品决策，不重开

- 入口：`src/features/messages/timeline/virtualization/messagesTimelineVirtualization.ts`、`MessagesTimeline.tsx`。
- 复核：`shouldVirtualizeTimelineRows` 明确 `return false`；`Messages.virtualized-jump.test.tsx` 注释写明「消息时间线列表虚拟化已移除」。重开是产品/交互回归，不在本次 bugfix 范围。

### P4. optimistic-user 行固定渲染 2~4 次（row-render-budget 62 条） ⏸ 交接成本，不作为本轮必修

- 动作：乐观行 → 确认行交接时 key/identity 变化导致整行重挂载；评估复用同一 itemId 或 React 复用策略。优先级最低，与 W2/P1 修复后复测再定。

---

## 执行顺序与依赖

```
W1 → W2 → W3        （第一梯队，互不阻塞，可并行；W2 先行收益最大）
  ↓
E1 / E2 / E3 / E4   （功能错误，E1、E2 需 OpenSpec change）
  ↓
P1（W2 收口后复测）→ P2 → P3 → P4
```

- 每项收口后在本文档标记 ✅ + 附新日志对比数据（同窗口同 label 计数）。
- 全梯队完成后重跑一次本体检脚本，输出 before/after 对照表。
