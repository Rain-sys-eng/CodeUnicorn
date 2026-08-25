# Session Switch Catalog Fetch Pitfall（切会话拉 catalog 卡死采坑）

> 来源事故：2026-08-19。补「侧栏供应商标签 / 独立配置绑回」时，点左侧历史会话整窗卡死；改代码前没有这个卡顿。标签修好后卡顿仍在，直到把切会话路径上的 `get_engine_models` 全部拆掉。
> 同族前案：2026-08-14 Windows 冷启 click freeze（`windows-cold-start-click-freeze-pitfall.md`）——入口换了，根因同类：**把重 IPC 绑在用户点击上**。
> 本文件是 **implementation rule**。行为事实以代码为准。

## 事故三段论（背下来）

1. **直接原因**：`get_engine_models` 走 `startupOrchestrator`，`phase: "on-demand"` 时 **priority 85、timeout 8s**。点一条会话如果触发这次 IPC，主线程 / WebView 就像死了。
   （2026-08-25 `auto-recover-fallback-model-catalog` 起 on-demand timeout 调整为 22s，只对「打开模型选择器 / 显式刷新」生效；切会话路径仍然零 catalog IPC，本文件红线不变。）
2. **放大原因**：标签补齐前，大量会话 `providerProfileId` 为空，`useProviderModelCatalogSync` 的 catalog key 停在 `__global__`，连续点击是空转。标签补齐后 **每条会话都有 binding**（含 `__local_pi__` / `__dsh_host_catalog__` / 托管 id），每次点击都是新 key → 必打 IPC。PI / DSH 还被加进 `PROVIDER_SCOPED_ENGINES`，官方本地 sentinel 再传给 composer 当新 catalog 作用域，等于 **点一次扫两遍**。
3. **流程原因**：把「绑回独立配置」理解成「点会话就要 switch L1 + 刷 catalog」。发送其实只认 `thread.providerProfileId`。点击路径注释写着 *identity + chrome only*，接线却加了 `refreshEngineModels` 和 `vendor_switch_*`。

「标签有了所以要同步模型列表」是假命题。标签是侧栏投影；catalog 是打开模型选择器才需要的东西。

## 为什么是 P0

- 左侧切会话是最高频操作。
- 卡死发生在「刚补完标签」之后，看起来像功能修好了产品坏了。
- `get_engine_models` 对本地 sentinel / 慢引擎可打满 8s timeout。
- 只拆 `forceRefresh` 不够：`forceRefresh: false` **仍然** `await getEngineModels`。

## 已证实模型

```text
点侧栏会话
  → setActiveThreadId（便宜，必须留）
  → providerProfileId 从空/旧值变成新 binding（标签补齐后几乎每次都变）
  → useProviderModelCatalogSync 认为 catalog key 变了
  → refreshEngineModels(engine, { providerProfileId, phase: "on-demand" })
  → get_engine_models IPC ≤ 8s
  → 整窗卡死
```

叠加：

| 接线 | 效果 |
| --- | --- |
| `handleSelectThread` 里再调一次 `refreshEngineModels` | 点击路径双发 |
| `activateEngineProviderProfile` / `vendor_switch_*` | 改 L1 全局 home，绑回错 + 更卡 |
| composer `providerProfileId={thread.providerProfileId}` 含本地 sentinel | ChatInputBox 再按 profile 拉一遍 catalog |

**已排除**：侧栏 `setThreads` merge、Index 短页、占位 hide 谓词。那些会造成跳动，不是这次 8s 假死。

## 硬红线（Forbidden）

1. **禁止在切会话 / `setActiveThreadId` / `commitThreadSelection` 上调用 `refreshEngineModels`、`get_engine_models`、`vendor_switch_*`、`activateEngineProviderProfile`。**
   点击路径只许 identity + chrome（设 active thread、必要时 `setActiveEngine`）。
2. **禁止用 `forceRefresh: false` 当「便宜」**。`useEngineController.loadModelsForEngine` 在 cached 分支仍会 invoke；要不调，要就证明 last-good 命中且 **零 IPC**。
3. **禁止把本地 sentinel**（`__disk__` / `__local_pi__` / `__local_config_toml__` / `__dsh_host_catalog__` 等）**传给 composer 当新 catalog 作用域**。侧栏标签可以显示 `local`；composer catalog 应保持引擎默认，与补标签之前一致。
4. **禁止为了绑回独立配置去 switch L1 启动配置。** 发送权威是 `thread.providerProfileId`（L2），不是全局当前供应商。
5. **禁止「补数据面」时顺手在热路径加预热。** 字段从空变成有值，会让以前的 early-return 全部失效。先问：这个 effect 在「每条会话都有该字段」时会不会每点都跑？

## 必须项（Required）

1. 切会话：`useProviderModelCatalogSync` **不得** `refreshEngineModels`。最多记 catalog key / debug，禁止 IPC。
2. `ChatInputBox` 的 `providerProfileId`：仅托管 id；本地 sentinel 传 `null`（`isManagedEngineProviderProfileId`）。
3. catalog 拉取只允许：打开模型选择器、用户显式刷新、发送前确缺 catalog。
   打开模型选择器时若当前引擎 catalog 为 fallback-only（全部 `source === "fallback"`），允许自动触发一次 forced refresh（见 `auto-recover-fallback-model-catalog`）。
4. 改动必须带手测：连点 PI / DSH / Grok / Claude 托管会话，手感应接近「补标签之前」。

## 改这些文件前先重读本文

- `src/app-shell/domains/useProviderModelCatalogSync.ts`
- `src/app-shell/sections/threadSelect/commitThreadSelection.ts`
- `src/app-shell/sections/layoutNodes/useAppShellLayoutNodesSection.tsx`（`handleSelectThread`）
- `src/features/layout/hooks/useLayoutNodes.tsx`（composer `providerProfileId`）
- `src/features/engine/hooks/useEngineController.ts`（`loadModelsForEngine` / 8s timeout）
- `src/features/vendors/activateEngineProviderProfile.ts`
- `src/features/composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners.ts`

证据：`docs/analysis/sidebar-session-list-regression-bundle-2026-08-19.md`。合同：`openspec/changes/fix-sidebar-session-list-regressions/`。
