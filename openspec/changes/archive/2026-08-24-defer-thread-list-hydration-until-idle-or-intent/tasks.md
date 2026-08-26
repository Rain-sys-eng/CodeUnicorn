# Tasks: defer-thread-list-hydration-until-idle-or-intent

## 1. Revert bad shield path

- [x] 1.1 删除 `StartupInteractionShield` 及 router 挂载/测试（已 checkout）
- [x] 1.2 保留 `confirmUiScaleHealthy` rAF defer 与 home-input-ready stamp（有用）

## 2. Scheduler implementation

- [x] 2.1 `useWorkspaceThreadListHydration`：冷启/首次 bind → idle first-paint；A→B → intent 短延迟 + cancel A
- [x] 2.2 导出 delay 常量；test 模式 delay=0
- [x] 2.3 cleanup：unmount / 再切换时取消 pending idle 与 timer

## 3. Tests

- [x] 3.1 冷启：短时间内不调用 list；advance idle/ceiling 后调用 first-paint
- [x] 3.2 切换 A→B：cancel 语义保持 + B first-paint
- [x] 3.3 force ensure 仍立即（既有 suite）

## 4. Verify

- [x] 4.1 focused vitest（hydration + restore + interactiveMainThread）
- [x] 4.2 `openspec validate defer-thread-list-hydration-until-idle-or-intent` → valid

## 5. Cmd+R 复发补丁（第二轮）

- [x] 5.1 根因：`useWorkspaceRestore` 绕过 idle 立刻 list → quiet 调度 + first-paint
- [x] 5.2 `scheduleWhenInteractiveQuiet` + Date.now 兼容 fake timers
- [x] 5.3 gate 前 pointerdown soft-cancel list + 重排
