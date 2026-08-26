# codex-chat-canvas-user-input-elicitation Specification

## Purpose

Defines the codex-chat-canvas-user-input-elicitation behavior contract, covering RequestUserInput GUI Rendering.
## Requirements
### Requirement: RequestUserInput GUI Rendering

系统 MUST 将 `item/tool/requestUserInput` 事件渲染为可交互的用户输入卡片，并以 `completed` 生命周期驱动待处理队列。

#### Scenario: request user input event renders interactive card when not completed

- **WHEN** 客户端收到 `item/tool/requestUserInput` 事件
- **AND** 事件 `completed` 字段不存在或为 `false`
- **THEN** 幕布 MUST 渲染包含问题标题（`header`）、问题文本（`question`）、可选项（`options`）和备注输入的交互卡片
- **AND** 卡片 MUST 与当前 `thread_id` 绑定，不得跨线程显示

#### Scenario: completed request does not enter pending queue

- **WHEN** 客户端收到 `item/tool/requestUserInput` 事件
- **AND** 事件 `completed=true`
- **THEN** 该请求 MUST NOT 进入待处理队列
- **AND** 系统 MUST NOT 弹出交互卡片

#### Scenario: no-questions payload still renders submit path

- **WHEN** `requestUserInput` payload 中问题列表为空
- **THEN** 幕布 MUST 渲染空态提示
- **AND** 用户 MUST 仍可提交空 answers 响应

#### Scenario: thread isolation prevents cross-thread card leakage

- **WHEN** Thread A 收到 `requestUserInput` 事件
- **AND** 用户切换到 Thread B
- **THEN** Thread B 的消息流 MUST NOT 显示 Thread A 的 requestUserInput 卡片
- **AND** 切回 Thread A 后该卡片 MUST 仍然可见且保留之前的填写状态

### Requirement: User Input Response Roundtrip

系统 MUST 将用户输入结果通过标准响应通道回传给服务端，并在提交后使线程生命周期进入可恢复、可结算状态，而不是留下不可恢复的伪 processing。

#### Scenario: stale timeout or cancel settlement removes pending request

- **WHEN** 用户提交空答案、跳过或 dismiss 一个 `AskUserQuestion` / `RequestUserInput` 卡片
- **AND** runtime response 表明该 request 已 unknown、timeout-settled、cancelled 或 workspace disconnected
- **THEN** 客户端 MUST 从本地 pending queue 移除该 request
- **AND** 客户端 MUST 清理该线程的 optimistic processing residue
- **AND** 客户端 MUST NOT 将该 stale settlement 当作 fatal submit failure 展示给用户

#### Scenario: non-stale submit failure remains retryable

- **WHEN** 用户提交 `AskUserQuestion` / `RequestUserInput` 响应
- **AND** response channel 失败但不符合 stale timeout/cancel settlement 条件
- **THEN** 客户端 MUST 保留 pending request
- **AND** 用户 MUST 能重试提交

### Requirement: askuserquestion Semantic Mapping

系统 MUST 在工具展示层将 `askuserquestion` 与 `requestUserInput` 语义对齐，并与官方 `Plan Mode` / `Default` 术语保持一致。

#### Scenario: request user input submitted audit title follows locale

- **WHEN** 系统渲染 `requestUserInputSubmitted` 审计项
- **THEN** 该项标题 MUST 使用 locale-driven 文案
- **AND** realtime submit、history replay 与本地归一化补全路径 MUST 使用一致语义
- **AND** 系统 MUST NOT 在这些用户可见路径中将 `"请求输入"` 写死为生产 UI 标题

#### Scenario: tool log alias maps to user input request semantics

- **WHEN** 工具日志中出现 `askuserquestion` 工具名
- **THEN** 幕布 MUST 将展示名映射为 `"User Input Request"` 或等效本地化术语
- **AND** 用户 MUST 能理解该事件属于“需要用户回答”的流程而非普通日志

#### Scenario: tool display fallback does not leak Chinese in non-Chinese locale

- **WHEN** 工具展示层缺少翻译函数上下文或进入静态 fallback 路径
- **THEN** `webfetch`、`askuserquestion` 等用户可见标题 MUST 使用 locale-safe fallback
- **AND** fallback MUST NOT 默认泄露中文标题到英文界面

#### Scenario: blocked askuserquestion keeps official terminology

- **GIVEN** 当前线程运行时模式为 `effective_mode=code`
- **WHEN** 系统阻断 `item/tool/requestUserInput`
- **THEN** 用户可见提示 MUST 使用 `Default` / `Plan Mode` 术语表达
- **AND** MUST NOT 暴露底层术语 `Collaboration mode: code`

#### Scenario: plan mode keeps interactive behavior

- **GIVEN** 当前线程运行时模式为 `effective_mode=plan`
- **WHEN** 工具日志中出现 `askuserquestion`
- **THEN** 系统 MUST 保持交互提问卡片路径可用
- **AND** MUST NOT 显示误导性的模式阻断提示

### Requirement: User Input Question Card Presentation MUST Be Shared Across AskUserQuestion And RequestUserInput

系统 MUST 对 Claude `AskUserQuestion` 与 Codex `RequestUserInput` 使用一致的用户提问卡片交互语义，避免两个引擎在多问题、关闭、宽度与时间线位置上产生 UI 漂移。

#### Scenario: live request card uses dedicated form width instead of chat bubble width

- **WHEN** 系统渲染待回答的 `RequestUserInput` / `AskUserQuestion` 卡片
- **THEN** 卡片 MUST 使用专用问答卡片样式
- **AND** 卡片 MUST NOT 依赖普通聊天 `.bubble` 的 `max-width` 约束
- **AND** 普通聊天气泡的宽度规则 MUST NOT 因问答卡片变更而扩大

#### Scenario: multi-question card displays one active question tab at a time

- **WHEN** request payload 包含多个 `questions`
- **THEN** 卡片 MUST 渲染 tab 列表
- **AND** 每次 MUST 只显示当前 active tab 对应的问题正文、选项和输入区
- **AND** 切换 tab MUST 保留其它问题已填写的 draft 状态

#### Scenario: multi-question card submits only from final tab

- **WHEN** request payload 包含多个 `questions`
- **AND** 当前 active tab 不是最后一个问题
- **THEN** 主按钮 MUST 显示 `Next` / `下一步`
- **AND** 点击主按钮 MUST 切换到下一个 tab
- **AND** 系统 MUST NOT 调用提交响应

- **WHEN** 当前 active tab 是最后一个问题
- **THEN** 主按钮 MUST 显示 `Submit` / `提交`
- **AND** 点击主按钮 MUST 使用标准 `{ answers: Record<string, { answers: string[] }> }` 响应契约提交所有问题答案

#### Scenario: pending question card separates collapse from skip settlement

- **WHEN** 待回答卡片可见
- **THEN** 卡片 header MUST 提供收起按钮
- **AND** 收起操作 MUST 只隐藏本地卡片
- **AND** 收起操作 MUST NOT 调用 runtime response channel
- **AND** action 区 MUST 提供明确的 skip/dismiss settlement 按钮
- **AND** skip/dismiss settlement 操作 MUST 使用标准响应通道提交空 answers
- **AND** 成功 settlement 后 MUST 从本地可见队列移除该卡片
- **AND** skip/dismiss settlement 操作 MUST NOT 构造带用户选择内容的正常答案提交

#### Scenario: stale pending question card skip removes local residue

- **WHEN** 用户跳过待回答卡片
- **AND** runtime 返回该 request 已 unknown、timeout、stale 或 workspace disconnected
- **THEN** 客户端 MUST 从本地可见队列移除该卡片
- **AND** 客户端 MUST NOT 将该 stale settlement 暴露为 fatal submit failure

#### Scenario: live request card is anchored to message timeline

- **WHEN** request payload 包含可关联的消息或工具 `item_id`
- **THEN** live request card MUST 插入到对应 timeline 位置附近
- **AND** 卡片 MUST NOT 永久吸附在 composer 上方或消息流底部
- **AND** 若找不到 anchor，系统 MAY 回退到 timeline 尾部显示，但仍 MUST 保持可关闭

### Requirement: Mode-Blocked RequestUserInput Event Compatibility

系统 MUST 在策略明确阻断 `requestUserInput` 时发出兼容事件，供前端解释性展示、队列清理与生命周期结算；该终态式结算语义 MUST 仅限 `requestUserInput` 型 `modeBlocked`，不得扩展到其它 blocked 方法。

#### Scenario: blocked event includes actionable context with dual-case compatibility

- **GIVEN** `requestUserInput` 被策略层阻断
- **WHEN** 系统生成阻断反馈事件
- **THEN** 事件 MUST 包含 `threadId/thread_id`、`blockedMethod/blocked_method`、`effectiveMode/effective_mode` 与 `reason`
- **AND** MUST 包含可执行建议（例如切换模式）

#### Scenario: blocked event can remove pending request by id compatibility

- **GIVEN** 阻断事件携带 `requestId` 或 `request_id`
- **WHEN** 前端消费该事件
- **THEN** 前端 MUST 能识别两种命名并从待处理请求队列移除对应项
- **AND** 队列状态 MUST 保持线程隔离

#### Scenario: blocked request settles pseudo-processing for the blocked thread

- **GIVEN** `modeBlocked` 事件对应 `blockedMethod/blocked_method = item/tool/requestUserInput` 或等效 reason code
- **WHEN** 前端消费该事件
- **THEN** 目标线程 MUST 清理普通 `processing`、`activeTurnId` 与等效 active-turn residue
- **AND** 用户 MUST 能继续与该线程交互
- **AND** 阻断提示卡片 MUST 保留为解释性审计痕迹

#### Scenario: non-request-user-input blocked event remains explanatory only

- **GIVEN** `modeBlocked` 事件对应的 blocked method 不是 `item/tool/requestUserInput`
- **WHEN** 前端消费该事件
- **THEN** 系统 MUST 保持解释性 blocked 展示语义
- **AND** 系统 MUST NOT 仅因为该事件属于 `modeBlocked` 就把它当作 user-input settlement 去清理无关 active execution state

### Requirement: Secret Input Handling

系统 MUST 对秘密输入问题提供安全展示策略。

#### Scenario: secret question masks entered content by default

- **WHEN** `requestUserInput` 问题项标记 `isSecret = true`（兼容 `is_secret`）
- **THEN** 输入控件 MUST 默认以掩码方式显示（`<input type="password">`）
- **AND** 客户端日志与调试输出 MUST NOT 输出该字段明文

#### Scenario: secret input supports visibility toggle

- **WHEN** 问题项标记 `isSecret = true`
- **AND** 输入控件处于掩码状态
- **THEN** 控件旁 MUST 提供可见性切换按钮（如眼睛图标）
- **AND** 点击切换按钮后控件 MUST 显示明文内容
- **AND** 再次点击 MUST 恢复掩码状态

#### Scenario: non-secret question uses standard textarea

- **WHEN** `requestUserInput` 问题项的 `isSecret` 为 `false` 或未定义
- **THEN** 输入控件 MUST 使用标准 `<textarea>` 而非密码输入

#### Scenario: secret field normalization handles snake_case and camelCase

- **WHEN** 上游事件中 `isSecret` 字段以 `is_secret`（snake_case）格式到达
- **THEN** 客户端 MUST 归一化为 `isSecret: boolean`
- **AND** 缺失该字段时 MUST 默认为 `false`

#### Scenario: secret value is sanitized in all log outputs

- **WHEN** 系统对 `isSecret=true` 的问题执行日志记录
- **THEN** 所有 `console.log`、logger 调用和 debug 输出中 MUST 将该字段的用户输入值替换为 `"***"`
- **AND** 替换 MUST 覆盖前端全链路（事件接收、状态存储、提交回传日志）

### Requirement: Claude AskUserQuestion MUST Render Interactive RequestUserInput Card

系统 MUST 在 `claude` 会话收到 `item/tool/requestUserInput` 事件后，渲染可交互提问卡片，而不是仅展示原始 JSON 文本。

#### Scenario: claude request user input renders card instead of raw json
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** 客户端收到 `item/tool/requestUserInput` 且 `completed` 不存在或为 `false`
- **THEN** 幕布 MUST 渲染包含 `header`、`question`、`options` 与备注输入区的交互提问卡片
- **AND** 对应工具日志区 MUST NOT 作为唯一交互入口展示原始问题 JSON

#### Scenario: completed claude request does not enter pending card queue
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** 客户端收到 `item/tool/requestUserInput` 且 `completed=true`
- **THEN** 该请求 MUST NOT 进入待处理提问队列
- **AND** 系统 MUST NOT 渲染新的待提交提问卡片

#### Scenario: empty questions still keeps claude submit path
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** `requestUserInput` 事件中的 `questions=[]`
- **THEN** 幕布 MUST 显示空态提示
- **AND** 用户 MUST 仍可提交空 answers 响应

### Requirement: Claude RequestUserInput Submission MUST Reuse Standard Response Contract

系统 MUST 复用现有 `respond_to_server_request` 协议回传 Claude 提问答案，并在成功后清理待处理请求。

#### Scenario: claude submit routes through respond_to_server_request
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** 用户在提问卡片点击提交
- **THEN** 客户端 MUST 通过 `respond_to_server_request` 回传 `{ answers: Record<string, { answers: string[] }> }`
- **AND** 后端 MUST 继续将该响应路由到 Claude AskUserQuestion 恢复流程

#### Scenario: submit success removes pending request and records submitted summary
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** 提交响应成功
- **THEN** 当前 request MUST 从待处理队列移除
- **AND** 会话消息流 MUST 生成可追踪的已提交记录（`requestUserInputSubmitted` 或等效语义）

#### Scenario: submit failure keeps request for retry
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** 提交响应失败
- **THEN** 当前 request MUST 保留在待处理队列
- **AND** 用户 MUST 能看到错误提示并重试提交

### Requirement: RequestUserInput Stale Timeout Settlement MUST Release The Pending Dialog

When a user-input request has already been settled by runtime timeout, the frontend MUST treat a later empty cancel response as stale settlement rather than a retryable submission failure.

#### Scenario: Claude AskUserQuestion cancel arrives after backend timeout

- **GIVEN** a Claude Code `AskUserQuestion` request is visible in the frontend queue
- **AND** the backend has already timed out and cleared the pending request
- **WHEN** the user cancels the dialog or the frontend timeout submits an empty response
- **THEN** the frontend MUST remove the pending request from the queue
- **AND** the thread MUST clear the optimistic processing marker created for that response attempt
- **AND** the frontend MUST NOT insert a submitted-answer history item for the stale response

#### Scenario: stale settlement regression fixes remain scoped

- **WHEN** a non-timeout submit failure occurs
- **THEN** the request SHALL remain visible for retry
- **AND** the timeout-specific stale classifier SHALL NOT hide real bridge or backend failures

### Requirement: Claude AskUserQuestion Tool Presentation MUST Avoid Misleading Plan-Mode Block Hint

当 Claude 提问链路可交互时，系统 MUST 避免展示与 Codex 协作模式阻断语义冲突的提示。

#### Scenario: active claude request does not show plan-mode-block hint as primary message
- **GIVEN** 当前活动会话引擎为 `claude`
- **AND** 存在可提交的 `requestUserInput` 卡片
- **WHEN** 对应 `askuserquestion` 工具日志可见
- **THEN** 用户主交互路径 MUST 指向提问卡片
- **AND** 界面 MUST NOT 以 `"This feature requires Plan mode"` 作为该请求的主提示文案

#### Scenario: claude tool row can remain as trace but not as exclusive interaction surface
- **GIVEN** 当前活动会话引擎为 `claude`
- **WHEN** `askuserquestion` 工具日志渲染
- **THEN** 工具行 MAY 保留为审计痕迹
- **AND** 用户 MUST 可在同线程中通过提问卡片完成回答与提交

### Requirement: Claude Fix MUST Preserve Other Engine Behavior

该能力变更 MUST 严格限制在 `claude` 引擎，不得改变其他引擎既有提问与工具展示行为。

#### Scenario: codex request user input flow remains unchanged
- **WHEN** 当前活动会话引擎为 `codex`
- **THEN** 既有 `requestUserInput` 渲染、提交与提示语义 MUST 保持不变

#### Scenario: opencode and gemini do not gain unintended askuserquestion behavior
- **WHEN** 当前活动会话引擎为 `opencode` 或 `gemini`
- **THEN** 系统 MUST NOT 因本变更引入新的 `askuserquestion` 交互流程
- **AND** 既有消息与工具渲染契约 MUST 保持不变

### Requirement: AskUserQuestion Submitted Answer MUST Remain Recoverable Until Runtime Resume Settles

The system MUST distinguish local AskUserQuestion answer acceptance from successful Claude runtime resume, so a Windows resume failure does not silently lose the user's answer or leave the thread in ambiguous processing state.

#### Scenario: accepted answer records submitted evidence before resume settles

- **WHEN** a user submits an answer for a Claude `AskUserQuestion` card
- **AND** the backend accepts the response for a matching request id
- **THEN** the conversation MUST retain submitted-answer evidence for that request
- **AND** the system MUST NOT depend on successful Claude resume before preserving the submitted answer

#### Scenario: runtime resume failure is recoverable

- **WHEN** an AskUserQuestion answer is accepted
- **AND** Windows Claude parent termination, session id lookup, or resume process spawn fails
- **THEN** the user-visible thread MUST receive a recoverable runtime failure signal or equivalent diagnostic
- **AND** the thread MUST NOT remain indefinitely in pseudo-processing solely because the local submit succeeded

#### Scenario: non-stale submit failure keeps retry path

- **WHEN** AskUserQuestion answer submission fails before backend acceptance
- **THEN** the pending question card MUST remain retryable
- **AND** the system MUST NOT create submitted-answer evidence for an answer that was not accepted

### Requirement: Timed-Out User Input Settlement Releases Stale Cards

The system MUST treat a user action against a locally timed-out `AskUserQuestion` / `RequestUserInput` card as stale settlement when runtime reports that the request is no longer actionable.

#### Scenario: timed-out submit returns stale runtime error
- **WHEN** a visible user-input card has reached `0:00`
- **AND** the user clicks Submit with selected answers
- **AND** runtime response indicates the request is unknown, stale, timeout-settled, cancelled, or workspace disconnected
- **THEN** the client MUST remove the request from the pending queue
- **AND** the client MUST clear optimistic processing residue for that thread
- **AND** the client MUST NOT show the stale response as a fatal submit failure
- **AND** the client MUST NOT insert a submitted-answer history item for the stale response

#### Scenario: timed-out skip returns stale runtime error
- **WHEN** a visible or collapsed user-input card has reached `0:00`
- **AND** the user clicks Skip / dismiss
- **AND** runtime response indicates the request is unknown, stale, timeout-settled, cancelled, or workspace disconnected
- **THEN** the client MUST remove the request from the pending queue
- **AND** the client MUST NOT show the stale response as a fatal submit failure

#### Scenario: ordinary submit failure remains retryable
- **WHEN** the user submits a user-input card
- **AND** runtime response fails without stale / timeout settlement evidence
- **THEN** the client MUST keep the request visible
- **AND** the user MUST be able to retry submission

### Requirement: AskUserQuestion MUST Be Reachable In Non-Plan Modes Via An In-Process MCP Server

系统 MUST 在非 plan 模式（`default` / `acceptEdits`）下通过一个进程内 MCP 服务器暴露 `AskUserQuestion` 工具，使 Claude 会话可以在 turn 进行中发起结构化提问，而不是仅在 plan 模式下经由原生 plan-gated 工具才能提问。

The Claude CLI only exposes its native `AskUserQuestion` tool when running in
plan mode; in `default` / `acceptEdits` the native tool is permission-gated, so
a mid-turn structured ask is otherwise impossible. The client MUST start an
in-process MCP server that re-exposes the capability as an allowed MCP tool.

#### Scenario: non-plan mode wires the in-process MCP tool

- **WHEN** 客户端为一个 `claude` 会话构建 CLI 命令
- **AND** 该会话运行时模式不是 plan 模式
- **THEN** 命令 MUST 通过 `--mcp-config` 注入进程内 AskUserQuestion MCP 服务器
- **AND** 命令 MUST 将该服务器的工具名显式加入允许列表（allowed tools）
- **AND** 系统 MUST NOT 传入 `--strict-mcp-config`，以免屏蔽用户自有的 MCP 服务器

#### Scenario: plan mode does not double-wire the MCP tool

- **WHEN** 客户端为一个 `claude` 会话构建 CLI 命令
- **AND** 该会话运行时模式为 plan 模式
- **THEN** 系统 MUST 依赖 CLI 原生 `AskUserQuestion` 工具
- **AND** 系统 MUST NOT 额外注入进程内 MCP AskUserQuestion 工具

#### Scenario: MCP-origin ask renders and settles through the shared user-input card

- **WHEN** 进程内 MCP 服务器收到一个 AskUserQuestion 调用
- **THEN** 系统 MUST 复用既有 `RequestUserInput` 交互卡片路径展示该提问
- **AND** 用户提交后系统 MUST 将答案作为 MCP `tool_result` 返回给发起该调用的 live turn
- **AND** 该往返 MUST NOT 依赖 kill/resume，当前 turn MUST 继续执行

### Requirement: AskUserQuestion MCP Calls MUST Survive Answers Slower Than The CLI Default Fetch Timeout

系统 MUST 在注入 AskUserQuestion MCP 工具时提高 CLI 的 MCP 工具调用抓取超时，使用户耗时超过 CLI 默认 60s 的回答不会被 CLI 提前放弃并作为 timeout 返回给模型。

The Claude CLI defaults its per-request MCP tool-call fetch timeout to 60s for
HTTP MCP servers, but an AskUserQuestion blocks on a human for up to the server's
own longer window. Without raising the CLI timeout, a slow answer can be
abandoned by the CLI and lost.

#### Scenario: tool timeout is raised when the ask is wired

- **WHEN** 客户端为一个 `claude` 会话注入 AskUserQuestion MCP 工具
- **THEN** 命令环境 MUST 设置 `MCP_TOOL_TIMEOUT` 为一个不短于服务器等待窗口的值（例如 300000 毫秒）
- **AND** 一个耗时超过 60s 才提交的回答 MUST 仍被正确送达发起该调用的 turn

#### Scenario: an explicit user override is respected

- **WHEN** 环境中已存在用户设置的 `MCP_TOOL_TIMEOUT`
- **THEN** 系统 MUST NOT 覆盖该用户显式值

### Requirement: A Pending AskUserQuestion MUST Hold The Composer Send Queue For Its Thread

系统 MUST 在某线程存在待回答的 AskUserQuestion / RequestUserInput 卡片时，保留（而非清空）该线程的 Composer 发送队列，使排队消息不会被当作新 turn 发出而令待处理提问失去归属。

While a dialog is open the CLI turn is blocked awaiting the answer; flushing the
queue would strand the answer and start unrelated fresh turns.

#### Scenario: queued messages are held while an ask is pending for the active thread

- **WHEN** 活动线程存在一个待回答的 AskUserQuestion 卡片
- **AND** 用户发送或已排队一条消息
- **THEN** 系统 MUST 将该消息保留在队列中而不是立即作为新 turn 发出
- **AND** 系统 MUST 在提问结算（提交 / skip / stale settlement）后恢复正常的队列 flush

#### Scenario: pending detection is scoped by workspace and thread

- **WHEN** 系统判断当前线程是否存在待回答提问
- **THEN** 判断 MUST 匹配 `workspace_id`
- **AND** 空 `thread_id` MUST 视为当前线程
- **AND** 另一线程的待回答提问 MUST NOT 触发当前线程的队列保留

### Requirement: Shared Session RequestUserInput Reachability

当会话身份为 Shared Session 且 runtime 已投影完整 `sharedOwner` 时，系统 MUST 将
合法的 `item/tool/requestUserInput`（含 Claude MCP `AskUserQuestion` 与 native 路径）
送达 Shared 幕布的 pending 队列并渲染可交互卡片。系统 MUST NOT 因 Claude 事件
`params.turnId` 曾使用 assistant item id、而 `sharedOwner.runtimeTurnId` 为 attempt
runtime turn 这一历史不一致而静默丢弃事件。

投影与映射 MUST 保证 control 路径上 `params.turnId`（及兼容 `turn_id`）与
`sharedOwner.runtimeTurnId` 对齐，且 `params.threadId` 为 Shared 线程 id，
`nativeThreadId` 指向真实 Owner。卡片 item 锚定 MUST 继续使用独立的
`itemId`（如 `askuserquestion-<request_id>`），不得依赖 assistant message item id。

#### Scenario: shared Claude MCP ask surfaces interactive card

- **WHEN** Shared Session 绑定 Claude Owner 且处于 default / acceptEdits 模式
- **AND** 模型调用 in-process MCP `AskUserQuestion` 触发 `item/tool/requestUserInput`
- **AND** runtime 已为该 attempt 投影完整 `sharedOwner`（含 attemptId、runtimeTurnId、
  nativeThreadId、executionTargetSnapshot）
- **THEN** 客户端 MUST 在 Shared 幕布渲染可交互提问卡片
- **AND** 卡片 `thread_id` MUST 为 Shared thread id
- **AND** 系统 MUST NOT 仅展示转圈的 MCP 工具卡而缺少提问 UI

#### Scenario: control turn identity is aligned with shared owner runtime turn

- **WHEN** Claude 或 Shared projection 发出 `item/tool/requestUserInput`
- **AND** 该事件携带 `sharedOwner`
- **THEN** `params.turnId`（或 `turn_id`）MUST 等于 `sharedOwner.runtimeTurnId`
- **AND** 前端 `resolveSharedRuntimeControlOwner` MUST 能成功解析
- **AND** 事件 MUST NOT 因 turn 身份不一致被 fail-closed 静默丢弃

#### Scenario: incomplete shared control owner still fails closed

- **WHEN** 事件声称 Shared 身份（`threadId` 以 `shared:` 开头、或存在 sharedBridge / sharedOwner 字段）
- **AND** 缺少完整 control owner 所需字段（attemptId、providerRuntimeKey、runtimeTurnId、
  executionTargetSnapshot 或 thread/native/turn 与 binding 不一致）
- **THEN** 客户端 MUST NOT 推断 owner 并弹窗
- **AND** 客户端 MUST NOT 将卡片绑定到错误的 Shared 或 native 线程

#### Scenario: native Claude requestUserInput remains reachable

- **WHEN** 用户在 non-Shared 的 native Claude 会话触发 AskUserQuestion / requestUserInput
- **THEN** 系统 MUST 仍渲染可交互提问卡片并完成既有 answer round-trip
- **AND** Shared control owner 门禁 MUST NOT 影响无 Shared claim 的 native 事件

### Requirement: Settled RequestUserInput Identity MUST Suppress Replay

系统 MUST 在 request identity 已结算（用户 accepted / stale settlement / runtime `completed=true`）后，抑制同 identity 的迟到或重放入队，避免 Claude 已继续执行时再次弹出问答框。

#### Scenario: accepted settlement tombstones identity and blocks re-add

- **WHEN** 用户成功提交或跳过某 `AskUserQuestion` / `RequestUserInput` 且 settlement 为 `accepted`
- **THEN** 客户端 MUST 将该 request identity（workspace + Shared owner 维度 + request_id）记入有界 settlement tombstone
- **AND** 后续同 identity 且 `completed` 不为 true 的 `item/tool/requestUserInput` 事件 MUST NOT 再次进入 pending queue
- **AND** 系统 MUST NOT 再次弹出该 identity 的交互卡片

#### Scenario: stale settlement also tombstones identity

- **WHEN** 用户提交/跳过触发 stale settlement（unknown request_id、timeout、workspace disconnected 等）
- **THEN** 客户端 MUST 同样写入 settlement tombstone
- **AND** 同 identity 迟到非 completed 事件 MUST NOT 重新入队

#### Scenario: completed event tombstones and removes queue entry

- **WHEN** 客户端收到 `item/tool/requestUserInput` 且 `completed=true`
- **THEN** 客户端 MUST 写入 settlement tombstone
- **AND** MUST 从 pending queue 移除该 request
- **AND** 后续同 identity 非 completed 重放 MUST 被忽略

#### Scenario: new request identity still elicits

- **WHEN** 到达的 `requestUserInput` 使用不同 request identity（例如新 tool_id 派生的 request_id 或不同 Shared attempt）
- **AND** 该 identity 未结算
- **THEN** 系统 MUST 正常入队并渲染交互卡片

#### Scenario: non-stale submit failure remains retryable without tombstone

- **WHEN** 用户提交失败且不属于 stale settlement
- **THEN** 客户端 MUST NOT 因该失败写入 settlement tombstone
- **AND** pending request MUST 保留并可重试

### Requirement: Claude Successful User Input Response MUST Emit Completed Lifecycle

Claude runtime 在成功接受 AskUserQuestion 答案后 MUST 发出 `completed=true` 的 `RequestUserInput` 生命周期事件，与超时结算路径对齐，供前端清理与墓碑写入。

#### Scenario: successful respond emits completed request user input

- **GIVEN** Claude session 存在 pending AskUserQuestion request
- **WHEN** `respond_to_user_input` 成功（MCP oneshot 或 native notify 路径）
- **THEN** runtime MUST 向该 turn 的订阅方 emit `RequestUserInput` 且 `completed=true`
- **AND** 事件 MUST 携带同一 request_id
- **AND** questions 可为 empty array

#### Scenario: successful respond does not leave resume wait re-entry for same request

- **GIVEN** 某 request_id 已成功 respond 并记入 session settled set
- **WHEN** 同一 native `AskUserQuestion` tool_use / 同 request_id 再次出现在 stream 转换路径
- **THEN** runtime MUST NOT 再次进入 kill+`--resume` 用户等待
- **AND** runtime MAY emit `completed=true` 或等效已结算信号，但 MUST NOT 重新注册 pending wait

#### Scenario: stream only waits on incomplete request user input

- **WHEN** Claude stream 收到 `EngineEvent::RequestUserInput`
- **AND** `completed=true`
- **THEN** runtime MUST NOT 调用 AskUserQuestion resume wait handler
- **AND** 仅当 `completed=false`（或缺省未完成）时 MUST 进入用户等待 / resume 流程

