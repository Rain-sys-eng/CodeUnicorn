## Why

Claude CLI 后台 Bash 完成时会把 `<task-notification>` 以 `role=user` 注入 JSONL，供下一轮模型续跑。这不是用户手写提问。前端 `parseAgentTaskNotification` 强制要求 `<result>`，而真实 wakeup 载荷常只有 task-id / tool-use-id / output-file / status / summary。解析失败后整段 XML 被当成普通用户提问，幕布右侧出现蓝气泡。DeepSeek 只是模型，不改变这条 CLI 注入协议。

## 目标与边界

- **目标**：无 `<result>` 的合法 envelope 仍能解析；幕布按三类分流——后台任务折叠条 / SubAgent 退役 / 真用户提问蓝气泡；后台回执默认折叠，不进用户蓝气泡；wakeup 不得把已落盘 assistant 再 shadow / live 追加一份。
- **边界**：只改前端 parse + presentation + Claude history shadow recovery / assembler 等价搜索边界。识别必须守住「载荷必须以 `<task-notification>`（或等价 entity-escaped）开头」，禁止把正文中间提到的 markup 当通知。
- **能力迁移**：后台回执的 status、summary、taskId、output-file、原始 XML 必须能在折叠展开后看到；不得裸丢。

## 非目标

- 不在后端吞掉 / 过滤 task-notification（破坏历史回放与锚点）。
- 不改 SubAgent 退役规则，不恢复 legacy Agent session 卡给 SubAgent。
- 不删除全部 task-notification 渲染；有 `<result>` 且非 SubAgent、非 Background 的旧卡保留。
- 不扩大 background shell settlement / process-phase 折叠策略。
- 不改 CLI 注入协议本身。

## What Changes

- 放宽 `parseAgentTaskNotification`：不再要求 `<result>`；无 result 时 `resultText` 为空字符串，仍提取 header 字段。
- 新增 `isBackgroundStyleAgentTaskNotification`，与既有 SubAgent 识别并列。
- Background 型 notification 在幕布渲染 process-phase 风格折叠条（默认收起）；`role=user` 也不得走蓝气泡。
- SubAgent 型继续 0 高退役；真用户提问继续蓝气泡。
- 补 focused tests：无 result 可解析、误伤防护、三类分流、折叠默认态。
- Claude history shadow recovery / live 等价搜索：CLI 注入的 task-notification user 不当新 turn；追加 recovered 前对已有等价 assistant 去重。

## Technical Options

| Option | Summary | Trade-off |
|--------|---------|-----------|
| A. 后端丢掉 task-notification 不进 conversation items | 前端立刻干净 | 破坏历史回放、锚点、enrich；跨引擎风险高 |
| B. 仅放宽 parse，全部走旧 Agent session 卡 | 修泄漏最快 | 后台 wakeup 被标成 Agent session，语义错；用户仍看到整卡噪音 |
| C. 放宽 parse + 三类分流；Background 默认折叠条 | 修泄漏且语义对 | 需新增识别与折叠 UI，测试面略增 |

**选定 C**：前端 presentation 分流；解析契约放宽但不放宽「必须从载荷开头匹配」。

## Capabilities

### New Capabilities

- `background-task-notification-fold`：Background 型 `<task-notification>` 的幕布折叠呈现、与 SubAgent / 真用户提问的分流合同。

### Modified Capabilities

- `shared-message-domain-helpers`：agent-task 解析不再要求 `<result>`；messages 消费规则增加 Background 折叠路径。

## 验收标准

1. 截图同款无 `<result>` 的 `Background command "…" completed` 载荷：幕布 **无** 用户蓝气泡、**无** 裸 XML、**无** `Agent session` 旧卡；默认可见折叠条（status + 后台任务完成文案）。
2. 展开折叠条可看到 task-id / tool-use-id / output-file / status / summary（及原始回执）。
3. SubAgent 型 `Agent "…"` 仍退役，不出现旧卡，也不出现本折叠条。
4. 普通用户提问（不以 `<task-notification>` 开头）仍是右侧蓝气泡。
5. 正文中间仅提及 `<task-notification>` 的普通散文仍 parse=null。
6. 有 `<result>` 且非 SubAgent、非 Background 的 notification 仍可走 legacy `.message-agent-task-card`。
7. focused vitest 覆盖以上边界；`openspec validate` 对本 change 通过。
8. 历史 `[assistant 已落盘正文, user wakeup fold]` + 等价 shadow：幕布只有一份 assistant，无 `claude-shadow-recovered-*`。

## Impact

- **Frontend**：`engine-task-output/contracts`、`messageRowPresentation`、`MessageRow`、timeline 消费、i18n、CSS、`claudeHistoryLoader` shadow recovery、`conversationAssembler` 等价搜索、focused tests。
- **Backend**：不改 `parse_task_notification_xml` / event conversion。
- **OpenSpec**：本 change + 上述 capability delta。
