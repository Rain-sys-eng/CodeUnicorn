# enable-qoder-shared-target design

> 上游：`openspec/changes/enable-qoder-shared-target/proposal.md`
> 证据：`docs/research/mossx-qoder-capability-spike.md` §13/§14（2026-08-22，qodercli 1.1.28 + PAT 注入，probe6/7/8/9/10/11）
> 规则：`docs/research/mossx-new-cli-onboarding-guide.md` §0 F 层 + Step 6；基石设计 §8 / §14
> 关联：`add-qoder-engine`（L1 接入，Shared 排除 delta 由本 change 取代）

## 1. 上下文

Qoder L1 Native 已交付：spawn-per-turn `acp-stdio` runtime、typed terminal、ACP history、vendor/Settings/i18n 全链路。Shared 侧当前的 qoder 形态是**有意 fail-closed**：

- 前端 `SHARED_SESSION_SUPPORTED_ENGINES` 不含 qoder；`normalizeSharedSessionEngine("qoder")` 回落 `claude`（仅供历史 snapshot 读路径）；`assertSharedSessionWriteEngine("qoder")` 抛错。
- 后端 `is_supported_shared_session_engine()` 不含 qoder；`is_pending_shared_binding_thread_id(Qoder)` 恒 false；`binding_uses_established_native_thread(Qoder)` 恒 false；`shared_projection` 投影恒 false。
- `shared_runtime_coordinator.rs` 已有 qoder identity passthrough 臂与 `engine_token`（L1 时预埋），缺 pending 识别。
- `shared_session_v2.rs context_capabilities()` 无 Qoder 臂 → 落 `_` fallback（`user_channel_transcript: false`，Shared 发送不可用）。

准入证据（全部 live 实测，transcript 在本地 evidence 目录）：

> 注（2026-08-22）：Qoder Native history 主通道已切换为磁盘 jsonl primary + ACP fallback（`qoder_history.rs`）。本 change 不依赖 history 通道选择；Shared recovery 的存在性 probe 使用 ACP `session/list`——该通道作为 fallback 保留，probe 结论继续有效。若未来移除 ACP fallback，本设计 D4 的 probe 通道需同步更换。

| Shared 要求 | 结论 | 证据 |
|-------------|------|------|
| 成功 terminal | typed response `stopReason:"end_turn"` | probe6 |
| cancel | typed `stopReason:"cancelled"`，无迟到 chunk | probe7 |
| 跨进程 resume（Shared re-attach） | 进程 B resume 后正确回忆进程 A 的事实 | probe10 |
| pendingProbe | `session/list` 可见 mossx 创建 session（title/updatedAt）；ACP fallback 通道保留，history jsonl 化不影响 | probe11 |
| profile 隔离 | `--config-dir` 下 create/kill/resume/list 成立 | probe11 |
| inputAck | `"first-event"`（弱，与 Kimi 同级） | spike §4 |

## 2. 决策

- **D1 准入档位 = Kimi 同档**：`inputAck: "first-event"` + typed terminal/cancel + `session/list` probe。不追求 Claude 级 `strong_context_ack`（qoder 无 echo/checksum 面，禁止伪造）。
- **D2 context capability 臂**：`RuntimeContextCapabilities { native_delta: false, structured_history_import: false, native_clone: false, user_channel_transcript: true, tool_history: false, image_history: false, strong_context_ack: false }`——与 Kimi/Grok/OpenCode/PI 逐字段一致。ACP `promptCapabilities.embeddedContext: true` 登记为未来 structured 通道线索，本 change 不启用。
- **D3 pending 身份**：Shared binding pending id = `qoder-pending-shared-<seed>`（`engine_binding_thread_id` 臂已存在）；`session/new` 在 binding 创建时即返回真实 sessionId（裸 UUID），pending 晋升走既有 exact-identity 路径；mossx 自持 sessionId，identity 来源不依赖 `session/list`。
- **D4 recovery owner 隔离**（基石 §14.4.7.1）：Shared Attempt/Binding recovery 只看 durable evidence + `session/list` probe 定性；**禁止**把 qoder Native 的 `session/resume` re-attach 借作 Shared recovery 的自动重建。ACK 不确定 → `recovery-required` → 显式 rebuild，与存量引擎一致。
- **D5 provider profile**：Shared `ExecutionTarget` 携带 qoder provider profile 时，runtime 以 `--config-dir <profile dir>` spawn（probe11 证明隔离下 resume/list 成立）；local/disk sentinel 按接入指南归一为 `providerProfileId = null`。
- **D6 写路径放行 + 读路径兼容**：`assertSharedSessionWriteEngine` / `is_supported_shared_session_engine` 加 qoder 后，`normalizeSharedSessionEngine("qoder")` 自然返回 `qoder`（在集合内）；历史 snapshot 中不可能存在 qoder Shared binding（write gate 此前 fail-closed），无迁移负担。
- **D7 幕布四件套**：qoder 的 Shared 渲染复用 Native 已验白的 `qoderRealtimeAdapter` 归一事件面（thought/tool/usage 全词汇已 live）；本 change 在真实 Shared 会话目视验收 streaming 光标 / reasoning 折叠 / tool 块 / 历史一致。
- **D8 Shared sidebar hide identity**：Qoder 进入既有 `SHARED_HIDE_ENGINE_PREFIXES`，使 `qoder:<sessionId>` 与裸 `sessionId` 在 `expandHiddenSharedBindingIds`、owner lookup 和 `isSharedSidebarHiddenPup` 中互认。只匹配 Shared 的 `nativeThreadIds` / verified hide set；不以标题推断，不隐藏独立 Qoder Native Session。

## 3. 触点清单（F 层逐处）

| # | 文件 | 改动 |
|---|------|------|
| F1a | `src/features/shared-session/utils/sharedSessionEngines.ts` | union + Set 加 `"qoder"`；更新 normalize 注释（不再是 Native-only） |
| F1b | `src-tauri/src/shared_sessions.rs` | `is_supported_shared_session_engine()` 加 `Qoder` |
| F2 | `src-tauri/src/shared_session_v2.rs` | `context_capabilities()` 加 Qoder 臂（D2）；`provider_runtime_key_for_target()` / provisioning / 发送 dispatch / interrupt dispatch / **recovery probe（`shared_session_v2_probe_binding`）** 补臂；`validate_execution_target` 对 runtime-only 目录（Qoder）按空目录 + Allow 放行（禁止发送路径现场 probe ACP） |
| F2b | `src-tauri/src/shared_event_log/canonical/validator.rs` | canonical fact engine 枚举两处加 `"qoder"`（TurnExecutionSnapshot / ProviderPrivateRef）——命中 ADR 校准触发器（canonical fact schema），收口时回写基石 |
| F3 | `src-tauri/src/shared_runtime_coordinator.rs` | `normalize_native_session_identity` Qoder 从 raw passthrough 臂移入 `engine:{raw}` 前缀臂（kimi 同；pending 占位原样保留） |
| F4 | `src-tauri/src/shared_projection/commands.rs` | `is_legacy_local_provider` Qoder 臂（`__local_qoder__`）；投影入口经 F1b 自动放行 |
| F5 | `src-tauri/src/shared_sessions.rs` | `is_pending_shared_binding_thread_id`（`qoder-pending-shared-`）/ `binding_uses_established_native_thread`（strip 前缀 + 判真）Qoder 臂改真实判断；**`validate_resolved_shared_selected_target`（选择/持久化路径）runtime-only 目录放行**（与 F2 发送路径同策，回归测试 `resolved_qoder_local_target_validates_without_static_catalog`） |
| F8 | `src/types/interaction.ts` | `SharedRuntimeControlOwner.engine` union 加 `"qoder"` |
| F9 | `src/features/shared-session/target/initialTarget.ts` | `localProviderSentinelId` 加 qoder 臂 |
| F10 | `src/features/composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners.ts` | Shared 四级 picker 目录：qoder 进 `PROVIDER_PROFILE_ENGINES` / `DEFAULT_PROFILES`（local-only，PI 同形态）；删除 Native-only 追加块（避免重复组） |
| F11 | `src/features/composer/utils/resolveDefaultCreationExecutionTarget.ts` | qoder 已在 Shared 集合，去掉冗余 union 成员与守卫 |
| F12 | `src/app-shell/sections/core/useAppShellSections.ts` + `src/features/app/hooks/useSidebarMenus.ts` | Shared 引擎标签 Record + 侧栏 Shared 新建子菜单加 qoder（`workspace.engineQoder` 10 locale 已有） |
| F13 | `src/features/threads/adapters/sharedRealtimeAdapter.ts` | 拆除 L1 fail-closed 守卫（`qoder` + `shared:` threadId 直接 return null）——它会把 qoder Shared live 事件全部挡在 normalized 路由外，丢 target badge / receipt 附着（验收实测发现） |
| F14 | `src/features/app/hooks/useAppServerEvents.ts` | qoder 加入 thread/started pending 解析白名单 + `shouldRebindSharedNativeThreadOnStartedEvent`（pending → `qoder:<uuid>>` 前端 bridge 重定钥，与后端 binding 晋升一致） |
| F15 | `src/features/shared-session/runtime/sharedHideIdentity.ts` | `SHARED_HIDE_ENGINE_PREFIXES` 加 `qoder`；复用 raw / `engine:` 等价展开，修复 Qoder Shared 下崽的 bare parent 漏藏 |
| 测试 | `sharedSessionEngines.test.ts`、`types.atomic.test.ts`、`useProviderTargetCatalogOwners.test.tsx`、`ChatInputBoxAdapter.test.tsx`、`useSidebarMenus.test.tsx`、`resolveDefaultCreationExecutionTarget.test.ts`、`shared_session_v2.rs` fixtures、`sharedHideIdentity.test.ts`、`sharedSessionSummaries.test.ts` | 旧 fail-closed 断言翻正例；Qoder hide identity / raw-parent pup 回归；pi submenu 存量断言欠账顺手补齐 |

## 4. 测试

- 既有断言翻转：`sharedSessionEngines.test.ts` 中 `isSharedSessionSupportedEngine("qoder") === false` / `assertSharedSessionWriteEngine("qoder")` 抛错 / `normalizeSharedSessionEngine("qoder") === "claude"` 三条反例改为正例。
- Shared negative-path：qoder target 的 ACK 不确定 → `recovery-required`（不盲建）；cancel race exactly-once；terminal 后迟到 chunk 幂等。
- 基石 §14.3.5 Contract Test Suite 15 项 qoder 覆盖（重点 #9 typed final 与 cleanup 分域、#10 cancel race、#12 early event hold/replay、#14 projection failure 不走 Native recovery）。
- Qoder hide identity：`qoder:<sessionId>` 必须展开为 raw id；raw parent 指向该 Shared binding 的 pup 不进 sidebar，独立 Qoder Native parent 保持可见。
- 手工 diff 前后端双集合（接入指南 F 层自检）。

## 5. 验收

- Shared Session 四级 picker 中 Qoder CLI 可选，Provider/Model/Reasoning 目录来自 ACP 实时返回。
- qoder target 连续多 turn（跨进程 re-attach）+ 切换到其他 CLI 再切回（user-channel context delivery）行为正确。
- 幕布四件套目视通过（真实 Shared 会话）。
- Qoder Shared binding 及其 raw-parent pup 不出现在 sidebar；用户主动创建的 Qoder Native Session 仍可见。
- `pnpm vitest run src/features/shared-session/utils/sharedSessionEngines.test.ts` + Shared negative-path tests + matrix/parity gate 全绿。
