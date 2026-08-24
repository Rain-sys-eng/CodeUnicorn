# wire-dsh-auto-mode-permission tasks

- [x] 1. OpenSpec proposal / design / spec delta
- [x] 2. Rust：accessMode → DSH permission preset；`commands/execute` payload
- [x] 3. Rust：`send_user_turn` / engine_send / daemon 在 prompt 前切换 preset
- [x] 4. Frontend：DSH ModeSelect 开放 default + auto；plan/acceptEdits 禁用
- [x] 5. i18n zh/en `dshModes` + focused tests
- [x] 6. 空白 DSH 会话默认 workspace-write，不跟全局 full-access
- [x] 7. busy / queued continue turn 跳过 `/permission`
- [x] 8. 审批卡调试字段（approvalId / callId / sessionId / type / 重复 reason）默认折叠
