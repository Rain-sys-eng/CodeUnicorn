---
type: research
status: draft
date: 2026-08-21
---

<!-- DOC-LIFECYCLE: research-note -->

# 跨引擎会话分叉 / 树能力调研（session fork & tree）

> 触发：pi RPC 接入设计（`docs/designs/pi-native-features/`）需要回答「分叉树是 pi 专属，还是可推广的原语」。
> 结论先行：**分叉（fork）是可推广的；树（同文件多分支 + 树内跳转 + 分支摘要）目前只有 pi 原生**。Claude 的 JSONL 里存在可推导的 parentUuid 树，但需要 spike 验证。

## 一、证据矩阵（本机 CLI `--help` 实测，2026-08-21）

| 引擎 | 版本/来源 | fork 能力 | resume/continue | 树结构 | 证据（命令面） |
|---|---|---|---|---|---|
| **pi** | 0.84.1 | `--fork <path\|id>`；RPC `fork` / `clone` / `get_fork_messages`；TUI `/fork` `/clone` | `-c` / `-r` / `--session` / `--session-id` | **真树**：JSONL 内 `id/parentId`，单文件多分支；`/tree` 全屏跳转；切分支自动生成 branch summary；RPC `get_tree` / `switch_session` | `pi --help`、`docs/rpc.md`、`docs/sessions.md` |
| **claude** | 本机安装 | `--fork-session`（resume/continue 时新建 session id） | `-c` / `--resume` / `--from-pr` | 文件内 `parentUuid` 链（含 sidechain），**可推导树**；双 Esc rewind（mossx 已有 `ClaudeRewindConfirmDialog`） | `claude --help` |
| **codex** | 本机安装 | `codex fork` 子命令（picker / `--last`） | `codex resume`（picker / `--last`）；archive/delete/unarchive | 未见（rollout 线性） | `codex --help` |
| **grok** | 本机安装 | `--fork-session`（同 claude 语义，可配 `--session-id`） | `-c` / `-r`（支持按 title 匹配） | 未见 | `grok --help` |
| **opencode** | 本机安装 | `--fork`（与 `--continue` / `--session` 联用） | `-c` / `-s`；`export` / `import` | 未见 | `opencode --help` |
| **gemini** | 本机安装 | ❌ 无 | `--resume`（latest/序号）/ `--list-sessions` / `--delete-session` | 无（checkpoint 是工作区文件恢复，非会话分支） | `gemini --help` |
| **kimi** | 本机安装 | ❌ 无 | `-S` / `-c`；`export`（ZIP）；`vis`（浏览器会话可视化器） | 无（vis 是回放，不是分叉树） | `kimi --help` |
| **dsh** | host 侧 | capability matrix 已标 `session.fork = supported` | supported | matrix `session.tree = unknown` | `capability_matrix.generated.rs` |

## 二、磁盘格式层实测（fork-from-任意消息 的可行性判定依据）

| 引擎 | 会话存储 | parent 链 | 「从第 N 条分叉」可行性 |
|---|---|---|---|
| pi | `~/.pi/agent/sessions/<cwd>/<ts>_<uuid>.jsonl` | **每条 entry 带 `id`/`parentId`**（含 `model_change`/`thinking_level_change` 等元数据 entry） | ✅ 原生（`fork`/`get_fork_messages`） |
| claude | `~/.claude/projects/<cwd>/<uuid>.jsonl` | **每条 entry 带 `uuid`/`parentUuid` + `isSidechain`**（实测确认） | ⚠️ 可推导渲染树；CLI 只有 `--fork-session` 整会话复制；「从第 N 条」要么走双 Esc rewind（原生通路，mossx 已接 `ClaudeRewindConfirmDialog`），要么自写截断 JSONL（越权改 CLI 存储，不建议） |
| codex | `~/.codex/sessions/yyyy/MM/dd/rollout-*.jsonl` | 无 parent；按 `turn_id` 线性 | ⚠️ 仅 `codex fork` 整会话复制；turn 级截断需自改 rollout（不建议） |
| opencode | `~/.local/share/opencode/opencode.db`（SQLite） | `session.parent_id` 存在（本机 52 条会话中 44 条有 parent——多为 subagent 派生）；`message` 无 parent | ⚠️ 仅 `--fork` 整会话复制；session 级谱系天然存在（parent_id 可直接当 lineage 用） |
| grok | `~/.grok`（未深挖） | 未确认 | ⚠️ 仅 `--fork-session` 整会话复制 |
| kimi | `~/.kimi/`（`active_sessions.json` + 文件） | 未确认；有 `kimi vis` 浏览器可视化器 | ❌ 无 fork；`vis` 值得单独 spike（可能升级为只读树） |
| gemini | — | — | ❌ 无 fork |
| dsh | host 管理 | — | matrix 已标 `session.fork = supported` |

**关键架构判断**：L2 引擎的 CLI fork 全是「整会话复制」，不支持「从第 N 条」。mossx 要做共同分叉，正路不是改各家存储，而是复用 **Shared Session 的 Context Compiler**：把「截至第 N 条的 canonical 历史」编译投影为新会话的首轮上下文（截断投影新 mode）。CLI 原生 fork（整会话）只作为「从末尾分叉」的快路径。

## 三、能力分级模型

```
L3 真树      同一会话文件内多分支 + 树内跳转 + 分支摘要
             → 只有 pi（fork/tree/switch/branch summary/compaction checkpoint 一整套）

L2+ 可推导树 历史文件里存在 parent 链，可以渲染树，但 CLI 不提供树操作
             → claude（parentUuid + sidechain；rewind 已是树内「回放到分叉」的产品化）

L2 fork 续跑  分叉 = 复制成新会话继续（原会话冻在分叉点，无树内往返）
             → claude --fork-session / grok --fork-session / codex fork / opencode --fork

L1 线性      只有 resume/continue
             → gemini / kimi
```

## 四、对 mossx 的设计含义

1. **分叉入口不应做成 pi 孤岛**。气泡 hover「⑂ 分叉」对 L2 引擎（claude/grok/codex/opencode）同样成立，语义是「fork 成新会话」；对 pi 语义是「树内新 lane」。同一个 UI 入口，两种后端语义，capability 决定文案（「分叉新会话」 vs 「分叉新分支」）。
2. **会话树 UI 是 pi 专属落点**（方案 1 侧栏树 / 方案 2 全屏树）。Claude 若未来要树，走 L2+ 推导 + 现有 rewind 通路，需要先 spike 验证 parentUuid 完整性，不进本期。
3. **capability matrix 可按本调研刷新**（当前多引擎 `session.fork = unknown`）：
   - `session.fork`：claude / grok / codex / opencode → `supported`（fork-on-resume 语义，需在 spec 注释语义差异）
   - `session.tree`：pi → `supported`；其余保持 `unknown`/`unsupported`
   - 注意 matrix 源是 spec 侧文件（`capability_matrix.rs` 测试引用 `spec_capability_state`），generated 由脚本产出，勿手改 generated。
4. **kimi 的 `vis` 子命令**（浏览器会话可视化器）值得单独 spike——如果它能暴露结构化树/时间线数据，kimi 可从 L1 升级到「只读树」。

## 五、与设计稿的链接

- 选款 gallery：`docs/designs/pi-native-features/index.html`
- 方案 2（全屏树）细节版：`variant-2-fullscreen-tree.html`
- 旧稿（树模型来源）：`mossx/docs/prototypes/pi-ui-prototype/index.html`
- 共同分叉 UX：`docs/designs/pi-native-features/variant-4-common-fork.html`（同一 ⑂ 入口 × L3/L2/L1 三档落地）
