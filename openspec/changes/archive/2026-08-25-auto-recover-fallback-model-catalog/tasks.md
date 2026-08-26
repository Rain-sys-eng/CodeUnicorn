# Tasks: auto-recover-fallback-model-catalog

## 1. FE 自动恢复

- [x] `ModelSelect.tsx` `handleMenuOpenChange` legacy 分支：当前引擎组 fallback-only（全部 `source === "fallback"` 且非空）时自动调一次 `handleRefreshConfig`
- [x] `ModelSelect.test.tsx`：fallback-only → 打开自动刷新一次；真实 catalog → 不刷新；in-flight 重复开合不双发

## 2. FE timeout 对齐

- [x] `useEngineController.ts` `loadModelsForEngine`：`timeoutMs` 按 phase 区分（on-demand 22_000 / idle-prewarm 8_000）
- [x] engine controller 测试断言 on-demand 22s / idle-prewarm 8s（spy startupOrchestrator.run）

## 3. Backend 并行化

- [x] `status.rs` `detect_pi_status`：`tokio::join!` 并行 version 探测与 `get_pi_models`

## 4. 收口

- [x] `npx tsc --noEmit` 0 error
- [x] focused vitest（ModelSelect 79/79、useEngineController 33/33 全绿）
- [x] `cargo test --lib engine::status` 39/39 全绿；status.rs 过 `rustfmt --edition 2021 --check`
- [x] `openspec validate auto-recover-fallback-model-catalog --strict` 通过
- [ ] spec delta 同步主 spec（verify / sync / archive 流程）
