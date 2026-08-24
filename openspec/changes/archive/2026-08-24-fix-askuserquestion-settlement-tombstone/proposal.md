## Why

Claude `AskUserQuestion` 在用户提交/跳过/取消后，对话侧往往已经继续执行，但前端仍可能再次弹出同一问答框。根因是：成功结算只做了队列 `remove`，没有 session 级 settlement tombstone；后端成功应答也几乎不 emit `completed=true`，迟到或 resume 重放的 `item/tool/requestUserInput` 会把卡重新入队。现场表现为「答了也没用、开始执行了又弹框」，且「不影响对话内容」——典型幽灵 UI，而非 agent 真阻塞。

## 目标与边界

- 目标：用户对某 `request_id`（含 Shared owner 维度）完成 accepted / stale / completed 结算后，同 identity 迟到/重放事件 MUST NOT 再进入 pending queue、MUST NOT 再弹交互卡。
- 目标：Claude 成功 `respond_to_user_input` 后 MUST 向 FE 发 `completed=true` 完成事件，与 MCP 超时路径语义对齐。
- 目标：Native `AskUserQuestion` tool_use 若本 session 已结算，MUST NOT 再次进入 kill+`--resume` 等待。
- 目标：O(1) 墓碑查询、有界集合，不引入轮询或根链高频 setState。
- 边界：兼容现有 `respond_to_server_request` payload；不改 Codex 本地 plan 卡片协议形状；合法的**新** tool_id / 新 request 仍可弹窗。

## 非目标

- 不改 AskUserQuestion UI 样式、倒计时时长、多题 tab 交互。
- 不解决模型在新 tool_id 下「礼貌重问」的产品策略（仅防同 request 幽灵重投）。
- 不重做 Windows resume 整链路（#658 可并行，不阻塞本 tombstone 修复）。
- 不引入新 IPC 方法名或破坏性 API。

## What Changes

- 前端：session 内有界 settlement tombstone；accepted/stale/completed 均写入；入队前检查。
- 后端 Claude：成功应答后 emit `RequestUserInput { completed: true }`。
- 后端 Claude：已结算 request_id 的 native 重入不再挂 resume wait；stream 仅对 `completed=false` 进入 wait。
- 测试：FE 重放开、BE completed emit、native 重入 guard 的 focused 覆盖。

## 方案取舍

| 方案 | 做法 | 取舍 |
|---|---|---|
| A | 仅 Dialog 本地 `locallySettled` 更久 | 切换线程/重挂载仍会丢；队列 remove 后现逻辑会清掉 local mark。不足。 |
| B | FE tombstone + BE completed + native 重入 guard | 前后端双保险，兼容现有 completed 契约，性能 O(1)。**采用**。 |
| C | 去掉 kill+resume 改 in-process 全 MCP | 架构正确但范围过大，回归面不可控。 |

选择 **B**：最小行为补全，对齐既有 `completed` lifecycle，不改协议主干。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `codex-chat-canvas-user-input-elicitation`：补齐「成功/stale 结算后的 tombstone 与重放抑制」以及 Claude 成功应答 `completed=true` 与 native 防二次 wait。

## Impact

- FE: `useThreadUserInputEvents.ts`, `useThreadUserInput.ts`, 小模块 tombstone store, 相关 tests
- BE: `engine/claude/user_input.rs`, `engine/claude.rs` stream wait 条件, focused Rust tests
- 无新依赖；无 **BREAKING** API

## 验收标准

- 同一 identity 在 accepted 或 stale 后，迟到 `completed=false` 事件不入队、不弹窗。
- Claude 成功应答后 FE 收到 `completed=true`（或等效 tombstone），队列保持为空。
- Native 已结算 tool 的二次 stream 出现 MUST NOT 再次阻塞 resume wait。
- 新 request_id 仍可正常弹窗与提交。
- 非 stale submit failure 仍可重试。
- 聚焦 Vitest + 相关 cargo test 通过；无根渲染热路径新增。
