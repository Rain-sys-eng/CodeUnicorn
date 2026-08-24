## 1. Lookup：本 catalog 优先

- [x] 1.1 export `findModelById`（`id` 或 `.model`）
  - 输入：`src/app-shell/domains/modelSelection.ts`
  - 输出：同文件 export，调用方语义不变
  - 验证：既有 modelSelection 调用仍编译
  - 依赖：无；优先级 P0

- [x] 1.2 `handleSelectModel` 先本 catalog `findModelById`，再跨 catalog 精确比 `id`
  - 输入：`src/app-shell/domains/useAppShellComposerModelSection.ts`
  - 输出：DSH runtime 名不再改写 `targetEngine`
  - 验证：vitest 新增 DSH×Grok / DSH×Claude；既有 kimi 跨引擎用例仍绿
  - 依赖：1.1；优先级 P0

## 2. 续聊闸门：显式切引擎才下崽

- [x] 2.1 新增 `explicitComposerEngineSwitch`：`mark` / `consume` / `peek` + `shouldSpawnNativeThreadForEngineMismatch`
  - 输入：`src/features/composer/hooks/`
  - 输出：纯模块 + vitest（mismatch 无 mark 不下崽；`explicit === currentEngine` 才下崽）
  - 验证：focused vitest 绿
  - 依赖：无；优先级 P0

- [x] 2.2 在 Atomic 跨引擎、创建目标、会话引擎选择处 `mark`
  - 输入：`Composer.tsx` `handleNativeAtomicTargetChange` / `handleCreationTargetChange`；`useAppShellLayoutNodesSection.tsx` `handleSelectConversationEngine`
  - 输出：仅 `target.engine !== selectedEngine`（或显式选引擎）时 mark
  - 验证：seed rematch 同引擎不 mark
  - 依赖：2.1；优先级 P0

- [x] 2.3 `sendUserMessage` consume 后按 helper 决定 stay-on-thread 或 spawn
  - 输入：`src/features/threads/hooks/useThreadMessaging.ts`
  - 输出：无显式切换时 `sendMessageToThread(activeThreadId)`
  - 验证：helper 单测覆盖全 CLI 漂移；显式切 Grok 仍 spawn
  - 依赖：2.1；优先级 P0

## 3. DSH 闭合态带 provider

- [x] 3.1 `formatDshModelDisplayLabel(model, { closed })`：闭合态 `{provider} / {lastSegment}`
  - 输入：`dshModelDisplayLabel.ts` + 既有 list 用例
  - 输出：默认列表行仍 last segment；closed 带 provider
  - 验证：`dshModelDisplayLabel.test.ts` 增补 closed 用例，旧用例不改语义
  - 依赖：无；优先级 P1

- [x] 3.2 `ModelSelect.getModelLabel` 仅 trigger / 当前模型传 `{ closed: true }`
  - 输入：`ModelSelect.tsx`
  - 输出：闭合态 `ggggg / grok-4.6`，列表行仍短
  - 验证：typecheck；列表调用不传 closed
  - 依赖：3.1；优先级 P1

## 4. 回归与索引

- [x] 4.1 跑 focused vitest：model section、dsh label、explicit switch helper
  - 验证：3 files / 39 全绿；kimi 跨引擎既有用例不回归
  - 依赖：1.2、2.1、3.1；优先级 P0

- [x] 4.2 更新 `openspec/changes/README.md` active 行
  - 验证：change id 可点
  - 依赖：artifacts 齐；优先级 P2

- [x] 4.3 手测（不 archive）：DSH 复杂第一轮后再发；显式点 Grok 组仍下崽
  - 验证：用户本机确认续聊不再误开 CLI；主动换引擎仍开新会话
  - 依赖：4.1；优先级 P2
