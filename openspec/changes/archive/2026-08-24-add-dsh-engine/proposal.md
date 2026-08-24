# add-dsh-engine

## Why

mossx 现有 6 个 Native Engine（Claude / Codex / Gemini / Grok / Kimi / OpenCode）。用户已经在本机跑 DeepSeek Harness（`dsh web`，`@deepseek-ai/dsh`），但 mossx 只能把它当外部网页，不能当一等 CLI：不能在 composer 选 DSH、不能把 DSH session 放进侧栏、不能 resume / fork / 审批桥。

DSH 不是又一个 OpenAI-compatible vendor preset。它有自己的 persistent host、workspace、session、模型目录和审批协议。把它压成 `ANTHROPIC_BASE_URL` 或 iframe 会丢掉 session 身份和 live mux。

Phase S 已在本机 `dsh 0.1.0-rc.6` + `127.0.0.1:3080` 证实 Host RPC 可作第二 client。详见 [`docs/research/mossx-dsh-capability-spike.md`](../../../docs/research/mossx-dsh-capability-spike.md)。

## What Changes

- 新增第 7 个 Native Engine：`dsh` / `DeepSeek Harness` / 协议族 `dsh-host-rpc` / `executionModel: persistent`。
- mossx 自动探测、adopt 或 spawn **一个** 全局 `dsh web`；退出时只杀 spawned。
- 配置（key / provider / catalog 维护）仍归 DSH Web UI。mossx 只做薄连接：bin / host / port / 打开 DSH Settings / doctor。
- Native session：`threadId = dsh:<dshSessionId>`。create / list / history / prompt / cancel / fork / live mux / 审批桥。
- 模型下拉展示 DSH `{ provider, model }` 二元组，数据来自 `POST /api/llm.models`。
- 第一期 **不进 Shared**（与 Gemini 同类：picker 可见但 disabled，并给 reason）。

## Capabilities

### New Capabilities

- `dsh-engine-runtime`: 发现/拉起 host、发消息、流式幕布、中断、selectModel、审批 respond。
- `dsh-session-history`: 列出 / 加载 DSH 会话；删除走 archive（DSH 无物理 delete）。
- `dsh-cli-lifecycle`: 安装 / 升级 / doctor（version + host.describe；host 没起来 ≠ CLI 没装）。

### Modified Capabilities

- `engine-capability-matrix`: fixture 与生成物增加 `dsh` 行（15 key）。
- composer / sidebar / settings / i18n：引擎选择器与展示面出现 DSH。

## Impact

- Affected code: `src-tauri/src/engine/**`、daemon `engine_bridge.rs`、capability/registry scripts、`src/features/{engine,threads,composer,vendors,settings,app}/**`、10 locale。
- APIs: `list_dsh_sessions` / `load_dsh_session` / archive-or-delete、`get_engine_models(Dsh)` 走 host、`dsh_doctor`。
- Data: mossx 只记 `dshBin` / `dshHost` / `dshPort` / `dshAutoStart` 与 workspace→dshWorkspaceId 映射。不写 `$DSH_HOME` credentials。
- Compatibility: 未安装 `dsh` 时显示 not-installed，不影响其他引擎。用户自己的 `dsh web` 被 adopt，mossx 退出后仍在。

## 目标与边界

- 目标档位：**L2 Native**。
- 边界：全应用一个 host；Native only；配置归 DSH。

## 非目标

- 不内嵌 DSH Web UI，不把 mossx 做成 DSH client plugin。
- 不在 mossx 内配置 DSH providers / API key / base URL。
- 不调用 `credentials.*` / `llm.discoverModels`；不把 mossx 做成 DSH 配置面。附图准入的窄例外见 `fix-dsh-custom-route-image-admission`（只写 `llm-pi-ai` 的 `input` / `defaultInput`）。
- 不用 ACP / headless / Python SDK 发主对话。
- 不做 Shared Session / Squad / Provider Continuation（L3）。
- 不把 DSH workspace 列表替代 mossx workspace。
- 不为 DSH 单独做一套审批 UI。
- 不按 workspace spawn 多个 `dsh web`。
- 不手改 DSH session 文件注入历史。

## 风险

- developer preview，RPC 可能破：client 收口在 `engine/dsh/host.rs`，单测钉 envelope。
- 3080 被非 DSH 占用：`host.describe` 校验，失败换 port 或明确报错。
- 误杀用户 host：spawned vs adopted。
- 模型列表为空被当成「未安装」：三种空态文案分开。
- mux 传输：已安装 0.1.0-rc.6 是 **WebSocket**，不是源码树里的 SSE。
- 审批没桥 → DSH 工具永久 pending。P3 不做完不能称 Native 可用。
