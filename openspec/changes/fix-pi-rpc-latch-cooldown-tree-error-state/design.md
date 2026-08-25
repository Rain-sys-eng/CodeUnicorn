# Design: fix-pi-rpc-latch-cooldown-tree-error-state

## 决策

**1. 闩的数据形态：`Option<Instant>` 取代 `AtomicBool`。**

`rpc_disabled` 全仓库只有 `ensure_resident` 一读一写（G19 已去掉命令路径的复位），替换无外部影响。`Option<Instant>` 同时承载「是否置位」与「置位时间」，是冷却判定的最小形态。判定抽纯函数便于单测：

```rust
fn rpc_disabled_blocks_spawn(disabled_since: Option<Instant>, now: Instant) -> bool {
    match disabled_since {
        None => false,
        Some(since) => now.duration_since(since) < PI_RPC_DISABLED_RETRY_COOLDOWN,
    }
}
```

**2. 冷却 60s 的理由。**

- 覆盖主要瞬态故障：pi 二进制升级中、系统资源瞬时耗尽、session 文件被其它进程短暂占用。
- 持续故障（老 pi 无 `--mode rpc`）下，每个冷却窗口最多一次白 spawn（~2s handshake 超时），不会退化成每次发送都白试。
- 不自适应退避：故障场景单一（binary 能力问题），简单固定窗口足够，避免引入状态机。

**3. 试探成功清闩的位置：spawn Ok 臂统一清。**

常规 spawn（闩未置位）走同一代码路径，`take()` 返回 None 时静默跳过，不分支。清闩打 log info 便于事后核对自愈发生时间。

**4. 存活 resident 复用优先级不动（`5e15b934f` 成果）。**

冷却逻辑只作用于「reuse 失败后的新 spawn 闸」，复用检查仍在闩之前。闩置位期间：有存活 resident 的会话照常 RPC；无 resident 的会话在冷却内降级 print-json（发送）/报错（命令），冷却过后自动试探。

**5. 前端错误态：store 记录 + 面板分支，不动既有加载语义。**

- `errorByKey` 在新尝试**开始**时清除（而非成功时）——点击重试后面板立刻从「加载失败」切回「加载中」，无 stale 错误残留。
- catch 保留「keep last-good snapshot」：有旧树时错误仅记录，面板仍渲染旧树（`tree !== null` 分支优先），不闪错误页。
- 错误详情直接展示后端 message（含 `pi rpc disabled after previous failure` 这类可定位文本），不重映射——该面板面向诊断。
- 手动重试而非自动退避：避免对故障 RPC 的自动 hammering；turn 完成事件触发的既有 `refreshPiSessionTree` 天然提供「会话活跃后自愈刷新」。

**6. i18n 只补新键。**

`piSession.tree.loadFailed` / `piSession.tree.retry` 中英两键；存量「加载中…」硬编码不动（非本 change 引入的债）。

## 备选方案（否决）

- **闩加次数上限（试探 N 次后永久闩）**：否决。持续故障下每 60s 一次白 spawn 成本可忽略；次数上限重新引入「永久残废需重启」。
- **闩改为 per-session**：否决（同 `5e15b934f` design D3）。闩语义是 binary 能力探测，per-session 无事实依据。
- **前端自动重试（指数退避）**：否决。RPC 故障期间自动重试会产生 spawn storm 风险；手动 + turn 完成事件已覆盖。
- **错误态做成 toast/通知**：否决。错误是面板内状态，就地展示 + 重试才是任务流闭环。

## 风险

| 风险 | 缓解 |
| ---- | ---- |
| 冷却试探在持续故障下周期性白 spawn | 每窗口最多一次，handshake 超时 ~2s；log 可观测 |
| `Instant` 单调性（系统时钟回拨） | `Instant` 单调时钟不受墙钟回拨影响；`duration_since` 对未来时间返回 0（仍在冷却内，安全方向） |
| store 模块级 state 的测试污染 | 测试文件内 `beforeEach` 复位（closePiTreeOverlay 已有先例；新增 reset helper 或直接操作 key） |
| 面板错误分支样式缺失 | 复用 `pi-fs-empty` 容器 + 原生 button，功能优先；样式增量留给设计走查 |
