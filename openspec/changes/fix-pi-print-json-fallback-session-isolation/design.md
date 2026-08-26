# Design: fix-pi-print-json-fallback-session-isolation

## 决策

**1. 忙互斥粒度 = session id，载体 = `ActivePiChildProcess.session_id`。**

`active_processes: Mutex<HashMap<String /* turn_id */, ActivePiChildProcess>>` 不带 session 信息，这是 B1 能写成 `!active.is_empty()` 的根源。给 entry 加 `session_id: Option<String>`（spawn 时从 `params.session_id` 克隆），busy 判定抽成纯函数：

```rust
fn print_json_fallback_busy<'a>(
    active_sessions: impl Iterator<Item = Option<&'a str>>,
    session_id: Option<&str>,
) -> bool {
    let Some(session_id) = session_id else { return false; };
    active_sessions.any(|active| active == Some(session_id))
}
```

- `session_id=None`（新会话）：print-json spawn 会让 pi 新建 session 文件，两个 None 进程写**不同** JSONL，无交叉写风险 → 恒放行。这同时修掉「新建也 busy」。
- 同 session 并发 print-json：仍互斥（防交叉写），行为与注释意图一致。
- 纯函数可直接单测，不需要构造 `tokio::process::Child`。

**2. fallback 释放 key 与 `try_send_message_rpc` 的 scratch key 同源。**

`try_send_message_rpc` 第一句就是 `pi_resident_map_key(params.session_id.as_deref(), turn_id)`。fallback 分支用**同一个表达式**取 key 再释放：

```rust
let resident_key = pi_resident_map_key(params.session_id.as_deref(), turn_id);
self.drop_resident_by_key(&resident_key).await;
```

- `Some(有效 id)` → `session:{id}`，与旧 `drop_resident` 行为一致。
- `None` / `pi:xxx` 非法 id → `scratch:{turn_id}`，修掉 B2 泄漏。
- `drop_resident(session_id)` 保留 pub 签名（`manager.rs:923` 在用），内部委托 `drop_resident_by_key(&format!("session:{session_id}"))`。

**3. `rpc_disabled` 闩只拦新 spawn，不拦存活复用。**

`ensure_resident` 调整为：read 复用 → write 双检复用/清死 → **然后**才 `if rpc_disabled → Err` → spawn。理由：

- 闩的语义是「这个 pi binary 不会说 RPC」（handshake 失败置位）。已经握手成功的 resident 显然会说 RPC，禁用它们没有任何收益，只会把并行 tab 全部打成 print-json（B3 的实测后果）。
- spawn 失败路径**不插入** map，所以闩挡新 spawn 不会泄漏。
- G19 的「命令路径不复位闩」结论不动；闩仍不可逆（进程生命周期内）。可恢复性由后续 change 评估（如检测到 pi 版本变化时复位），不在本 change。

**4. `session_id=None` 时 busy 检查跳过 rpc run 查询。**

`rpc_has_active_run_for(None)` 查的是 `scratch:commands`（树/fork 面板共享槽），与本次新发送的 `scratch:{turn_id}` 无关（B4）。且 F2 已释放本次发送的 scratch 槽，因此 `None` 时 rpc 侧恒不忙。`rpc_has_active_run_for` 签名与 `Some` 语义不变。

**5. `set_model` 失败维持 Fallback，不改 Failed。**

归档 design（`enhance-pi-native-rpc-session`）既定：`set_model` 失败回退 print-json（每次携带 `--model`），不得以漂移模型静默作答。F2/F4 修好后：本 turn print-json 带正确 `--model` 完成；resident 已释放，下一 turn 重 spawn 带 `--model` 的 RPC resident 自然恢复。无需改语义。

## 备选方案（否决）

- **busy 互斥按 workspace 保留、只修闩**：否决。`!active.is_empty()` 与「同会话交叉写」的注释意图直接冲突，保留它等于保留「只能有一个 PI」。
- **闩改为 per-session map**：否决（过度设计）。闩的本意是 binary 能力探测，per-session 没有事实依据；F3 的「只拦新 spawn」已覆盖实测故障面。
- **fallback 时也 kill 其它 session 的 resident**：否决。fallback 只影响本次发送的槽位，其它 session 的 RPC 不应被牵连。

## 风险

| 风险 | 缓解 |
| ---- | ---- |
| 同 session 并发 print-json 的互斥被误放开 | F2 纯函数单测钉死「同 session 仍互斥」；`session_id` 在 spawn 时即快照，不受后续 rekey 影响 |
| `scratch:{turn_id}` 释放误杀正在 steer 的 run | fallback 只发生在 RPC 发送失败之后；若该 resident 有活跃 run，`try_send_message_rpc` 走 steer 分支，失败是 `Failed` 而非 `Fallback`，不会进释放分支 |
| busy 检查不再持锁跨 await | 顺带改进：先在锁内算纯函数，drop guard 后再 await rpc 查询，消除锁跨 await |
