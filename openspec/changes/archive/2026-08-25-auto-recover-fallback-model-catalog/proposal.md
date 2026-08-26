# Change: auto-recover-fallback-model-catalog

## Why

PI 引擎模型菜单首开只见静态兜底 `auto / Use PI CLI default model`，要手动点刷新几次才出现真实 catalog（ark/bigmodel 分组）。8b93981f0 的 RPC 主路径（`get_available_models`）降低了触发率，但三层机制残留仍在当前 HEAD：

1. **超时错配**：FE `startupOrchestrator` 对 catalog 请求固定 `timeoutMs: 8_000`，后端 `detect_pi_status` 串行最坏 ~30s（version 10s + RPC 10s + `--list-models` 10s）。冷启动 / 慢机器上首次拉取必然 FE 先超时，落 generated fallback。
2. **落兜底后零自动恢复**：`setActiveEngine` 用 detection 时的 `status.models` 乐观填充且不触发新拉取；菜单打开（Native/legacy 路径）也不补拉。用户只能发现刷新按钮并手动重试。
3. **后端串行探测**：version 与 models 探测无依赖关系却串行 await，放大最坏路径。

## What Changes

- **菜单打开自动恢复（主修）**：Native/legacy 模型选择器打开时，若当前引擎组 models 全部 `source === "fallback"`，自动触发一次既有 `onRefreshConfig`（spinner / error 语义复用刷新按钮，菜单保持打开）。每次打开最多一次自动刷新，不循环；catalog 非兜底（含空 catalog 引导态）时不触发。
- **timeout 按 phase 对齐**：`loadModelsForEngine` 的 orchestrator `timeoutMs`：on-demand 8s → 22s（覆盖并行化后的后端最坏 ~20s），idle-prewarm 保持 8s。
- **后端探测并行化**：`detect_pi_status` 用 `tokio::join!` 并行 version 探测与 `get_pi_models`，最坏 30s → 20s。

## Impact

| 维度 | 说明 |
| ---- | ---- |
| Frontend | `ModelSelect.tsx`（菜单打开钩子）、`useEngineController.ts`（timeoutMs） |
| Backend | `status.rs` `detect_pi_status`（join 并行） |
| 热路径红线 | 切会话路径零改动；自动恢复只发生在「打开模型选择器」这一允许拉 catalog 的入口（`session-switch-catalog-fetch-pitfall.md` Required #3） |
| 既有行为 | Atomic/Shared（targetGroups）路径已有 `onOpenTargetCatalog` / `onOpenProviderProfile` 打开预取，不动；空 catalog 的自定义模型引导文案 requirement 不动 |
| Out of scope | 其他引擎的后端探测并行化；orchestrator 全局 timeout 策略；改 pi CLI |

## Acceptance

1. PI catalog 处于 fallback-only（仅 `auto`）时打开模型菜单 → 自动出现刷新 spinner，成功后菜单内直接出现真实分组列表，无需手动点刷新。
2. PI catalog 已有真实模型时打开菜单 → 不触发额外 catalog IPC。
3. 自动刷新失败 → 菜单内显示错误文案（复用刷新按钮 error 位），下次打开再自动试一次；不产生循环请求。
4. 连点侧栏会话（含 PI 会话）→ 零 catalog IPC（回归红线）。
5. on-demand catalog 请求在后端 ~20s 最坏路径内不再被 FE 8s 截断。
