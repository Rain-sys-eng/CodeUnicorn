## MODIFIED Requirements

### Requirement: Parallel Sessions With Different Providers MUST Be Isolated

同一 workspace 下，绑定不同供应商的会话 MUST 并行运行且互不影响。
（保持既有 scenario；补充 create-menu 入口不得破坏该隔离。）

#### Scenario: two Claude threads with different providers

- **WHEN** 同一 workspace 下同时存在绑定 managed provider A 的 Claude 会话与绑定 managed provider B（或本地配置）的 Claude 会话
- **THEN** 两个会话各自的 turn 进程 MUST 仅注入各自绑定对应的供应商配置
- **AND** 任一会话的发送 MUST NOT 修改全局 `~/.claude/settings.json`

#### Scenario: two Kimi threads with different providers

- **WHEN** 同一 workspace 下同时存在绑定不同 managed provider 的 Kimi 会话
- **THEN** 每个会话的 `kimi` 进程 MUST 以其绑定 provider 物化的独立 `KIMI_CODE_HOME` 启动
- **AND** 任一会话的发送 MUST NOT 修改全局 `~/.kimi-code/config.toml`

#### Scenario: Kimi workspace control reaches every provider runtime

- **WHEN** 同一 workspace 下存在多个 provider-scoped Kimi runtime，用户执行 workspace interrupt、turn interrupt、remove 或 shutdown
- **THEN** manager MUST 定位并控制该 workspace 下的全部 matching runtime
- **AND** provider-scoped map key MUST NOT 使旧 workspace-only control path 漏掉 child process owner

#### Scenario: global switch does not reroute bound threads

- **WHEN** 用户在设置页切换全局供应商（`vendor_switch_claude_provider` / `vendor_switch_kimi_provider`）
- **THEN** managed-bound 会话的后续发送 MUST 继续使用其绑定供应商
- **AND** 无绑定或 local/default 会话 MUST 跟随新的全局默认

#### Scenario: create-menu binding preserves isolation

- **WHEN** 用户通过新建会话菜单先后为同一 engine 创建绑定 A 与绑定 B 的两个 native 会话
- **THEN** 两会话的 thread binding MUST 分别记录 A 与 B
- **AND** 后续全局设置页 switch 到 C MUST NOT 改写 A/B 已记录的 managed binding

#### Scenario: historical native second turn ignores last-used parallel provider residue

- **WHEN** 用户并行使用多个 native Claude 会话且各自绑定不同 managed provider（例如 A=MiniMax、B=DeepSeek）
- **AND** 用户返回会话 A 发起第二次（或后续）turn
- **THEN** 该 turn 的生效 provider 路由 MUST 仍为会话 A 的 L2 `providerProfileId`（发送参数或 catalog binding）
- **AND** 上送 runtime model MUST 按会话 A 绑定 profile 的 catalog/env 解析；MUST NOT 静默使用会话 B 遗留的产品模型名导致跨供应商 400
- **AND** Shared Session 路径 MUST NOT 被本 scenario 要求改动

## ADDED Requirements

### Requirement: Composer Draft MUST Not Contaminate Finalized Historical Native Sessions

从某一 native 会话离开到「无 active thread」再进入 **已 finalized 的历史会话** 时，系统 MUST NOT 把上一会话的 composer draft model selection 写入该历史会话。

#### Scenario: draft applies only to pending create threads

- **WHEN** `shouldApplyDraftToNextThread` 为 true 且存在 draft selection
- **AND** 目标 `activeThreadId` 为 finalized 历史会话（id 不含 `-pending-`）
- **THEN** draft MUST NOT 应用到该会话
- **AND** 仅当目标为 `*-pending-*` 创建中会话时 draft 才可应用（保持既有 create 体验）
