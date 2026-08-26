## Why

响应中条现在只有 spinner + 计时 +「响应中...」。引擎其实已经在推 live `tokenUsage`（`thread/tokenUsage/updated` → `tokenUsageByThread` → canvas `activeTokenUsage`），但 WorkingIndicator 没接。用户要的是 Cursor 那种 `4m 21s · 5.6k tokens`：流式过程中就能看到本轮 token 在涨。

## 目标与边界

- 响应中条在计时后面追加 compact token 文案，例如 `11:11 · 5.6K tokens`。
- 数字跟 live `activeTokenUsage.last`（input + cached input + output），有数才显示；引擎还没上报就只保留计时。
- WorkingIndicator 自己订 canvas selector，**禁止**把 token usage 打进 `Messages` / `conversationCanvasNode` 根 props。
- 新回合开始后，若 live 快照仍是上一轮终值，不得立刻显示旧数；等本轮 usage 到来再亮。

## 非目标

- 不改消息结束态 footer 的「输入 / 输出」明细。
- 不新增 usage 事件、不改 engine adapter、不改 Composer 占用环。
- 不做 tok/s、cache hit%、费用估算。
- 本 change **不自动 git commit**。

## 技术方案（对比）

| 方案 | 做法 | 取舍 |
|------|------|------|
| A 把 tokenUsage 塞进 Messages 根 props | 实现最快 | 违反 live 根链红线：usage 抖动会打整棵幕布 |
| **B WorkingIndicator 订 canvas selector（采用）** | 只订 `activeTokenUsage.last` 三个数 | 小树刷新；Messages 根 props 不变 |
| C 新建 liveTokenUsageChannel | 和 live text 一样外置 | 现有 `activeTokenUsage` 已在 canvas store，重复造通道 |

## What Changes

- WorkingIndicator：计时旁显示 compact live tokens。
- 纯函数：从 `ThreadTokenUsage.last` 算出本轮总数，并用 processingStartedAt 丢掉过期快照。
- i18n：全 locale 增加 `messages.liveTokenUsage`。
- focused tests：格式化、过期快照、selector 不打 Messages 根 props。

## Capabilities

### New Capabilities

- `conversation-working-indicator-live-tokens`：响应中条展示本轮 live token 总数。

### Modified Capabilities

- `conversation-realtime-client-performance`：明确 token usage 不得经 Messages 根 props 广播。

## 验收标准

1. 响应中：有 live usage 时显示 `计时 · compact tokens`；无数时不占位。
2. 切会话 / 新回合：旧轮 token 不闪一下。
3. `conversationCanvasNode` 的 Messages selector 仍不含 `activeTokenUsage`。
4. focused vitest 绿；**不 git commit**。

## Impact

- `src/features/messages/rows/components/WorkingIndicator.tsx`
- `src/features/messages/utils/workingIndicatorLiveTokens.ts`（新）
- `src/i18n/locales/*/messages.ts`、`src/test/vitest.setup.ts`
- OpenSpec change `show-live-working-indicator-tokens`
