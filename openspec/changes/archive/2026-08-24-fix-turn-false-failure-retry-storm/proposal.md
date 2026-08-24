# fix-turn-false-failure-retry-storm

## Why

2026-08-24 用户报告（L站 yuzu）：Shared 会话 Claude Code + claude-opus-5「~100K token 就被中断」，跨渠道复现、原因未知。拿到其 CLI transcript（`~/.claude/projects/S--AIWorker-M365-Copilot-Proxy-docker-multi/`）逐条比对后确认：**中断是 mossx 客户端误判，不是上游砍单**。

数据证据：

- 6 个 session 中 auto-resume「继续。上一轮因供应商暂时失败中断」共 80+ 次（单 session 最高 106 次）；逐条比对前轮结局：除一次真实配额 403 级联外，**全部前轮以 `stop_reason=end_turn` 正常完成**——正文完整、138 个 tool_use 零悬挂、对应时间窗零 `isApiErrorMessage`。
- mossx 侧同样的轮次显示「耗时0s · 输出0 token」失败行，行内却展示着已收到的正文——**已完成轮次被翻成了失败**。
- 误判进入 shared provider-retry（`isSilentCliProcessExit` → retryable `soft-cancel`）→ auto-resume 死循环；每枪都是一整发 ~160K token（cache_read 138K + cache_creation 24K）的请求，直到上下文撑爆触发 auto-compact（"ran out of context"）。
- 另发现真实失败 `403 预扣费额度失败`（余额 ＄0.378 < 预扣 ＄0.80，预扣额随上下文增长）被 `failed to authenticate + 403` 规则误分类为 retryable「号池」，同 key 空转烧余额。

Root cause 两层：

- **Bug A（误判，引擎层）**：`src-tauri/src/engine/claude.rs` ~2355 的进程收尾逻辑——进程非零退出即无条件 `TurnError`，"regardless of whether partial output was received"。流式 `result` 事件已到达（轮次逻辑完成）的 turn 也被退出码否决。yuzu 环境（Windows + CLI 2.1.233 + 中转渠道）下 CLI 成功轮次后退出码非零，每轮都踩中。
- **Bug B（放大，重试层）**：`src/features/shared-session/provider-retry/` 无 identical-failure 熔断；配额类 403 误分类 retryable；`b52ce0106` 把 maxAttempts 上限放宽到 999，把单次误判放大成 token 燃烧循环。

## What Changes

- **E1 引擎结算修正（Claude）**：流式 `result` 且 `is_error != true` 的轮次，进程非零退出降级为 `log::warn!`（保留 status / stderr sample 诊断），照常 `TurnCompleted`，不再发 `TurnError`。无 `result` 或 `result.is_error == true` 的轮次维持现有失败路径不变。
- **E2 引擎适配器审计**：排查 gemini / kimi / grok / opencode / pi / qoder / dsh 的同款「退出码否决 result」模式（已知 `gemini.rs:1482` 同型）；仅修 identical inversion，其余记录结论。
- **R1 分类器配额规则**：`预扣费 / 余额不足 / 剩余额度不足 / insufficient balance|credit|quota / quota exceeded` → permanent「配额不足」（新 kind `quota`），判定先于 pool 的 `failed to authenticate + 403` 规则；i18n 补 `providerRetryReasonQuota`。
- **R2 identical-failure 熔断**：同一 retry series 内连续 3 次相同 failure signature（`kind` + normalized message 前缀）→ 直接 `exhausted`，停止 auto-send；不同签名不熔断。复用现有 exhausted overlay，不新增 UI。
- Spec delta：`claude-turn-settlement-stream-lifecycle`（ADDED）、`shared-provider-retry`（ADDED）。

## 目标与边界

- 斩断「已完成轮次 → 误判失败 → auto-resume 死循环」链路：E1 断根（所有 Claude 会话受益），R2 防爆（所有 shared 会话受益），R1 修正配额误分类。
- 改动最小化：E1 只动 `claude.rs` settle 路径一个 guard；R1/R2 只动 provider-retry 模块与 i18n locale 文件。
- 兼容现有契约：无 `result` 的失败、用户主动停止、recovery-required 路径行为全部不变。

## 非目标

- 不重审 `maxAttempts` 999 上限本身（`b52ce0106` 的产品决策保留；R2 熔断后其风险已收敛）。
- 不修 yuzu 环境里 CLI 非零退出的来源（Windows / hooks / 中转渠道），只取日志 evidence 确认假设（manual task，可 waiver）。
- 不实质修改 Claude 以外引擎的 settle 逻辑（E2 仅审计 + 记录；发现 identical inversion 才修，且单独列验收）。
- 不新增 UI 组件；exhausted / permanent 复用现有 overlay 与文案槽位。
- 不动 auto-compact / prompt-too-long 既有路径（`claude/lifecycle.rs`）。

## 方案对比

### Bug A（引擎结算）

| 方案 | 取舍 |
| --- | --- |
| **1. 成功 `result` 优先于退出码（采用）** | 契约修正：流内 terminal 证据 > 进程退出码。改动单点、语义清晰；风险仅「stderr 有真错误但 result 已成功」的极端情形，降级为 warn 日志可接受 |
| 2. 前端分类器豁免「有正文输出的失败」 | 前端拿不到 `result` 真相（只有 outcome/message 字符串），信号不可靠；且非 shared 会话仍留错误标记。拒绝 |
| 3. 退出码白名单（0 / 特定码算成功） | 环境差异大（Windows / 中转 / hooks 排列组合），白名单永远追不全。拒绝 |

### Bug B 熔断

| 方案 | 取舍 |
| --- | --- |
| **1. identical signature 计数熔断（采用）** | 精确命中观测到的循环形态（同 kind + 同 message 反复）；实现 ~30 行；对真实渐进式故障（消息变化）零影响 |
| 2. series wall-clock / 总时长预算 | 对慢失败不公平（大上下文一轮本来就分钟级），且挡不住「秒败 × 999」。拒绝 |
| 3. 「输出 0 token」计数 | 前端 settle 通知不携带 token 数据，加管线成本高。拒绝 |

### 配额 403 分类

| 方案 | 取舍 |
| --- | --- |
| **1. permanent `quota` kind（采用）** | 同 key 重试治不好余额不足；permanent overlay 直接告诉用户「配额不足」，导向充值 / 换号 |
| 2. 映射 `recovery-required` | recovery bar 语义是 target 不可用 / 会话恢复，与余额不足不符，且会把用户引到错误操作。拒绝 |

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `claude-turn-settlement-stream-lifecycle`：新增「成功 `result` 的结算优先于进程退出码」requirement。
- `shared-provider-retry`：新增「配额不足类失败 permanent 分类」与「identical-failure 熔断」两个 requirement。

## 验收标准

1. fake CLI 脚本 emit 成功 `result` 后 `exit 1` → `send_message` 返回 Ok、恰好一次 `TurnCompleted`、零 `TurnError`（cargo test）。
2. 无 `result` + `exit 1`（既有行为）与 `result.is_error=true` + `exit 1` 仍走 TurnError（cargo test 钉住，不回归）。
3. `Failed to authenticate. API Error: 403 预扣费额度失败, 用户剩余额度…` → permanent / `quota` / 「配额不足」，不启动 countdown；普通 `401 INVALID_API_KEY` 仍 retryable pool（vitest）。
4. 同一 series 连续 3 次 identical signature 失败 → `exhausted`、不再 auto-send；第 3 次签名不同则继续正常 countdown（vitest）。
5. `openspec validate --all --strict --no-interactive`、`npm run typecheck`、focused vitest（provider-retry 相关套件）、`cargo test`（claude 引擎套件）全绿。
6. （manual，可 waiver 并注明）拿到 yuzu mossx 应用日志该时间窗 `[claude]` 行，确认 TurnError 原文与「非零退出 + 空 stderr」假设一致。

## 风险

- **R1（低）误放真实失败**：guard 只在成功 `result` 已到达时生效；`result` 未到的崩残轮次仍走旧失败路径。测试钉住边界。
- **R2（低）熔断误停真实瞬断**：连续 3 次同签名才触发；真实 transient（502/timeout 波动）通常消息或节奏会变化，且用户可从 exhausted overlay 手动重来。默认 maxAttempts=3 的用户感知不到变化。
- **R3（低）配额正则误伤**：规则要求余额/配额关键词（`预扣费/余额/insufficient/quota exceeded`），不覆盖 bare `403` / invalid key；用正反对例测试钉住。
- **R4（低）其他引擎审计扩大范围**：E2 默认只记录；仅在确认 identical inversion 时修复并补对应验收，不顺手重构。
