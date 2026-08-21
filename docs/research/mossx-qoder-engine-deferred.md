---
type: research
status: active
---

<!-- DOC-LIFECYCLE: active-follow-up-record -->
> [!NOTE]
> **Lifecycle: Follow-up record, not a product contract.** 行为事实源仍是 OpenSpec `add-qoder-engine` 与代码。本文只记录 **刻意后置** 的能力，防止后人把缺口当成漏接。

# Qoder 引擎后置项（Deferred Record）

> 日期：2026-08-22
> 关联：OpenSpec `openspec/changes/add-qoder-engine/`
> Spike：[`mossx-qoder-capability-spike.md`](./mossx-qoder-capability-spike.md)
> 接入档位：**L1 Native**（`acp-stdio`，spawn-per-turn + `session/resume`）；**不进 Shared**

本 change 把 Qoder CLI 接到 Native 对话 / 历史 / Settings / vendor。下列条目 **不是漏点**，是 Spike 证据不足或产品边界明确后置。新 change 再开，不要在本接入面顺手做满。

---

## 1. 必须有真实成功 turn 才能升级

本机 Spike（qodercli 1.1.27）账号 `logged_in: true`，但模型 API 返回 `Network attempt failed at unknown`。因此下列矩阵格保持 `unknown`，adapter 按 ACP 词汇实现、到达才归一：

| 项 | 现状 | 升级条件 |
|----|------|----------|
| `streaming.reasoning` | unknown | live 观测 `agent_thought_chunk` |
| `streaming.tool-output` | unknown | live 观测 `tool_call` / `tool_call_update` |
| `input.mid-turn` | unknown | 实测 `_meta.qoder.promptQueueing` |
| `session.fork` | unknown（仅 initialize 声明，未 live） | 实测 `session/fork` 或 CLI `--fork-session` |
| usage / token 卡 | 通用 token 路径；无专属 Qoder usage 卡 | ACP usage 字段 live 到达 |
| `session/cancel` → `stopReason: cancelled` | 代码按词汇实现 | 成功 turn 上打断一次 |

幕布五件套目视（streaming 光标 / reasoning 折叠 / tool 块 / usage 收尾 / 历史与 live 一致）同样 blocked，harness：`docs/research/spikes/harness/qoder-acp/probes/probe6_golden_turn.py`。

---

## 2. Shared / L3 / 产品化后置

| 项 | 为什么现在不做 | 再开条件 |
|----|----------------|----------|
| Shared 资格 | pendingProbe / 成功 terminal / cancel 未完整实测；picker disabled + write gate fail-closed | 黄金 turn 证明 ACK/terminal 后独立 change 评估 |
| L3 NativeHistoryReader / Provider Continuation | `session/load` 回放通道已验证，但不是 Continuation 契约 | 独立 change；禁止把 Native resume 借给 Shared recovery |
| `session/request_permission` → elicitation 卡 | v1 = `bypassPermissions` + auto-approve，防 headless 挂死 | 产品化问用户时走统一 `RequestUserInputMessage`，禁止 per-engine 弹层 |
| 斜杠目录（`available_commands_update`） | v1 不在 mossx 斜杠 UI 暴露 | 需要 slash picker 时再接 |
| `qodercli commit` / CommitMessageEngine | 与 DSH 同：排除 | 需要 commit 助手时再评估 |
| CN 版 `qoderclicn` | 不同 binary / 账号体系 | 单独 Spike，禁止复用 `qodercli` detect |
| 远程会话 `--remote` / `--teleport` | 非 L1 范围 | 独立 change |
| SDK 面 / 插件 / skills / hooks 管理 | 非对话主路径 | 不进本引擎接入 |

---

## 3. 本 change 已修、不再当后置

以下曾在 review 中列为 P0/P1，**已在 2026-08-22 补齐**，不要再记成缺口：

- daemon `engine_bridge.rs` 影子 include `qoder_auth`（PAT 注入 / doctor 登录判定）
- `is_codex_thread_id` 排除 `qoder:` / `qoder-pending-`（禁止误走 Codex compact）
- `session.fork` 从乐观 `supported` 降为 `unknown`
- Shared **写路径** `assertSharedSessionWriteEngine`（qoder 不再被 normalize 成 claude 后落盘）；canonical validator 不再把 qoder 当合法 Shared engine；`is_legacy_local_provider(Qoder)=false`
- `executable_name()` = `qodercli`（engine id 仍是 `qoder`）
- `detect_preferred_engine` 优先级：DSH 先于 Qoder，避免 PATH 双安装时抢走 DSH 默认
- 10 语言 `qoderUnsupported` + `qoderAuth`

`normalizeSharedSessionEngine("qoder") === "claude"` **仍保留** 给历史 snapshot 读路径（Gemini/DSH 同套路）。新写入必须走 `assertSharedSessionWriteEngine`。

---

## 4. 预存、与 Qoder 无关（不要在本 change 顺手修）

- daemon `parse_engine_type_string` 缺 `"pi"` 臂
- daemon `EngineFeatures::pi().reasoning_effort` 与主 crate 不一致
- `MessagesCore` process 白名单原本就不含 opencode/pi
- AppShell `workspaceNavigationContext` hard = 79 贴顶（`qoderDoctor` 已入账；再加 key 必须先出后进）
- 生成 locale 除 en/zh 外由 `scripts/i18n/build-locale.ts` 维护；onboarding 命名空间目前只有 en/zh 源文件

---

## 5. 再开 change 时的最小入口

1. 有可用 Qoder 模型 API 的环境跑 probe6 黄金 turn。
2. 把矩阵 `unknown` 格升为实测值，并回写基石设计「零、当前实现校准」。
3. Shared 资格另开 change：先 Spike ACK/terminal/cancel，再改双集合；禁止只把 qoder 加进 Set。
4. elicitation 走现有 user-input 卡，不新造 Qoder 弹层。
