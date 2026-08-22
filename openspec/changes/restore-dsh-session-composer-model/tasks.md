## 1. 切回瞬间绑定 DSH chrome

- [x] 1.0 `isEngineType` / chrome 切会话识别 `dsh`；缺失 engineSource 时从 `dsh:` id 推断
  - 输入：`workspaceFlowsTypes.ts`、`commitThreadSelection.ts`、`topbarSessionTabs.ts`
  - 输出：点回 DSH 会 `setActiveEngine("dsh")`，绿点回到 DeepSeek Harness
  - 验证：`commitThreadSelection.test.ts`、`topbarSessionTabs.test.ts`
  - 依赖：无；优先级 P0

- [x] 1.1 `setActiveEngine` 在 `switchEngine` 前乐观切换 `activeEngine`，失败回滚
  - 输入：`src/features/engine/hooks/useEngineController.ts`
  - 输出：点回 DSH 第一帧 `activeEngine === "dsh"`
  - 验证：`useEngineController.test.tsx` — switch 未 resolve 前 activeEngine 已变；reject 后回滚
  - 依赖：无；优先级 P0

- [x] 1.2 目标 status models 为空时用 last-good `{engine}:__global__`
  - 输入：同上
  - 输出：DSH 第一帧不显示上一引擎残留 catalog
  - 验证：先加载过 DSH catalog，切走再切回，乐观态用 last-good
  - 依赖：1.1；优先级 P0

## 2. 账本不被 native 空窗改写

- [x] 2.1 Codex repair 仅当 thread engine 也是 Codex
  - 输入：`useAppShellComposerModelSection.ts`
  - 输出：`dsh:` + `activeEngine=codex` 不 `persistComposerSelectionForThread`
  - 验证：model section 新用例
  - 依赖：无；优先级 P0

- [x] 2.2 DSH thread / activeEngine=dsh 允许 unknown 可信 catalog id
  - 输入：`useAppShellComposerModelSection.ts` + `modelSelection.ts`（行为经 allowUnknown）
  - 输出：残留/空 catalog 不回落默认
  - 验证：`modelSelection.test.ts` + model section
  - 依赖：无；优先级 P0

- [x] 2.3 DSH Atomic target 无身份时不回落全局 selectedModelId
  - 输入：`resolveComposerAtomicSelectedModelId.ts`
  - 输出：空串，而不是 Codex/Claude 全局模型
  - 验证：对应 test
  - 依赖：无；优先级 P0

## 3. Host history 播种缺失账本

- [x] 3.1 Rust 从已加载 events fold `currentModel`
  - 输入：`src-tauri/src/engine/dsh/history.rs`
  - 输出：`DshSessionLoadResult.currentModel`
  - 验证：cargo test header/context last-wins
  - 依赖：无；优先级 P0

- [x] 3.2 客户端抽出并仅在不可信账本时播种 + 通知 composer reload
  - 输入：`dshHistoryLoader.ts`、`selectedComposerSession.ts`、resume hydrate
  - 输出：冷 session / 被污染账本恢复 `{provider}/{model}`
  - 验证：loader + seed helper vitest
  - 依赖：3.1；优先级 P0

## 4. 回归

- [x] 4.1 focused vitest + `history.rs` cargo test
- [ ] 4.2 手测：DSH 对话 → 其它 native → 点回同一 DSH；闭合态 `provider / model`，绿点 DeepSeek Harness
