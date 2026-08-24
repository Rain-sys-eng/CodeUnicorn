# pi-session-fork-tree Specification

## Purpose

定义 PI 会话的 fork（fork-to-new-file）与只读会话树投影契约：气泡分叉入口、中间对话区「上下右」dock 树面板、tab 分支 chip、侧栏 ⑂N 徽标、run-status 会话树 pill。所有交互 MUST 诚实反映 RPC 实际语义，不假装 upstream 不存在的能力（树内 leaf 移动）。

## Requirements

## ADDED Requirements

### Requirement: 气泡分叉 MUST 明说 fork-to-new-file 语义

系统 MUST 为 pi user 消息提供分叉入口，且分叉确认弹窗 MUST 如实描述「创建新会话文件」语义，禁止宣称树内 lane。

#### Scenario: user 气泡出现 pi-only 分叉入口

- **WHEN** 当前 thread 引擎为 pi 且消息为 user 角色
- **THEN** 气泡 action bar MUST 渲染 `⑂` 分叉按钮
- **AND** 非 pi 引擎 MUST NOT 渲染该按钮

#### Scenario: 分叉确认弹窗文案诚实

- **WHEN** 用户点击 `⑂`
- **THEN** 弹窗 MUST 引用源消息文本
- **AND** MUST 明说「将从该消息创建新会话文件，源会话保留在历史中」
- **AND** MUST NOT 使用「树内新分支/lane」文案

#### Scenario: fork 成功源会话不受污染

- **WHEN** `pi_fork` 成功返回
- **THEN** Rust MUST 在 fork 后立即 `switch_session` 切回源会话文件（fork-then-switch-back）
- **AND** 源 thread 后续发送 MUST 落回源会话文件（关联不漂移）
- **AND** fork 返回的源文本 MUST 填入<b>新会话</b>（`pi:<forkedSessionId>`）的 composer 草稿；拿不到 forkedSessionId 时退化当前 thread
- **AND** fork 成功后 MUST 自动跳转到分叉会话幕布（`requestPiThreadJump`，草稿已在新会话输入框）；跳转因索引延迟未生效时弹窗 MUST 保留成功确认态告知去向
- **AND** 弹窗文案 MUST 明说「源会话保持不动，新分支出现在会话树面板（不占侧栏）」

#### Scenario: fork 派生会话 MUST NOT 出现在侧栏

- **WHEN** pi 会话文件头含 `parentSession`（fork/clone 派生）
- **THEN** 侧栏 MUST NOT 将派生会话渲染为顶层行或嵌套行（`useThreadRows` 过滤；thread 本体保留在 store 供跳转选择）
- **AND** 派生血缘 MUST 在两条侧栏数据通道上都成立：session-index 行与 live disk list（`list_pi_sessions` → `normalizePiSessionSummaries`）都 MUST 携带 `parentSessionId` → `parentThreadId`（缺任一通道，index 快照后新建的派生会话会泄漏成顶层行）
- **AND** live 窗口（fork 跳转 / `thread/started` 新建的分支行，`parentThreadId` 尚未就位）MUST 经内存级派生登记即时隐藏：fork 成功时与树投影加载时（lane>0 的 laneSessionIds）登记，`useThreadRows` 过滤时与 parentThreadId 并列查询（进程内存级，重启后由上述双通道接管）
- **AND** 内存派生登记 MUST 防误伤主线：① fork 返回的 `forkedSessionId` 等于源 sessionId 或 fork 前后 sessionFile 未变（静默 no-op）时 MUST NOT 登记/跳转（Rust `resolve_pi_forked_session_id` 返回 null）；② 树投影登记 MUST 跳过 `rootSessionId`（主线 root 永远可见）；③ index 行 / pi 磁盘 list 等权威通道证明某 session 无 `parentSessionId` 时 MUST 立即将其移出内存派生集合（`reconcilePiDerivedHideWithAuthoritativeRows` 自愈，不等重启）
- **AND** 侧栏 session-index 分页 MUST NOT 让派生行占槽位：per-engine 首页预算、keyset「更多」页与 hasMore 基数都在 SQL 层排除 `engine='pi' AND parent_session_id 非空` 的行（`for_sidebar=true`；GC/会话管理等全量读路径不受影响）——否则 fork 密集工作区里每页 5 槽大半被渲染层必藏的 fork 吃掉，main 永远进不了可见窗口（2026-08-24 ai-reach 取证：首页 5 槽 3 fork，7 个 main 全丢）
- **AND** 已泄漏的 live 行 MUST 在下轮 list 刷新时经 merge backfill 补回 parent 并重新隐藏
- **AND** 派生会话 MUST NOT 使用 subagent 嵌套视觉、MUST NOT 计入子代理数（`collectCanvasChildSubagentThreads` / `Composer.stripChildThreads` / `useStatusPanelData.seedSubagentsFromChildTree` 三处分域）
- **AND** 分支线路 MUST 由会话树面板统一控制

#### Scenario: 会话树 MUST 为中间对话区右侧 dock

- **WHEN** 当前 thread 为 native pi 会话且用户打开会话树
- **THEN** 树 MUST 以「上（幕布）下（composer）｜ 右（树）」布局 dock 在中间对话区（pi 独立容器 `PiConversationTreeSplit`，不复用不改动 subAgent ConversationInspectorSplit / ConversationHost 任何逻辑）
- **AND** 树 MUST NOT 渲染在右侧文件/Git tab 面板
- **AND** dock 宽度 MUST 支持左右拖拽调整并持久化

#### Scenario: 会话树 MUST 展示会话族全图且主线贯穿

- **WHEN** 查看源会话或跳入任一 fork 派生分支后打开会话树
- **THEN** 树 MUST 展示会话族全图：root 主线 + 所有派生 lane（`parentSession` 链解析；当前文件是分支时主线 MUST 以 rootEntries 磁盘解析为基底，禁止被分支自身子树顶替）
- **AND** lane 语义 MUST 为「首个 child 延续主线」——主线贯穿分叉点不断裂，分支从旁路长出
- **AND** 树 MUST 以 lane 分列的「一棵大树」呈现：当前激活路径实体展示、其余虚化；分叉点经「自 #entryId」一一对应
- **AND** lane 0（主线）与每条派生 lane MUST 都提供「↪ 跳转」（来回跳转）；文件内 lane 诚实禁用

#### Scenario: 面板 MUST 在树内跳转后保持打开

- **WHEN** 用户经「↪ 跳转」在会话族内切换到另一 lane
- **THEN** 会话树面板 MUST 保持打开（开态按 workspace + pi 判定，不按精确 thread）
- **AND** 面板 MUST 按新当前 thread 刷新，族全图持续可见

#### Scenario: 派生 lane MUST 支持树内跳转

- **WHEN** 用户点击 fork 派生 lane 的「↪ 跳转」
- **THEN** 系统 MUST 经既有 onSelectThread 流程切换到 `pi:<lane-session-id>`（历史加载与后续发送经 resident 对齐自动落到该会话文件；panel 无布局上下文时经 store 跳转请求中转）
- **AND** 文件内 lane（RPC 无 leaf-move 命令）MUST 以禁用态表达，tooltip 诚实说明

#### Scenario: turn 进行中禁止 fork

- **WHEN** RPC 会话存在未 settle 的 agent run
- **THEN** `pi_fork` MUST 返回明确错误（「请等待完成或先停止」）
- **AND** MUST NOT 在流式中切换会话文件

### Requirement: 会话树 MUST 为只读地图

系统 MUST 将 pi 会话树渲染为只读导航地图，节点操作仅限 fork；禁止提供 RPC 不支持的树内 leaf 移动交互。

#### Scenario: 会话树 dock 渲染

- **WHEN** 用户打开会话树
- **THEN** 系统 MUST 以中间对话区「上下右」dock 渲染（`PiConversationTreeSplit`，幕布列保持可见可交互，宽度可拖拽并持久化）
- **AND** MUST 经 `pi_get_session_tree` 渲染 lanes、当前 leaf 高亮、label 书签
- **AND** 非 message 元数据条目（model_change / sidechain / 工具结果等）MUST NOT 渲染；一个 turn 的多条 assistant 条目 MUST 只显示首条有文本的；行序 MUST 按时间线排列（分叉从发起点往下画）
- **AND** 当前叶→根的整条激活路径 MUST 跨 lane 贯通染色（每条 lane 首个~末个 on-path 节点间的轨道/圆点 + 两端都在路径上的分叉曲线，染激活 lane 色）；路径外分支 MUST 置灰（选中哪条亮哪条）
- **AND** turn 结束（`onTurnCompleted`）时 MUST 自动刷新打开中的树面板（按 workspace+thread 过滤；面板未挂载不刷，打开时 mount 刷新兜底）

#### Scenario: 树上操作仅限 fork

- **WHEN** 用户与树上节点交互
- **THEN** user 消息节点 MUST 提供 `⑂ 分叉` 操作（同气泡分叉语义）
- **AND** 系统 MUST NOT 提供「跳转到该节点继续」交互（RPC 无 leaf-move 命令）
- **AND** 非 user 节点 MUST NOT 提供操作

#### Scenario: 树入口

- **WHEN** 当前 thread 引擎为 pi
- **THEN** run-status 条 MUST 提供「会话树」pill（`ComposerRunStatusStrip.piTree`，与 todo/subagent/plan/edit 平级，点击 toggle dock 开态）
- **AND** tab 分支 chip / 侧栏 ⑂N 徽标点击 MUST 打开同一 dock（统一 `openPiTreeOverlay` 开态源）
- **AND** 非 pi 引擎与 Shared 会话 MUST NOT 渲染这些入口

### Requirement: 分支 chip 与侧栏徽标 MUST 共享树数据

tab 分支 chip、侧栏 ⑂N 徽标与会话树 overlay MUST 读取同一份树数据 store，且 chip/徽标仅在 lane 数大于 1 时渲染。

#### Scenario: tab 分支 chip

- **WHEN** 当前 pi 会话树存在超过 1 条 lane
- **THEN** topbar tab MUST 渲染当前 lane chip（如 `main ▾`）
- **AND** 点击 MUST 打开会话树分屏面板
- **AND** MUST NOT 提供 lane 切换下拉（RPC 无切换命令）
- **WHEN** 会话仅 1 条 lane
- **THEN** chip MUST NOT 渲染

#### Scenario: 侧栏 ⑂N 徽标

- **WHEN** pi thread 的会话树存在超过 1 条 lane
- **THEN** 侧栏会话行 MUST 渲染 `⑂ N` 徽标
- **AND** 点击 MUST 打开会话树分屏面板

#### Scenario: 数据一致性

- **WHEN** fork / 树操作改变了会话树
- **THEN** chip、徽标、overlay 三处 MUST 从同一 store 读取并同步刷新

### Requirement: 状态归属 MUST 不进 AppShell domain bag

pi-session 增强的全部 UI 状态 MUST 归属 feature-local store，禁止新增 AppShell domain bag key，禁止高频事件驱动根链 setState。

#### Scenario: feature-local store

- **WHEN** 实现树 / chip / 徽标 / compact 状态
- **THEN** 状态 MUST 归属 `src/features/pi-session/` 的 feature-local store（keyed by threadId）
- **AND** MUST NOT 新增 AppShell domain bag key（AppShell Structure Gate）
- **AND** 高频事件 MUST NOT 驱动根链 setState（Render Perf 红线）
