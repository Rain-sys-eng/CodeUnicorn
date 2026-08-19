---
type: design
status: approved-pending-review
---

# Shared 供应商失败自动重试 Design

> **Lifecycle**：brainstorming 已通过；本文是实现前的 design spec，不是 shipped 行为源。
> **交互对照**：`docs/designs/shared-provider-retry/index.html`
> **日期**：2026-08-20

## 1. Outcome

Shared 会话在供应商号池 / 超时 / 429 / 过载这类**暂时失败已经落账**之后，客户端按结果论自动再发一轮。再发不是重试同一个 Shared attempt，也不是换供应商；而是同一家 CLI / Provider / Model，把用户可改的「续跑指令」作为**新的用户消息**发出去。

界面学 Codex 的「再连几次」手感，但层不同：Codex 官方是 in-turn HTTP/stream reconnect；Moss 驱动的是 CLI，只能在 `turnCommitted` 之后新开 attempt。

## 2. Non-goals

- 不自动切换供应商 / Provider / Model。
- 不改 Shared V2 durable-first 纪律：失败 attempt 不原地重放，不伪造 `turnCommitted`。
- 不重试 `recovery-required` / `target-unavailable` / observer detach / ACK ambiguous。那些仍走现有 `SharedSendStatusBar`。
- 不覆盖 native / 非 Shared 会话（v1）。
- 不把重试状态放进 Composer / 输入框下方状态条。
- 不让用户自定义幕布提示文案。
- 不把每会话配置写入磁盘；刷新后回到全局默认。
- 不重发上一轮用户原文和图片。工作区文件改动已经落盘，续跑指令只负责让 CLI 接着做。

## 3. Why this layer

`sendSharedSessionTurnV2` 在 typed rejection / failed terminal 后会确认 commit 并解锁 Composer，然后 `useThreadMessaging` 直接 `return`。客户端收到的是「这一枪已经结束」，不是 Codex 的 `willRetry`。

因此本功能是 **post-commit controller**，挂在 Shared 发送结果之后：

```text
user send
  → Shared V2 begin / dispatch / await terminal
  → turnCommitted (completed | failed | cancelled)
  → composer unlock
  → providerRetry controller 分类
       ├─ retryable + enabled → 幕布倒计时 → 新 attempt（续跑指令）
       ├─ permanent / user-stop / recovery → 不自动打
       └─ success → 结束本轮 series
```

## 4. Units

每个 unit 只做一件事，通过明确接口通信。

| Unit | 职责 | 不做什么 |
|---|---|---|
| `classifySharedProviderRetryError` | 纯函数：错误文本 + 本地证据 → `retryable` / `reason` / `kind` | 不读 store，不发请求 |
| `providerRetryPolicy` | 默认值、clamp、退避秒数 | 不持有会话态 |
| `providerRetrySettingsStore` | 每 `workspaceId + threadId + engine` 一份内存配置 | 不写 localStorage / rust settings |
| `providerRetryControllerStore` | 当前 thread 的 overlay / series / 倒计时 | 不改 Shared send 状态机 |
| `useSharedProviderRetry` | 看发送终态、分类、倒计时、调用现有 submit | 不自己 begin Shared turn |
| `SharedProviderRetryHint` | 幕布一行提示 + 文字按钮 | 不进 Composer |
| `SharedProviderRetryToggle` | 协作旁边的 pill + 小弹窗 | 不改全局设置页 |

依赖方向：classifier / policy 无 UI；stores 无发送副作用；controller hook 只调用现有 `sendMessage`；两个 UI 组件只订 store。

## 5. 配置

### 5.1 作用域

- **全局默认**：编译期常量，打开会话 / 首次碰到某 CLI 时拷贝一份。
- **生效值**：进程内存。key = `` `${workspaceId}::${threadId}::${engine}` ``。
- `engine` 是 Shared CLI（`claude` / `codex` / `kimi` / `grok` / `opencode` / `pi`），不是供应商号池名。
- 同一会话里切 Claude → Codex，用 Codex 自己的那份；互不影响。
- 切到另一个 Shared 会话：新 key，重新从默认拷贝。
- 刷新 / 重启进程：全部回到默认。
- 弹窗改动立即作用于该 key，不写盘。

不采用「全局一份 CLI 配置跨会话共享」。用户原话是每个 Shared session 的每个 CLI 独立一份。

### 5.2 字段与默认

| 字段 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `enabled` | `true` | on/off | 关 = 不自动倒计时、不自动发 |
| `maxAttempts` | `3` | 0–10 | `0` 等价于关闭自动发；pill 仍可打开 |
| `baseDelaySec` | `3` | 1–1200 | 第一次失败后，再发第一枪前要等的秒数 |
| `maxDelaySec` | `20` | 1–1200 | 单次等待上限；指数退避翻倍后也不会超过它 |
| `backoff` | `exponential` | `exponential` \| `fixed` | 指数 ×2 或固定间隔 |
| `resumePrompt` | 见下 | 非空字符串 | **发给 CLI 的正文**，不是幕布提示 |

默认续跑指令：

```text
继续。上一轮因供应商暂时失败中断，请从已完成进度接着做，不要重复已完成的步骤。
```

空串或只空白时回退到 `继续`。

指数节奏：`min(base * 2^(attempt-1), maxDelay)` → 默认 3s → 6s → 12s。

`enabled=false` 或 `maxAttempts=0`：分类仍可跑（便于以后打日志），但 **不进入 wait，不自动 submit**。

## 6. 错误分类

只看**已经失败落账的结果** + 本地证据。不看 CLI 内部 `willRetry`。同一 `attemptId` 只分类一次；流式正文里的 403 和 `turn/error` 算同一枪。

输入：

- Shared terminal `outcome`（`failed` / `cancelled` / `completed`）
- 助手失败气泡 / `turn/error` 原文
- 本地 interrupt 标记（用户点停止）
- 当前 Shared send state（`recovery-required` / `target-unavailable` / `blocked` 直接否决）

### 6.1 会自动再试（`retryable`）

按短 reason 归类，供幕布一行使用：

| kind | reason | 匹配（大小写不敏感，命中任一） |
|---|---|---|
| `pool` | 号池 | `not assigned to any group`；`api key is not assigned`；`failed to authenticate` 且含 `403` |
| `rate` | 请求过多 | `429`；`too many requests`；`rate limit` / `rate-limit` / `rate_limited` |
| `timeout` | 超时 | 现有 `classifyNetworkError === "timeout"`；`FIRST_PACKET_TIMEOUT:`；`deadline exceeded`；`no initial response within`；中文「超时/超時」 |
| `overload` | 过载 | `overloaded`；`at/no/out of/without capacity`；`capacity exceeded/exhausted/limit`；`busy, please retry` |
| `server` | 服务错误 | `5xx` 且附近有 `error/http/status/upstream/gateway`；`bad gateway`；`service unavailable`；`upstream` + `retry/error/fail` |
| `soft-cancel` | 暂时中断 | `turn cancelled` / `canceled`，且 **没有** 本地 interrupt 证据 |

号池 403 是主场景：供应商后台可能已切号，下一枪有机会打中可用 key。

### 6.2 不自动再试（`permanent` 或 `abort`）

| kind | 处理 |
|---|---|
| 本地用户停止 / `Session stopped` 且本轮是 interrupt | `abort`，文案「已停止后续自动重试」 |
| `unknown model` / `model not found` / 缺 Key / `provider removed` / `missing-provider` | `permanent` |
| `prompt too long` / `context overflow` / `context_length` | `permanent` |
| 永久权限拒绝（`permission denied` 且无 retry later） | `permanent` |
| Shared `recovery-required` / `target-unavailable` / `blocked` | 不进入本功能 |
| `SharedActiveAttemptObserverError` / ACK ambiguous | 不进入本功能（fail closed） |
| 其他未识别错误 | **fail closed：不自动再试**，也不弹「不自动再发」以免误报 |

`permanent` 才在幕布出一行「{reason}，不自动再发」+ `再试`。未知错误保持现状，只留原来的失败正文。

### 6.3 与现有 recovery 的边界

`recoveryErrorMap.ts` 管 binding / owner。本分类器管供应商暂时失败。两者禁止抢同一枪：

- send state 不是 `idle`（commit 后应回到 idle）→ 本功能不启动。
- `native-session-not-found` → 只走恢复条。

## 7. 再发流程

### 7.1 Retry series

一次 series 从「用户亲手发出的那一轮」失败开始，到成功 / 用尽 / 中止结束。

- series 不跨会话、不跨 CLI、不跨 Provider/Model。
- 自动或手动发出的续跑指令 **继续同一 series**，不新开计数。
- 用户在 Composer 里另发一条自己的消息 → 取消 wait，结束 series。
- 用尽 / 停止 / 永久错误后点幕布 `再试` → **新 series**，attempt 从 1 再数，先进入 `wait`（用当前退避的第一次等待），不立刻 submit。用户要马上打，再点 `立即`。

`attempt` 在进入 wait 时 +1。点 `立即` 只跳过剩余秒数，不额外 +1。

### 7.2 状态

`idle → wait → sending → (wait | success | exhausted | stopped | permanent)`

- `wait`：倒计时。Composer 不锁。
- `sending`：调用现有 Shared submit，正文 = `resumePrompt`，无图片，Target 与失败那一轮相同。
- 新 attempt 若再失败且 `attempt < max` → 回到 `wait`。
- `attempt >= max` 且仍失败 → `exhausted`。
- 新 attempt 成功（terminal `completed`，或幕布出现非错误助手正文）→ `success`，约 2s 后清 overlay。

Controller **不得**调用 `sharedSessionV2BeginTurn`。必须走 `useThreadMessaging` 现有发送入口，以便 admission gate、optimistic user bubble、V2 orchestrator 仍只此一条路。

### 7.3 发给 CLI 的消息

| 项 | 值 |
|---|---|
| role | 真实 user 消息 |
| text | 当前 CLI 内存配置里的 `resumePrompt` |
| images | 空 |
| engine / provider / model / reasoning | 与失败 attempt 的 snapshot 相同 |
| collaboration | 不因此自动 arm 协作；若协作 run 正在进行则本功能不启动 |
| 幕布可见 | 是。小字标记「自动续跑」 |

为此给 `ConversationItem`（`kind: "message"`, `role: "user"`）增加可选字段：

```ts
originKind?: "provider-continuation" | "shared-provider-retry" | string
```

只用于幕布小标记和 series 归属；CLI 只看到纯文本。

不把续跑指令做成隐藏调度词（那是协作 `【协作调度】` 的模式）。用户要看见发出去的那句。

### 7.4 中止

下列任一发生，立刻 `clearTimeout` / `clearInterval`，series 结束，不再自动 submit：

- 幕布 `停止` 或 Composer 红停
- 用户提交一条非本功能的新消息
- 切换 engine / provider / model
- 切换 thread / workspace
- 进入 `recovery-required` / `target-unavailable`
- 协作 run 开始
- 页面卸载

切走再切回：overlay 不恢复。内存配置还在，倒计时不接着走，避免后台偷发。

## 8. UI

### 8.1 幕布提示

挂在**当前 thread 最新失败助手气泡下面**，不是 Composer，不是 `SharedSendStatusBar`。

视觉约束（已在交互稿拍板）：

- 无卡片描边、无底色块、无大按钮
- 一行：12px 提示 + 同一行文字按钮
- 按钮无边框，中间用 `·` 分开
- 等待色用现有 warning token，停止/用尽用 danger text token，不要再包一层 container

文案由产品定死，走 i18n，不进设置：

| 态 | 中文 |
|---|---|
| wait | `{cli} 暂时失败（{reason}）· {n}s 后再试 {attempt}/{max}` |
| sending | `正在发给 {cli} · {attempt}/{max}` |
| exhausted | `{cli} 已重试 {max} 次仍失败` |
| permanent | `{reason}，不自动再发` |
| stopped | `已停止后续自动重试` |
| success | `第 {attempt} 次已接通` |

按钮：

- wait：`立即` · `停止`
- sending：`停止`
- exhausted / permanent / stopped：`再试`

`{cli}` 用当前 Shared engine 展示名（Claude Code / Codex / Kimi …），不用供应商名「百倍」。`{reason}` 用 §6.1 短词。

Overlay 是 ephemeral store，不写入 conversation history。刷新后消失。

### 8.2 Composer 设置入口

只在 `isSharedSessionResolved` 时渲染，放在 `composer-collab-slot` 里、`MultiAgentComposerToggle` **右侧**。

- pill 形态对齐协作：无描边、24px 高、弱文案
- 文案：`重试 {n}次`；`enabled=false` 或 `n=0` 时为 `重试 关`
- 点开 portal 小弹窗（宽度约 292–320，向上弹出，避免被 composer overflow 裁切）
- 字段：开关、次数、退避、首次等待、最长等待、续跑指令
- 副文案写明：只对这个 Shared 会话的当前 CLI 生效，刷新后回到默认

不进「设置 > 续写与融合」。那是另一条能力。

## 9. 挂点（实现时对照）

| 现有点 | 用法 |
|---|---|
| `sendSharedSessionTurnV2` 返回 `v2.committed` | 只作为「本枪已落账」信号；outcome 另读 terminal / 幕布失败气泡 |
| `useThreadMessaging` Shared 早退 | committed 之后通知 controller，不要在 V2 orchestrator 里重试 |
| `pushThreadErrorMessage` / `onTurnFailed` | 分类输入之一；8s 去重窗口仍然有效，controller 以 attemptId 为准 |
| `interruptedThreadsRef` | 区分用户停止 vs soft-cancel |
| `sharedSendStateStore` | 非 idle 则禁止启动 |
| `composer-collab-slot` | 放置 pill |
| `ConversationItem.originKind` | 标记自动续跑气泡 |

禁止改 `sendStateMachine` 九态来表达供应商冷却。那是 binding/recovery 的状态机。

## 10. 测试口径

纯函数（必做）：

- 分类表：号池 403、429、超时、过载、5xx、soft-cancel、用户停止、缺模型、recovery 前缀、未知错误
- 退避：3/6/12 封顶 20；fixed 始终 base
- clamp：越界写回范围
- 空续跑指令 → `继续`

Store / hook（必做）：

- 同一 session 的 Claude / Codex 配置互不覆盖
- 换 session 后回到默认，不读到上一会话的次数
- wait 期间 stop / 切 model / 切 thread 不再 submit
- series 内第二次失败继续计数，不重置
- 续跑发出的 user 消息带 `originKind: "shared-provider-retry"`，且不启动新 series
- `recovery-required` 不出现幕布重试行
- `enabled=false` 或 `maxAttempts=0` 不自动发

UI（focused）：

- hint 不在 Composer DOM 里
- pill 仅 Shared 可见，在协作右侧
- 一行内是文字按钮，无实心大按钮

不把全量 e2e 当本 change 的准入。

## 11. 风险

- **重复劳动**：续跑指令必须明确「不要重复已完成步骤」；仍无法 100% 阻止模型重做。可接受，比重发整段用户任务更轻。
- **失败气泡与 terminal 双通道**：必须以 attemptId 去重，避免一次失败数两枪。
- **偷发**：切会话必须取消 timer；后台 thread 不允许继续倒计时。
- **与协作抢发送**：协作 run active 时本功能停。
- **V2 admission**：自动 submit 必须走现有 idle gate；sending 时若仍非 idle，取消本枪并标 stopped，不要自行重入 begin。

## 12. 实施顺序（计划阶段再拆任务）

1. policy + classifier + 单测
2. 内存 settings / controller store
3. `useSharedProviderRetry` 挂到 Shared 发送终态
4. 幕布 `SharedProviderRetryHint`
5. Composer pill + popover
6. `originKind` 小标记
7. focused tests

实现前另开 OpenSpec change；本文不是 `openspec/**` 的行为源。落地后以 OpenSpec + 代码为准，本文改为 historical mirror。
