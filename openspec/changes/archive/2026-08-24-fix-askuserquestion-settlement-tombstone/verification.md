# Verification · fix-askuserquestion-settlement-tombstone

- **Date**: 2026-08-12
- **Status**: user accepted

## Automated

- Vitest：`useThreadUserInput` / `RequestUserInputMessage` / `RequestUserInputSubmittedBlock` / tombstone / claudeHistoryLoader 相关套件绿
- Cargo：`respond_to_user_input_*`（含 sole MCP waiter recovery）绿

## Manual（owner 验收）

- [x] Claude default + MCP：提交后 turn 继续
- [x] 跳过后不再永久 `mcp__ccgui__AskUserQuestion` loading
- [x] 重开会话不出现可点幽灵卡
- [x] 已提交折叠 / 分段 Tab / 幕布扁平样式定稿

## Docs

- Capability matrix + single UI entry：`docs/reference/conversation/user-input-elicitation-capability-matrix.md`
- Onboarding D10 指针：`docs/research/mossx-new-cli-onboarding-guide.md`
