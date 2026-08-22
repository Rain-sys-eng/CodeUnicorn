# Design: restore-dsh-session-composer-model

## Context

切会话合同（`session-switch-catalog-fetch-pitfall`）：

```
click = setActiveThreadId + chrome setActiveEngine(thread.engineSource)
禁止 refreshEngineModels / get_engine_models / vendor_switch_*
```

现状 `setActiveEngine` 在 `await switchEngine` 成功后才 `setActiveEngineState`。DSH 点回去的第一帧仍是上一个 native。

Codex repair（`useAppShellComposerModelSection`）在 `activeEngine === "codex"` 时把 `effectiveSelectedModelId` 写回 **当前** `activeThreadId`。thread 已是 `dsh:`、engine 还是 Codex 时，会污染 DSH 账本。

DSH `getEffectiveSelectedModelId` 不在 `allowUnknown`：非空残留 catalog 对不上 thread model 就回落 catalog default。

Host 已有事实：history 的 `request/header.config` / `request/context` 带 `{provider, model}`。`load_dsh_session` 已拉这些 events，只是丢掉了。

## Goals / Non-Goals

**Goals:**

1. 点回 DSH thread 的同一帧，composer chrome 的 engine 是 `dsh`。
2. Codex/native repair 不得改写 `dsh:` 账本。
3. 可信 DSH `{provider}/{model}` 在 catalog 空或残留时仍驱动闭合态。
4. 账本缺失时，用本次 history 已加载的 host 当前模型播种；不新开 click-path catalog IPC。

**Non-Goals:**

- 点击路径调 `session.models` / `llm.models` / `get_engine_models`。
- 改变 stay-on-thread / `ccgui` 过滤 / 全局 DSH pref 合同。
- 改 `DshSessionSummary` 列表热路径去扫每个 session 的 history。

## Decisions

### D0. 切会话 chrome 必须识别 DSH

`commitThreadSelection` 的 `isEngineType` 漏了 `"dsh"` 时，点回 DSH thread **不会** `setActiveEngine("dsh")`。composer 绿点停在上一个 native（截图：Codex CLI + 全自动/默认），即使账本里还有 `gork-zhu / grok-4.5`。

闸门：`isEngineType` 含 `dsh`；`engineSource` 缺失时从 `dsh:` thread id 推断。无前缀 Codex id 不得误推断。

### D1. 乐观 `activeEngine`，失败再回滚

`setActiveEngine` 在 installed 校验通过后立刻 `setActiveEngineState` + `persistEngineSelection` + 切可见 catalog。`switchEngine` 仍在之后跑。**点击路径不得** `refreshEngineModels` / `get_engine_models`：可见 catalog 只来自 `targetStatus.models` 或 last-good `{engine}:__global__`。打开模型选择器才拉 catalog。

可见 catalog 优先 `targetStatus.models`；空则用 `lastGoodModelsByScopeRef` 的 `{engine}:__global__`。禁止为了补 DSH 列表在 click 上再打一条 `get_engine_models`。

`switchEngine` 失败则回滚到切入前的 engine / models。

### D2. Repair 看 thread engine，不看漂移的 `activeEngine`

```
activeEngine === "codex" && resolveThreadEngine(activeThreadId) === "codex"
```

才允许 persist repair。`dsh:` 即使 `activeEngine` 仍是 Codex 也不写。

### D3. DSH thread 允许 unknown ledger id

`allowUnknownActiveThreadModel` 在 `activeEngine === "dsh"` **或** 当前 thread 是 DSH 时为 true。可信 `{provider}/{model}`（`isTrustedDshCatalogId`，排除 `ccgui`）即使不在当前 `engineModelsAsOptions` 也保留。

空 catalog 的既有行为（返回 thread id）保持。

### D4. DSH Atomic 禁止回落全局 native 模型

`resolveComposerAtomicSelectedModelId`：`executionTarget.engine === "dsh"` 且 target 无模型身份时返回空串，不得用 `globalSelectedModelId`（上一个 Codex/Claude 选择）。

### D5. History 抽出 current model，只在账本不可信时播种

Rust `load_dsh_session` 对已加载 events last-wins fold：

- `request/context` → `{provider, model}`
- `request/header` → `header.config.{provider, model, reasoningEffort}`

写入 `DshSessionLoadResult.currentModel`。不另发 RPC。

客户端：

- loader / resume 抽出 `provider/model` catalog id
- `seedDshComposerSelectionFromHost`：仅当现有账本缺失或不可信时写入 `selectedModelByThread.{ws}:{threadId}`
- 通知 `useSelectedComposerSession` reload 当前 thread，避免 resume 晚到后 UI 不刷新
- 已有可信账本（用户刚点过 / 发送写过）不得被 host 覆盖
- 已有 `dsh:` 续聊仍不得用全局 `composerEnginePrefs.dsh.modelId` 当 fallback

## Risks

| 风险 | 处理 |
|---|---|
| 乐观 engine 与 backend `switch_engine` 失败不一致 | generation + chrome snapshot：只有最新一次失败才回滚 |
| last-good 过期 | 只作第一帧；打开 picker 才 `refreshEngineModels` |
| history 窗口不含更早的 header | last-wins 当前页；UI 默认 200 条通常含最近 request |
| 播种与用户点选竞态 | 只在账本不可信时写；可信账本 last-write 仍是用户 |

## Click-path 红线核对

| 动作 | 允许 |
|---|---|
| `setActiveThreadId` | 是 |
| chrome `setActiveEngine` 改 React state / last-good | 是 |
| `setActiveEngine` 内部既有 `switchEngine` | 保持；**不得**再跟 `refreshEngineModels` |
| 在 `useProviderModelCatalogSync` / `commitThreadSelection` 加 `refreshEngineModels` | **禁止** |
| resume `load_dsh_session` 顺带 fold current model | 是（不是 click 热路径） |
