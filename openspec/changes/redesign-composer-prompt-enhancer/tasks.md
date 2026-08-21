## 1. Instruction and result contract

- [x] 1.1 重写 `buildPromptEnhancerInstruction`：强度 + 去套话/去复述
- [x] 1.2 enhancer 专用 duplicate collapse，空结果不采用
- [x] 1.3 cache key 纳入 intensity

## 2. Engine visibility and ModelSelect

- [x] 2.1 可执行引擎白名单替换 claude/codex 常量
- [x] 2.2 按 `useCliEngineVisibility` 过滤；空列表不可 run
- [x] 2.3 弹窗复用 Composer `ModelSelect`

## 3. Dialog interaction

- [x] 3.1 并排对照 + 新增着色 + loading/disabled/empty
- [x] 3.2 强度三档 + 高级超时
- [x] 3.3 i18n zh/en + 其余 locale key

## 4. Tests

- [x] 4.1 hook：可见引擎、强度 instruction、去重、cache
- [x] 4.2 dialog：ModelSelect、强度、空引擎
- [x] 4.3 focused vitest 绿
