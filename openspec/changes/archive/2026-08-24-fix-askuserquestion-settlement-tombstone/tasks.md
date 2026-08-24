## 1. OpenSpec 与契约

- [x] 1.1 撰写 proposal / design / delta spec
- [x] 1.2 `openspec validate fix-askuserquestion-settlement-tombstone --strict`（实现后）

## 2. Frontend tombstone

- [x] 2.1 新增有界 `userInputSettlementTombstone` 模块（mark/has，MAX=2048）
- [x] 2.2 `useThreadUserInputEvents`：completed / 入队前检查 tombstone
- [x] 2.3 `useThreadUserInput`：accepted 与 stale settlement 写入 tombstone
- [x] 2.4 Vitest：accepted 后同 key 重放不入队；stale 写墓碑；失败不写墓碑
- [x] 2.5 `addUserInputRequest` 闸门 + skip 写 `skippedQuestionIds`/submitted audit（防 history 幽灵卡）
- [x] 2.6 history：尾部 incomplete / MCP Ask 不 rehydrate 为 interactive queue

## 3. Claude backend completed + re-entry guard

- [x] 3.1 `respond_to_user_input` 成功后 emit `completed=true`
- [x] 3.2 session settled request_id 集合；convert 已结算时发 completed 且不 pending
- [x] 3.3 stream 仅对 `completed=false` 调用 `handle_ask_user_question_resume`
- [x] 3.4 聚焦 cargo/test 覆盖成功 completed emit 与重入不 wait
- [x] 3.5 MCP：pending 缺失但 oneshot 仍在时必须交付答案；settled re-entry 不挂 waiter
- [x] 3.6 MCP：request_id 漂移时 sole waiter 恢复交付（skip/submit 不挂死）
- [x] 3.7 FE skip 与 submit 同路径；submitted id 与 history 对齐防双卡

## 4. 验证

- [x] 4.1 相关 Vitest 通过
- [x] 4.2 相关 Rust tests 通过（若环境允许）
- [x] 4.3 确认无根链轮询 / 无新增每事件大列表拷贝
- [x] 4.4 用户手测验收通过（2026-08-12）：跳过可继续、无幽灵重弹、UI 折叠/分段控件定稿
- [x] 4.5 能力矩阵文档：`docs/reference/conversation/user-input-elicitation-capability-matrix.md`

## 5. 收口备注

- 单 UI 入口：Claude + Codex 共用 `RequestUserInputMessage`；其他 CLI 未 emit，无需分皮肤。
- 跟进 UI（同 change 落地）：已提交折叠对齐「已处理」、展开扁平、Tab 分段控件。
