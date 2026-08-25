# Change: expand-shared-atomic-reasoning-linkage-to-pi

## Why

PI CLI 思考强度档位（`off / minimal / low / medium / high / xhigh / max`，按 `thinkingLevelMap` 裁剪）已经在 Native composer 上落地（`add-pi-thinking-level-selector`，2026-08-25）：

- 后端 `supported_thinking_levels_for_pi_model` 把每个 PI 模型的 `supportedReasoningEfforts` 投影到 `EngineModelInfo`，Shared 共用的 `providerModelCatalogs["pi"]` 与 Native 同源。
- Native composer 走 `modelSelection.ts: getReasoningOptionsForModel(model)` 直接读 `model.supportedReasoningEfforts`，`ButtonArea` 在 `currentProvider === "pi" && reasoningOptions.length > 0` 时渲染 `ReasoningSelect`。
- Native send 端：RPC 路径 `pick_thinking_level(params.effort, available)` + `set_thinking_level`；fallback 路径 `resolve_thinking_flag` 加 `--thinking` argv。

但 Shared / create-session Atomic 对话框走的是另一条前端路径（`atomicModelReasoning.ts` + `Composer.tsx` 的 `atomicModelReasoningRef`），这条路径目前只接 Codex / Claude / Grok —— 对 PI 直接返空档位 / 清空 effort。**用户在 Shared Session 选 PI 模型时看不到 `ReasoningSelect`，UI 选档位后 send 边界 reconcile 又会把 effort 清成 null**，结果是 PI native 端根本拿不到 thinking level 参数。

后端 send 链路（`shared_session_v2_dispatch_turn` → `engine_send_message` → `pi.rs::try_send_message_rpc` / `send_message_print_json`）已经把 `owner.target.reasoning_effort` 透传到 native engine，**后端零改动**。所以这次只动前端推理层与 atomic reasoning 模块，扩展原子化推理档位联动到 PI 引擎。

## What Changes

- **F1 `atomicModelReasoning.ts`**：
  - `resolveAtomicReasoningOptions` 在 `engine === "pi"` 分支从 `model.supportedReasoningEfforts` 推导（对齐 `modelSelection.ts: getReasoningOptionsForModel`，与 native 共用同一份 allowlist 规则 —— 投影端已经把 PI 的 `getSupportedThinkingLevels` 移植到 `supported_thinking_levels_for_pi_model`，catalog 与 resident allowlist 同源）。
  - `reconcileAtomicReasoningEffort` 把 `codex | claude | grok` 早退白名单加上 `pi`；命中 allowlist 保留 effort；非法 → 模型 default；capability-neutral（model 缺元数据）保留原值（不发明档位）。
  - `resolveAtomicDefaultReasoningEffort` 同步扩 PI 分支：从 `model.defaultReasoningEffort` 或 options[0] 取值。
  - `resolveAtomicReasoningEffort`（`buildProviderExecutionTarget` / `initialTarget.ts` seed 用）：扩 PI 分支，inherit 命中保留，非 inherit 时落 default；保持与 codex / claude / grok 同形态。
  - `enrichModelReasoningForEngine` 新增（private helper）：把 PI（也兼容未来扩展）的 `supportedReasoningEfforts` 数组 / `defaultReasoningEffort` 从 `providerModelCatalogs[engine]` 匹配到的行复制出来。`enrichModelInfoWithAtomicReasoning` 内部分流保持 codex-only（与 native `useProviderTargetCatalogOwners.ts` 行为一致，不污染）。

- **F2 `Composer.tsx` `atomicModelReasoningRef`**：
  - 非 codex 分支原本只填 `id` / `model`（缺 `supportedReasoningEfforts` / `defaultReasoningEffort`），扩为：目标引擎 === "pi" 时去 `providerModelCatalogs["pi"]` 按 id/model 匹配，把 catalog 行的 capability 元数据复制到 `atomicModelReasoningRef.model`。非 codex 且非 pi 引擎维持原行为（向后兼容）。

- **F3 `Composer.tsx` shared target hydrate reconcile effect**：
  - 当前 effect 早退条件 `engine !== "codex" && engine !== "claude" && engine !== "grok"`，扩为加上 `pi`，确保 Shared Session 内 hydrate 选 PI target 时也会把 `selectedNextTarget.reasoning.effort` 收敛到 PI 模型的 allowlist。

- **F4 测试**：
  - `atomicModelReasoning.test.ts` 补 PI 7 档 / map holes / unknown-neutral / inherit / cross-engine 切换场景。
  - 新增 `Composer.*.test.tsx`：Shared target 切到 PI 模型时 `ReasoningSelect` 显示 catalog allowlist，`selectedEffort` reconcile 行为。
  - 新增 `ModelSelect.test.tsx`（如不存在单测）：`buildProviderExecutionTarget` 在 `providerId === "pi"` 时 seed `low` default（model 有 `defaultReasoningEffort`）或 null（unknown model）。

- **F5 OpenSpec / 文档**：
  - `openspec/specs/shared-execution-target/spec.md` 在 `Atomic Model Selection MUST Link Reasoning Effort To Target Model Capability` / `Shared Atomic Reasoning Options MUST Follow Selected Next Target` / `Shared Codex Effort MUST Reconcile Null Or Unsupported Values` 三条 requirement 追加 ADDED scenarios 覆盖 PI（MODIFIED delta，原 requirement 文本不动）。
  - `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 最近校准段追加本 change；「Atomic 模型↔思考强度联动」校准行刷新；「更新触发器」条目保留（本次属于该能力的引擎覆盖扩展）。

## Capabilities

### Modified Capabilities

- `shared-execution-target`：在「Atomic 模型选择必须联动 Reasoning effort 到目标模型 capability」「Shared Atomic reasoning options 必须跟随 selected next target」「Shared Codex effort 必须 reconcile null 或不支持值」三条之上追加 PI 覆盖场景；原 requirement 文本与既有 scenarios 保留不动。

### Non-Goals

- 不引入 Shared PI turn 的 capability 新维度：PI 在 Shared 链路（V2 dispatch / `engine_send_message` / `pi.rs::send_message` / RPC `set_thinking_level` 与 print-json `--thinking`）的所有 contract 已落地；本 change 只是把前端 UI 与 send 边界 reconcile 接进同一套原子化联动。
- 不接 DSH / Qoder / Kimi / Grok / OpenCode：这些引擎的 catalog allowlist 与 send 边界路径需要各自单独评估（DSH native ReasoningSelect 已在 ButtonArea 接通，但 Shared 路径同上未接；Qoder 同 PI 但 ACP `session/set_config_option reasoning_effort` 缺乏用户实证）。本 change 只解决 PI 单引擎的对称性，由后续 change 处理其他引擎。
- 不动 native PI 对话框：native 路径走 `modelSelection.ts` 而非 `atomicModelReasoning.ts`，两套体系并行不影响；详见「不回归 native 红线」节。
- 不在 `setActiveThreadId` / 模型点击 / picker 展开时调 `get_engine_models`：catalog 仍只在打开 picker / 手动刷新 / 发送前缺目录时拉取（沿用 `add-pi-thinking-level-selector` 既有红线）。
- 不改 PI CLI 行为：仅前端 UI 渲染与 send 边界 effort 透传。

## 不回归 native 红线

native PI composer 对话框走 `modelSelection.ts: getEffectiveReasoningOptions(engine, ...)` → `getReasoningOptionsForModel(model)` → 直接读 `model.supportedReasoningEfforts`，**完全不走** `atomicModelReasoning.ts` / `Composer.tsx atomicModelReasoningRef` / shared target hydrate effect。

具体隔离边界：

- `useAtomicReasoningProjection = isSharedSessionResolved || Boolean(createSessionTargetPicker)`。native 模式下为 false，`atomicReasoningOptions` / `atomicSelectedEffort` 直接走 `reasoningOptions` / `selectedEffort` prop 早退，不消费 `atomicModelReasoningRef`。
- shared target hydrate effect 的早退条件 `!isSharedSessionResolved`，native 不进。
- `atomicModelReasoningRef` 的 useMemo 在 native 也会执行（仅 CPU 开销），但不被消费，不改 native 行为。
- `enrichModelInfoWithAtomicReasoning` 内部 `if (engine !== "codex") return model;` 早退，`useProviderTargetCatalogOwners.ts` 与 `ModelSelect.tsx`（native 侧 builder）调用时若传 `"pi"` 不会触发任何修改。

因此本 change 不会让 native PI 对话框多走任何分支，不会改变 native 任何 prop 形状，不会触发 native 任何额外 re-render。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Backend | 零改动 |
| Frontend | `Composer.tsx`（两处：atomicModelReasoningRef 非 codex 分支 + shared target hydrate effect 早退白名单）、`atomicModelReasoning.ts`（四处 + 一处新增 helper）、`ButtonArea.tsx`（不改，条件已是 `currentProvider === "pi" && reasoningOptions?.length > 0`） |
| 测试 | `atomicModelReasoning.test.ts`（追加）、`Composer.*.test.tsx`（新增 shared PI projection）、`ModelSelect.test.tsx`（追加 buildProviderExecutionTarget PI seed） |
| 热路径 | shared target hydrate effect 加 pi 后会在 Shared target 切换为 pi 模型时触发一次 reconcile；不触发额外 catalog IPC，沿用 `providerModelCatalogs` 已有快照 |
| i18n | 沿用现有 `reasoning.minimal` / `reasoning.default` 等 key；新增 `reasoning.pi` 仅当新增 i18n 词条需要（首选复用 `reasoning.default`） |
| Out of scope | native PI 对话框（不变）、DSH / Qoder / Kimi / Grok / OpenCode 引擎（不在本 PR）、PI CLI 行为（不变）

## Acceptance

1. 选中 Shared PI target + 模型有 catalog allowlist → composer 出现 `ReasoningSelect`，options 等于 catalog 行 `supportedReasoningEfforts`。
2. 不支持思考的 PI 模型（`supportedReasoningEfforts` 为空）→ 选择器隐藏；selectedEffort = null；send 时 native `pi.rs::try_send_message_rpc` / `send_message_print_json` 不下发 `--thinking` / `set_thinking_level`。
3. 用户在 Shared PI target 上选 `high` 发送 → `SendMessageParams.effort=high`（V2 `owner.target.reasoning_effort`）→ PI RPC 路径调 `set_thinking_level("high")`，fallback 路径加 `--thinking high`。
4. 同一会话 hydrate `reasoning=null` → composer 显示 PI 模型 `defaultReasoningEffort`，send 边界 reconcile 后 effort 等于 default。
5. 切到 PI 模型但 PI 模型不支持旧 effort（如 `ultra`） → reconcile 收敛到 PI 模型 default；send 不下发 `ultra`。
6. cross-engine 切换：从 Codex high 切到 Shared PI 模型允许集 → seed PI 模型 default，不继承 Codex high。
7. **Native PI 对话框 0 回归**：同一会话下走 native path 时 `ReasoningSelect` 显示、e2e send 行为与 `expand-shared-atomic-reasoning-linkage-to-pi` 前完全一致（vitest 通过 + 端到端跑通）。
