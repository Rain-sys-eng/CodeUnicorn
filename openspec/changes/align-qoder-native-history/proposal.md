## Why

Qoder 的历史会话明文保存在 `~/.qoder/projects/<cwd-slug>/<sessionId>.jsonl`，但当前
打开历史仍为每次 spawn `qodercli --acp`、握手并执行 `session/load`。这会把历史首屏
绑定到 CLI 冷启动与 ACP replay drain，体感约 3–5 秒；也曾因 response 与 trailing
`session/update` 的时序不同而截断历史。

PI、Grok、Kimi 都将 vendor JSONL 用作 NativeHistoryReader，协议通道只服务 live turn。
Qoder 应对齐该分层：本地文件负责历史 catalog 与 replay，ACP 保留为只读 fallback 和
唯一的 delete control-plane。

## 目标与边界

- 目标：Qoder history list / load 在本地 session 文件存在时不启动 `qodercli`，并保留
  user、assistant text、reasoning、tool input/output 的时间线语义。
- 目标：按 workspace 精确归属 session，支持 canonical path、`/private/tmp` 别名与
  `--config-dir` 对应的 Qoder home。
- 目标：本地文件缺失或本地 layout 未匹配时，继续以 ACP `session/list` / `session/load`
  兜底；删除始终使用 ACP `session/delete`。
- 边界：不修改、迁移或删除 `~/.qoder/projects/**`；不把本地 JSONL 用于 live streaming、
  send、cancel、terminal 或 Shared recovery；不新增依赖。

## 方案对比

| 方案 | 优点 | 代价 | 结论 |
| --- | --- | --- | --- |
| A. 本地 JSONL primary，ACP fallback | 对齐 PI/Grok/Kimi；毫秒级打开；vendor 变动或缺文件仍可恢复 | 需要维护 best-effort parser | 采用 |
| B. 继续 ACP，只缩短 drain | diff 小 | CLI 冷启动仍在，且重新引入尾包截断风险 | 不采用 |
| C. 仅本地 JSONL | 最快 | vendor layout 变化时无法查看历史 | 不采用 |

## What Changes

- 新增 Qoder NativeHistoryReader contract：按项目目录列举和按 session id 读取 JSONL，使用
  line-by-line parser 与 best-effort malformed-line isolation。
- Qoder session catalog 改为 native disk primary；找不到本地项目目录或对应 session file 时，
  才使用现有 ACP list/load fallback。
- 保留 ACP realtime architecture：live prompt、typed terminal、cancel、trailing-update drain
  不改；仅 history read path 换源。
- 为 workspace slug、metadata summary、message projection、tool-result 合并、本地优先与
  ACP fallback decision 添加 Rust tests。

## Capabilities

### New Capabilities

- `qoder-native-history-reader`: Qoder local JSONL 的 workspace-scoped list/load projection，
  以及与 ACP fallback 的边界。

### Modified Capabilities

<!-- 无：Qoder 的原始 capability delta 尚在未归档的 add-qoder-engine change 中；本 change
     以独立 reader contract 收口这条补充行为。 -->

## 验收标准

- 已存在本地 Qoder session 时，list/load 不 spawn `qodercli`，并返回完整的 user / text /
  reasoning / tool timeline。
- 本地文件缺失或 workspace slug 不匹配时，list/load 走 ACP fallback；本地 reader 不可用
  不得使历史接口失败或影响 live turn。
- `session/delete` 仍只经 ACP；没有 `remove_file`、`remove_dir_all` 或任何 vendor-history
  write path。
- focused Rust tests、`cargo check` 和 Qoder history loader parity tests 通过；现有 ACP
  trailing-drain regression tests 保持通过。

## Impact

- Affected code: `src-tauri/src/engine/qoder_history.rs` 及其 Rust tests；OpenSpec Qoder
  history artifacts。
- APIs: Tauri `list_qoder_sessions` / `load_qoder_session` 的返回 schema 不变，性能与
  fallback routing 改变。
- Dependencies: 无新增依赖；只读 Qoder vendor JSONL。
