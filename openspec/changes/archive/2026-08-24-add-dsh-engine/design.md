# add-dsh-engine design

## Context

DSH（DeepSeek Harness）是 persistent Node host，不是 per-turn spawn CLI。mossx 作为第二个 Host RPC client 接入，交互面与其他 Native Engine 对齐。

Phase S 证据：[`docs/research/mossx-dsh-capability-spike.md`](../../../docs/research/mossx-dsh-capability-spike.md)。

## Goals / Non-Goals

Goals：

- 第 7 引擎 `dsh`，协议族 `dsh-host-rpc`，`executionModel: persistent`。
- 全局单例 host supervisor（adopt / spawn）。
- Native session 与 DSH Web UI 看同一批 `sessionId`。
- composer 模型是 `{ provider, model }` 二元组。
- 审批 / 提问复用现有 elicitation。

Non-Goals：见 proposal。第一期不进 Shared。

## Decisions

### 1. Identity

| 字段 | 值 |
|---|---|
| engine id | `dsh` |
| displayName | `DeepSeek Harness` |
| shortName | `DSH` |
| adapterId | `builtin.dsh` |
| protocolFamily | `dsh-host-rpc` |
| executionModel | `persistent` |
| serde | `"dsh"` |
| thread | `dsh:` / `dsh-pending-` |

`BuiltinEngineProtocol::family()` 与 `execution_model()` 必须给 DSH 独立臂，禁止落到 `stream-json-cli` / `one-shot`。

### 2. Host supervisor

```text
ensure_dsh_host(settings) -> DshHostHandle
  1. owned/adopted handle 且 host.describe 成功 → 复用
  2. probe settings.dsh_host:dsh_port（默认 127.0.0.1:3080）
  3. describe 成功 → adopt（不杀）
  4. 否则 resolve dsh bin（settings.dsh_bin / PATH / 最后才 npx）
  5. spawn: dsh web --host 127.0.0.1 --port <chosen>
  6. 读 stdout `dsh web: http://…` 或轮询 describe
  7. ownership = spawned | adopted
```

规则：

- mossx 退出只杀 spawned。
- 3080 被非 DSH 占用：换 port 或报错。
- 探活只信 `host.describe`。
- 不要每 workspace spawn。
- PATH / Windows / npx 复用 `build_codex_path_env` / `find_cli_binary`。

设置：`dshBin` / `dshHost` / `dshPort` / `dshAutoStart`（default true）。

### 3. Workspace 绑定

打开 mossx workspace path P：

1. `ensure_dsh_host`
2. `workspace.create({ path: P })` 幂等
3. persist `mossxWorkspaceId → dshWorkspaceId`
4. `session.list` 过滤 `ws.sessionIds` 且不在 `archivedSessionIds`

禁止省略 workspace、让 session 落到 host cwd。

### 4. Session identity

`session.create` **立即**返回真实 `sessionId`。与 Kimi 不同，backend 不得再造不可恢复 UUID。

`dsh-pending-*` 仅覆盖 create RPC 返回前的 optimistic composer row；promotion 必须合并到 `dsh:<sessionId>`，禁止双行。

### 5. Send / ACK / Terminal

```text
ensure host + mux subscribed
if model changed: session.selectModel({ sessionId, provider, model, reasoningEffort? })
session.prompt({ sessionId, mode: "queue", content })
wait mux turn/end
```

- Input ACK = `{ accepted: true }`（`request-response`）。
- Terminal = mux `turn/end`（`reason.kind`）。
- Cancel = `session.cancel` accepted，再等 turn 结算。
- host 活着 ≠ turn 活着。

delta 必须走 `liveAssistantTextChannel` / `liveItemDeltaChannel`。

### 6. Live transport

已安装 `0.1.0-rc.6`：**WebSocket** `/api/events.mux` 与 `/api/events.host`。

裸 GET 返回 `426 Upgrade Required`。不要实现成 EventSource/SSE（源码树 fetch handler 是 SSE，与已发布 host 不一致）。

Mux → `EngineEvent` 收口在 `engine/dsh/events.rs`。未知 type skip。

### 7. Models

`get_engine_models(Dsh)`：ensure host → `llm.models` → flatten groups。单个 provider `failures[]` 进诊断，不让整表失败。

`id = ${provider}/${model}`。未配置模型时 composer 禁发，文案指向「打开 DSH Settings」。

### 8. Shared

不加入 `SHARED_SESSION_SUPPORTED_ENGINES` / `is_supported_shared_session_engine()`。
Shared picker 里 DSH disabled，reason 为「Not available in Shared Session」。
Rust exhaustiveness 必须给 `EngineType::Dsh` 失败闭合臂（与 Gemini 同类），但不把 DSH 标成 supported。
`normalizeSharedSessionEngine("dsh")` 与 Gemini 一样 fail-closed 到 claude；用户路径靠 picker disabled，禁止把 DSH 写成 Shared target。

### 11. ⚠ 决策记录（C4 / G6 / Provider Profile）

- C4 model catalog：DSH 为 `runtime-only`，不进静态 `generatedModelCatalog.json`。模型只来自 `POST /api/llm.models`。
- G6 Session Management 过滤：第一期不单独做 DSH 解析器（grok/kimi 现状同样未覆盖）；侧栏/history 走 `dshHistoryLoader`。
- Provider Profile picker：DSH 与 Gemini 一样排除。mossx 不管理 DSH credentials / provider；`isProviderProfileEngine("dsh") === false`。
- `isEngineExecutionEnabled("dsh") === true`：否则新建会话 / send / engine controller 会把 DSH 当成禁用引擎。

### 9. History / delete

`session.history` 可读冷 session。list/load 走 Host RPC。

DSH 删除语义是 `workspace.archiveSession`。UI 可叫删除，实现 archive；文档写明不是物理删日志。

### 10. Approval

mux `approval/requested` / `question/requested` → 现有 `RequestUserInputMessage` / 审批卡 → `POST /api/respond` 回同一 `rpcId`。禁止 DSH 专属弹层。

## Risks / Trade-offs

| 风险 | 处理 |
|---|---|
| RPC 破 | host.rs 单测钉 envelope |
| 误杀用户 host | spawned vs adopted |
| 空 catalog | 三种空态 |
| 协议族谎报 | A6 单测 family=`dsh-host-rpc` |
| historyLoader 漏加 | 静默走 Codex；factory 必加 `dsh:` |
| 渲染白名单漏加 | streaming 光标消失 |

## Migration Plan

无存量 DSH 数据。registry / matrix / 白名单只追加。

## Open Questions

无。Phase S 已关闭协议、ACK、fork、mux 传输形态。steer / subagent 深度投影后置。
