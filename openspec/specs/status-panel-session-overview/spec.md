# status-panel-session-overview Specification

## Purpose

TBD - created by archiving change for `status-panel-session-overview`.
## Requirements
### Requirement: 会话概览额度 target 收集 MUST 按 session kind 分岔

「结果」tab 会话概览的供应商套餐额度查询 target 集合 MUST 按当前活跃会话的 kind 决定：

- **Native session**（`threadKind !== "shared"`）：target 集合 MUST 仅包含当前会话绑定的 engine 与 `providerProfileId`（及当前 model 展示元数据）；MUST NOT 从 conversation history 的 `executionTargetSnapshot` / `engineSource` 收集其它供应商。
- **Shared session**（`threadKind === "shared"`）：target 集合 MAY 从当前 thread conversation items 的 `executionTargetSnapshot`（及必要时 `engineSource`）去重收集，并 MUST 包含当前 fallback binding，以支持多供应商并行额度展示。

#### Scenario: Native 不展示历史其它供应商额度

- **WHEN** 活跃会话为 Native
- **AND** conversation items 中存在与当前 `providerProfileId` 不同的 `executionTargetSnapshot`（例如历史 kimi / minimax profile）
- **THEN** 会话概览额度区 MUST NOT 为这些历史供应商发起额度查询或渲染额度卡
- **AND** 至多展示当前 binding 对应的一条额度结果（含 unsupported / empty / coding_plan / official_cli）

#### Scenario: Shared 仍展示多供应商额度列表

- **WHEN** 活跃会话为 Shared
- **AND** conversation items 中出现多个不同的 engine+provider 目标
- **THEN** 会话概览 MUST 为去重后的每个目标独立查询并分卡展示额度
- **AND** 当前 fallback binding 若尚未出现在 history 中 MUST 仍被包含

#### Scenario: 无 engine 时不查询

- **WHEN** 当前无有效 `selectedEngine` / status panel engine
- **THEN** 系统 MUST NOT 发起 coding plan 额度查询
- **AND** 会话概览 MUST NOT 因额度逻辑崩溃

### Requirement: 结果 Tab MUST 默认展示会话概览 Section

dock status panel 的「结果」tab MUST 在顶部常驻渲染会话概览 section(`SessionOverviewSection`),其全部字段 MUST 来自既有前端 store / props 的确定性派生,MUST NOT 新增 tauri command、MUST NOT 引入轮询、MUST NOT 依赖大模型生成。默认状态下「结果」tab MUST 只渲染会话概览:总结 hero、提示信号、验证 chips、文件变化、风险、建议动作、提交弹窗、Policy 审计与成本区 MUST 仅在用户通过 client UI visibility control `bottomActivity.checkpointDetails` 显式 opt-in 后渲染;无论开关状态如何,tab badge 的 checkpoint verdict MUST 照常计算。

#### Scenario: 详情区默认隐藏

- **WHEN** 用户从未启用 `bottomActivity.checkpointDetails` 可见性开关
- **THEN** 「结果」tab MUST 只渲染会话概览
- **AND** MUST NOT 渲染总结 hero、提示信号、验证 chips、文件变化、成本区、建议动作、提交弹窗或 Policy 审计
- **AND** tab badge verdict MUST 仍由 `buildCheckpointViewModel` 照常计算

#### Scenario: 开启后恢复完整结果表面

- **WHEN** 用户在设置中启用 `bottomActivity.checkpointDetails`
- **THEN** 「结果」tab MUST 恢复渲染成本区与完整 checkpoint 详情(含文件变化与提交流程)
- **AND** 开关状态 MUST 经 client UI visibility store 持久化

#### Scenario: 概览字段来源固定

- **WHEN** 「结果」tab 渲染会话概览
- **THEN** engine / model MUST 来自 `selectedEngine` / `selectedModelId`
- **AND** workspace 标识 MUST 来自 `workspaceName`(可回退 `workspacePath`)
- **AND** 运行状态与时长 MUST 来自 `isProcessing` 与 `threadStatusById`(`processingStartedAt` / `lastDurationMs` / `isContextCompacting`)
- **AND** 消息与 turn 统计 MUST 来自当前 thread 的 conversation items
- **AND** 上下文占用 MUST 来自 `activeTokenUsage`
- **AND** rate limit MUST 来自 `activeRateLimits`
- **AND** 待处理计数 MUST 来自 `approvals` / `userInputRequests`(与消息流内嵌卡片同源)

#### Scenario: 缺失字段降级为不渲染

- **WHEN** 某一概览字段的数据源缺失(如无 `activeTokenUsage`、无 rate limit 快照)
- **THEN** 对应行 MUST 整体不渲染
- **AND** section MUST NOT 渲染 placeholder 或 `undefined` 文案

#### Scenario: 零待处理不常显

- **WHEN** `approvals` 与 `userInputRequests` 均为空
- **THEN** 待处理计数行 MUST NOT 渲染

#### Scenario: 无活跃会话时展示空态

- **WHEN** 当前没有活跃 thread 且没有任何概览数据
- **THEN** 会话概览 MUST 渲染本地化空态文案
- **AND** MUST NOT 崩溃或阻塞「结果」tab 其余 section

### Requirement: 会话概览 MUST NOT 与成本 Section 重复表达

会话概览 MUST 聚焦会话身份、运行状态、活动统计、上下文占用与待处理计数;token 五维拆分与成本金额 MUST 仍由 `CostBudgetSection` 表达,会话概览 MUST NOT 重复渲染成本金额。

#### Scenario: 概览不渲染成本

- **WHEN** 会话概览与 `CostBudgetSection` 同屏渲染
- **THEN** 会话概览 MUST NOT 出现 session 成本金额或预算条

### Requirement: 会话概览额度卡 MUST 支持余额型 coding-plan 结果

会话概览额度渲染 MUST 将 `get_coding_plan_quota` 返回的余额型结果视为有效 coding_plan（或等价供应商额度）成功态：

- 当 `success=true` 且 `balance.items.length > 0` 时，即使 `windows` 为空，额度卡 MUST 进入可展示成功态。
- 前端 MUST 将 `balance.items` 映射为既有 credits 展示字段：`hasCredits=true`，`creditsBalance` 为各 `currency + totalBalance` 的可读拼接（默认形态如 `CNY 110.00`，多币种以分隔符连接）。
- 当 `windows` 为空且 `hasCredits=true` 时，额度卡 MUST NOT 渲染 coding-plan empty 占位文案。
- `isAvailable=false` 时仍可展示余额数字；MUST NOT 仅因 unavailable 将结果降级为 unsupported host。

#### Scenario: DeepSeek 余额成功无百分比窗口

- **WHEN** 某额度 entry 的 coding plan 输入为 `source=deepseek`、`success=true`、`windows=[]`、`balance.items` 非空
- **THEN** 概览额度卡 MUST 显示 credits 余额
- **AND** MUST NOT 显示 `codingPlanEmpty` 类空态文案
- **AND** MUST NOT 显示 `not a known coding-plan host` 类错误

#### Scenario: DeepSeek 查询失败

- **WHEN** coding plan 输入 `success=false` 且 error 描述鉴权或网络失败
- **THEN** 额度卡 MUST 展示 error 态
- **AND** MUST NOT 崩溃整个会话概览 section

#### Scenario: Shared 多卡之一为 DeepSeek 余额

- **WHEN** Shared 会话 `quotaEntries` 同时含 DeepSeek 余额成功 entry 与 MiniMax windows 成功 entry
- **THEN** 系统 MUST 分卡渲染
- **AND** DeepSeek 卡 MUST 显示 credits
- **AND** MiniMax 卡 MUST 显示百分比 windows

### Requirement: 额度成功条件 MUST 兼容 windows 或 balance

`buildSessionOverviewQuota`（或等价 viewModel）在判断供应商额度优先于 official_cli rateLimits 时，MUST 在以下任一成立时采用供应商结果：

1. `windows.length > 0`，或
2. `balance.items.length > 0`

在供应商结果成立时，MUST NOT 回落到 Codex 官方 rateLimits 窗口。

#### Scenario: Codex engine + DeepSeek provider 不用官方 rateLimits 冒充

- **WHEN** engine 为 `codex` 且 coding plan 为 DeepSeek balance 成功
- **AND** 本地存在 Codex account rateLimits 快照
- **THEN** 概览 MUST 展示 DeepSeek 余额
- **AND** MUST NOT 用 Codex official primary/secondary 百分比覆盖该卡

