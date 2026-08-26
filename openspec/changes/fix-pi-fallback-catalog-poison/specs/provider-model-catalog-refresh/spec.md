# Delta: provider-model-catalog-refresh

## ADDED Requirements

### Requirement: Fallback-Only Engine Catalog MUST NOT Poison Cache-First Resolution

后端 cache-first catalog 解析 MUST 把「全部 `source == "fallback"` 的合成兜底列表」视为不健康数据而非有效缓存。非 force 请求在 cached 全 fallback 时 MUST 照常走刷新，不得直接命中兜底列表；force 刷新得到全 fallback 结果且 cache 中存在真实 catalog 时 MUST 返回 last-good 且 MUST NOT 写回覆盖；全 fallback 结果在无可用旧缓存时 MAY 返回给 UI 降级展示，但 MUST NOT 写入 cache，使下次调用重新探测、探测恢复即自愈。

#### Scenario: fallback-only cache does not short-circuit

- **WHEN** engine status cache 中的 catalog 全部 `source == "fallback"`（如 PI 探测失败合成的 `auto`）
- **THEN** 非 force `get_engine_models` MUST 发起新鲜探测
- **AND** 探测成功时 MUST 返回真实 catalog 并写回 cache

#### Scenario: fallback-only fresh does not evict last-good

- **WHEN** force 刷新得到全 fallback 结果，且 cache 中存在含真实模型的 catalog
- **THEN** 系统 MUST 返回 last-good 真实 catalog
- **AND** cache MUST 保持 last-good 不被覆盖

#### Scenario: fallback-only fresh without cache is degrade-only

- **WHEN** 无可用旧缓存且探测得到全 fallback 结果
- **THEN** 兜底列表 MUST 返回给调用方用于 UI 降级展示
- **AND** 该兜底结果 MUST NOT 写入 engine status cache

### Requirement: Fallback-Only Catalog MUST Preserve Thread Ledger Model Selection

引擎 catalog 降级为全静态兜底时，若活动会话账本存在 modelId 且不在兜底列表中，composer MUST 把该账本 modelId 作为临时合成选项（`source: "ledger"`）纳入选择投影，使有效选择与会话 chip 显示账本模型 id，而非静默回落到兜底默认条目。合成选项 MUST NOT 携带思考档位元数据；catalog 恢复真实模型后 MUST 不再注入合成选项，账本 id 按正常 catalog 命中解析。codex / claude 的既有 freeform / managed runtime 链路 MUST 不受此逻辑影响。本投影变化 MUST NOT 在切会话点击路径引入任何 catalog IPC。

#### Scenario: history session keeps ledger model under degraded catalog

- **WHEN** PI catalog 全 fallback（仅 `auto`）且切到账本为 `kimi-coding/k3` 的历史会话
- **THEN** composer 模型 chip MUST 显示 `kimi-coding/k3`
- **AND** 有效发送模型 MUST 为 `kimi-coding/k3`

#### Scenario: healthy catalog suppresses the synthetic option

- **WHEN** catalog 含任一非 fallback 来源模型
- **THEN** 系统 MUST NOT 注入 `source: "ledger"` 合成选项
- **AND** 账本 id MUST 按正常 catalog 命中逻辑解析

#### Scenario: new session still shows the degrade entry

- **WHEN** PI catalog 全 fallback 且新建会话无账本 modelId
- **THEN** composer MUST 显示兜底默认条目（`auto`）作为降级发送路径
