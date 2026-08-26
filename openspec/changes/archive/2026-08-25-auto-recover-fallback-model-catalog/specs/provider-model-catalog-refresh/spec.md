# Delta: provider-model-catalog-refresh

## ADDED Requirements

### Requirement: Fallback-Only Engine Catalog MUST Auto-Recover On Picker Open

Native 模型选择器打开时，若当前引擎可见 catalog 全部来自静态兜底（每行 `source === "fallback"` 且非空），系统 MUST 自动触发一次该引擎的 forced refresh，并复用手动刷新按钮的 spinner / error 语义（菜单保持打开）。每次菜单打开 MUST 最多触发一次自动刷新；in-flight 期间 MUST NOT 双发；失败后 MUST NOT 自动循环重试。catalog 已有真实模型或为空 catalog 引导态时 MUST NOT 触发。切会话路径 MUST NOT 因此新增任何 catalog IPC。Atomic / Shared picker 已有的打开预取行为 MUST 保持不变。

#### Scenario: fallback-only catalog auto-refreshes on open

- **WHEN** Native 模型选择器打开，且当前引擎组 models 全部 `source === "fallback"`
- **THEN** 系统 MUST 自动触发一次 forced refresh
- **AND** 菜单 MUST 保持打开并显示刷新 spinner
- **AND** 刷新成功后菜单内 MUST 直接呈现真实 catalog

#### Scenario: live catalog does not auto-refresh

- **WHEN** 选择器打开，且当前引擎组含任何非 fallback 来源的模型
- **THEN** 系统 MUST NOT 发起 catalog IPC

#### Scenario: refresh failure does not loop

- **WHEN** 自动刷新失败
- **THEN** 菜单 MUST 显示错误文案（复用刷新按钮 error 位）
- **AND** 系统 MUST NOT 自动重试，直到下次菜单打开再触发一次

#### Scenario: session switch stays catalog-free

- **WHEN** 用户在侧栏连续切换会话（含 PI 会话）
- **THEN** 系统 MUST NOT 发起任何 catalog IPC
- **AND** 自动恢复逻辑 MUST 只由模型选择器打开事件驱动

### Requirement: On-Demand Catalog Timeout MUST Cover Backend Probe Chain

on-demand catalog 请求的 orchestrator timeout MUST 覆盖目标引擎后端最坏探测链（含回退路径）；idle-prewarm MAY 使用更短 timeout。PI 引擎后端 version 探测与 models 探测 MUST 并行执行，使最坏串行链不超过单次探测 timeout 与 models 回退链之和。

#### Scenario: on-demand refresh survives slow CLI cold start

- **WHEN** PI CLI 冷启动导致 RPC 探测接近超时并回退 `--list-models`
- **THEN** FE on-demand 请求 MUST NOT 在后端最坏路径（~20s）内被 8s 超时截断
- **AND** 超时兜底 MUST 仅在超过覆盖阈值后触发

#### Scenario: pi detection probes run concurrently

- **WHEN** backend 执行 `detect_pi_status`
- **THEN** version 探测与 models 探测 MUST 并行发起
- **AND** 未安装时 models 探测结果 MUST 被丢弃，返回 not-installed 状态
