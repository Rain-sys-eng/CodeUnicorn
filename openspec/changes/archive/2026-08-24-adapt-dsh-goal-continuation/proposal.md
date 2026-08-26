# adapt-dsh-goal-continuation

## Why

mossx 已把 DeepSeek Harness 接成 Native Engine，但把 DSH 的 **hop `turn/end`** 当成 mossx 的 **user-turn 终态**，并在第一次 completed 时解绑 mux。DSH host 在 Goal `active` 时会自动注入下一轮 `<goal_round>` 并继续跑 hop；mossx 却提前把 composer 置 idle、丢掉后续 mux 帧。同时 `source.kind === "goal"` 被当成普通 injected context 整行隐藏，用户看不到 DSH Web 里那张「上下文注入 · goal」卡。这是 DSH 专属 terminal / 投影合同缺口，不是 Codex `/goal`，也不该动其他引擎。

## What Changes

- DSH mux **completed `turn/end` 后保持 binding**；只在 cancel / error / interrupt / archive / shutdown 解绑。
- Goal phase 为 `active` 时，**不向 frontend 发 `TurnCompleted`**，composer 保持 running，等待 host 驱动的下一 hop。
- Goal 进入 `paused` / `complete` / `blocked` / clear，或尚未收到 `goal/change` 的普通 turn：按现有合同发 `TurnCompleted`。
- `source.kind === "goal"` 的 `user/message` 投影为折叠卡「上下文注入 · goal」，不是用户气泡，也不是完全隐藏。
- AGENTS.md / skills / runtime-context 等其它 injected kinds **继续隐藏**。
- Goal 注入不得成为 sidebar title。
- 仅改 DSH 路径；Claude / Codex / Gemini / Grok / Kimi / OpenCode 结算与投影不动。

## 目标与边界

- **目标**：Goal `active` 时 mossx 跟随 host 的 hop 循环，不提早 idle；Goal 注入用折叠卡单独记录。
- **边界**：只改 `engine/dsh/**` 的 mux 结算、history fold、以及 DSH 幕布投影 / 折叠卡。不接 Shared，不改 DSH host，不发明第二套 Goal 协议。
- **安全偏好**：若 Goal 仍 active 而 host 没开下一 hop，composer 可保持 running（用户可 Stop）。宁可 hang 可停，不可提早结束。

## 非目标

- 不改 Claude / Codex / Gemini / Grok / Kimi / OpenCode 的 turn settlement。
- 不把 DSH Goal 接到 Codex `/goal` slash command 或 Codex Goal UX。
- 不把 `agent-instructions` / `plugin` / sourceless runtime-context 渲成气泡或卡片。
- 不新增 ConversationItem kind（避免 `NORMALIZED_ITEM_KINDS` 穷尽扩散）。
- 不在 mossx 内实现 Goal 编辑器 / pause / resume / complete UI。
- 不为 Goal 做独立轮询；host 自己驱动下一 hop。
- 不把所有 mux 控制面事件（`session/queue` / `session/jobs`）渲到幕布。

## Capabilities

### New Capabilities

- `dsh-goal-continuation`: DSH Goal-active hop 的 terminal 合同、mux 绑定生命周期、`source.kind === "goal"` 折叠卡投影（history + live）、以及 Goal 注入不得当用户气泡 / sidebar title。

### Modified Capabilities

- （无主 specs 可改。`dsh-engine-runtime` / `dsh-session-history` 仍在 active change `add-dsh-engine` 内；本 change 用新 capability 覆盖那两条合同的 Goal 例外，归档时一并 sync。）

## Impact

| 层 | 影响面 |
|----|--------|
| Backend | `src-tauri/src/engine/dsh/events.rs`（unbind / TurnCompleted 抑制 / goal/change / goal injection Raw）、`history.rs`（goal 行保留 + source_kind + sidebar 过滤） |
| Frontend | `dshRuntimeContext.ts`、`dshHistoryParser.ts`、`conversation.ts` presentation kind、`MessageRow` / context card、`dshRealtimeAdapter`、10 locale `messages.ts` |
| Specs | 新增 `dsh-goal-continuation` |
| ADR | 命中 terminal/ACK contract：归档前须回写 `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 「最近校准」 |

## 技术方案对比

| 选项 | 描述 | 取舍 |
|------|------|------|
| A. 把 DSH Goal 接到 Codex `/goal` | 复用现成 Goal UX | 协议不同构；会污染 Codex 面。**否决** |
| B. 新增 ConversationItem kind `dsh-goal` | 独立行类型 | 穷尽匹配面大，history/live/normalize 都要改。**否决为本期** |
| C. 所有 injected `user/message` 都出卡片 | 实现简单 | AGENTS.md / skills 会刷屏，违反已落地的 hide 合同。**否决** |
| **D. DSH-only：mux 保持绑定 + Goal-active 抑制 TurnCompleted + `dsh-goal` presentation context 折叠卡（推荐）** | 只改 DSH 投影与结算 | 对位 DSH Web；可测；不动其他引擎 |

采用 **D**。

## 验收标准

1. 无 Goal 的普通 DSH turn：`turn/end(completed)` 仍结算 composer；oneshot waiter 仍返回，sync `collect_turn_text` 不挂死。
2. Goal `active` 时 hop `turn/end(completed)`：**不**发 `TurnCompleted`；mux 仍绑定；下一 hop `turn/start` / assistant chunk 仍上幕布。
3. Goal `paused` / `complete` / clear / `blocked`：发 `TurnCompleted`，composer idle；`blocked` 仍保持 mux 绑定以便用户处理后继续。
4. 用户 Stop / `cancelled` / `error`：立即发 `TurnError`，解绑，composer 可再发。
5. history 与 live：`source.kind === "goal"` 显示折叠卡，标题为「上下文注入」+ `goal`；默认折叠，可展开看原文；**不是**用户气泡。
6. `agent-instructions` / `plugin` / sourceless runtime-context 仍隐藏。
7. Goal / `<goal_round>` 文本不得成为 sidebar title。
8. Claude / Codex 等其它引擎相关测试集不因本 change 失败。
