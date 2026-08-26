---
type: plan
status: draft
date: 2026-08-26
related-design: docs/designs/pi-background-tasks/index.html
---

# PI 后台任务体验一体化方案（bg_run 链路三层补齐）

## 一、背景与问题

用户安装 `npm:pi-background-tasks@2.4.2`（`~/.pi/agent/settings.json` packages）后，PI 会话中模型频繁通过 `bg_run` 把任务甩到后台。完整链路：

```text
模型调 bg_run
  → 工具立即返回 receipt（taskId + 输出路径，任务在后台跑）
  → 工具指引要求 agent「结束当前 turn，等通知」
  → pi 发出 agent_settled
  → codemoss pi_rpc.rs：turn settlement = agent_settled（pi_rpc.rs:12）
  → 前端：spinner 停、composer 解锁、会话显示「空闲」   ← 用户感知"停止了"
       …（任务实际还在跑）…
  → 扩展注入 <background-task-notification> 消息
     （registry.ts:2305, customType + deliverAs:'followUp' + triggerTurn）
  → pi 自动开启全新 turn → codemoss 看到一条"凭空出现"的 turn
```

### 三个断点（UI 层割裂）

- **断点 A：turn 状态说谎**。bg_run 一返回 turn 就 settle，UI 显示「已完成/空闲」，逻辑任务未完成。
- **断点 B：后台任务零可视化**。扩展的状态面（footer dock / `ctx.ui.setStatus` / widget / `ctx.ui.notify`，extension.ts:268~313）全是 pi TUI 钩子；codemoss 是 RPC headless host，全部不可达。消息流里只有一张一次性 receipt 工具卡。
- **断点 C：唤醒消息渲染错位**。现有 `BackgroundTaskNotificationFold` 的解析器只认 Claude 的 `<task-notification>`（`src/features/engine-task-output/contracts/agentTaskNotification.ts:10`，正则 `<\s*task-notification\s*>`），不匹配 `<background-task-notification>` → 唤醒通知渲染为裸 user bubble，且新 turn 与原任务卡无视觉关联。

### 健康信号缺失（感受层割裂）

- 运行中无 elapsed / 心跳 / 输出 tail；
- 完成通知依赖扩展 `triggerTurn` 注入，pi resident 退出或扩展崩溃时任务**静默死亡**，用户无从得知；
- 无控制权：扩展的 `/tasks` `/logs` `/kill` 是 TUI slash command，codemoss 不可用。

### 对照资产（已有基建）

| 资产 | 位置 | 复用方式 |
| --- | --- | --- |
| Claude backgroundTaskId settlement blocker（issue #983） | `src-tauri/src/engine/claude.rs:1890~2229` | 语义参照：turn 不提前 settle；pi 侧改为 UI 层等待态 |
| `agentTaskNotification` 契约 + `BackgroundTaskNotificationFold` | `src/features/engine-task-output/`、`src/features/messages/rows/components/` | 扩展解析器认第二种标签 |
| `ComposerRunStatusStrip`（「子代理 2/2」pill + 展开 panel） | `src/features/composer/components/run-status/`、`src/styles/composer-run-status.css` | C 层直接复用：后台任务 pill + 就地展开面板 |
| 扩展持久化 registry | `<cwd>/.pi/tasks/session-<pid>/<taskId>.json` + 输出日志 | B 层数据源 |

## 二、目标与非目标

### 目标

1. 后台任务在 codemoss 消息流里是一等公民：有身份（taskId）、有生命周期（运行中/完成/失败）、有健康信号（elapsed、输出 tail、终态）。
2. turn 状态不说谎：存在未终态后台任务时，会话显示「等待后台任务」而非「空闲」。
3. 唤醒通知正确折叠并与原任务卡关联，新 turn 在视觉上接续原链路。
4. 通知丢失时 UI 不错误等待：registry watch 能发现进程死亡并标记失败。

### 非目标

- 不改变 pi / 扩展的后台执行行为本身（agent 何时用 bg_run 由模型与提示词决定，D 层只做倾向性引导）。
- 不做跨会话/跨工作区的全局任务中心（C 层限会话级面板）。
- 任务取消能力列二期（见 §五-C）。

## 三、方案总览

三层一体，共享同一条数据链，逐层递进：

```text
B 提供数据（.pi/tasks registry watch + 输出日志）
  ↓ 喂给
A 的卡片状态（运行中/完成/失败 + elapsed + tail 预览）
  ↓ 聚合为
C 的 pill + panel（会话级任务列表 + 日志查看 + 取消[二期]）
```

- **A（契约+前端）是骨架**：定义后台任务在消息流与 turn 状态机里的形态。缺它，B 的数据没有渲染载体。
- **B（健康数据源）是血肉**：缺它，A 的状态只能靠"通知到了没有"推断——通知丢失即永远假「运行中」。
- **C（工具条 pill）是出口**：多任务并行、跨 turn 时的聚合视图与干预入口，复用 composer-run-status 既有展开语义。
- **D（提示词层）独立**：降低 agent 甩后台的倾向，减少问题发生频率，不属于本方案交付物但可同期做。

## 四、详细设计

### A1 — 后台任务启动卡

**契约层（Rust）**：`pi.rs` / `pi_rpc.rs` 事件转换时，识别 `bg_run` / `bg_delegate` / `bg_run_pi_attested` / `fusion_*` 工具调用，从 tool result receipt JSON 提取 `taskId`、`name`、`outputPath`、`timeoutSeconds`，产出新的 canonical item kind（如 `backgroundTask`），而不是泛化工具卡。

- 工具名单做成常量表 + 单测，不硬编码在转换逻辑里。
- receipt 解析失败时降级为普通工具卡（不阻塞消息流）。

**前端**：新组件 `BackgroundTaskCard`（`src/features/messages/rows/components/`）：

- header：任务图标 + `name` + 状态 badge（运行中/已完成/失败/已取消）+ elapsed 计时；
- body（运行中）：输出 tail 预览（最近 3 行，monospace，自动滚底）；
- footer：taskId（截断）+ 心跳文案「最后输出 N 秒前」+ 操作（查看日志 / 取消[二期]）；
- **终态自动原地折叠**（对齐 0.9.0「Auto-fold completed terminal groups」既有行为）：任务到达终态后活体卡原地换成 fold 行（状态 pill + 名称 + 耗时/exit code），chevron 可重展开看末屏日志与 kv；不再长期占一块展开面积。

**Render Perf 红线对照**：elapsed 计时与 tail 刷新必须挂在卡片组件本地 state（组件级 `setInterval`/事件订阅），**禁止进根 hook 链 / 根 store**；tail 更新由 B 层事件驱动，无秒级轮询根链。

### A2 — 唤醒通知消费（不单列时间线行）

- `agentTaskNotification.ts` 解析器扩展：增加 `<background-task-notification>` 标签识别（与 `<task-notification>` 并存，注意正则边界，避免误吞普通 XML 散文——延续 0.3.12 的边界硬化原则）。
- 通知**不渲染为裸 user bubble、不单列时间线行**（A1 任务卡已是活的载体，再出一张折叠卡就是重复信息）。它被消费为三件事：① 按 `taskId` 定位 A1 卡并驱动其原地折叠；② 写入终态摘要（耗时 / exit code）；③ 触发 followUp turn，后续 assistant 消息天然承载时间线上的「接续点」语义。
- 该通知**不作为 turn 边界的用户提问**处理（对齐 Claude wakeup 语义：0.9.0 已修「wakeup 不是 shadow-recovery turn 边界」）。
- `isCliInjectedAgentTaskNotificationText` 同步覆盖新标签；历史重载时任务卡直接以折叠态回放（对齐「history replay starts folded」）。

### A3 — turn 等待态

- 会话/turn 状态机新增「等待后台任务」语义：本 turn 出现 ≥1 个未终态 `backgroundTask` item 时，`agent_settled` 后 UI **不显示空闲**，显示状态条：「⏳ 等待后台任务 · N 个运行中——可继续发消息，完成后自动继续」。
- composer **保持可用**（pi RPC 支持 `streamingBehavior: steer/followUp`，等待期发消息合法），仅状态条提示。
- 等待态的进入/退出由 task 终态事件驱动（B 层或 A2 通知），不引入轮询。
- 与 Claude WaitBgTasks 的差异：Claude 是引擎层阻塞 settle；PI 是 turn 照常 settle、UI 层表达等待。**不动 pi 行为**。

### B — registry watch 健康数据源

- 数据源：`<cwd>/.pi/tasks/session-<pid>-<pid>/<taskId>.json`（metadata）+ 同目录输出日志。目录按 pi resident pid 分段，需与当前会话绑定的 resident 匹配；匹配不到（如会话来自另一 pid）时降级为「仅通知驱动」并标注。
- Rust 侧新增 watcher（`notify` crate 或既有 fs watch 基建）：metadata JSON 的 status/exitCode/updatedAt 变更 → 封装为 canonical event 推前端；输出日志 tail 按需读取（不整文件推送，延续 tool-output byte budget 原则）。
- 断链检测：metadata 长时间无更新且对应进程已退出、且未收到完成通知 → 任务标「异常终止（未收到通知）」，消除假「运行中」。
- 纯增量能力：A1/A2 先上时卡片状态由通知驱动；B 上线后无缝切换为 registry 驱动 + 通知兜底。

### C — 后台任务工具条 pill（复用 composer-run-status）

- 形态：**复用真实 `composer-run-status` 工具条**（「子代理 2/2」同款 pill）：composer 上方出现「后台任务 N 个运行中」pill，running 时带 live dot；点击就地展开 panel（真实 `composer-run-status-panel` 槽位），列出任务分组（运行中/已完成/失败）、点任务展开日志（读输出文件，等价扩展 `/logs`）。不做右侧独立面板、不做模态对话框。
- 与 A3 合并：等待态不再是独立状态条，pill 本身就是「等待后台任务」的表达；turn settle 后 pill 持续存在直到任务全部终态。
- 入口冗余：顶栏「后台任务 (N)」按钮与任务卡「查看日志」均聚焦到该 pill 并展开 panel。
- 二期干预：panel 任务行上加取消按钮。两条路径——① codemoss 直接 kill 进程树（需处理 Unix killpg / Windows taskkill 差异，参照扩展自带 `windows-taskkill.ts` 与 claude.rs grace tree-kill 经验）；② 等扩展暴露 RPC 控制面。拍板前默认不做。
- AppShell Gate 对照：panel 展开状态复用 composer-run-status 既有状态通道；若新增 shell 状态，必须有 owner domain（写 `APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS`），禁止无主塞 bag。

### D — 提示词层（独立，零代码）

在 pi 的全局/项目 `AGENTS.md` 增加引导：「codemoss host 下优先前台执行；仅预计 >N 分钟或明确需并行的任务用 bg_run」。随时可做，不阻塞本方案。

## 五、待验证点（实施前 spike）

1. **customType 透出**：pi RPC 模式下扩展注入的 followUp 消息，host 端事件是否携带 `customType: 'background-task-notification'` 字段（`pi.rs` 目前未处理 customType）。决定 A2 从事件层还是文本层解析。验证方法：起 RPC resident，触发一次 bg_run 完成，dump 原始事件流。
2. **历史重载形态**：重开会话时 notification 消息在 pi: 历史里的持久化形态（纯文本 or 结构化），A2 的折叠在历史链路是否同样生效。
3. **registry 目录与 resident pid 的对应关系**：`session-<pid>-<pid>` 两个 pid 段的语义，以及会话恢复（resume 旧 session）时新 resident 能否读到旧 pid 目录的任务。

## 六、风险与红线对照

| 红线/Gate | 对照 |
| --- | --- |
| Render Perf Baseline | elapsed/tail 全部组件本地 state + 事件驱动；禁止高频 setState 入根链；禁止秒级轮询 |
| AppShell Structure Gate | 面板状态进 shell 必先登记 owner domain |
| Engine Onboarding / ADR 校准 Gate | 本方案变更 pi engine 事件契约（新增 backgroundTask item kind），收口前需校准 `docs/research/mossx-multi-cli-provider-session-foundation-design.md`「零、当前实现校准」表 |
| Merge Guardrails | `agentTaskNotification.ts`、`Messages` 渲染管线是高 fan-out 文件，冲突时按 capability matrix semantic merge |
| 引擎行为中立 | 不 patch pi、不 patch 扩展；全部改动在 codemoss 侧，扩展升级不破坏（标签/receipt 格式变化时降级为现状体验） |

## 七、分期与验收

| 期 | 内容 | 验收 |
| --- | --- | --- |
| P1 | A2 通知消费 + A1 启动卡（通知驱动状态，终态原地折叠） | pi 会话 bg_run：通知不再裸 bubble；任务卡运行中→完成自动折叠；历史重载直接折叠态 |
| P2 | B registry watch + 断链检测 | 杀掉后台任务进程（不发通知）后 UI 标记失败而非永远运行中；elapsed/tail 实时 |
| P3 | A3 turn 等待态 | bg 任务未终态时 settle 后显示等待条；composer 可发消息（followUp） |
| P4 | C 工具条 pill 只读面板 | pill 常驻 composer 上方，展开列出会话全部后台任务，可看日志、可跳卡片 |
| P5 | C 取消能力（需拍板路径） | 待定 |

每期独立可 ship，P1 即可消除最刺眼的断裂。

## 八、OpenSpec 拆分建议

本方案涉及 pi engine behavior 与跨层 contract 变更，按仓库规矩实施前先建 OpenSpec change：

- 建议 change id：`pi-background-task-experience`
- spec delta 落点：pi engine 事件契约（新 backgroundTask item kind）、消息渲染（通知消费 / 终态原地折叠）、composer run-status（后台任务 pill）
- 设计稿对照：`docs/designs/pi-background-tasks/index.html`
