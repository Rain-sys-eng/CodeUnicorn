---
type: analysis
status: active
date: 2026-08-25
---

# PI 能力差距（v3）：客户端真正缺什么，而不是协议还剩什么

> 日期:2026-08-25（v3 推翻 v1/v2 的「按 RPC 清单做功能」）
> 校准:pi@0.84.3 × mossx 代码事实（pi.rs / engineMessageDelivery / skills.rs /
> UserInputQuestionCard / liveItemDeltaChannel / message-queue）
> 性质:产品缺口规划。**不再**把「pi 协议有、mossx 没调」当成缺口。
>
> **v1/v2 作废口径**:`docs/designs/pi-rpc-parity/` 四批 HTML 是按 RPC 清单画的
> 形态稿，**不得当实施计划**。本文件 §一 说明为什么那四批是错的。

---

## 〇、一句话

mossx 接 PI，会话主路径已经能用：长驻 RPC、发消息、steer、树/分叉/压缩、
thinking、图、auth.json、models.json。v1/v2 列的 F1–F15 里，**绝大部分不是
「客户端缺这个功能」，而是「PI 还有一个同名 RPC 没调」**——客户端已经用自己
的队列、提问卡、重试、slash 面板、终端把同类事情做了。

真正要规划的只有两类：

1. **产品决策**（做不做，不是怎么画 UI）：PI 工具要不要权限闸；要不要 PI 扩展生态。
2. **小缺口 / 诚实性**（半天～两天，没有新界面）：技能目录漏扫、capability 撒谎、
   死控件露出、thinking 档位硬编码。

---

## 一、你点的四条，对照代码的结论

### batch-2「扩展对话框」——系统已经有提问卡，不该再推荐做一套

事实：

- Claude AskUser 走 `EngineEvent::RequestUserInput` →
  `UserInputQuestionCard`（`request-user-input.css`），DSH 也接了。
- PI **不会发 AskUser**。PI 的交互协议是 `extension_ui_request`，
  `pi_rpc.rs:202` 一律 `cancelled: true`（v1 刻意 headless）。
- 所以「缺对话框 UI」是假命题。真问题只有一句：**要不要让 PI 扩展能问用户**。
  若要，是把 `extension_ui_request` 翻译成现有 `RequestUserInput` 事件
  （纯接线）；若不要，维持 auto-cancel，**不要立项、不要画稿**。

默认建议：**不做**。mossx 没有 PI packages 管理，用户也不靠 PI 扩展过日子。
为未启用的生态画四类对话框，就是空转。

### batch-1「流式工具输出 / 重试条 / 动态档位」——前两项不该当功能做

**F2 tool_execution_update**

- 工具卡 live 通道已经存在：`liveItemDeltaChannel` +
  `ToolBlockRenderer` 订阅 `toolOutput` lane（perf flag 默认开）。
- PI 现在只接 `tool_execution_start/end`。补 `tool_execution_update`
  就是把 bash 实时块灌进这条通道。
- 你的判断对：这是性能项目，不是功能。仓库硬红线就是禁高频 setState、
  禁数组追加打根。即便走 live channel，bash 全量快照替换仍然可能打爆
  WebView。**不作为 PI 增强立项。** 若以后要做，单独开 perf spike
  （必须 coalesce，必须过渲染归因），不是 OpenSpec「功能」。

capability 现状：`streaming.tool-output = supported`（generated matrix），
但 PI 并没有 live tool 流——**矩阵在撒谎**。正确动作是改成 `partial` /
把口径改成「有工具卡片，无实时输出」，而不是为了圆这个 supported 去接事件。

**F5 auto_retry**

- Shared 层 `useSharedProviderRetry` 已经有倒计时 / 立即再试 / 熔断。
- PI 内部 `auto_retry_*` 是另一套。接事件做状态条 = 两层重试叠在一起。
- **不接。** 真要可见性，先核实 PI native 会话会不会进 Shared retry；
  进了就够用，没进再单独说，不要新 UI。

**F4 thinking 档位**

- 选择器 UI 现成。缺口只是 `pi.rs:30` 硬编码七档。
- 这是 **半小时纠错**，不是批次一主题。顺手修，不要设计稿。

### batch-3「队列 / 融合」——就是现在这套，不是新能力

事实：

- 前端 `MessageQueue`（融合 / 删除 / pending-ack）是跨引擎的。
- `engineMessageDelivery.ts` 已有 `prompt | steer | followUp | nextTurn`。
- PI `input.mid-turn = supported`；`useQueuedSend.ts:842` 写明
  「pi RPC steer 原生支持 same-run steer」。
- 后端 `pi.rs:1068` idle → `prompt`，streaming → `steer`。已经在跑。

用户在 PI 回合中再发一条，走的就是现有队列 + steer/融合。PI 的
`follow_up` RPC 只是把队列从 mossx 挪到 PI 进程里，**用户感知不变**。
**不要接 follow_up，不要新通道标，不要第三档发送方式。**

`!bash` RPC 同理：终端面板已在，独占价值只有「输出进 LLM 上下文」。
不是缺口，是 P2 边角，按需再说。

### batch-4 设置面——抽象，而且多半不该做

- PI 设置页已有：`PiProviderAuthSection`（API key）、`models.json` 编辑。
- 自动压缩 / 自动重试开关：PI 默认就自动压缩、自动重试。给开关是运营项，
  没有用户在要。
- `PI_CACHE_RETENTION`：一个 env，不值得一页设置。
- pi packages 管理：mossx 已有 `extensions/` + `curated-skills/` +
  `skills/`。两套生态先有产品决策才能做面板；现在没有这个决策。
- OAuth 引导：有订阅用户痛点再做一行 copy，不是批次。

**batch-4 整批撤销。**

---

## 二、PI 在客户端已经有的（不要再当缺口）

| 能力 | 事实 |
|---|---|
| 长驻 RPC 发消息 / 图 / @file | `pi --mode rpc` 主路径 |
| 回合中插话 | steer 已接；`input.mid-turn=supported` |
| 队列 + 融合 + 删除 | 跨引擎 `MessageQueue` |
| 会话树 / 分叉 / 压缩 / 统计 | `src/features/pi-session/` 已上线 |
| thinking 选择器 | 现成；档位列表硬编码是 bug 不是缺 UI |
| 提问卡 / 审批卡 | Claude/DSH 的 `UserInputQuestionCard`；PI 不用 AskUser |
| 供应商失败重试 | Shared provider retry |
| 工具卡 + live 通道 | `bash-panel` + `liveItemDeltaChannel`（PI 未灌流） |
| slash 面板 | builtin + `CustomCommandOption` + `useCustomCommands` |
| 技能发现 | `.agents/skills`、`.claude/skills`、`.codex/skills`、全局 agents/claude |
| 终端面板 | `TerminalDock` |
| PI API key / models.json | `pi_auth.rs` / `pi_models_config.rs` + 设置页 |
| rewind/checkpoint | Claude-only，与 PI 树/分叉不同源，不构成 PI 缺口 |

---

## 三、客户端真正缺的（按「用户是否感觉到」排）

### P0 产品决策（先拍板，再谈代码）

#### D1. PI 工具要不要权限闸

Claude 有文件/命令审批；PI 哲学是不弹窗，工具直接跑。mossx 里 PI 的
bash/write **没有确认**。这是唯一一个用户能直接感到的安全差异。

选项：

- **接受 PI 哲学**（默认）：文档化「PI 无审批」，不要做假权限 UI。
- **mossx 自己拦**：在 `tool_execution_start` 拦一层，走现有审批卡。
  这是 mossx 行为，不是 PI RPC。工作量大，且和 PI「无弹窗」打架
  （拦了 PI 会当工具失败）。**没明确安全需求不要做。**

#### D2. 要不要 PI 扩展生态

`extension_ui_request` auto-cancel 卡死的是 **PI 扩展**（权限闸扩展、
Q&A 扩展、第三方 pi package）。mossx 现在没有 PI package 安装面，
也没有把 `~/.pi/agent/extensions` 当一等公民。

**没这个产品方向就维持 auto-cancel。** 有方向时：翻译到现有
`RequestUserInput`，零新 UI。

### P1 诚实性 / 小缺口（值得做，但不是「功能批次」）

#### G1. capability 撒谎 + 死控件露出

- `streaming.tool-output = supported`，PI 没有 live tool 流。
  改成 `partial` 或文档口径改成「有工具结束态、无实时输出」。
- composer 规划模式开关在 PI 上可见但 `disabled`
  （`collaboration.mode = unsupported`）。应 **直接不渲染**，不要摆一个灰开关。

这两条是 hygiene，用户会觉得「这个引擎怎么半残」。

#### G2. PI 技能/模板目录没进 mossx 发现

`src-tauri/src/skills.rs` 扫了 claude / codex / agents / gemini，
**没有** `~/.pi/agent/skills`、`.pi/skills`、`.pi/prompts`。

PI 进程自己会加载这些目录（用户在 TUI 里 `/skill:x` 可用），但 mossx
slash 面板列不出来。合进现有 `getSkillsList` / `CustomCommandOption`
槽即可，**不要新面板**。

#### G3. thinking 档位硬编码

`get_available_thinking_levels` 在 `set_model` 后刷一次。纯后端。

### P2 可做可不做（没有用户在要就别做）

| 项 | 说明 |
|---|---|
| 会话导出 | **全引擎都没有**。PI `export_html` 只是最便宜实现。应作为 mossx 级「导出会话」，不要标成 PI 特性。没人要就别做。 |
| 会话名写入 PI | mossx 已有标题。要跨端 `pi -r` 同名再 `set_session_name`。 |
| clone | fork 已有。没人说「想原样复制一份」就别做。 |
| PI 订阅 OAuth 引导 | 设置页加三步 copy。有 Claude Pro 走 PI 的用户再做。 |
| `get_entries(since)` | 历史管线内部增强，用户无感。 |

### 明确不做

| 项 | 原因 |
|---|---|
| 新队列 UX / follow_up RPC / 通道标 | 现有队列 + steer 就是这个功能 |
| 新提问对话框 | 现有 AskUser 卡；PI 扩展未产品化 |
| tool_execution_update 当功能 | 性能红线；要做走 perf spike |
| auto_retry 状态条 | Shared retry 已有；禁止双层重试 |
| `!bash` 进 composer | 终端面板已有 |
| pi packages 管理页 | 先有生态战略 |
| 自动压缩/重试/长缓存设置页 | 没有用户需求 |
| cycle_model / get_messages / themes | 重复事实源或 TUI 专属 |

---

## 四、建议实施顺序（若要动代码）

1. **先拍 D1 / D2**（权限闸？扩展生态？）。默认都是否。拍完再往下。
2. **G1 hygiene**（capability 口径 + 隐藏 PI 上的规划模式开关）。
3. **G3 thinking 档位**（顺手）。
4. **G2 PI 技能目录进 slash**（若有人用 `~/.pi/agent/skills`）。
5. 其余全部冻结，除非有真实用户故事。

不要再开「PI RPC 功能批次」这类 change。不要再为未立项的缺口画 HTML。

---

## 五、v1/v2 条目怎么处置

| 原 ID | v3 处置 |
|---|---|
| F1 扩展对话框 | 并入 D2；默认不做 |
| F2 流式工具输出 | 不做功能；capability 改口径（G1） |
| F3 follow_up 队列 | **撤销**。现有队列就是 |
| F4 thinking 档位 | 降为 G3 纠错 |
| F5 auto_retry | **撤销** |
| F6 export_html | P2，mossx 级，非 PI 特性 |
| F7 get_commands 面板 | 降为 G2 数据源，无新 UI |
| F8 会话命名 | P2 |
| F9 clone | P2 |
| F10 get_entries | 冻结 |
| F11 bash RPC | **撤销** |
| F12–F15 设置 | **整批撤销** |

设计稿 `docs/designs/pi-rpc-parity/` 保留作「真壳抽取方法」参考，
**内容不当 backlog**。入口页已标明作废。
