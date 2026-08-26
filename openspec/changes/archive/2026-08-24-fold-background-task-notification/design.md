## Context

Claude Code 后台 Bash 完成后，CLI 把 wakeup 写成 `role=user` 的 `<task-notification>` 注入 session JSONL。原生 Claude 模型吃这份 XML；经 Claude CLI 走 DeepSeek 时协议不变，只是模型换成 OpenAI 兼容（`tool-use-id` 形如 `call_00_…`）。

当前前端解析：

1. 载荷必须以 `<task-notification>` 或 entity-escaped 开头（防散文误伤）。
2. **必须**找到 `<result>`，否则返回 null。
3. `isSubagentStyleAgentTaskNotification` 只认 `Agent "…"` / `智能体 "…"`。
4. parse=null 的 user 文本走右侧蓝气泡；parse 成功且非 SubAgent 走 `.message-agent-task-card`。

截图载荷只有 header、没有 `<result>` → parse=null → 蓝气泡泄漏。后端 `parse_task_notification_xml` 本就不要求 result。

## Goals / Non-Goals

**Goals:**

- 无 `<result>` 的合法 envelope 可解析。
- Background / SubAgent / 真用户提问三类分流。
- Background 默认折叠，不进蓝气泡、不进 Agent session 卡。
- 展开后只展示一份详情（优先任务输出 inspector，否则 header kv）。

**Non-Goals:**

- 后端过滤。
- 改 SubAgent 退役或 S10 enrich。
- 全局删除 task-notification 渲染。
- 改 settlement / process-phase 折叠策略。

## Decisions

### D1 — 放宽 parse，但不放宽起点

`parseAgentTaskNotification`：

- 保留：`trimStart` 后必须以 `<` 或 `&` 开头；open tag index 必须为 0。
- 删除「必须有 `<result>`」。
- 有 result：行为与现网一致。
- 无 result：从 envelope（到 `</task-notification>` 或文末）提取 header；`resultText = ""`。
- 空 envelope（无 task-id / tool-use-id / output-file / status / summary）仍返回 null。

### D2 — Background 识别独立于 SubAgent

新增 `isBackgroundStyleAgentTaskNotification`：

- 若已是 SubAgent 风格 → **false**（永不抢 SubAgent）。
- `Background command "…" / “…”`
- `Background shell …`
- 以 `Background` 开头且含 completed/finished/failed/error 等终态词
- 含 `后台命令` / `后台任务` / `后台进程`

**不**用「有 tool-use-id」单独判定。

### D3 — 幕布三类分流

| 判定 | 呈现 |
|------|------|
| parse=null | 真用户 / 普通 assistant 文本；user 仍蓝气泡 |
| SubAgent | 继续退役（Timeline 0 高锚点 / MessageRow null） |
| Background | 新折叠条；`displayText=""`；不加 `.message-agent-task` 旧卡 |
| 其它已解析（通常有 result） | 保留 legacy Agent session 卡 |

`isOrdinaryUserQuestionItem` 已依赖 parse；放宽后 Background 不再被当成普通提问。

### D4 — 折叠条视觉语言

复用 process-phase chip：左对齐全文案 + chevron + 全宽 hairline。默认收起。

- status pill：notification.status
- 文案：`后台任务完成`（失败则失败文案）；有引号命令名时追加 ` · {title}`
- 展开：有 output snapshot 只渲染 inspector；否则只渲染 kv。不再并排 raw XML /「查看输出」按钮
- `role=user` 也走这条路径；用 `.message-agent-task-fold` 覆盖 `.message.user` 右对齐与蓝气泡

### D5 — 测试策略

- contract：无 result 可解析；散文误伤仍 null；空 envelope null；entity-escaped 无 result 可解析。
- 识别：Background command / Background shell / 后台任务；SubAgent 不被认成 Background。
- presentation：Background 折叠、无蓝气泡、无裸 XML；SubAgent 仍退役；普通提问仍蓝气泡；非 Background 有 result 仍旧卡。
- scroll 锚点：Background 折叠后 `data-agent-tool-use-id` 仍可滚到。

### D6 — wakeup 不是 shadow / live 等价搜索的 turn 边界

CLI 注入的 `role=user` `<task-notification>`（后台 wakeup / SubAgent 退役）MUST NOT：

1. 把 `findLastAssistantAfterLastUser` / `hasExplicitFinalAssistantAfterLastUser` 的 last-user 切到 fold 之后，导致 shadow 在折叠条后再追加 `claude-shadow-recovered-*`
2. 让 `shouldStopAssistantEquivalenceSearch` 在 fold 处截断，导致 live `itemCompleted` 再追加一条等价 assistant

追加 recovered 行前，MUST 扫描已有 assistant 是否与 shadow 正文等价（相等或互为前缀）；命中则 merge / skip，不得在 fold 后再插一份。真用户提问仍是边界。历史里没有 assistant 的中断恢复仍允许追加。

## Risks / Trade-offs

- **误伤真用户粘贴整段 XML**：仅当整条消息以 envelope 开头。用户在中文说明后再贴 XML 仍走蓝气泡。可接受。
- **Background 有 result 的旧卡消失**：现网「Background shell … + result」会从 Agent session 卡改成折叠条。语义更对，属有意变更。
- **未知非 Background 且无 result**：走 legacy 卡（空 result）。比蓝气泡安全；不扩大 Background 启发式。
