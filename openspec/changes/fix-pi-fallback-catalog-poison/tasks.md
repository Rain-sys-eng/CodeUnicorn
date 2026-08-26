# Tasks

## Implementation

- [x] 1. 后端：`resolve_engine_models_cache_first` 加 `is_fallback_only_catalog` 防中毒（cached 全 fallback 不命中 / fresh 全 fallback 不顶掉 last-good / 无 cache 不写回）
- [x] 2. 后端测试 +3：`cache_first_fallback_only_cached_does_not_short_circuit` / `cache_first_fallback_only_fresh_does_not_evict_last_good` / `cache_first_fallback_only_fresh_without_cache_is_not_written_back`
- [x] 3. 前端：`modelSelection.ts` 新增 `preserveLedgerModelOnFallbackCatalog` 纯函数
- [x] 4. 前端：`useAppShellComposerModelSection` 用 `ledgerAwareEngineModels` 喂 `effectiveModels` 与 `getEffectiveSelectedModelId`（codex/claude 除外）
- [x] 5. 前端测试 +6：`modelSelection.test.ts` `preserveLedgerModelOnFallbackCatalog` describe

## Verify

- [x] 6. `npx vitest run src/app-shell/domains/modelSelection.test.ts` 50/50
- [x] 7. `npm run typecheck` 0 error
- [x] 8. `npx vitest run src/app-shell/domains/ ButtonArea.test.tsx` 269/269
- [x] 9. `npm run check:app-shell:governance` 22/22
- [x] 10. `rustfmt --edition 2021 --check` 两个改动 rs 文件 clean
- [x] 11. `cargo test --lib cache_first` 8/8（/tmp/mossx-catalog-fix worktree 隔离验证，不共享主树 target）
- [ ] 12. 真机验证：重启打包 app（或开一次模型菜单触发恢复）后，PI 历史会话 chip 显示账本模型、思考强度回归

## Sync / Archive

- [ ] 13. 收口后 sync spec delta 到 main specs（provider-model-catalog-refresh），按流程 archive
