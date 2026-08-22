# Proposal: restore-dsh-session-composer-model

> OpenSpec change id: `restore-dsh-session-composer-model`  
> 现场：DSH 正常对话后切到其它 native 会话，再切回 DSH，composer 不再绑该 session 的 `{provider}/{model}`  
> 正交：`fix-native-followup-engine-collision`（续聊不下崽）；`dsh-followup-model-ledger`（已有 `dsh:` 不得用全局 pref 改 selectModel）  
> 本 change **不** 改 engine registry / Shared / provider binding / context compiler / ACK

---

## Why

DSH catalog 合同是 `id = {provider}/{model}`（如 `gork-zhu/grok-4.6`）。其它 CLI 切回会话能对上，是因为静态/status catalog 够用。DSH 只有 runtime catalog，session 摘要也不带当前模型。

切回时 `commitThreadSelection` 先 `setActiveThreadId`，chrome 里的 `setActiveEngine` 还要 `await switchEngine`。这段空窗里：

1. `activeEngine` 仍是上一个 native（常见是 Codex）。
2. Codex 会话 repair 会把当前 effective 模型写进 **当前 thread** 账本——包括刚点进去的 `dsh:`。
3. DSH 不在 `allowUnknown` 里；catalog 空或还是上一引擎残留时，闭合态回落到全局/默认模型。
4. Native Atomic 在 target 没有模型身份时回落 `selectedModelId`，绿点停在 Codex。

所以只有 DSH 会丢 provider/model；其它 CLI 有 catalog 可 rematch。

## What Changes

- 切会话 chrome 的 `setActiveEngine` **先改 UI `activeEngine` + last-good catalog**，再 `await switchEngine` / `refreshEngineModels`。点击路径仍禁止额外 `get_engine_models`。
- Codex repair **只允许写 Codex thread**，禁止在 `dsh:` 空窗改账本。
- DSH thread 的可信 `{provider}/{model}` 按 unknown/freeform 保留，不因残留 catalog 回落默认。
- Native Atomic：DSH target 没有模型身份时 **禁止** 回落全局 native `selectedModelId`。
- Resume / history 从已加载的 `request/header` / `request/context` 抽出 `{provider, model}`，在账本缺失或不可信时播种 composer 账本。不新增 click-path RPC。

**非 BREAKING**。

## 目标与边界

- **目标**：从其它 native 点回 `dsh:<session>`，composer 立刻绑回该 session 的 DSH `{provider}/{model}`；绿点在 DeepSeek Harness。
- **边界**：不调用 `session.models` / `llm.models` / `get_engine_models` 作为切会话点击路径。不把 `__dsh_host_catalog__` 当 managed catalog 作用域。不把 `ccgui` 写入 `selectModel`。已有 `dsh:` 续聊仍不得用全局 `composerEnginePrefs.dsh.modelId` 改 target。

## 非目标

- 不改 DSH `flatten_llm_models` 的 `{provider}/{model}` 合同。
- 不改其它 CLI 的 catalog 刷新策略。
- 不回写基石 ADR（未命中更新触发器）。
- 不提交 git commit。

## Capabilities

### New Capabilities

- `dsh-session-composer-restore`: 切回 DSH session 必须按 thread 账本或 host history 当前 `{provider}/{model}` 绑定 composer，不得吃上一个 native 的全局选择。

### Modified Capabilities

- （无）既有 capability REQUIREMENTS 不改语义。

## Impact

- Frontend: `useEngineController.ts`、`useAppShellComposerModelSection.ts`、`modelSelection.ts`、`resolveComposerAtomicSelectedModelId.ts`、`selectedComposerSession.ts`、DSH history loader / resume
- Backend: `src-tauri/src/engine/dsh/history.rs` 从已加载 events 抽出 current model
- Tests: model section repair、engine switch 乐观态、history extract、atomic fallback
- Docs: 本 change
