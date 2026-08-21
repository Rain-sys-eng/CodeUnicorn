# add-qoder-engine tasks

> 执行顺序 = 接入指南 §0 矩阵 A → H。每层完成后跑该层自检再进下一层。
> 事实源：`docs/research/mossx-qoder-capability-spike.md`（qodercli 1.1.27 pinned）。
> 纪律：⚠ 项无编译/测试兜底，全部人工核对；🔵 项在 PR 描述写决策记录。

## Phase 0 — OpenSpec + Spike

- [x] 0.1 创建 `openspec/changes/add-qoder-engine/`（proposal / design / tasks / 5 个 spec delta）
- [x] 0.2 Phase S 实测落档 `docs/research/mossx-qoder-capability-spike.md` + research README 索引
- [x] 0.3 `openspec validate add-qoder-engine --strict --no-interactive` 通过

## P0 — A 层 Identity + C 层治理

- [x] 1.1 A1–A3：`src/types/engine.ts` `EngineType` + `engineIds.json`（`acp-stdio` / `one-shot` / displayName `Qoder CLI`）+ `engineRegistry.ts` `EngineProtocolFamily` union 加 `"acp-stdio"`
- [x] 1.2 A4：`src-tauri/src/engine/mod.rs` `EngineType::Qoder` + `display_name` / `icon` / `engine_enabled_in_settings`（常驻 true）/ `disabled_engine_status` / `EngineFeatures::qoder()` + `pub mod qoder*`（编译器列出的每个集成点逐个决定，禁止 `_ => unreachable!()`）
- [x] 1.3 A5：daemon `engine_bridge.rs` 平行枚举 + matches + `#[path]` include；`parse_engine_type_string` 加 `"qoder"` 臂；`sync_engine_configs` 推 `qoder_bin`
- [x] 1.4 A6：`adapter_registry.rs` `EngineProtocolFamily::AcpStdio` + `family()` Qoder 臂 + `with_builtins()` 数组 + `engine_id()` match；修正 registry 测试数量断言到 9
- [x] 1.5 C1–C4：`matrix.json` qoder 行（15 key，按 spike §9）+ `check-engine-capability-matrix.mjs` `ENGINE_VARIANTS` + `check-engine-adapter-registry.mjs` `expectedBuiltins` + `check-model-provider-catalog.mjs` qoder 归 runtime-only（同 dsh）→ `--write` 重新生成
- [x] 1.6 C5：`scan-engine-name-branches.mjs` 扫 `"qoder"` 分支，finding 进 capability policy 或豁免注释
- [x] 1.7 `types.rs`：`AppSettings.qoder_bin`（serde `qoderBin`）
- [x] 1.8 自检：`pnpm check:engine-adapter-registry && pnpm check:engine-capability-matrix && pnpm check:model-provider-catalog`

## P1 — B 层 Rust runtime（ACP spawn-per-turn）

- [x] 2.1 [P0] `engine/qoder.rs`：`QoderSession`（new / subscribe / get_session_id / emit_error / build_command / send_message / interrupt / interrupt_turn / active_process_snapshots）+ ACP stdio JSON-RPC client（id 配对、agent request 应答、`fs/*` workspace 沙箱、permission auto-approve）+ parser 单测（initialize/new/resume/prompt/cancel/error 双通道/迟到 chunk 丢弃/图片 block）
- [x] 2.2 [P0] `engine/status.rs`：`detect_qoder_status`（`qodercli --version` + `status -o json` 登录态 + `QODER_HOME`/`~/.qoder`）+ `resolve_engine_type()` `qoder_bin` 臂 + `get_engine_models` 分发（ACP `session/new` 读 `availableModels` + `reasoning_effort`）
- [x] 2.3 [P0] `engine/manager.rs` + `engine/commands.rs`：qoder_sessions map + `engine_send_message` / `engine_send_message_sync` / `engine_interrupt` / `get_engine_models` Qoder 臂（thread 前缀 `qoder:` / `qoder-pending-` / `qoder-turn-` / `qoder-item-`）
- [x] 2.4 [P0] `engine/events.rs` engine→字符串 match Qoder 臂
- [x] 2.5 [P0] `workspaces/commands.rs` `add_workspace` Qoder 臂 + 检测 gate；`state.rs` 启动预热；`session_management.rs` `get_engine_config` Qoder 臂
- [x] 2.6 [P0] `engine/qoder_provider_profile.rs`：`--config-dir` 隔离 + 展示元数据（无 key CRUD；`isProviderProfileEngine("qoder") === false`）
- [x] 2.7 [P0] `cargo check` 主 crate + daemon 双 target 全绿；`cargo test` engine 模块绿

## P2 — B10 历史 + 命令注册

- [x] 3.1 [P0] `engine/qoder_history.rs`：`list_qoder_sessions`（ACP `session/list` cwd 过滤，soft-empty）/ `load_qoder_session`（`session/load` 回放，`messageId` 去重，slash 清单不入历史）/ `delete_qoder_session`（`session/delete`）+ 单测
- [x] 3.2 [P0] `command_registry.rs` 三命令 + doctor 注册（⚠ 无编译兜底，人工核对）+ daemon 分发臂
- [x] 3.3 [P1] 统一 session catalog：catalog projection qoder source、`SessionCatalogIdentity::Qoder`（`qoder:` 前缀）、批量删除臂、auto-compaction 排除
- [x] 3.4 [P1] session index writers / prune 臂核对（backend inventory §extra）

## P3 — D 层幕布渲染（⚠ 事故高发）

- [x] 4.1 [P0] `src/features/threads/adapters/qoderRealtimeAdapter.ts` + `realtimeAdapterRegistry.ts`（`ConversationEngine` 穷举）+ adapter 单测
- [x] 4.2 [P0] `qoderHistoryLoader.ts` + parser + `useThreadActions.historyLoaderFactory.ts` `qoder:` 分支（防落 codex loader）+ parity 测试
- [x] 4.3 [P0] `conversationCurtainContracts.ts`：`ConversationEngine` union + `NORMALIZED_EVENT_DICTIONARY` 登记 qoder 私有事件
- [x] 4.4 [P0] `TimelineRowRenderer.tsx` streaming 白名单 + qoder（无兜底，目视验收）
- [x] 4.5 [P0] `MessagesCore.tsx` process/explore 折叠、usage 收尾、user-input、heartbeat 白名单逐处 + qoder
- [x] 4.6 [P0] `useAppServerEvents.ts`：`inferRawMethodEngine()` `"qoder/raw"` + threadId 前缀推断 + reasoning delta engineHint
- [x] 4.7 [P1] 哨兵自检：`rg -n '"qoder"' src/features/messages src/features/threads src/conversation-presentation src/features/app/hooks/useAppServerEvents.ts` 非空；`pnpm vitest run src/features/threads/adapters src/features/threads/loaders` 绿

## P4 — E 层 Composer / 选择器

- [x] 5.1 [P0] `ChatInputBoxAdapter.tsx`：`engineToProvider()` / `providerToEngine()` / `engineDisplayName` / `providerModelCatalogs` / availability 三 map + qoder（防落 claude）
- [x] 5.2 [P0] `ChatInputBox/types.ts` `AVAILABLE_PROVIDERS` + qoder（enabled 默认 true）
- [x] 5.3 [P0] `EngineIcon.tsx` + `providerBrandIcon.ts` + model-icons（`qoder.svg` 已在 `@lobehub/icons-static-svg`）
- [x] 5.4 [P0] `cliEngineVisibilityStore` / `engineExecutionPolicy` / `isEngineExecutionEnabled("qoder")===true`；accessMode 对 qoder 禁用（同 kimi）
- [x] 5.5 [P1] `engineImageInput.ts` `ENGINE_IMAGE_LABEL` + qoder；`modelSelection.ts` reasoning effort 分支（supported）
- [x] 5.6 [P1] `HomeChat.tsx` / `PromptEnhancerDialog.tsx` `getEngineLabel` + qoder

## P5 — F 层 Shared（显式不进）

- [x] 6.1 [P0] 确认 `sharedSessionEngines.ts` 与 `shared_sessions.rs` 双集合**不含** qoder；picker disabled + reason（同 gemini/dsh）
- [x] 6.2 [P0] `shared_session_v2.rs` / `shared_runtime_coordinator.rs` / `shared_projection/commands.rs` exhaustiveness 臂 = fail-closed
- [x] 6.3 [P0] `pnpm vitest run src/features/shared-session/utils/sharedSessionEngines.test.ts` 绿 + 人工 diff 双集合

## P6 — G 层 Settings / Sidebar / Session 管理

- [x] 7.1 [P0] `cliEngineNav.tsx`：qoder 从 upcoming 转 supported（`buildCliEngineNavItems` 加 `qoderHasConfig` + 调用方传参）
- [x] 7.2 [P0] `VendorSettingsPanel.tsx` qoder 面板（CLI 状态 + 登录引导 + 自定义路径；无 provider key 管理）
- [x] 7.3 [P0] `CliCustomPathDialog.tsx` `CliCustomPathEngine` union + qoder
- [x] 7.4 [P0] `SettingsView.tsx`：`onRunQoderDoctor` + `resolveSessionEngine()` + session counts
- [x] 7.5 [P0] `useSidebarMenus.ts` iconKind `engine-qoder` + new-session 条目；`Sidebar.tsx` icon switch；`ThreadList.tsx` `baseEngineTitle` + badge
- [x] 7.6 [P1] `SessionManagementSection.tsx` + utils：qoder 过滤 label / 加载分支（参照 grok/kimi 现状决定是否补齐，写决策记录）
- [x] 7.7 [P1] `qoder_doctor` 前端封装（`services/tauri/doctor.ts` + barrel + `types/diagnostics.ts`）

## P7 — CLI 生命周期

- [x] 8.1 [P1] `CliInstallEngine::Qoder`（官方安装渠道）+ install/upgrade plan + 设置页安装/升级按钮 + doctor 接线

## P8 — H 层 i18n（10 语言）

- [x] 9.1 [P0] `workspace.ts`（`engineQoder`）+ `providers.ts` + `sidebar.ts` + `settings.ts` + `runtimeNotice.ts` × en/es/fr/hi/ja/ko/pt-BR/ru/zh/zh-TW
- [x] 9.2 [P0] parity 守卫绿：`chatLocaleMerge.test.ts` / `sharedSendLocaleParity.test.ts` 等

## P9 — 验证与收口（不 commit，待 review）

- [x] 10.1 [P0] `cargo test` 全量 + `npm run typecheck` + `npm run lint`
- [x] 10.2 [P0] contract scripts 全绿：`check:engine-capability-matrix` / `check:engine-adapter-registry` / `check:model-provider-catalog` / `check:engine-controller-facade` / `check-branding` / `scan-engine-name-branches` / `check:app-shell:governance`
- [x] 10.3 [P0] 存量回归：`session-foundation` golden fixtures + `realtimeAdapters.test.ts` / history parity / `engineRegistry.test.ts`
- [ ] 10.4 [P0] **BLOCKED（本机模型 API 不可达）**：渲染层目视验收五件套需 review 环境补验（streaming 光标 / reasoning 折叠 / tool 块 / usage 收尾 / 历史一致）
- [x] 10.5 [P0] Contract Test 映射：adapter/loader/registry/sentinel/parity 自动化已绿（vitest 199 + cargo 20）；需真实 CLI 的 #1-#5 fault-injection 因本机模型 API 不可达标记 blocked 待 review 环境；Shared 项 N/A（不进 Shared）
- [x] 10.6 [P1] 回写基石设计「零、当前实现校准」表（engine registry / protocol family 触发器）
- [x] 10.7 [P0] `openspec validate --all --strict --no-interactive` 绿；**不 commit**，输出 review 包

## P10 — 真实客户端冒烟修复（2026-08-21）

- [x] 11.1 [P0] 发送报 `session/new timed out`：实测 session/new 在大 repo 需 30.1s（spike §7.5），新增 `QODER_SESSION_NEW_TIMEOUT=90s` / `QODER_SESSION_RESUME_TIMEOUT=30s`
- [x] 11.2 [P0] 创建 session 无法选模型：create-session picker 只 seed `SharedSessionSupportedEngine | "dsh"`——`resolveDefaultCreationExecutionTarget` 系列加 qoder（`CreateSessionSupportedEngine` / `isCreateSessionSupportedEngine` / `LOCAL_PROFILE_IDS` / `isResolvedCreationExecutionTarget` native 分支）+ `QODER_LOCAL_PROVIDER_PROFILE_ID` 前端常量 + 回归测试
- [x] 11.3 [P1] 深色图标黑块：`<img>` 加载的 SVG 拿不到页面 currentColor——EngineIcon 改内联双色 glyph（品牌绿 #2ADB5C + currentColor 细节，深色主题呈白绿）+ 测试断言更新

## P11 — review follow-up（2026-08-22）

- [x] 12.1 [P0] daemon `engine_bridge.rs` include `qoder_auth`；`cargo check --bin cc_gui_daemon` 绿
- [x] 12.2 [P1] `is_codex_thread_id` 排除 `qoder:` / `qoder-pending-`
- [x] 12.3 [P1] `session.fork` 降为 `unknown` + matrix `--write`
- [x] 12.4 [P1] Shared 写路径 `assertSharedSessionWriteEngine`；canonical validator / `is_legacy_local_provider` 对齐 Gemini/DSH
- [x] 12.5 [P1] 10 语言 `qoderUnsupported` + `qoderAuth`；`executable_name=qodercli`；detect 优先级 DSH 先于 Qoder
- [x] 12.6 后置项落档 `docs/research/mossx-qoder-engine-deferred.md`

## 明确后置（独立 change）

完整记录：[`docs/research/mossx-qoder-engine-deferred.md`](../../../docs/research/mossx-qoder-engine-deferred.md)

- Shared 资格评估（pendingProbe / 成功 terminal / cancel 实测后）
- L3 NativeHistoryReader / Provider Continuation（`session/load` readback 通道）
- `session/request_permission` → elicitation 卡产品化（D10）
- 成功 turn 黄金事件补采（streaming.reasoning / tool-output / usage / fork / promptQueueing unknown → 实测值）
- CN 版 `qoderclicn`；远程会话（`--remote` / `--teleport`）；SDK 面