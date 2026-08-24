# Verification

```bash
npx vitest run \
  src/features/messages/orchestration/presentation/messagesViewModel.collapseMiddleSteps.test.ts \
  src/features/messages/components/Messages.live-behavior.test.tsx \
  src/features/subagent-ui/utils/syntheticSharedSubagentTools.test.ts
```

目视：长回合应看到「正文 A → 已处理 chip → 正文 B」，而不是整墙正文 + 底部一个「工具调用 198 次」。
