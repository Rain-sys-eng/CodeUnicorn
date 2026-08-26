# Delta: codex-model-catalog-coverage

## MODIFIED Requirements

### Requirement: User-Managed Custom Codex Models MUST Expose Mainstream Reasoning Options

用户管理的 Codex 自定义模型在缺少 reasoning metadata 时，MUST 暴露公共默认档位 `low/medium/high/xhigh` 且默认档为 `medium`，使 reasoning selector 可用、effort 选择不丢失。用户管理来源包括：「自定义模型」管理器写入 localStorage 的模型（`source: custom`）与 provider-owned 配置模型（provider-scoped catalog 的 `source: provider-custom` 自定义模型、`source: provider-config` 配置默认模型）。provider-owned 来源 MUST 先按 runtime identity 匹配 built-in catalog / authoritative catalog，命中时使用 model-specific 档位（如 Sol/Terra 的 max/ultra），仅 miss 时回落公共默认档。该默认档 MUST NOT 覆盖 runtime `model/list` 或 authoritative catalog 的 identity 匹配 metadata；MUST NOT 应用于 CLI runtime 发现的 unknown model（`source: "runtime"` 等非用户管理来源的未登记模型保持 capability-neutral）。

#### Scenario: Custom codex model without metadata

- **WHEN** 用户添加自定义 Codex 模型且无 reasoning metadata
- **THEN** reasoning selector MUST 展示 low/medium/high/xhigh 四档
- **AND** 默认档 MUST 为 medium

#### Scenario: Provider-owned model without metadata

- **WHEN** provider-scoped catalog 返回 `source: provider-custom` 或 `source: provider-config` 的模型且无 reasoning metadata，且 runtime identity 不命中 built-in catalog
- **THEN** reasoning selector MUST 展示 low/medium/high/xhigh 四档
- **AND** 默认档 MUST 为 medium

#### Scenario: Provider-owned model matches built-in identity first

- **WHEN** provider-owned 模型的 runtime identity 命中 built-in catalog（如 relay 上的 `gpt-5.6-sol`）
- **THEN** 系统 MUST 使用该 built-in model 的 model-specific 档位与 default
- **AND** 公共默认档 MUST NOT 覆盖 identity 匹配结果

#### Scenario: Custom model matches authoritative identity

- **WHEN** 自定义模型 runtime identity 命中 authoritative catalog
- **THEN** authoritative metadata MUST 覆盖公共默认档
- **AND** 公共默认档 MUST NOT 覆盖 runtime 返回

#### Scenario: Custom model selection preserves effort

- **WHEN** 用户在 Atomic picker 选择自定义 Codex 模型且 target reasoning 为空
- **THEN** 生成的 ExecutionTarget MUST 播种 `reasoning = { effort: "medium" }`
- **AND** 用户已选 effort MUST 不被覆盖

#### Scenario: Unknown runtime model stays neutral

- **WHEN** CLI discovery 返回的 unknown model 无 reasoning metadata
- **THEN** selector MUST 保持“默认”展示与 `selectedEffort = null`
- **AND** 不因本 requirement 获得伪造 capability
