## 1. 测试钉死（先红后绿）

- [x] 1.1 在 `claudeManagedRuntimeModel.test.ts` 增加：DeepSeek catalog 下 `MiniMax-M3` / `minimax-m2` residual → repair 到 default，`repaired=true`
- [x] 1.2 同文件确认既有 freeform（`my-org-router-v2`、`claude-opus-4-6`）与 kimi residual 断言仍成立
- [x] 1.3 在 `selectedComposerSession.test.ts` 钉住：draft 不得应用到 finalized 历史会话（已有则补强注释/回归用例）

## 2. Resolver 实现

- [x] 2.1 扩展 `isForeignClaudeRuntimeResidue` / `FOREIGN_RUNTIME_RESIDUE_HINTS`：覆盖 MiniMax 及约定第三方产品前缀；仅与 `!legal.has` 组合触发 repair
- [x] 2.2 保证 catalog 命中与 env 合法集优先于 residual 启发式

## 3. 验证与回归

- [x] 3.1 跑 `npx vitest run src/features/models/claudeManagedRuntimeModel.test.ts src/app-shell/domains/selectedComposerSession.test.ts`
- [x] 3.2 确认 Shared 相关路径无代码 diff（或仅文档/无行为变更）
- [x] 3.3 `openspec validate fix-native-parallel-provider-model-isolation --strict --no-interactive`
