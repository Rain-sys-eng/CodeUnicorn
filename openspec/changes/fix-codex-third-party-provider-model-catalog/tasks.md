# Tasks

## Batch 1（P0 前端）：provider-owned 模型 reasoning 默认档

- [x] 1. `features/models/customModelReasoning.ts`：新增 `isUserManagedCustomModelSource`（custom / provider-custom / provider-config），`resolveCustomModelDefaultReasoningEffort` 扩圈
- [x] 2. `features/models/atomicModelReasoning.ts`：`enrichModelInfoWithAtomicReasoning` provider-owned 来源 catalog-identity 优先、miss 后回落默认档（`source === "custom"` 分支不变）
- [x] 3. `app-shell/domains/modelSelection.ts`：`enrichScopedCodexReasoningMetadata` 增加 provider-owned 默认档兜底（authoritative 填充之后）
- [x] 4. 前端测试：atomicModelReasoning（provider-custom / provider-config / runtime-neutral / catalog-identity 优先）+ modelSelection enrichScopedCodex 场景
- [x] 5. 验证：`npx vitest run src/features/models/atomicModelReasoning.test.ts src/app-shell/domains/modelSelection.test.ts`（84/84 基线 + 新增）+ 相关 ButtonArea / useProviderTargetCatalogOwners 回归

## Batch 2（P1 后端）：Codex managed scope 移除官方 fallback 拼接

- [x] 6. `engine/status.rs`：`get_provider_scoped_engine_models` Codex 分支跳过 `merge_provider_models_with_public`（经 `finalize_provider_scoped_catalog` 抽函数）
- [x] 7. 后端测试：codex scoped 不含 generated fallback（`codex_provider_catalog_skips_public_fallback_merge`）+ Claude/Kimi scoped 合并行为不变回归（改走 finalize 锁定引擎路由）
- [x] 8. 验证：`cargo test --lib provider_catalog`（4/4）、`codex_adapter::tests`（7/7）、`engine::status::tests`（39/39，含改动回归）；/tmp worktree 隔离执行，已清理

## Batch 3（P1 后端）：usage 事件 200K 伪造移除

- [x] 9. `engine/codex_adapter.rs`：`emit_usage_from_object` 拆出纯函数 `build_usage_update_event`，删除 `.or(Some(200_000))`，None 透传
- [x] 10. 后端测试：缺失 window 时 `model_context_window: None` / 上报值透传 / 无 token 跳过；`app_server_auto_compaction.rs` 的 200K 启发式保持不变（边界锁定）
- [x] 11. 验证：codex adapter 圈定通过 + 前端 turnBadge 回归（12/12）+ `useAppServerEvents.tokenUsage` 14/14（含新增「codex 无 window 不伪造 200K」用例，锁定 legacy resolver 的 codex 分支）+ `useAppServerEvents` legacy resolver 清理死参数 `fabricateDefault`

## Batch 4（P2 前端）：discovery 提取保留 reasoning metadata

- [x] 12. `useProviderTargetCatalogOwners.ts`：`extractCodexDiscoveredModels` 保留 `supportedReasoningEfforts` / `supported_reasoning_efforts`（string/object）与 `defaultReasoningEffort`
- [x] 13. 前端测试：discovery 响应带 efforts 时条目保留（camelCase/snake_case 混合形态）；不带时 neutral

## Review & 提交（用户 gate：review 后才提交）

- [x] 14. 全量验证：`npm run typecheck` 0 error、改动圈定 vitest 全绿（Batch1/4 134/134 + tokenUsage 14/14 + turnBadge 12/12）、`rustfmt --edition 2021 --check` 改动 rs clean、`cargo test --lib` 圈定全绿（provider_catalog 4/4 + codex_adapter 7/7 + status 39/39）、`npm run check:app-shell:governance` 22/22
- [x] 15. `openspec validate fix-codex-third-party-provider-model-catalog --strict`（已通过）
- [x] 16. advisory review（2026-08-26 接管复核：四批次 diff 与 proposal/spec delta 逐项对齐；发现并修复两处缺口——`useAppServerEvents` legacy resolver 死参数 `fabricateDefault`、codex 不伪造 200K 分支缺测试锁定；update/generated 批量改动确认为 CHANGELOG 重写后的生成器可复现产物，单独提交不混入业务批次）
- [x] 17. 按批次独立提交（中文 Conventional Commits：openspec docs → Batch 1 models → Batch 2 engine catalog → Batch 3 usage window → Batch 4 discovery → release-notes 重生成单独提交），git diff --stat 自查无格式噪音混入（prettier 存量报警均在非本次改动区域，未触碰）

## Sync / Archive

- [ ] 18. 真机验证（用户）：三方 provider 会话模型菜单 + 思考强度 + 上下文指示器
- [ ] 19. 收口后 sync spec deltas 到 main specs，按流程 archive
