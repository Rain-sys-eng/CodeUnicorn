# add-dsh-engine tasks

## Phase 0 — OpenSpec

- [x] 0.1 创建 `openspec/changes/add-dsh-engine/`（proposal / design / tasks / spec delta）
- [x] 0.2 Phase S 实测写入 `docs/research/mossx-dsh-capability-spike.md`

## P0 — Identity + supervisor + models

- [x] 1.1 A1–A3：`EngineType` / `engineIds.json` / `EngineProtocolFamily` 加 `dsh` + `dsh-host-rpc`
- [x] 1.2 A4–A6：Rust `EngineType::Dsh` + daemon 影子 + `adapter_registry` 第三条协议臂（禁止谎报 stream-json）
- [x] 1.3 C 层：matrix fixture + `ENGINE_VARIANTS` + `expectedBuiltins` + model-catalog 白名单决策
- [x] 1.4 `engine/dsh/` host + supervisor（ensure / adopt / spawn / drop）
- [x] 1.5 `detect_dsh_status` + `get_engine_models` → `llm.models`
- [x] 1.6 composer picker 出现 DSH 分组；设置薄面板 + 打开 DSH UI

## P1 — Native session CRUD + send

- [x] 2.1 workspace.create 绑定；session.create / list / prompt / cancel
- [x] 2.2 mux WS → EngineEvent → `dshRealtimeAdapter`
- [x] 2.3 thread 前缀 `dsh:` / pending promotion（create 返回真实 id，禁止假 sessionId）
- [x] 2.4 D4/D5/D6 渲染与事件白名单；streaming 光标

## P2 — History / sidebar / resume

- [x] 3.1 `dshHistoryLoader` + historyLoaderFactory `dsh:` 分支
- [x] 3.2 `list_dsh_sessions` / `load_dsh_session` / archive
- [x] 3.3 sessionIndex / Sidebar badge / i18n 10 语言
- [x] 3.4 重启后续上同一 `dsh:<id>`
- [x] 3.5 历史/幕布隐藏 DSH 注入的 instructions / runtime snapshot / skill catalog

## P3 — 审批 / 图 / reasoning / fork

- [x] 4.1 approval + question → 现有 elicitation → `/api/respond`
- [x] 4.2 图像：catalog / imageLimits 声明时允许
- [x] 4.3 `session.selectModel` + reasoningEffort
- [x] 4.4 `session.fork`

## P4 — CLI 生命周期

- [x] 5.1 `CliInstallEngine::Dsh`（`@deepseek-ai/dsh@latest`）
- [x] 5.2 install / update / doctor（version + describe；Node 版本不够明确报错）
- [x] 5.3 host 没起来不算 CLI 没装

## P5 — 治理收口

- [x] 6.1 15 项 contract 能填的填；Shared 标 N/A
- [x] 6.2 Claude/Codex/Kimi fixture 回归（adapters/loaders 全绿；`realtimeHistoryParity` Claude shared-id 一条在 HEAD 即失败，DSH 未改 assembler/claude adapter）
- [x] 6.3 回写基石设计「零、当前实现校准」
- [x] 6.4 OpenSpec validate；准备 archive（不自动 commit）

## P6 — 明确后置

- Shared / Squad
- Provider Continuation（L3）
- mossx 写 DSH settings（除 `fix-dsh-custom-route-image-admission` 的窄例外：附图时只声明 `llm-pi-ai` 模态）
- DSH subagent 深度投影
- 多 host / 远程 DSH
