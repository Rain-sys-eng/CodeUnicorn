# Proposal: fix-native-parallel-provider-model-isolation

## Why

并行多个 Native CLI 会话（同引擎、不同 managed 供应商）后，回到历史会话二次对话时，底栏仍可能显示上一会话的模型名（如 `MiniMax-M3`），而实际请求打到最后使用的供应商 API（如 DeepSeek），触发：

```text
API Error: 400 The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed MiniMax-M3.
```

Shared Session 用每轮 `selectedNextTarget` 隔离，无此问题。Native 的 L2 会话 binding 与「全局 L1 + 单引擎 catalog + freeform 放行」混用，导致跨供应商 **model residual** 静默上送。

## 目标与边界

### 目标

1. **Managed catalog 就绪时**：跨供应商产品模型名 residual（不仅 `k3`/`kimi-*`，含 `MiniMax-*` 等）MUST repair 到当前绑定 profile catalog 默认，或 fail-closed；不得静默 `--model` 上送第三方 API。
2. **合法 freeform 不回归**：catalog 外自定义名（如 `my-org-router-v2`、用户明确自定义）在非 residual 启发式下仍可 freeform。
3. **并行会话隔离**：历史 native 会话二次发送 MUST 继续使用本会话 L2 `providerProfileId`；不得被最后一次 L1 启用的供应商改写发送路由。
4. **测试钉死**：用 Vitest 卡住 MiniMax residual under DeepSeek、kimi residual 既有行为、freeform 白名单、composer draft 不污染 finalized 历史会话。

### 非目标

- Shared Session target / next-send 语义（保持现状）。
- 改写 `~/.claude/settings.json` 盖盘策略。
- 新增供应商产品形态或续接 UI。
- 全量第三方品牌 residual 穷举（以可扩展启发式 + 测试钉死本次事故模型为主）。

## What Changes

### Frontend

- 扩展 `claudeManagedRuntimeModel` 跨供应商 residual 检测（MiniMax 等），catalog 就绪且未收录时 repair。
- 保持 freeform 与既有 kimi residual / tier mapping 行为。
- （按需）切会话 / catalog 刷新后 selection 与 resolver 一致；不扩大 draft 到 finalized 历史会话。

### Backend（可选防御）

- 若实现成本可控：已存在 L2 binding 时禁止用不同 request profile **静默覆盖** catalog binding（首绑 / 同值仍可写）。

## Capabilities

### New Capabilities

- （无）本 change 不新增 capability 命名空间。

### Modified Capabilities

- `claude-provider-runtime-model-sync`：residual 启发式从「仅 Kimi」扩展为「多供应商产品模型 residual」；补 MiniMax under DeepSeek 场景。
- `engine-per-session-provider-binding`：强调并行 native 会话二次对话不得跨会话 residual 上送；L2 binding 不被并行会话污染。

## Impact

| 区域 | 路径（预期） |
|------|----------------|
| runtime resolver | `src/features/models/claudeManagedRuntimeModel.ts` |
| 单测钉死 | `src/features/models/claudeManagedRuntimeModel.test.ts` |
| composer selection 隔离 | `src/app-shell/domains/selectedComposerSession.ts`（仅当测试证明需收紧） |
| L2 binding 记录（可选） | `src-tauri/src/session_management.rs` |
| Shared | **无行为变更** |

## 技术方案对比

| 方案 | 说明 | 取舍 |
|------|------|------|
| A. 仅 toast 提示用户手动重选 | 不止血，仍会 400 | **否** |
| B. catalog 就绪时所有 unlisted 一律 repair | 破坏合法 freeform | **否** |
| C. 扩展 residual 启发式 + 测试钉死 +（可选）L2 防覆盖 | 止血本次事故且保留 freeform | **是** |

## 验收标准

- [ ] DeepSeek managed catalog 下 `MiniMax-M3` / `minimax-m2` selection → repair 到 catalog 默认，`repaired=true`
- [ ] 既有 `k3` / `kimi-*` residual 仍 repair
- [ ] `my-org-router-v2`、`claude-opus-4-6` freeform 不回归
- [ ] draft 仅作用于 pending 会话；finalized 历史会话不吃上一会话 draft
- [ ] Shared 相关测试无需因本 change 改断言
- [ ] 聚焦 Vitest 全绿
