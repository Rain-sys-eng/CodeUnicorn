# Design: expand-shared-atomic-reasoning-linkage-to-pi

## 决策

**1. 后端零改动 —— PI native send 链路早已就位，本 change 纯前端。**

- PI RPC 路径 (`pi.rs:1133`)：`pick_thinking_level(params.effort, available)` → 命中 resident allowlist 后 `client.set_thinking_level(&thinking)`。
- PI print-json fallback (`pi.rs:1570`)：`resolve_thinking_flag(params.effort)` → 加 `--thinking <level>` argv。
- Shared V2 dispatch (`shared_session_v2.rs` ~L4605 的 `Kimi | Grok | OpenCode | Pi | Qoder` 臂)：`crate::engine::engine_send_message(..., owner.target.reasoning_effort.clone(), ...)` 把 effort 透传给 native engine。
- 目标：把前端 atomic reasoning 模块与 Composer projection 链路接进 PI，不动 Rust。

**2. PI catalog 与 PI resident allowlist 同源，但渲染与下发是两阶段。**

- UI 显示：`providerModelCatalogs["pi"]`（由 `supported_thinking_levels_for_pi_model` 投影，移植 pi CLI `getSupportedThinkingLevels` 规则）。
- Send 主路径：用 resident `client.available_thinking_levels()` 缓存做 allowlist 夹紧。若两者漂移（RPC handshake 失败 / 老 pi 没 `get_available_thinking_levels` 命令），send 端以 resident 胜出（log warn 静默丢档），UI 不变（沿用 catalog）。这是 native PI 已有行为，shared 复刻时维持一致。

**4. `atomicModelReasoning.ts` 引擎白名单扩展到 PI，与现有 Codex / Claude / Grok 同形态：**

| 函数 | claude | grok | codex | **pi**（新增） | 其他（未接） |
| --- | --- | --- | --- | --- | --- |
| `resolveAtomicReasoningOptions` | 固定 allowlist | 固定 allowlist | 走 `enrichModelInfoWithAtomicReasoning` + catalog/custom | 走 `enrichModelReasoningForEngine` + catalog allowlist | 返回 `[]`（capability-neutral） |
| `reconcileAtomicReasoningEffort` | 命中→保留，不命中→null | 同 | 命中→保留，不命中→模型 default，unknown-neutral | 同 codex | 直接 null |
| `resolveAtomicDefaultReasoningEffort` | null | null | catalog/custom default 或 options[0] | model.defaultReasoningEffort 或 options[0] | null |
| `resolveAtomicReasoningEffort`（seed 用） | null（非 inherit） | null（非 inherit） | inherit 命中保留 / default；非 inherit → default | 同 codex | null |

**5. `Composer.tsx atomicModelReasoningRef` 非 codex 分支的策略：仅对 pi 引擎补 capability 元数据。**

非 codex 引擎的 catalog 行有 `supportedReasoningEfforts`（PI 已经有；DSH 也有；Qoder 有 `with_reasoning` 投影）。但本 change **只接 PI**，避免误把未评估的引擎拉到新联动里。DSH / Qoder 由各自 change 评估。

非 codex 且非 pi 引擎维持现有行为（只填 `id` / `model`），向后兼容；这意味着 kimi / grok / opencode 等即便 catalog 有 allowlist 也暂不接 —— 待后续 change。

**6. Shared target hydrate reconcile effect 早退白名单扩展到 PI：**

```ts
if (engine !== "codex" && engine !== "claude" && engine !== "grok" && engine !== "pi") {
  return;
}
```

仅 PI 加这条；其它引擎不动。这样 hydrate 时 Shared target 选 PI 模型也会把 `reasoning.effort` 收敛到 PI 模型的 allowlist（避免 hydrate 出不在 PI allowlist 的脏 effort 跨 session 留存）。

**7. 不动 `enrichModelInfoWithAtomicReasoning` 的 codex-only 早退：**

`useProviderTargetCatalogOwners.ts:341` / `:670` 与 `ModelSelect.tsx:281` 都通过它补 codex 元数据。该函数内 `if (engine !== "codex") return model;` 保持不变 —— native 路径不会因本次重构触发额外修改。新增的 PI 处理走独立的 `enrichModelReasoningForEngine(engine, model)` helper，只在 `atomicModelReasoning.ts` 内部使用。

**8. `resolveAtomicReasoningEffort`（seed 用）PI 分支语义：**

- `inherit: true` 且 previous effort 命中 allowlist → 保留。
- `inherit: true` 且 previous effort 不在 allowlist → 落 PI 模型 default（与 codex 同形态）。
- `inherit: false` 或未传 → 落 PI 模型 default（覆盖 Codex / Grok 旧 effort；保留 Claude/Grok 的 null 不变量 —— 它们在 `initialTarget.ts` 走的不是 default 而是 null）。
- `options.length === 0` 且有 metadata 但全部空数组（capability-neutral 边缘） → 维持 current（与 codex 同形态）。

## 回退（按 native PI fallback 语义）

`supported_thinking_levels_for_pi_model` 在 RPC 失败时回退 `--list-models`：

- `thinking=yes` → 填标准五档（`off / minimal / low / medium / high`；`xhigh` / `max` 仍 opt-in），UI 显示 5 档。
- `thinking=no` → 空数组，UI 隐藏选择器，send 不下发 thinking。

Shared 复刻后行为与 native 完全一致（包括「unknown-neutral 不发明档位」）。

## 不做什么

- 不在 `setActiveThreadId` / 模型点击时拉 `get_engine_models`（沿用 `add-pi-thinking-level-selector` 红线）。
- 不为每个 PI 模型 cycle `set_model`（共享 session 与 native 一致：resident cache 锁住当前模型 allowlist）。
- 不在 UI 显示时把 illegal 档回落 medium；非法档由 send 边界 reconcile 收口。
- 不接 DSH / Qoder / Kimi / Grok / OpenCode：本次严格只做 PI 单引擎的对称性。
- 不动 native PI 对话框（详见 proposal「不回归 native 红线」节）。

## 测试覆盖矩阵

| 测试 | 覆盖点 |
| --- | --- |
| `atomicModelReasoning.test.ts` | PI 7 档 catalog allowlist、map holes 子集、capability-neutral unknown model、cross-engine inherit、cross-engine non-inherit seed default、reconcile null → default、reconcile illegal → default |
| `Composer.*.test.tsx` (新增) | Shared target 切到 PI 模型时 `atomicReasoningOptions` 等于 catalog 行 `supportedReasoningEfforts`；`atomicSelectedEffort` 收敛到 allowlist；PI 不支持时返 `[]`；Shared target hydrate effect 对 PI 触发 reconcile |
| `ModelSelect.test.tsx` (新增或追加) | `buildProviderExecutionTarget` 在 `providerId === "pi"` 时按 `modelMeta.defaultReasoningEffort` seed |
| `useThreadMessaging.*.test.tsx` (新增或追加) | send 边界 `reconcileAtomicReasoningEffort` 对 PI：catalog 允许 high → 保留 high；catalog 允许 [low, medium] + current ultra → 收敛到 default |

## 与已有 capability 的关系

- `shared-execution-target` 现有三条 Atomic Reasoning requirement（`Atomic Model Selection MUST Link Reasoning Effort To Target Model Capability` / `Shared Atomic Reasoning Options MUST Follow Selected Next Target` / `Shared Codex Effort MUST Reconcile Null Or Unsupported Values`）只覆盖 Codex / Claude / Grok。本 change 在这三条 requirement 上追加 PI scenarios，不破坏既有 Codex / Claude / Grok 行为。
- 与 `add-pi-thinking-level-selector`（2026-08-25）正交：那次是 native + catalog 投影；这次是 shared atomic 联动。两边都依赖 `supported_thinking_levels_for_pi_model` 投影（同源 catalog）。

## 风险与已知限制

- **PI RPC 与 catalog allowlist 潜在漂移**：resident `available_thinking_levels()` 与 catalog 是同源（都基于 pi 的 `getSupportedThinkingLevels`），但 RPC handshake 失败 / 老 pi 会让 resident 拿不到 allowlist。send 端 `pick_thinking_level(effort, None)` 在 effort 非空时仍会 normalize lowercase 透传，set_thinking_level 失败被 warn log 兜住。这是 native 既有行为，shared 复刻后继承。
- **`buildProviderExecutionTarget` 中 `nextEffort` 与 `initialTarget` seed 时序**：用户在 picker 上点选 PI 模型会触发 seed；如果用户立刻发消息，send 边界 reconcile 仍会按 catalog allowlist 再校验一次。两层校验冗余但行为一致（与 codex 同形态）。
- **跨引擎切换**：Shared session 从 Codex 切到 PI（或反向）时，inherit=false seed 落 PI 模型 default；inherit=true 且旧 effort 命中 PI allowlist 时保留（罕见：Codex `high` 几乎不可能命中 PI 七档 allowlist 中的 `high`，所以走 default）。
