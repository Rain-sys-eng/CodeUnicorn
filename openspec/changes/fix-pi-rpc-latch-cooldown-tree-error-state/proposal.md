# Change: fix-pi-rpc-latch-cooldown-tree-error-state

## Why

用户实证（2026-08-25，已确认诊断）：安装版 app（连续运行 12.6h）在今天复现 busy bug 期间，一次 PI RPC spawn 失败把 workspace 级 `rpc_disabled` 闩打上。旧代码闩在 `ensure_resident` 复用检查**之前**早退 → 全部 RPC 调用（发送 + 会话树命令）永久失败 → **所有 PI 会话树（长/短）永远显示「加载中…」**。重启 app 后立即恢复（闩在内存）。

`5e15b934f` 已修闩的位置（存活 resident 复用优先，闩只拦新 spawn），但仍有两个残余：

1. **闩不可逆**：一旦置位，需要新 spawn 的功能（新会话 RPC、无存活 resident 的会话树/命令）静默残废到 app 重启。用户无法感知、无自恢复路径。
2. **前端无错误态**：`PiSessionTreePanel` 以 `tree === null` 渲染「加载中…」——加载**失败**（tree 保持 null）与加载**中**视觉完全一致，本次排查的最大成本就是这个歧义。

事实源：`src-tauri/src/engine/pi.rs ensure_resident`、`src/features/pi-session/store/piSessionStore.ts refreshPiSessionTree`（catch 只 console.warn）、`src/features/pi-session/components/PiSessionTreePanel.tsx:386`（`tree === null ? 加载中…`）。

## What Changes

- **F1 闩加冷却自恢复（pi.rs）**：`rpc_disabled: Arc<AtomicBool>` → `rpc_disabled_since: Arc<Mutex<Option<Instant>>>`。冷却期（60s，`PI_RPC_DISABLED_RETRY_COOLDOWN`）内拦新 spawn；冷却过后放行一次试探 spawn——成功即清闩自愈（log info），失败重新计时（持续故障下每冷却窗口最多白试一次，不退化成每次发送都白 spawn）。纯函数 `rpc_disabled_blocks_spawn(disabled_since, now)` 承载判定，可单测。已存活 resident 复用逻辑不变（`5e15b934f` 成果保留）。
- **F2 会话树错误态（store + panel）**：`piSessionStore` 增加 `errorByKey: Record<string, string>`——`refreshPiSessionTree` 新尝试开始清旧错误、catch 时写错误消息（保留 last-good 快照语义不变）；新增 `usePiSessionTreeError` hook。`PiSessionTreePanel`：`tree === null && error` 渲染「加载失败 + 错误详情 + 重试按钮」（retry 调 `refreshPiSessionTree`），`tree === null && !error` 维持「加载中…」。
- **F3 i18n**：`piSession.tree.loadFailed` / `piSession.tree.retry` 中英键。
- **F4 测试**：`rpc_disabled_blocks_spawn` 冷却矩阵单测；新建 `piSessionStore.test.ts`（失败写错误、重试清错误）；新建 `PiSessionTreePanel.test.tsx`（错误态渲染 + 重试触发重新加载）。

## Capabilities

### Modified Capabilities

- `pi-rpc-session-runtime`：「Resident MUST 按会话隔离（真并行）」追加 scenario——禁用闩冷却过后自动试探恢复。
- `pi-session-fork-tree`：ADDED requirement——会话树加载失败 MUST 显示错误态与重试入口，禁止与加载中同态。

### Non-Goals

- 不改闩的置位条件（仍只有 spawn/handshake 失败置位）；不改 `set_model` 失败 Fallback 语义。
- 不做闩状态的前端可视化（冷却自恢复后用户无需感知）；不做树错误态的自动重试退避（手动重试即可，避免对故障 RPC 的自动 hammering）。
- 不重写「加载中…」硬编码为 i18n（存量，非本 change 引入）。
- P0 发版（`5e15b934f` 进入安装版）走构建流程，非代码改动。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Backend | `src-tauri/src/engine/pi.rs`（字段 + ensure_resident + 纯函数 + 单测） |
| Frontend | `piSessionStore.ts`（state + hook）、`PiSessionTreePanel.tsx`（错误分支）、`zh/en piSession.ts`（2 键） |
| 测试 | pi.rs mod tests +1；新建 `piSessionStore.test.ts`、`PiSessionTreePanel.test.tsx` |
| 热路径 | 闩未置位时仅一次 `Mutex lock + Option 读`，零额外开销；前端仅 store 多一个 map |
| 兼容性 | `rpc_disabled` 为 private 字段，无外部读取面；store 新增 key 有默认值 |

## Acceptance

1. 闩置位后 60s 内：新 spawn 仍被拒（错误同前）；存活 resident 会话不受影响。
2. 闩置位 60s 后：第一次需要新 spawn 的操作被放行试探；pi 恢复健康 → 闩清除（日志可见 `latch cleared`），后续全部恢复 RPC；pi 仍故障 → 重新计时 60s。
3. 会话树加载失败 → 面板显示「加载失败 + 原因 + 重试」而非永远「加载中…」；点重试 → 回到加载中并重新请求；成功后正常渲染树。
4. 树加载失败但存在 last-good 快照 → 仍渲染旧树（不闪错误页）。
5. `cargo test engine::pi` 与 focused vitest 全绿；`openspec validate` 通过。
