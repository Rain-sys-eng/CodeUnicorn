# add-dsh-agent-preset-picker tasks

- [x] 1. OpenSpec proposal / design / spec delta
- [x] 2. Rust：`session.create` 传 `agentPreset`；`send_user_turn` / daemon / remote 贯通
- [x] 3. Rust：`session.list` → `DshSessionSummary.agentPreset`
- [x] 4. Frontend：prefs + ThreadSummary + send options
- [x] 5. Frontend：方案 A `DshAgentPresetSelect` 接入 composer 工具条
- [x] 6. i18n zh/en + focused tests
- [x] 7. 碰撞补丁：index/live merge 保住 header preset；锁条件改为 user message；Light 发送带 prefs
- [x] 8. 缺 header 不把猜的 standard 写回 live；tauri send 快照带 dshAgentPreset
