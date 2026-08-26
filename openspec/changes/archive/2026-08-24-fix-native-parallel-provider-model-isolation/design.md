# Design: fix-native-parallel-provider-model-isolation

## Context

- Native：发送 L2 = `thread.providerProfileId`；L1 = 全局「使用中」+ catalog 同步。
- Shared：每轮 `selectedNextTarget`，与 L1 解耦。
- 既有 `resolveClaudeManagedRuntimeModel` 仅把 `k3` / `kimi-*` 当 residual；`MiniMax-M3` 走 freeform 放行 → DeepSeek 400。
- Composer draft 已限制在 `*-pending-*`；本 change 以 **send 边界 residual repair** 为主止血。

## Goals / Non-Goals

**Goals**

1. Catalog 就绪时，跨供应商产品模型 residual → repair 到 default。
2. Freeform 与 tier mapping 不回归。
3. 测试先红后绿，卡住事故模型。

**Non-Goals**

- Shared 路径改动。
- 穷举所有云厂商模型命名。
- UI 强制同步（允许 display 短暂 residual，send 必须 repair；后续可跟 selection repair）。

## Decisions

### D1. Residual 启发式扩展（非「全 unlisted 封杀」）

在 `isForeignClaudeRuntimeResidue` 增加可测试的产品/品牌 residual 模式：

| 类 | 模式示例 |
|----|----------|
| Kimi（既有） | `^k3$`, `^kimi-`, `^kimi-code/` |
| MiniMax（事故） | `minimax` 子串 / `^MiniMax` |
| 常见第三方前缀 | `deepseek`、`glm-`、`qwen`、`doubao`、`moonshot`、`abab` 等（**仅当 `!legal.has(value)` 时才 repair**） |

**为何不是全 unlisted repair**：既有契约允许 `my-org-router-v2`、`claude-opus-4-6` freeform。

**合法路径**：

1. catalog 命中 entry → 用 entry.model  
2. catalog 按 runtime 反查命中 → 用该 entry  
3. unlisted + residual 启发式 → repair default  
4. unlisted + 非 residual → freeform  
5. catalog 空 → 维持既有 env / freeform 行为  

### D2. Send 边界为唯一强制闸门

`useAppShellComposerModelSection` 已用 `resolveClaudeManagedRuntimeModel` 产出 `resolvedModel`。  
扩展 residual 后，**无需改 Shared**；Claude managed send 自动吃到 repair 结果。

避免在 effect 里对 Claude residual 自动 `handleSelectModel`（历史 #185 风险）。UI 可短暂显示脏 id；**上送 runtime 必须已 repair**。

### D3. L2 binding 防覆盖（可选 P1）

若时间允许：`record_engine_provider_binding_at_path` 在 **已有不同 binding** 时拒绝覆盖，仅允许首绑或同值幂等。  
解析优先级仍为 request > catalog（前端必须继续传 L2）；防覆盖只防「错误 request 永久写脏 catalog」。

本 change **P0 不强制后端**；以前端 residual + 测试为主。后端作为 follow-up 若测试/证据需要再开。

### D4. Shared 零触碰

不改 `selectedNextTarget`、Shared send 组装、Shared catalog 切换。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 过宽 residual 误伤 freeform（如用户自定义名含 `deepseek`） | 仅启发式 + `!legal`；合法 catalog/env 名优先；测试钉 freeform |
| UI 仍显示 MiniMax 但 send 已 repair | 可接受止血；follow-up 可在 catalog sync 后写回 selection |
| 新供应商模型命名未覆盖 | 扩展 patterns 数组 + 加测试即可 |

## Migration

无数据迁移。用户侧：下次发送自动 repair，无需清 localStorage。

## Open Questions

- 无阻塞项。自定义 freeform 若与 residual 模式冲突，优先「显式 catalog 登记」。
