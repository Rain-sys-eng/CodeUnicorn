# multi-agent-orchestration Specification

## Purpose

固化 Shared Session 多 CLI 协作编排（Plan → Approve → Implement → Review）的
cross-layer 行为合同：outcome 字符上限、Inspector 展示契约、降级 settle。

可执行落点与常量表见 `dev-guidelines/multi-agent/contracts.md`。
设计文档：`docs/architecture/multi-engine-collaboration-orchestration-design.md`。
## Requirements
### Requirement: Stage outcome character limits SHALL be shared constants

系统 MUST 使用控制平面统一常量截断 stage short / body / final summary，
禁止前端或其它层各自硬编码不同上限。

#### Scenario: short outcome chip is bounded

- **WHEN** stage 结算写入 `shortOutcome` 或 outcome.summary
- **THEN** 文本 MUST 经 `short_text` 截断至 `STAGE_SHORT_OUTCOME_CHARS`（160）
- **AND** 超长时 MAY 以 `…` 结尾

#### Scenario: stage body and final summary use hard caps without ellipsis

- **WHEN** 写入 outcome.body 或 run.finalSummary
- **THEN** body MUST 受 `STAGE_OUTCOME_BODY_CHARS`（12000）约束
- **AND** finalSummary MUST 受 `FINAL_SUMMARY_CHARS`（12000）约束
- **AND** 二者 MUST 使用硬截断 `cap_text`，不得用带 `…` 的 short_text 误导用户

### Requirement: Inspector display contracts SHALL isolate stage stories

系统 MUST 保证头与幕布「两套故事」一致：徽章对齐本段 target；
非 plan 段禁止用 plan.markdown；canvas key 带 `shared:` 前缀 attempt 隔离。
在此基础上，Inspector MUST 在 stage 输出幕布上方提供可折叠的注入上下文 Header（详见 capability `multi-agent-inspector-inject-context`），且该 Header 使用 plan/上游摘要时 MUST NOT 将 plan.markdown 写入非 plan 段的 **输出幕布** 正文。

#### Scenario: contract 2 non-plan stage must not use plan.markdown

- **WHEN** Inspector 为 implement 或 review 段构造 settle fallback 正文
- **THEN** 系统 MUST NOT 读取 `projection.plan.markdown`
- **AND** MUST 仅使用本 stage 的 fullOutcome / shortOutcome / liveText

#### Scenario: contract 2 plan stage may use plan.markdown

- **WHEN** Inspector 为 plan 段构造 settle fallback 且 plan.markdown 非空
- **THEN** 系统 MAY 使用 plan.markdown 作为正文候选

#### Scenario: contract 3 canvas key uses shared prefix

- **WHEN** 协作节点写入或读取 attempt-scoped canvas
- **THEN** threadId MUST 形如 `agent-canvas:shared:<uuid>:<attemptId>`
- **AND** 解析 MUST 还原 `sharedThreadId` 以 `shared:` 开头

#### Scenario: contract 4 persona line is target plus optional agent name

- **WHEN** Inspector 卡片头渲染 `stageInspectorTypeLine`
- **THEN** 输出 MUST 含引擎/模型目标标签
- **AND** 若存在 `personaAgentName`，MUST 以 ` · 智能体 {name}` 追加
- **AND** persona MUST NOT 改写 stage.target

#### Scenario: contract 4 persona body is injected to CLI but hidden on canvas

- **WHEN** 协作节点绑定了客户端智能体且 `personaPrompt` 非空
- **THEN** 该 stage worker prompt MUST 包含智能体正文（先于本步 `rolePrompt`）
- **AND** 主幕 / Inspector 卡片 MUST NOT 渲染智能体正文
- **AND** 展示层 MAY 仅显示 persona icon 与 name

#### Scenario: inject-context header may reference plan summary without polluting canvas

- **WHEN** 非 plan 段 Inspector 展开注入上下文 Header
- **THEN** Header 的上游分区 MAY 展示 `plan.summary` 或截断后的 plan 文本作为「注入来源」
- **AND** Messages 输出幕布正文 MUST 仍遵守 contract 2（不得因 Header 而把 plan.markdown 写入非 plan 段 canvas）

### Requirement: Composer context SHALL fan into first stage only

系统 MUST 将 Composer 上下文（图片、skill、记忆、便签，可多条）以及**主幕已有对话 digest**（若有）对齐注入模板首段，后续段仅消费首段文字归纳与上游 stage 产出，禁止整类拒绝或静默丢弃。有主幕历史时 MUST 注入 digest；空历史可跳过。

#### Scenario: images and context allowed on collab submit

- **WHEN** 用户开启协作并附带图片和/或 skill/记忆/便签后发送
- **THEN** 系统 MUST NOT 因「协作暂不接收附件/上下文」拦截
- **AND** 首段 worker turn MUST 收到注入后的 model text 与（若有）images

#### Scenario: main-canvas history fans into first stage model text

- **WHEN** 用户在已有主幕对话的会话上开启协作发送
- **THEN** 首段 model text MUST 在本轮用户任务前包含主幕对话 digest 标记块（`【主幕对话上下文】`）
- **AND** `visibleText` / 主幕用户气泡 MUST NOT 包含该 digest 块

#### Scenario: dispatch falls back to durable image_refs

- **WHEN** 协作 drive 调用 `shared_session_v2_dispatch_turn` 且未传 `images`
- **AND** 对应 attempt 的 `TurnRequested.input.image_refs` 非空
- **THEN** 系统 MUST 用 `image_refs[].locator` 作为 CLI 附图路径
- **AND** MUST NOT 静默丢弃 durable 附图

#### Scenario: image-only collab request is accepted

- **WHEN** 用户开启协作、只附图不写正文后发送
- **THEN** 系统 MUST 接受请求（不得因 empty text 拒绝）
- **AND** 首段 prompt MUST 使用占位任务文案并附带 images

#### Scenario: memory and note-card bodies fan into first-stage model text

- **WHEN** 协作发送携带 selectedMemoryIds 和/或 selectedNoteCardIds
- **THEN** 首段 `request_text` / model text MUST 包含记忆/便签注入块
- **AND** 主幕 visible text MUST NOT 包含上述注入块
- **AND** 便签附图 MUST 并入 firstStageImages（走附图 SSOT）

#### Scenario: skill bodies are injected for collab first stage

- **WHEN** 协作发送携带 skillInvocations（含 path）
- **THEN** 系统 MUST 读取 SKILL.md 并将正文注入首段 model text
- **AND** MUST NOT 仅依赖编排 prompt 中间的 `/skill` slash 解析作为唯一通道
- **AND** 读文件失败时 MAY 保留 slash token 作为引擎回退

#### Scenario: non-first stages receive text summary only

- **WHEN** 首段已成功并启动后续 stage
- **THEN** 后续 stage begin turn MUST NOT 附带 first-stage images
- **AND** 后续 prompt 的「用户任务」MUST 使用 `userVisibleText`（无记忆/skill/主幕 digest 注入块）
- **AND** 后续 prompt MUST 可依赖 plan / short_outcome / upstream notes 中的文字归纳

### Requirement: Downstream start failure MAY degrade to succeeded after implement

当上游实现段已成功、后续段启动失败时，系统 MUST 可降级 settle 为 succeeded，
而不是整 run 失败抹掉已交付成果。

#### Scenario: review unavailable after implement success settles succeeded

- **WHEN** 非首段（`completed_stage_index > 0`）已成功结算
- **AND** 启动下一段（如 review）失败
- **THEN** run MUST settle 为 `succeeded`
- **AND** 未启动段 MUST 标记 `skipped`
- **AND** finalSummary MUST 综括已成功段要点（含 implement 短说明），不得仅复读失败原因

#### Scenario: first stage unavailable still fails the run

- **WHEN** 首段（index 0）启动失败
- **THEN** run MUST 走 failed settle 路径
- **AND** MUST NOT 降级为 succeeded

