## Why

多会话挂队列后切换 workspace/thread，auto-drain 只服务 `activeThreadId`，非焦点队列被冻结，违背「挂上就会跑」的预期。同时 Codex 队列 drain 时 handoff bubble 与 queue strip 双 owner，导致「幕布已弹出同文案、输入框上方队列条仍残留」。需要一次收口：S1 后台续跑 + handoff/queue 生命周期原子切换。

## What Changes

- **S1 后台 auto-drain**：所有有队列且 per-thread ready 的 thread 可 drain；不依赖焦点。
- **并发上限 1**：全局非 active 同时 in-flight drain ≤ 1；active thread 不占该配额。此为 2026-08-11 incident 后的安全收敛值。
- **不串线**：后台派发必须 `sendUserMessageToThread(workspace, threadId, …)`，item 绑定 owner workspace/thread。
- **及时弹出、无残留**：drain 开始时乐观出队 + Codex handoff 同 tick；失败回队并清 handoff；真实 user item 到达后主动 clear handoff state。
- **Pending ACK 可恢复**：Shared V2 的未确认 handoff 不再允许「删除」静默 no-op。用户显式确认后，复用 Shared V2 terminal abandon 流程；终止成功前不清本地队列、不重发。
- **持久化不串 owner**：后台 thread 的队列变更必须按该 item 的 workspace/thread owner 写回；rehydrate 必须保留 owner，缺失 owner 只安全 hold。
- **不做 S2**：无 Settings 开关、无后台引导 Toast/角标新产品 UI。

## 目标与边界

- 目标：非焦点队列自动续跑；queue strip 与 handoff 单所有者；并发 ≤ 1；跨 thread 不串；不确定 Shared handoff 有显式、安全的退出路径。
- 边界：仅前端 `useQueuedSend` 调度、Shared V2 既有 terminal abandon 调用、handoff 可见性与队列持久化；不改 Tauri/Rust protocol。

## 非目标

- S2 policy 开关 / 设置页 / 引导 Toast
- 新 workspace 队列角标体系
- high demand 自动重试策略
- 提高事件流渲染频率

## Capabilities

### New Capabilities

- `queue-background-auto-drain`: 非焦点会话队列在 per-thread ready 时后台 auto-drain；并发与不串线约束。

### Modified Capabilities

- `codex-queued-user-bubble-continuity`: handoff 与 queue strip 不得双显同一条；真实 user item 到达后必须清理 handoff state。

## Impact

- 代码：`useQueuedSend`、`useComposerController`、`MessageQueue` 与 Shared recovery owner。
- 测试：`useQueuedSend.test.tsx` 及 handoff 单测。
- 性能：后台最多 1 路 drain；须遵守现有 event batch / 禁止根链高频 setState。
- 无 **BREAKING** API；行为从 active-only 变为默认后台续跑（产品行为变更）。

## 技术方案对比（摘要）

| 方案 | 说明 | 取舍 |
|---|---|---|
| A. S1 默认后台 + 无开关 | 实现 per-thread 调度，maxBg=1 | **采用**：对齐用户「挂机排队」预期；incident 后优先保证不重发 |
| B. S2 开关默认关 | 需设置面与叙事 | 拒绝：用户明确不做 S2 UI |
| C. 仅修残留不做后台 | 只修 handoff/queue | 不足：主诉求未解 |

## 验收标准

1. A 挂 ≥3 条队列，切到 B：A 在 idle 后自动 drain，无需回 A。
2. 同时多会话排队时，非 active in-flight drain ≤ 1；消息不发到错误 thread。
3. Codex drain：handoff 出现时 queue strip 立即不再显示该条；失败回队且无 handoff。
4. 等价 optimistic/history user 到达后 handoff state 为 null，幕布仅一条 bubble。
5. 无新 Settings/Toggle UI；相关 Vitest 通过。
6. Shared `pending-ack` 删除必须先展示「可能已被 Runtime 接收」确认；确认 abandon 成功后才移除队列，且绝不自动重发；失败时保留队列与恢复入口。
7. 非 active thread 的队列变更重启后仍绑定原 workspace/thread；owner 缺失时不允许 fallback 到当前会话发送。
