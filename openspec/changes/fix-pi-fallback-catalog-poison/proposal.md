# Change: fix-pi-fallback-catalog-poison

## Why

PI composer 模型 chip 卡在 `auto`、切历史会话丢失账本里的模型选择、思考强度选择器消失。实证链（2026-08-26 用户现场，打包版 0.9.3，启动时恰逢本机并行 cargo 构建）：

1. **探测瞬时失败合成兜底**：`detect_pi_status` 链最坏 ~20s（RPC 10s + `--list-models` 10s）。失败时 `parse_pi_available_models` / `parse_pi_models_output` 会合成 `auto / PI Auto`（`source=fallback`）兜底条目——**pi 的 models 永远不会为空**。
2. **L1 cache 中毒不自愈（核心）**：`resolve_engine_models_cache_first`（engine/commands.rs）把「非空」当健康：① 非 force 调用对 cached `["auto"]` 直接命中，整个 app 生命周期不再重新探测；② force 刷新再次失败时把 `["auto"]` **写回 cache 顶掉上一份真实 catalog**。
3. **前端把会话账本修成 auto**：`getEffectiveSelectedModelId` 中 pi 不在 `allowUnknownActiveThreadModel` 白名单；fallback-only catalog 里找不到账本 `kimi-coding/k3` → 回落 `getDefaultModelId` → `auto`。切历史会话模型选择全丢（账本数据实际完好，存于 clientStorage）。
4. **思考强度连带消失**：`auto` 条目无 thinking levels → `reasoningOptions` 为空 → ButtonArea 对 pi 隐藏 ReasoningSelect。

10bee91d6 的「菜单打开自动恢复」只能覆盖「用户主动开菜单且当次探测成功」一条出路；cache-first 的中毒语义不除，任何一次瞬时失败都会复发。

## What Changes

- **后端防中毒（主修）**：`resolve_engine_models_cache_first` 新增 `is_fallback_only_catalog` 判定（全部 `source == "fallback"`）：
  - cached 全 fallback → 不视为缓存命中，照常走刷新；
  - fresh 全 fallback 且 cached 有真实 catalog → 返回 last-good，**不写回**；
  - fresh 全 fallback 且无可用 cached → 兜底仍交给 UI 降级展示，但**不写入 cache**，下次调用重新探测，探测恢复即自愈。
- **前端保账本**：`modelSelection.ts` 新增纯函数 `preserveLedgerModelOnFallbackCatalog`——catalog 全 fallback 且会话账本 modelId 不在其中时，合成 `source: "ledger"` 临时选项追加进列表；`useAppShellComposerModelSection` 用它同时喂 `effectiveModels` 与 `getEffectiveSelectedModelId`，切历史会话显示真实模型 id（如 `kimi-coding/k3`），不再被修成 `auto`。catalog 痊愈后账本 id 正常命中，合成选项自动消失。codex / claude 走既有 freeform / managed runtime 链路，不在此列。
- 合成 ledger 选项不带思考档位元数据（catalog 未痊愈前无法知道真实 levels），降级期间思考强度选择器保持隐藏；catalog 恢复后自动回归。

## Impact

| 维度 | 说明 |
| ---- | ---- |
| Backend | `engine/commands.rs`（cache-first 防中毒 + `is_fallback_only_catalog`）；`engine/commands_tests.rs` +3 测试 |
| Frontend | `app-shell/domains/modelSelection.ts`（纯函数）、`useAppShellComposerModelSection.ts`（接线）、`modelSelection.test.ts` +6 测试 |
| 热路径红线 | 切会话点击路径零新增 IPC（本 change 不新增任何 catalog fetch；只是缓存命中判定与前端选择投影变化），符合 `session-switch-catalog-fetch-pitfall.md` |
| 既有行为 | `auto` 兜底条目保留为「探测失败 + 全新会话」的降级发送路径；10bee91d6 菜单打开自动恢复不变，且在本 change 后成功率更高（不再被中毒 cache 短路） |
| Out of scope | 删除 `auto` 兜底条目（产品决策，用户若拍板可单独跟进）；其他引擎探测链超时调优 |

## Acceptance

1. cached 全 fallback 时非 force `get_engine_models` 必须重新探测（不得直接命中 `["auto"]`）。
2. force 刷新拿到全 fallback 结果时，last-good 真实 catalog 不被顶掉。
3. 无旧 cache 时全 fallback fresh 仍返回给 UI 降级展示，但不写回 cache。
4. PI 历史会话（账本 `kimi-coding/k3`）在 catalog fallback-only 期间：chip 显示 `kimi-coding/k3` 而非 `auto`；catalog 恢复后思考强度选择器回归。
5. 全新 PI 会话在 catalog fallback-only 期间仍显示 `auto` 降级条目，可发送。
6. 连点侧栏会话零新增 catalog IPC（回归红线）。
