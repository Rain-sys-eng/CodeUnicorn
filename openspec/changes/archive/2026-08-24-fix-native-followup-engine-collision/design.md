# Design: fix-native-followup-engine-collision

## Context

Native 续聊发送闸门在 `useThreadMessaging.sendUserMessage`：

```
threadEngine !== currentEngine || !threadIdCompatible
  → startThreadForMessageSend(currentEngine)
```

`currentEngine` 来自全局 `activeEngine`。DSH catalog 合同是 `id = {provider}/{model_id}`、runtime 只有 `model_id`。`handleSelectModel` 本 catalog 只比 `id`，对不上再跨 catalog 精确比 `id`。DSH 闭合态 `formatDshModelDisplayLabel` 只留 last path segment。

碰撞不是 grok 特例：

| DSH last-segment / catalog id | 可能撞上的 native CLI |
|---|---|
| `grok-4.6` | Grok |
| `claude-sonnet-4-6` | Claude |
| `kimi-k2` / `kimi-code/...` | Kimi |
| `gpt-5.x` | Codex |
| `gemini-*` | Gemini |
| 整串 `{provider}/{model}` | Kimi / OpenCode slug |

复杂第一轮独有空窗（pending finalize、catalog 预热、人点底栏确认）让 rematch / 跨 catalog lookup 有机会对齐，故非 100%。简单 1+1 没有空窗。

显式切引擎组仍必须下崽：Atomic 左栏、创建目标、会话引擎选择。

## Goals / Non-Goals

**Goals:**

1. 本 catalog 能用 `id` 或 `.model` 命中时，禁止跨 catalog 改写 `targetEngine`。
2. Native 续聊默认 stay-on-thread；只有本轮显式引擎组切换才 `startThreadForMessageSend`。
3. DSH 闭合态带 provider，避免与其它 CLI 同名 runtime 在视觉上不可分。
4. 合同覆盖全部 native CLI，不写 grok 特例。

**Non-Goals:**

- 改 DSH `flatten_llm_models` catalog 合同。
- 因同名 runtime 拦截用户点另一引擎组。
- 改 Shared send / picker = send 账本。
- 改 engine registry、基石 ADR。

## Decisions

### D1. 本 catalog 优先：`id` 或 `.model`

**选定**：export `findModelById`（已比 `id` 再比 `.model`）。`handleSelectModel` 先 `findModelById(effectiveModels, id)`。无命中才跨 catalog **精确比 `id`**（保留「从 Claude 点 `kimi-code/kimi-for-coding`」既有用例）。

禁止：仅因 runtime 名（`grok-4.6`）跨 catalog 把 DSH 选择写成 Grok CLI pref。

不采用：跨 catalog 也比 `.model`。那会把 DSH `ggggg/grok-4.6` 的 runtime 再次判给 Grok 组。

### D2. 显式引擎切换标记 + 续聊闸门

**选定**：模块级 `mark` / `consume` / `peek`（`explicitComposerEngineSwitch.ts`）。

只在这些用户意图点 `mark(nextEngine)`：

- `handleNativeAtomicTargetChange`：`target.engine !== selectedEngine`
- `handleCreationTargetChange`：`target.engine !== selectedEngine`
- `handleSelectConversationEngine`：`setActiveEngine` 前

send 入口每次 `consume()`。纯函数：

```
shouldSpawnNativeThreadForEngineMismatch({
  threadEngine, currentEngine, threadIdCompatible, explicitEngine
})
```

- 已匹配且 prefix 兼容 → 不下崽
- mismatch 且 `explicitEngine === currentEngine` → 下崽
- 其余 mismatch → stay-on-thread（`sendMessageToThread(activeThreadId)`）

create-session seed rematch 用的是 `currentProvider`，`target.engine === selectedEngine`，不会误 mark。`commitThreadSelection` 切的是已有会话，不 mark。

不采用：send 时比较 display label。文案会漂。不采用：禁止 Atomic 左栏出现其它引擎。故意切引擎必须可用。

### D3. DSH 闭合态带 provider

**选定**：`formatDshModelDisplayLabel(model, { closed?: boolean })`。

- 列表行（默认）：last path segment（既有 vitest 保持）
- 闭合态：按 catalog id 第一个 `/` 拆 provider，`${provider} / ${lastSegment}`；无 `/` 则仍 last segment

`ModelSelect.getModelLabel` 只在 trigger / 当前模型文案传 `{ closed: true }`。

不改列表行：双栏行内仍要短，避免把 Kimi/OpenCode 行挤乱。

### D4. 与既有 change 的边界

| change | 本 change 碰不碰 |
|---|---|
| `fix-model-picker-send-authority` | 不改 picker = send 账本；lookup 命中后仍写 resolver |
| `add-dsh-engine` | 不改 host RPC / flatten 合同 |
| 基石 ADR | 未命中更新触发器，不回写 |

## Risks / Trade-offs

- [Risk] 用户真要点 Grok CLI，但 mark 漏了 → 续聊锁在 DSH。Mitigation：三处显式切引擎入口必须 mark；vitest 钉 `explicit === currentEngine` 才 spawn。
- [Risk] stale mark：点了 Grok 后又回到 DSH 再发。Mitigation：每次 send 都 consume；匹配路径丢弃标记。
- [Risk] DSH catalog id 与 Kimi slug 整串相同。Mitigation：本 catalog `id` 先命中则不跨 catalog。
- [Risk] 闭合态变长。Mitigation：只改 trigger，列表行仍短。

## Migration Plan

纯前端行为修复。无需数据迁移。回滚：还原 lookup、闸门、label 三处。

## Open Questions

无。碰撞面与显式切引擎语义已在诊断中钉死。
