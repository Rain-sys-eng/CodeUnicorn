# Tasks: expand-shared-atomic-reasoning-linkage-to-pi

## 1. `atomicModelReasoning.ts` 接 PI

- [ ] 新增 private helper `enrichModelReasoningForEngine(engine, model)`：当 `engine === "pi"` 时从 `model.supportedReasoningEfforts` 复制 capability 元数据到返回值；其它 engine 直返 `model`（不发明）。与 `enrichModelInfoWithAtomicReasoning`（codex-only）平行。
- [ ] `resolveAtomicReasoningOptions` 在 `engine === "pi"` 分支走 `enrichModelReasoningForEngine` → 从 `enriched.supportedReasoningEfforts` 推导 options；空则按 `enriched.defaultReasoningEffort` 回退到 `[default]`；全空返 `[]`。
- [ ] `reconcileAtomicReasoningEffort` 早退白名单加 `pi`：`if (engine !== "codex" && engine !== "pi") { return null; }`（保留 claude/grok 既有早退，移除 DSH/Kimi/OpenCode 等非四档引擎的空早退扰动）。
- [ ] `resolveAtomicDefaultReasoningEffort` 扩 PI 分支：从 `enrichModelReasoningForEngine("pi", model).defaultReasoningEffort` 或 `resolveAtomicReasoningOptions("pi", enriched)[0]` 取值；非 PI 走原早退（null）。
- [ ] `resolveAtomicReasoningEffort`（`buildProviderExecutionTarget` / `initialTarget.ts` seed 用）扩 PI 分支：inherit 命中保留，不命中 → PI 模型 default；非 inherit → PI 模型 default。

## 2. `Composer.tsx` `atomicModelReasoningRef` 接 PI

- [ ] 非 codex 分支扩为：目标引擎 === "pi" 时去 `providerModelCatalogs["pi"]` 按 id/model 匹配，把 `matched.supportedReasoningEfforts` / `matched.defaultReasoningEffort` 复制到 `atomicModelReasoningRef.model`。匹配逻辑复用 codex 分支的 `matchByIdentity` 形态。
- [ ] 非 codex 且非 pi 引擎维持原行为（只填 `id` / `model`）。

## 3. `Composer.tsx` Shared target hydrate reconcile effect

- [ ] effect 早退条件 `engine !== "codex" && engine !== "claude" && engine !== "grok"` 改为 `engine !== "codex" && engine !== "claude" && engine !== "grok" && engine !== "pi"`。
- [ ] effect 内部 `reconcileAtomicReasoningEffort({ engine, model, effort: normalizedRaw })` 自动受益于 §1 的 PI 分支扩展，无需额外改本 effect。

## 4. 测试

- [ ] `src/features/models/atomicModelReasoning.test.ts`：
  - [ ] PI 全 7 档 catalog allowlist
  - [ ] PI `thinkingLevelMap` 含 holes 时 options 是子集
  - [ ] PI unknown model 走 capability-neutral（返 `[]` / null）
  - [ ] PI 模型支持 high → 保留 high（inherit）
  - [ ] PI 模型支持 [low, medium] + current ultra → 收敛到 default
  - [ ] PI 跨引擎从 Codex high → PI 不继承（non-inherit）
  - [ ] PI 模型 `defaultReasoningEffort` 为 high → 默认 effort = high
  - [ ] `enrichModelReasoningForEngine` 对非 PI 直返 model
- [ ] `src/features/composer/components/Composer.*.test.tsx`（新建）：
  - Shared target 切到 PI 模型有 catalog allowlist → `atomicReasoningOptions` 等于 catalog 行 `supportedReasoningEfforts`
  - Shared target PI 模型无 catalog 行（runtime-only）→ `atomicReasoningOptions = []`
  - Shared target PI 模型 `defaultReasoningEffort = low` + `selectedEffort = null` → `atomicSelectedEffort = "low"`
  - Shared target PI 模型 + 不支持 effort → reconcile 收敛到 default
- [ ] `src/features/composer/components/ChatInputBox/selectors/ModelSelect.test.tsx`（新建或追加）：
  - `buildProviderExecutionTarget({ providerId: "pi", modelMeta: { defaultReasoningEffort: "low", supportedReasoningEfforts: [...] } })` → seed `reasoning.effort = "low"`
  - 同上但 inherit=true + previousEffort="high" 命中 PI allowlist → seed `reasoning.effort = "high"`
- [ ] `src/features/threads/hooks/useThreadMessaging.test.tsx`（追加）：
  - send 边界 `reconcileAtomicReasoningEffort({ engine: "pi", model, effort: "high" })` + catalog 允许 high → 返 high
  - send 边界 `reconcileAtomicReasoningEffort({ engine: "pi", model, effort: "ultra" })` + catalog 不允许 → 返 default

## 5. 文档与 ADR

- [ ] `openspec/changes/expand-shared-atomic-reasoning-linkage-to-pi/specs/shared-execution-target/spec.md`：在三条 Atomic Reasoning requirement 上追加 ADDED scenarios 覆盖 PI（详见 specs delta）。
- [ ] `docs/research/mossx-multi-cli-provider-session-foundation-design.md`：
  - [ ] 最近校准段追加 `2026-08-25 · Atomic 思考强度联动扩到 PI（expand-shared-atomic-reasoning-linkage-to-pi）`
  - [ ] 「Atomic 模型↔思考强度联动」校准行刷新 OpenSpec change id + 事实源
  - [ ] 「更新触发器」条目保留（本次属于该能力的引擎覆盖扩展）

## 6. 验证

- [ ] `npm run check` 全绿
- [ ] focused vitest `src/features/models/atomicModelReasoning.test.ts` 全绿
- [ ] focused vitest `src/features/composer/components/Composer.*.test.tsx` 全绿
- [ ] focused vitest `src/features/composer/components/ChatInputBox/selectors/ModelSelect.test.tsx` 全绿
- [ ] focused vitest `src/features/threads/hooks/useThreadMessaging.test.tsx` 全绿
- [ ] `cargo test --lib` 不引入新 failure（与 HEAD baseline 对照）
- [ ] `openspec validate --change expand-shared-atomic-reasoning-linkage-to-pi` 通过
- [ ] **Native PI 0 回归**：跑一次 native pi dialog 的 smoke（手工或 scripted）：模型选择 → 思考档位显示 → 发消息 → 验 `[pi/rpc] set_thinking_level(<level>)` 日志
- [ ] **Shared PI smoke**：创建 Shared Session 选 PI 模型 → 思考档位选择器出现 → 选档 → 发消息 → 验 V2 dispatch `reasoning_effort` 非 null → 验 PI native set_thinking_level / --thinking 日志

## 7. 收口

- [ ] proposal.md / design.md / tasks.md / verification.md 全部勾完
- [ ] ADR 校准回写完成
- [ ] spec delta 同步
- [ ] openspec status --change expand-shared-atomic-reasoning-linkage-to-pi ready-for-archive
