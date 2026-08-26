# claude-provider-runtime-model-sync Specification

## Purpose

定义 Claude Code **managed 供应商**下，模型 **展示标签、会话选中、发送 `--model`、进程 env** 的单源 runtime 契约，防止第三方 API（如 DeepSeek）收到跨供应商残留模型名（如 `k3`）。
## Requirements
### Requirement: Send MUST Use Provider-Scoped Runtime Model

Native Claude managed 会话发送时，系统 MUST 将 UI 选中的 catalog entry id 解析为 **当前绑定 profile** 下的 runtime model 字符串，再传给 Claude CLI `--model`。

#### Scenario: DeepSeek profile maps all tiers to deepseek-v4-pro

- **WHEN** 会话绑定 DeepSeek managed profile，且 profile env 将各 Claude 档位映射到 `deepseek-v4-pro`（或仅 `ANTHROPIC_MODEL=deepseek-v4-pro`）
- **AND** 用户选中任一 Claude 档位 entry（如 `claude-fable-5`）
- **THEN** 发送使用的 runtime model MUST 为 `deepseek-v4-pro`（或该 entry 在 catalog 中的当前 `model` 字段）
- **AND** MUST NOT 发送 `k3`、`kimi-k3`、`kimi-code/k3` 或其他非该 profile catalog/env 合法名

#### Scenario: stale selection runtime is re-resolved at send time

- **WHEN** 内存中 `nativeAtomicSelection.model` 或历史 selection 仍为旧供应商 runtime（如 `k3`）
- **AND** 当前 thread binding profile 的 catalog 已更新为 DeepSeek 映射
- **THEN** 发送前 MUST 按当前 catalog 重解析
- **AND** 若无法解析为合法 runtime，MUST repair 或 fail-closed，不得把旧 `k3` 传给 CLI

### Requirement: Process Environment MUST Not Leak Parent Provider Routing Keys

Claude managed turn spawn 时，系统 MUST 先清除进程中的 Claude provider routing 环境变量，再写入当前 profile 的 env。

#### Scenario: parent process has residual k3 model env

- **WHEN** 父进程环境存在 `ANTHROPIC_MODEL=k3` 或 `ANTHROPIC_DEFAULT_FABLE_MODEL=k3` 等 routing 键
- **AND** 当前 turn 绑定 DeepSeek profile（env 含 `ANTHROPIC_MODEL=deepseek-v4-pro` 等）
- **THEN** child Claude 进程 MUST NOT 保留父进程的 `k3` 值作为有效 model 路由
- **AND** 生效的 model 相关 env MUST 来自当前 profile（缺失键不得回落父进程脏值）

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

### Requirement: Display Label And Send Runtime MUST Share The Same Resolver

Claude 模型选择器展示的主标签所代表的 runtime MUST 与即将发送的 runtime 来自同一解析规则。

#### Scenario: four tier rows show deepseek-v4-pro

- **WHEN** provider-scoped catalog 将四档 `model` 均写为 `deepseek-v4-pro`
- **THEN** UI 主标签 MUST 显示该 runtime（或等价映射结果）
- **AND** 发送 runtime MUST 与所勾选 entry 的 catalog `model` 一致
- **AND** localStorage mapping MUST NOT 单独把标签显示为 deepseek 而 send 仍使用另一脏 `.model`

### Requirement: Catalog Refresh MUST Repair Foreign Selection

切到 managed profile 或刷新该 profile catalog 后，系统 MUST 检查当前 composer selection 的 runtime 是否仍属于该 profile。

#### Scenario: switch from Kimi-mapped session UI to DeepSeek catalog

- **WHEN** L1/catalog 切换到 DeepSeek，且当前 selection runtime 仍为 Kimi 系（`k3` / `kimi-*`）
- **THEN** 系统 MUST 将 selection repair 为 DeepSeek catalog 默认或 `ANTHROPIC_MODEL`
- **AND** 底栏勾选与后续 send 一致

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

