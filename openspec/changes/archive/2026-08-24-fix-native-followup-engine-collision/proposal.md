# Proposal: fix-native-followup-engine-collision

> OpenSpec change id: `fix-native-followup-engine-collision`  
> 现场：DSH 第一轮复杂对话后，第二轮会在侧栏「下崽」开出 native Grok CLI 会话  
> 正交：`fix-model-picker-send-authority`（picker 与 send 账本）；`add-dsh-engine`（DSH 接入）  
> 本 change **不** 改 engine registry / Shared / provider binding / context compiler / ACK

---

## Why

DSH 把 host LLM 挂在自定义 provider（如 `ggggg`）+ runtime `grok-4.6` 上，catalog id 是 `{provider}/{model_id}`。mossx 闭合态只显示 last path segment，`handleSelectModel` 跨 catalog 只比 `id`，续聊闸门在 `threadEngine !== activeEngine` 时一律 `startThreadForMessageSend(currentEngine)`。复杂第一轮留下的空窗（pending finalize、catalog 预热、人点底栏）让 rematch 有机会把 `grok-4.6` 当成 Grok CLI 模型，于是第二轮真的 spawn 出 native grok session。

这不是 grok 特例。任何 DSH last-segment 与其它 native CLI catalog id 相同（`claude-sonnet-4-6`、`kimi-k2`、`gpt-5.x`、`gemini-*`），或 Kimi/OpenCode 的 `provider/model` slug 与 DSH catalog id 整串相同，都会走同一条 lookup + 下崽闸门。简单 1+1 轮没有空窗，所以不是 100%。

## What Changes

- `handleSelectModel` 对本 catalog 先按 `id` **或** `.model` runtime 命中；禁止仅因 runtime 名跨 catalog 改写 `targetEngine`。
- 续聊 stay-on-thread：thread 归属 engine 与 `activeEngine` 不一致时，除非本轮有显式引擎组切换标记，否则继续发到当前 thread，禁止 `startThreadForMessageSend`。
- 显式点另一引擎组（Atomic 左栏 / 创建目标 / 会话引擎选择）仍允许下崽。
- DSH 闭合态显示 `provider / lastSegment`（如 `ggggg / grok-4.6`）；列表行可仍用 last segment。
- 覆盖全部 native CLI：claude / codex / gemini / grok / kimi / opencode / pi / dsh，不写 grok 特例。

**非 BREAKING**。故意切引擎组仍开新会话。

## 目标与边界

- **目标**：DSH（或任一 native）续聊不得因同名 runtime / catalog last-segment 误开另一 CLI 会话。
- **边界**：只修 model lookup、续聊闸门、DSH 闭合态文案。不改 DSH host RPC、不改 Shared、不改 engine registry。

## 非目标

- 不改 DSH `flatten_llm_models` 的 `{provider}/{model_id}` catalog 合同。
- 不因「当前 catalog 有同名 runtime」拦截用户点另一引擎组。
- 不改 `fix-model-picker-send-authority` 的 picker = send 账本合同。
- 不回写基石 ADR（未命中更新触发器）。
- 不提交 git commit（实现后交用户审批）。

## Capabilities

### New Capabilities

- `native-followup-engine-collision`: native 续聊的 engine 归属以 thread 为准；跨 catalog 不得仅凭 runtime / last-segment 改写引擎；DSH 闭合态必须带 provider。

### Modified Capabilities

- （无）既有 capability 的 REQUIREMENTS 不改语义，只补本 change 的碰撞合同。

## Impact

- Frontend:
  - `useAppShellComposerModelSection.ts`（lookup 先本 catalog `id` 或 `.model`）
  - `modelSelection.ts`（export `findModelById`）
  - `useThreadMessaging.ts`（mismatch 闸门吃显式切换标记）
  - `Composer.tsx` / `useAppShellLayoutNodesSection.tsx`（mark 显式引擎切换）
  - `dshModelDisplayLabel.ts`（闭合态带 provider）
- Tests: model section、dsh label、mismatch helper、composer onSelectEngine。
- Backend: 不改 Rust。
- Docs: 本 change。

## 技术方案对比

| 选项 | 描述 | 取舍 |
|---|---|---|
| A. 只改 DSH 显示名，不改闸门 | 闭合态写成 `ggggg / grok-4.6` | 人眼可辨，但 rematch / 跨 catalog lookup 仍会翻引擎 |
| B. DSH catalog id 改成不可撞的内部 id | 改 flatten 合同 | 破坏已存 pref / resolver；其它 CLI 的 `provider/model` 仍互撞 |
| **C. 本 catalog 优先 + 续聊锁 thread + 闭合态带 provider（推荐）** | lookup 不跨 catalog 猜引擎；下崽必须显式点引擎组 | 覆盖全 CLI；故意切引擎仍可用 |

采用 **C**。

## 验收标准

1. DSH 会话选 `ggggg/grok-4.6` 后第二轮（含复杂第一轮后）仍发到同一 `dsh:` thread，侧栏不得新开 grok CLI。
2. 同样合同覆盖 DSH last-segment 撞 `claude-sonnet-4-6` / `kimi-k2` / `gpt-5.x` / `gemini-*`：续聊不得下崽对应 CLI。
3. 用户在 Atomic 左栏 / 创建目标显式点 Grok（或其它）组，下一轮仍应开该引擎新会话。
4. `handleSelectModel("kimi-code/kimi-for-coding")` 从 Claude catalog 显式跨引擎点选，仍写入 kimi pref（既有用例不得回归）。
5. DSH 闭合态文案含 provider（`ggggg / grok-4.6`），列表行可仍显示 last segment。
6. 相关 vitest 绿。不 commit。
