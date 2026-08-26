## 背景

WorkingIndicator 当前合同：

```
spinner  11:11  响应中...  [optional activity]
```

用户参考 Cursor：`4m 21s · 5.6k tokens`。仓库里 live usage 已经齐了：

1. 引擎 `EngineEvent::UsageUpdate` → `thread/tokenUsage/updated`
2. reducer `setThreadTokenUsage` 写 `tokenUsageByThread`（数值未变会 noop）
3. `activeCanvasSnapshot.activeTokenUsage` 已有
4. Composer 占用环已经订这份快照；Messages 根 selector **刻意不订**，避免和 heartbeat 一样打整树

结束态 footer 用 `finalInputTokens / finalOutputTokens`，只 stamp 在 `isFinal` assistant 上，live 回合看不到。

## 方案

**选定：WorkingIndicator 直接订 canvas `activeTokenUsage.last`**

| Option | Summary | Trade-off |
|--------|---------|-----------|
| A 经 Messages 根 props | 实现快 | 违反「高频 canvas 状态禁挂根 hook 链」 |
| **B 行内 selector（采用）** | WorkingIndicator 调 `useActiveCanvasSelector` | messages → layout 有依赖，但 canvas store 已是跨 feature 热通道（Composer / StatusPanel 同样订） |
| C 新建 live channel | 完全不碰 canvas store | 重复；usage 本来就不是 delta 级 |

### 显示口径

- 数字：`last.inputTokens + last.cachedInputTokens + last.outputTokens`（与 footer 的 whole-turn input 口径一致，再加 output）。
- 格式：复用 `formatTokenCount`（`5600 → 5.6K`），文案 `messages.liveTokenUsage` = `{{tokens}} tokens`。
- 位置：计时右侧、`响应中...` 左侧，中间 `·`。无数时不渲染 `·` 和 token span。
- 过期快照：`markProcessing(true)` **不**清 `tokenUsageByThread`。若 `lastTokenUsageUpdatedAt < processingStartedAt`，本轮先隐藏旧数，等新 usage。两戳都缺时，只要 `isThinking` 且计数 > 0 仍显示（兼容缺时间戳的引擎）。

### 性能

- selector 每次投影都会 new `{ tokenCount, usageUpdatedAt }`，必须用字段 equality 保引用；数值未变时 WorkingIndicator 不重渲。
- usage 未变时 reducer 已 noop，canvas snapshot 不换。
- 不把 token 放进 `TimelineLiveModel`，避免 TimelineRowRenderer / MessagesCore 跟涨。

### i18n

- 新 key：`messages.liveTokenUsage`
- zh / zh-TW：`{{tokens}} tokens`（与截图一致，technical term 保留 English）
- 其它 locale 同样 `{{tokens}} tokens`，避免再造一套单位翻译。

## 风险

- 引擎只在 turn completed 才推 usage：条上会一直没有 token，这是诚实空态，不是 bug。
- Codex `token_count` 的 last/total 语义：前端 normalize 已把同一 envelope 镜像到 `last`；本 change 不改口径。
- messages 引用 layout store：接受为既有跨 feature 热通道，不新开 domain key。
