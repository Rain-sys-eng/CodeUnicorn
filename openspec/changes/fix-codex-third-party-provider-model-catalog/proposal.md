# Change: fix-codex-third-party-provider-model-catalog

## Why

三方供应商为主的 Codex 用户反馈模型列表三类事实全错（2026-08-26 用户现场）：**思考强度不可用、模型列表混入官方假条目、上下文窗口一律 200K**。三个独立根因（均为代码实证，repo-relative 事实源）：

1. **思考强度**：后端 `engine/status.rs: codex_provider_models_from_config` 为 provider-owned 自定义模型写 `source: "provider-custom"` 且不带 reasoning；前端 `features/models/atomicModelReasoning.ts: enrichModelInfoWithAtomicReasoning` 只认 `source === "custom"`（localStorage 管理器路径，e756fda28）才补默认档，`provider-custom` 走官方 catalog identity 查表——`generatedModelCatalog.json` 只有 4 个官方 gpt 模型，三方模型（glm-4.6 / deepseek-chat 等）必然 miss → efforts 空 → ReasoningSelect 隐藏。Native composer 的 `modelSelection.ts: enrichScopedCodexReasoningMetadata` 兜底同样只按官方 catalog identity 匹配，同样 miss。c03428f20 引入 provider-owned customModels 双写时漏掉了这条链。
2. **模型列表**：`engine/status.rs: get_provider_scoped_engine_models` 对 Codex managed scope 无条件 `merge_provider_models_with_public`，把官方 generated fallback（gpt-5.6-sol/terra/luna、gpt-5.5）拼进三方供应商列表。三方 relay 大多不服务这些模型，选了必然 API 报错；且这些假条目反而带满档 reasoning metadata，与真实三方条目（空档位）形成刺眼对比。主 spec `model-provider-catalog-runtime` 的 "provider catalog appends public models" scenario 是该行为的 spec 来源，需一并修订。
3. **上下文**：`engine/codex_adapter.rs:144` `model_context_window.or(Some(200_000))` 是 2026-02 init 时代（380551d5b）遗留：codex 的 tokenCount/usage 事件对三方 provider 不带 context window（codex 内置 models 登记表只覆盖官方模型），于是全部伪造 200K——128K 模型用量被低估、1M 窗口模型严重高估。前端产品口径已演进为「CLI 没给就显示未上报，不估 200K」（`utils/turnBadge.ts:186` 注释、`turn-target-runtime-receipt` spec "Unknown window does not fake 200K" scenario 已为 Shared 面确立同语义），但后端在事件源头伪造，UI 无法区分真假。

PI 引擎的同族修复（d5e3585bf `resolveLedgerAwareEngineModels`）为 PI-only 圈定，不覆盖 Codex。

## What Changes

按风险从低到高四个批次，每批独立可提交、独立可回滚：

### Batch 1（P0，纯前端）：provider-owned 模型补齐 reasoning 默认档

- `features/models/customModelReasoning.ts`：新增 `isUserManagedCustomModelSource` predicate，覆盖 `custom` / `provider-custom` / `provider-config` 三种用户管理来源；`resolveCustomModelDefaultReasoningEffort` 同步扩圈。
- `features/models/atomicModelReasoning.ts: enrichModelInfoWithAtomicReasoning`：provider-owned 来源（provider-custom / provider-config）**先走官方 catalog identity 匹配**（命中则用 model-specific 档位，如 gpt-5.6-sol 的 max/ultra），miss 后回落 `CUSTOM_MODEL_REASONING_EFFORTS`（low/medium/high/xhigh，默认 medium）。`source === "custom"` 分支行为不变。
- `app-shell/domains/modelSelection.ts: enrichScopedCodexReasoningMetadata`：authoritative identity 填充后，仍为空的 provider-owned 用户管理来源行回落同组默认档（覆盖 Native composer scoped 路径）。
- Shared/Atomic picker 的 `resolveAtomicReasoningOptions` / `resolveAtomicDefaultReasoningEffort` 复用 enrich 结果，自动受益，不改签名。

### Batch 2（P1，后端单点）：Codex managed scope 不再拼官方 generated fallback

- `engine/status.rs: get_provider_scoped_engine_models`：仅 `EngineType::Codex` 分支跳过 `merge_provider_models_with_public`，直接返回 provider-owned 条目。Claude / Kimi / Grok / OpenCode 的 scoped 合并行为**逐字节不变**（有专门回归测试锁定）。
- 空 catalog 降级链路已存在且 spec 覆盖：Shared/Atomic picker 走 `resolveProviderConfiguredDefaultModel`（`provider-model-catalog-refresh` spec "Empty Managed Model Catalog MUST Fall Back To Configured Default Model"）；Native composer 走 codex `allowUnknownActiveThreadModel` 保住账本 modelId。
- 前端无需改动：`useProviderTargetCatalogOwners` 的 `filterAtomicProviderProfileModels` 对 public fallback 的放行是幂等容错，后端不再返回即消失。

### Batch 3（P1，后端单点）：usage 事件不再伪造 200K context window

- `engine/codex_adapter.rs: emit_usage_from_object`：删除 `.or(Some(200_000))`，`model_context_window` 缺失时透传 `None`。
- 前端已有完整降级面：context 指示器 `modelContextWindow > 0` 才算百分比；turn badge 显示「未上报」。
- **明确不动**：`backend/app_server_auto_compaction.rs` 的 `.unwrap_or(200_000.0)`（auto-compaction 触发启发式）。window 缺失时静默禁用 compaction 是行为回退风险，需独立产品决策，本 change 只修「显示事实」。

### Batch 4（P2，前端小改）：discovery 提取保留 runtime reasoning metadata

- `useProviderTargetCatalogOwners.ts: extractCodexDiscoveredModels`：目前丢弃响应里的 reasoning 字段；改为保留 `supportedReasoningEfforts` / `supported_reasoning_efforts`（string/object 双形态）与 `defaultReasoningEffort`，字段名与 `useModels.ts: normalizeReasoningEfforts` 同源。runtime metadata 优先的既有 spec 语义（`codex-model-catalog-coverage`）不变。

## Impact

| 维度 | 说明 |
| ---- | ---- |
| Backend | `engine/status.rs`（Codex scoped 分支 + 回归测试）、`engine/codex_adapter.rs`（200K 删除 + 测试更新） |
| Frontend | `features/models/customModelReasoning.ts`、`features/models/atomicModelReasoning.ts`、`app-shell/domains/modelSelection.ts`、`useProviderTargetCatalogOwners.ts` + 对应测试 |
| Spec deltas | `codex-model-catalog-coverage`（MODIFIED：custom reasoning 默认档扩圈）、`model-provider-catalog-runtime`（MODIFIED：Codex managed 不 append generated fallback）、`composer-engine-preferences-context-indicator`（ADDED：禁止伪造 context window） |
| UI 外观 | 零布局/样式/组件改动；可见变化仅为数据事实修正（思考强度选择器恢复可用、假官方行消失、错误百分比退化为「未上报」） |
| 热路径红线 | 切会话点击路径零新增 IPC（Batch 1/2/4 均为既有数据的投影/合成变化；Batch 3 是事件字段变化），符合 `session-switch-catalog-fetch-pitfall.md` |

## 兼容性与边界（硬约束）

1. **引擎圈定**：Batch 2 仅改 `EngineType::Codex` 分支；Claude（builtin 合并）、Kimi / Grok（generated fallback 合并）、OpenCode（本就不合并）零变化，配套回归测试锁定。
2. **本地/官方路径**：`providerProfileId` 为空（本地 disk profile / 官方登录）的 codex catalog 走 engine-wide status（`get_codex_models` + model/list），不受 Batch 2 影响。
3. **既有会话账本**：升级前在 managed provider 上误选了幽灵官方模型的会话——codex `allowUnknownActiveThreadModel`（前端）+ `UnlistedRuntimeModelPolicy::Allow`（发送校验）双层放行，账本 modelId 不被列表收窄破坏，发送行为与升级前一致（relay 不服务则 API 层报错，与现状相同）。
4. **`source: custom` 语义不变**：localStorage 管理器模型保持 e756fda28 原行为（跳过 catalog 查表、直接默认档），spec scenario "Custom model matches authoritative identity" 的 authoritative 覆盖链路（useModels merge / enrichScopedCodexReasoningMetadata）不受影响。
5. **capability-neutral 红线**：CLI runtime 发现的 unknown model（`source: "runtime"` 且无 metadata）继续保持 neutral（不发明档位），spec "Unknown model remains capability-neutral" 两 scenario 不动。
6. **官方登录用户的上下文显示**：新版 codex app-server 的 tokenCount 自带 `model_context_window` 则照常显示；老版本 CLI 缺字段 → 指示器降级「未上报」。诚实优先于错误百分比，与 Shared 面既有 spec 语义对齐。auto-compaction 触发不受影响。
7. **多 AI 并行**：`src-tauri` 主树存在并行在途改动（lib test 构建可能被阻断），Rust 验证一律走 `/tmp` worktree（不共享 `CARGO_TARGET_DIR`）；前端验证用 vitest 单文件圈定。

## Acceptance

1. 三方供应商绑定 Codex 会话：composer 模型菜单只显示该 provider 的自定义/配置模型（+ configured-default 兜底行），无 gpt-5.x 假条目。
2. 同场景选中自定义三方模型：ReasoningSelect 恢复可用，档位 low/medium/high/xhigh、默认 medium；选择后 effort 正确随 `send_user_message` 下发。
3. provider-owned 模型 runtime identity 命中官方 catalog（如 relay 上的 gpt-5.6-sol）时，展示 model-specific 档位（含 max/ultra）而非通用四档。
4. Claude / Kimi / Grok / OpenCode 的 scoped catalog、本地 codex catalog、`source: custom` 行为与 HEAD 逐字节一致（回归测试锁定）。
5. 三方 provider 会话的 tokenCount 事件无 window 时：context 指示器不显示百分比（或「未上报」），不再按 200K 计算错误的百分比；auto-compaction 行为不变。
6. 「发现模型」提取的条目保留 model/list 返回的 reasoning metadata（有则展示，无则 neutral）。
7. 升级后打开升级前创建的 managed provider 会话（含曾选中幽灵官方模型的）：账本模型不丢、可正常发送。
