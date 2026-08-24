## MODIFIED Requirements

### Requirement: Illegal Runtime MUST Fail Closed Or Auto-Repair

系统 MUST NOT 在已知模型集合外静默把非法 runtime 发给第三方 API 并依赖 400 回灌。

跨供应商 residual 检测 MUST 覆盖已知第三方产品模型命名（至少包括 Kimi 系与 MiniMax 系），不得仅匹配 `k3` / `kimi-*`。

#### Scenario: k3 selected under DeepSeek profile

- **WHEN** 解析得到的 runtime 为 `k3`（或不属于当前 profile catalog/env 合法集合且命中 residual 启发式）
- **AND** 当前 profile 为 DeepSeek 或其它非 Kimi 兼容集合
- **THEN** 系统 MUST 自动 repair 到 profile 默认 runtime，或拦截发送并 toast 说明原因
- **AND** MUST NOT 完成一次会触发 DeepSeek `passed k3` 的 CLI 调用

#### Scenario: MiniMax residual under DeepSeek profile

- **WHEN** 当前 thread 绑定 DeepSeek managed profile 且 provider-scoped catalog 已就绪（含 `deepseek-v4-pro` / `deepseek-v4-flash` 等合法 runtime）
- **AND** composer / atomic selection 仍为 `MiniMax-M3`（或其它 MiniMax 产品模型名）且该名不在当前 catalog/env 合法集合
- **THEN** `resolveClaudeManagedRuntimeModel`（或等价 send-time resolver）MUST repair 到当前 catalog 默认 runtime
- **AND** MUST NOT 将 `MiniMax-M3` 作为 Claude CLI `--model` 上送
- **AND** MUST NOT 依赖 DeepSeek API 400 作为用户可见的唯一失败路径

#### Scenario: legitimate freeform remains allowed

- **WHEN** catalog 已就绪，候选 runtime 不在合法集合
- **AND** 候选不命中跨供应商 residual 启发式（例如 `my-org-router-v2` 或明确的 Anthropic 风格 freeform 如 `claude-opus-4-6`）
- **THEN** resolver MUST 保持 freeform 放行（`repaired=false`）
- **AND** MUST NOT 因本 change 的 residual 扩展而强制回退到 catalog 默认

## ADDED Requirements

### Requirement: Parallel Native Session Model Residual MUST Be Re-resolved At Send Time

并行多个 Native Claude managed 会话（不同 `providerProfileId`）后，切回任一历史会话发送时，系统 MUST 按 **该会话当前绑定 profile 的 catalog/env** 重解析 runtime；不得沿用其它会话遗留的产品模型名。

#### Scenario: switch from MiniMax-bound session UI to DeepSeek-bound session send

- **WHEN** 用户在同一 workspace 先后使用绑定 MiniMax 与绑定 DeepSeek 的两个 native Claude 会话
- **AND** 随后在 DeepSeek 绑定会话发起 turn，且内存/selection 仍携带 MiniMax 产品模型名
- **THEN** send-time resolver MUST 按 DeepSeek catalog 重解析或 repair
- **AND** 实际上送 runtime MUST 属于 DeepSeek catalog/env 合法集合或明确 freeform（非 MiniMax residual）

#### Scenario: Shared path unchanged

- **WHEN** 用户在 Shared Session 内切换 execution target 的 provider/model
- **THEN** 本 capability 的 residual 扩展 MUST NOT 改变 Shared `selectedNextTarget` 写入与 begin_turn 语义
- **AND** Shared 仍以 target 为下一轮唯一权威输入
