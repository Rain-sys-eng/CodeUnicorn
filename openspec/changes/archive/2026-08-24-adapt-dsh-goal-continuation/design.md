## Context

DSH host 把 **user turn** 和 **Goal hop** 分层：

- 用户一句 prompt → 一个或多个 hop。
- 每个 hop 结束发 `turn/end`。
- Goal plugin 在 phase `active` 时由 `dsh-goal-round-driver` 注入 `user/message`（`source.kind === "goal"`，正文是 `<goal_round>`），再自动开下一 hop。
- `goal/change` 带完整 snapshot：`phase ∈ {active, paused, blocked, complete}`，或 clear tombstone。

mossx 当前把第一次 completed `turn/end` 同时当成：

1. oneshot waiter 完成（`collect_turn_text` 需要这个）。
2. `EngineEvent::TurnCompleted` → frontend `onTurnCompleted` → composer idle。
3. `hub.bindings.remove(session_id)` → 后续 mux 帧全部丢掉。

DSH Web 从不解绑，所以同一 host session 会继续。这是 DSH-only 的 terminal/ACK 合同，不是 Codex Goal。

History 侧 `is_dsh_injected_user_message` 把所有非 `user` source 整行丢掉，包括 Goal。DSH Web 用 `ContextInjectionRow` 显示「上下文注入」+ provenance `goal`。

## Goals / Non-Goals

**Goals:**

- Goal `active` 时 mossx 保持 mux 绑定，不因 hop `turn/end(completed)` 提早 idle。
- `source.kind === "goal"` 用折叠卡单独记录，history 与 live 一致。
- 其它 injected kinds 继续隐藏。
- oneshot waiter 仍在第一次 `turn/end` 完成，避免 sync collect 挂死。

**Non-Goals:**

- 不改其它引擎 settlement。
- 不接 Codex `/goal`。
- 不在 mossx 做 Goal CRUD UI。
- 不新增 ConversationItem kind。

## Decisions

### D1. 解绑与 TurnCompleted 拆开

`dispatch_mux_text` 今日把「notify waiter」和「unbind」绑在同一个 terminal 检测上。拆成：

| 事件 | notify waiter | emit TurnCompleted / TurnError | unbind |
|------|---------------|--------------------------------|--------|
| `turn/end` completed，Goal 非 active / 未知 | 是 | TurnCompleted | **否** |
| `turn/end` completed，Goal `active` | 是 | **抑制** | **否** |
| `turn/end` cancelled / aborted / error / failed | 是 | TurnError | **是** |
| interrupt / archive / shutdown | — | 既有路径 | **是** |

Binding 在 completed 后留下，下一 hop 的 `turn/start` / chunk / 审批仍可达。`onTurnStarted` 会 remount processing。

**备选**：永远不发 TurnCompleted，靠前端超时。否决——普通 DSH turn 会永远转圈。

### D2. MuxHub 跟踪 Goal snapshot

在 `MuxHub` 为每个 session 记：

```text
goal_phase: Option<DshGoalPhase>   // None = 尚未见 goal/change
awaiting_session_idle: bool        // 抑制过 TurnCompleted，等终态
```

`project_session_event` 不再对 `goal/change` 直接 `Vec::new()`。`dispatch_mux_text` 先 apply `goal/change`，再决定 `turn/end` 是否投影 TurnCompleted。

Phase 映射（对齐 DSH `GoalPhase`）：

- `active` → 抑制 TurnCompleted，清 `awaiting_session_idle` on next `turn/start`。
- `paused` / `complete` / 缺省 clear → 发 TurnCompleted（若本帧是 turn/end，或 `awaiting_session_idle` 时延迟补发）。
- `blocked` → 发 TurnCompleted（用户必须操作），**保持 binding**。

漏掉 `goal/change` 但 binding 还在：下一 `turn/start` 仍会让 composer 回到 running。这是安全网。

**备选**：前端自己听 `goal/change` 决定 idle。否决——`onTurnCompleted` 已经把 composer 关掉，后续 raw 救不回来。

### D3. Goal 注入走 presentation context，不新增 item kind

`ConversationPresentationContext` 增加：

```ts
{
  kind: "dsh-goal";
  title: string;      // i18n「上下文注入」
  sourceLabel: string; // 固定 "goal"
  body: string;       // 原始注入文本
}
```

History：`fold_history_events` 对 `source.kind === "goal"` **保留** `DshSessionMessage`（`source_kind: "goal"`）。`dshHistoryParser` 不再 `continue` 丢掉它，而是写出 `kind: "message"` + `presentationMetadata`（`displayText: ""`，contexts 含 `dsh-goal`）。`buildMessagePresentationMetadata` 已有「若 item 自带 metadata 则原样返回」的 hook。

Live：`user/message` + `source.kind === "goal"` 投影 `EngineEvent::Raw { kind: "dsh-goal-injection", text, source, id }`。`dshRealtimeAdapter` 把它映射成 `itemStarted` 用户消息（带同一 metadata）。其它 injected kinds 仍不投影。

卡片视觉克隆 `.note-card-context-summary-card`：默认折叠，展开看 body。空 `displayText` + 有 context card → `shouldRenderBubble` 为 false，但 context stack 让行可见（对齐 note-card 只出卡不出泡）。

**备选**：新 item kind。否决——穷尽匹配面太大。
**备选**：所有 injection 出卡。否决——AGENTS.md / skills 会刷屏。

### D4. Sidebar title 过滤 Goal 文本

`sanitize_dsh_sidebar_title` 今日只剥 runtime-context envelope。补：`<goal_round>` 整段、或「仅 Goal 注入」的 first_message 视为空 title，回落到既有 untitled 路径。

### D5. 引擎隔离

所有逻辑关在 `engine/dsh/**`、`dshRuntimeContext`、`dshHistoryParser`、`dshRealtimeAdapter`、`MessageRow` 对 `dsh-goal` context 的渲染。Claude / Codex 事件投影与 settlement 文件不改。

## Risks / Trade-offs

- **[Risk] Goal 卡在 active，host 不再开 hop → composer 一直 running**
  → Mitigation：用户 Stop 走 cancel + unbind + TurnError。规格明确宁可 hang 可停。

- **[Risk] 漏掉 `goal/change`，误抑制或误结算**
  → Mitigation：未见 snapshot 时按普通 turn 发 TurnCompleted，但 **不解绑**。下一 `turn/start` remount processing。

- **[Risk] oneshot waiter 与 live 抑制打架**
  → Mitigation：notify waiter **永远**在第一帧 `turn/end` 触发；只抑制 frontend `TurnCompleted`。

- **[Risk] 长期 binding 泄漏**
  → Mitigation：cancel / error / interrupt / archive / shutdown 必 unbind；workspace interrupt 已按 binding 列表 cancel。

- **[Risk] 折叠卡被当成用户气泡，污染 sticky / 复制**
  → Mitigation：`displayText` / `stickyCandidateText` 为空；卡片在 context stack，不进 bubble。

- **[Risk] ADR 未回写不能归档**
  → Mitigation：tasks 含 foundation-design 「最近校准」回写。

## Migration Plan

- 无数据迁移。旧 DSH history 重新 load 即可看到 Goal 卡。
- 回滚：还原 `events.rs` 在 terminal 时 unbind + 无条件 TurnCompleted，以及 history hide-all-non-user。

## Open Questions

- 无。Goal phase 语义以本机 `@deepseek-ai/dsh` 类型为准；blocked 发 TurnCompleted 但保持 binding，已在 proposal 验收条钉死。
