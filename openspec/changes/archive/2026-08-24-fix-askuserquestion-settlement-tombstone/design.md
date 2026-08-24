## Context

Claude AskUserQuestion 有两条交付路径：

1. **Native / plan**：`tool_use AskUserQuestion` → `RequestUserInput` → wait → kill + `--resume`
2. **Default MCP bridge**：`ask_via_mcp` → oneshot 回 tool_result（成功时只在超时才 emit `completed=true`）

前端已有 `completedRequestKeysRef`，但**只**在收到 `completed=true` 时写入；用户 submit/skip 成功路径只 `removeUserInputRequest`，不写墓碑。后端成功 `respond_to_user_input` 也不 emit completed。因此 resume 重放 / 乱序重投会把同题卡重新入队，而 agent 已在执行——幽灵 UI。

## Goals / Non-Goals

**Goals:**

- 结算后同 identity 重放 fail-closed 抑制
- 成功应答与超时路径 completed 语义对齐
- Native 已结算 request 不二次 wait
- 有界 O(1) 结构，无轮询、无根链热更新

**Non-Goals:**

- 改 UI、timeout 秒数、答案文案策略
- 全量替换 resume 架构
- 跨 app 重启持久化墓碑（session 内存即可；completed 事件覆盖同会话乱序）

## Decisions

### D1. FE 共享有界 tombstone 模块

- 新建轻量 `userInputSettlementTombstone.ts`：`mark` / `has` / `MAX=2048` 溢出 clear+re-mark（与现 ref 策略一致）。
- `useThreadUserInputEvents` 入队前 `has` 则 return；`completed=true` 时 `mark`。
- `useThreadUserInput` 在 `accepted` 与 `stale` 结算后 `mark`（用 `requestUserInputIdentityKey`，保留 Shared attempt 隔离）。
- **为何不用 reducer 大状态**：避免全列表订阅重渲染；tombstone 与现 ref 同语义但跨 hook 共享。

### D2. BE 成功应答 emit `completed=true`

- `respond_to_user_input` 在 MCP oneshot / native notify 成功后，对对应 `turn_id` emit  
  `RequestUserInput { request_id, questions: [], completed: true }`。
- FE 既有 completed 路径负责 remove + tombstone，兼容 Codex 无关路径（仅 Claude session 发）。

### D3. Native 重入 guard + stream wait 仅 `completed=false`

- Session 内 `settled_user_input_request_ids: HashSet`（有界，同 FE cap 思路）。
- `respond` 成功 insert；`convert_ask_user_question_to_request` 若已 settled → 返回 `completed: true` 事件且**不**写入 pending。
- Stream 循环：`is_user_input_request` 仅当 `RequestUserInput { completed: false }` 时调用 `handle_ask_user_question_resume`。
- **兼容**：新 tool_id → 新 request_id → 仍可问；MCP 路径本就不从 transcript 二次 convert。

### D4. 性能与回归护栏

- 所有查找 O(1)；无每 token/setState。
- 非 stale submit failure **不** mark tombstone，保留可重试。
- Shared identity key 继续带 `attemptId` / `providerRuntimeKey`，不跨 attempt 误杀。
- Codex RequestUserInput 本地路径：若走同一 FE settle hook 则获得 tombstone 益处；不改 Codex 协议。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| 墓碑误杀「同 request_id 合法二次问」 | request_id 由 tool_id 派生且 tool_id 通常唯一；Shared 带 attempt；cap clear 后仅影响极端长会话 |
| completed 事件多一次 control 流量 | 每问一次结算一发，Critical lane 可接受 |
| settled set 内存 | 有界 HashSet + 溢出 clear |
| 只 FE 不 BE / 只 BE 不 FE | 双写：任一路径到位即可挡幽灵；测试覆盖两边 |

## Migration Plan

1. 先合 FE tombstone（立即挡用户结算后重放）
2. 再合 BE completed + native guard
3. 回滚：删除 tombstone mark 与 completed emit 即可；无数据迁移

## Open Questions

- 无阻塞项。可选后续：跨 reload 持久化 tombstone（本次不做）。
