## 0. Incident (2026-08-11)

- [x] 0.1 重发洪水止血：completed-id + terminal-pulse + catch 闸门
- [x] 0.2 记录 `INCIDENT.md` 禁止重引入项
- [x] 0.3 临时关后台 → 安全版重开（cap=1 + signal deps）

## 1. P0 队列残留 / handoff 单所有者

- [x] 1.1 乐观出队（native）
- [x] 1.2 fail/catch prepend + terminal-pulse（禁止 dispatch 前 delete pulse）
- [x] 1.3 activeItems 命中等价 user 时清 handoff state
- [x] 1.4 completed-id：成功后同 id 永不自动再发
- [x] 1.5 单测：失败不连发；成功后 status 抖动不重发

## 2. P1 S1 安全版后台 auto-drain

- [x] 2.1 `MAX_BACKGROUND_QUEUE_DRAIN = 1`；`getEnableBackgroundQueueDrain()` 默认 **true**
- [x] 2.2 enqueue 写 `ownerWorkspaceId` / `ownerThreadId`
- [x] 2.3 **不**把整表 `threadStatusById` 放进 drain effect deps；改用 `queueDrainSignal`（仅有队列/inFlight 的 thread 的 p/t）
- [x] 2.4 调度：active 优先；后台 cap=1；无 status 的非 active hold
- [x] 2.5 非 active 强制 `sendUserMessageToThread(owner…)`；classify 仅 `ownerIsShared`
- [x] 2.6 native 成功 inFlight 边沿结算 + 8s 超时兜底（不重发）
- [x] 2.7 单测：闸关不后台发；闸开可后台发；hold without status

## 3. 接线与清理

- [x] 3.1 composer / app-shell 传 threadStatus、activeItems、resolveWorkspace
- [x] 3.3 Vitest useQueuedSend + handoff 已通过

## 3A. P0 Shared pending-ack recovery 与 owner persistence

- [x] 3A.1 将 `pending-ack` 的删除请求接入现有 `ConfirmDialog`；明确告知 Runtime 可能已接收、不会重发、不能撤回。
- [x] 3A.2 复用 Shared V2 terminal abandon contract；仅成功后结算 cancelled、移除 queue item、清 in-flight。失败/无 owner 时保持原状态。
- [x] 3A.3 将 queue persistence 写回按 queue owner 定位；rehydrate round-trip `ownerWorkspaceId` / `ownerThreadId`，owner 缺失仅 hold。
- [x] 3A.4 单测：`pending-ack` 删除不会静默 no-op；取消/abandon 失败不丢队列；abandon 成功不重发；非 active owner 写回与 rehydrate 不串线。

## 4. 验证（手工）

- [x] 4.1 焦点：123 → 挂 456 → 自动发且 strip 空（用户验收通过）
- [x] 4.2 离焦：A 挂队列 → 切 B → A 在 ready 后后台 drain（cap=1，用户验收通过）
- [x] 4.3 紧切回：不应「已回复还在条里」+ 不应同句刷屏（用户验收通过）
- [x] 4.4 三会话各 1 队列：不卡死、不连发（用户验收通过）
- [x] 4.5 Shared pending-ack：点击删除 → 明示确认 → abandon 成功后解除；取消或失败时消息仍在，且不会重发（用户验收通过）。
