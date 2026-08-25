# Design: auto-recover-fallback-model-catalog

## 根因链（已核实代码事实）

```text
App 启动 / 首开菜单
  → refreshEngines → detect_pi_status（串行 version 10s + RPC 10s + list-models 10s，最坏 30s）
  → 或手动刷新 → get_engine_models("pi") → 同上
  → FE startupOrchestrator.run({ timeoutMs: 8_000 }) 先超时
  → fallback: () => scopedFallbackModels → engineModels = [auto]（source: "fallback"）
  → 之后无任何自动恢复：
      · setActiveEngine("pi") 只用 detection 快照乐观填充（useEngineController.ts:452-464），不拉取
      · 菜单打开 legacy 分支 handleMenuOpenChange 直接 return（ModelSelect.tsx:1185-1187）
  → 用户看到只有 auto，手动刷新 N 次直到某次 < 8s 返回
```

8b93981f0（RPC 主路径）让正常环境首开 < 8s，但慢机器 / CLI 冷启动 / RPC 失败回退 `--list-models` 的场景仍会撞 8s 墙。

## 方案

### 1. ModelSelect legacy 分支：fallback-only 自动补拉

`handleMenuOpenChange` 在 `!hasTargetGroups` 时新增：

```ts
const currentGroup = pickerGroups.find((g) => g.providerId === currentProvider);
const groupModels = currentGroup?.models ?? [];
const isFallbackOnly =
  groupModels.length > 0 &&
  groupModels.every((model) => (model.source ?? "") === "fallback");
if (isFallbackOnly) {
  handleRefreshConfig(); // 内部已 guard: !onRefreshConfig || isRefreshingConfig
}
```

- `source` 字段链路已核实：后端 generated fallback `.with_source("fallback")` → `engineModelToOption` 保留 → `resolveProviderModelGroups` ModelInfo 透传。
- 每次打开最多一次：`handleMenuOpenConfig` 只在 open transition 触发；in-flight 时 `isRefreshingConfig` guard 挡重入；失败后不会循环（无 retry timer），下次打开再试一次。
- 空 catalog（`length === 0`）不触发：保留 `Empty Provider Model Catalog MUST Surface Custom Model Guidance` 的引导态语义。
- 通用收益：codex/grok/kimi/opencode 的 generated fallback roster 同样命中此恢复逻辑。

### 2. orchestrator timeout 按 phase 区分

`useEngineController.loadModelsForEngine`：

```ts
timeoutMs: phase === "on-demand" ? 22_000 : 8_000,
```

- on-demand 只从「打开菜单 / 显式刷新 / workspace 变更兜底」到达（切会话路径已在 2026-08-19 拆净），调用均为 fire-and-forget 或带 spinner 的菜单内 await，拉长 timeout 不阻塞点击。
- 22s 覆盖并行化后后端最坏 ~20s（max(version 10s, models 10s+10s 回退)）。

### 3. detect_pi_status 并行化

```rust
let version_probe = probe_cli_version(&bin, "pi", path_env.as_ref());
let models_probe = get_pi_models(&bin, path_env.as_ref());
let ((installed, version, error), (models, config_diagnostic)) =
    tokio::join!(version_probe, models_probe);
```

- 两探测无数据依赖；未安装时 `get_pi_models` spawn 立即失败走 fallback，结果被 `not_installed_status` 丢弃，无副作用。
- 最坏 30s → 20s；正常路径（RPC 秒回）不变。

## 红线对照

| Gate | 结论 |
| ---- | ---- |
| Session Switch Catalog Fetch | 切会话 / `setActiveThreadId` / `commitThreadSelection` 零改动；自动恢复挂在「打开模型选择器」——pitfall Required #3 明确允许的入口 |
| Render Perf | 事件驱动一次性调用，非高频 setState / 非数组追加入根链 |
| AppShell Structure | 不新增 shell 状态、不改 domain bag；复用既有 `onRefreshConfig` prop |
| ADR 校准 | 不命中更新触发器（engine registry / provider binding / canonical fact schema / context compiler 等均不变） |
| Native WebView API | 不涉及 native 能力 |

## 测试

- `ModelSelect.test.tsx`：legacy 模式 fallback-only 组 → 打开菜单自动调 `onRefreshConfig` 一次；真实 catalog 组 → 不调；in-flight 中重复开合 → 不重复调。
- `useEngineController`：断言 on-demand phase 的 orchestrator `timeoutMs` 为 22s（经 startupOrchestrator mock）。
- Rust：现有 `status.rs` pi catalog 解析测试保持绿（并行化不改解析语义）。
