# show-dsh-session-stats

## Why

DSH Web 在 composer 下方展示会话级速度数字：`首 token 平均 8.5s · 72 tok/s | 缓存命中 96%`。mossx 已经能连上同一套 host projection（`sessionStats` / `tokenUsage`），但 `session/projection` 被丢掉，历史 loader 也不读 usage，输入框下方红框因此是空的。

## What Changes

- 从 DSH history 尾页 `projections.values` 读取 `tokenUsage` 与 `sessionStats`。
- 把 live mux `session/projection` 帧映射成既有 `thread/tokenUsage/updated` 与一条轻量 `dsh/raw` stats 事件。
- 仅在 DSH 会话的 `composer-branch-row` 中间空位渲染上述三项；无数据时整行不占位。
- 不引入新的 AppShell domain key：stats 挂在既有 `ThreadTokenUsage.sessionStats`。

## Capabilities

### New Capabilities

- `dsh-session-stats`：DSH 会话速度条的数据契约与 composer 展示口径。

### Modified Capabilities

- `dsh-session-history`：history / live projection 必须带上 `sessionStats` 与 cache-aware `tokenUsage`。

## Impact

- Affected code: `src-tauri/src/engine/dsh/{history,events}.rs`、`src/features/threads/**`、`src/features/composer/**`、`src/types/usage.ts`、zh/en composer i18n。
- 不改 EngineEvent 公共枚举（避免全引擎构造点扩散）。
- 不把 turns/steps/LLM 时长/token 明细搬进红框；那些仍归 DSH Web 完整 StatsLine。

## 目标与边界

- 目标：DSH 会话 composer 红框与网页版同一组速度数字。
- 边界：只读 host 已算好的 projection，客户端不自己 fold 事件流。

## 非目标

- 不把该条展示给非 DSH 引擎。
- 不重做 Claude / Codex context meter。
- 不在 mossx 内嵌 DSH Web StatsLine 全量分组。
