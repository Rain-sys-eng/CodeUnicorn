# Tasks

## Implementation

- [x] 1. 后端：`resolve_engine_models_cache_first` 加 `is_fallback_only_catalog` 防中毒（仅 PI 启用；cached 全 fallback 不命中 / fresh 全 fallback 不顶掉 last-good / 无 cache 不写回）
- [x] 2. 后端测试 +4：三个 PI 中毒场景 + `cache_first_fallback_guard_does_not_touch_other_engines`（Kimi cached 命中语义不变回归）
- [x] 3. 前端：`modelSelection.ts` 新增 `preserveLedgerModelOnFallbackCatalog` 纯函数 + `resolveLedgerAwareEngineModels` PI 圈定函数
- [x] 4. 前端：`useAppShellComposerModelSection` 用 `ledgerAwareEngineModels` 喂 `effectiveModels` 与 `getEffectiveSelectedModelId`（仅 PI）
- [x] 5. 前端测试 +9：`preserveLedgerModelOnFallbackCatalog` describe（6）+ `resolveLedgerAwareEngineModels` describe（3，含 8 个非 PI 引擎参数化回归）
- [x] 5a. 用户拍板收紧：防中毒与合成选项严格圈 PI，不影响其他引擎 catalog（backend guard + frontend gate 双层）

## Verify

- [x] 6. `npx vitest run src/app-shell/domains/modelSelection.test.ts` 50/50
- [x] 7. `npm run typecheck` 0 error
- [x] 8. `npx vitest run src/app-shell/domains/ ButtonArea.test.tsx` 269/269
- [x] 9. `npm run check:app-shell:governance` 22/22
- [x] 10. `rustfmt --edition 2021 --check` 两个改动 rs 文件 clean
- [x] 11. `cargo test --lib cache_first` 9/9（PI 圈定后复测，/tmp/mossx-catalog-fix2 worktree 隔离，已清理）
- [ ] 12. 真机验证：重启打包 app（或开一次模型菜单触发恢复）后，PI 历史会话 chip 显示账本模型、思考强度回归

## Sync / Archive

- [ ] 13. 收口后 sync spec delta 到 main specs（provider-model-catalog-refresh），按流程 archive
