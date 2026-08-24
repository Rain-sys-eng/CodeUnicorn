# show-dsh-session-stats design

## 数据源

DSH host 已经算好全日志数字，客户端只消费成品值：

| 数字 | 来源 | 公式（与 DSH `StatsLine` 对齐） |
|---|---|---|
| 首 token 平均 | `sessionStats.ttftMs / ttftSteps` | `formatDuration`：`<60s` 一位小数 + `s`，否则 `XmYs` |
| tok/s | `sessionStats.decodeTokens / (decodeMs/1000)` | `>=10` 取整，否则一位小数 |
| 缓存命中 | `tokenUsage.cacheReadTokens / billedInput` | `billedInput = uncached + cacheRead + cacheWrite`，四舍五入整数 `%` |

缺任一分子/分母时该项整段省略；三项都空则组件返回 `null`。

## 通路

```text
history 尾页 projections.values
  → load_dsh_session.usage + sessionStats
  → dshHistoryLoader.tokenUsage.sessionStats
  → setThreadTokenUsage

mux session/projection
  key=tokenUsage → EngineEvent::UsageUpdate → thread/tokenUsage/updated
  key=sessionStats → EngineEvent::Raw { kind: dsh-session-stats }
    → setThreadSessionStats（只补丁 sessionStats，不覆盖 token 计数）
```

`setThreadTokenUsage` 在新 payload 没有 `sessionStats` 时保留旧值，避免 stream `usage` chunk 把历史 TTFT 冲掉。

## 展示

挂在 `Composer` 的 `.composer-branch-row`：分支胶囊之后、trailing usage 圆点之前，对应截图红框。`flex: 1` 吃掉中间空位；过长 ellipsis，hover 出完整行。

只在 `selectedEngine === "dsh"` 且至少一项可显示时渲染。
