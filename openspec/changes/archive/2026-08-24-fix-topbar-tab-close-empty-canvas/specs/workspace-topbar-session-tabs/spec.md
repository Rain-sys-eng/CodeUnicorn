# workspace-topbar-session-tabs · Spec Delta

## MODIFIED Requirements

### Requirement: Topbar Tab MUST Provide Close Action Without Lifecycle Side Effects

系统 MUST 将 topbar tab 的关闭能力定义为“窗口管理”，而不是 thread 生命周期操作。

#### Scenario: single close still removes tab from topbar window only

- **WHEN** 用户点击 tab 的 `X`
- **THEN** 该 tab MUST 从 topbar 窗口移除
- **AND** 系统 MUST NOT 删除 thread
- **AND** 系统 MUST NOT 终止会话运行

#### Scenario: close all removes every visible topbar tab only

- **WHEN** 用户在某个 topbar tab 上触发 `关闭全部标签`
- **THEN** 当前 topbar 窗口中的所有 tab MUST 被移除
- **AND** 系统 MUST NOT 删除任何 thread
- **AND** 系统 MUST NOT 终止任何会话运行

#### Scenario: close completed removes only non-processing visible tabs

- **WHEN** 用户触发 `关闭全部已完成标签`
- **THEN** 系统 MUST 仅移除当前 topbar 窗口中 `isProcessing = false` 的 tab
- **AND** `isProcessing = true` 的 tab MUST 被保留
- **AND** `isProcessing` 状态未知（缺失/未初始化）的 tab MUST 被保留
- **AND** 该动作 MUST NOT 删除 thread 或终止会话运行

#### Scenario: close left removes only tabs left of the target tab

- **GIVEN** topbar 窗口中存在位于目标 tab 左侧的可见 tabs
- **WHEN** 用户触发 `关闭左侧标签`
- **THEN** 系统 MUST 仅移除目标 tab 左侧的可见 tabs
- **AND** 目标 tab 与其右侧 tabs MUST 保留

#### Scenario: close right removes only tabs right of the target tab

- **GIVEN** topbar 窗口中存在位于目标 tab 右侧的可见 tabs
- **WHEN** 用户触发 `关闭右侧标签`
- **THEN** 系统 MUST 仅移除目标 tab 右侧的可见 tabs
- **AND** 目标 tab 与其左侧 tabs MUST 保留

#### Scenario: active close falls back to adjacent remaining tab

- **GIVEN** 当前 active tab 被单个关闭或批量关闭动作移出 topbar 窗口
- **WHEN** 关闭后 topbar 窗口仍存在剩余 tabs
- **THEN** 系统 MUST 优先选择关闭前位置右侧最近的剩余 tab
- **AND** 若右侧不存在，则 MUST 选择左侧最近的剩余 tab

#### Scenario: closing active tab with no remaining tabs clears thread selection to an empty canvas

- **WHEN** 当前 active tab 被关闭后 topbar 窗口已无剩余 tab（单个关闭 / 关闭全部 / close-current-session 快捷键任一入口）
- **THEN** 系统 MUST 清空该 workspace 的 active thread 选择（`activeThreadId = null`）
- **AND** 画布 MUST 落到「workspace 无 active thread」空画布态，MUST NOT 继续渲染刚被关闭会话的内容
- **AND** 系统 MUST NOT 经 workspace 导航路径恢复该 workspace 的 last selected thread
- **AND** 被关闭的 tab MUST NOT 因本次清空操作重新出现在 topbar 窗口
- **AND** 系统 MUST NOT 因此删除 thread、归档 thread 或终止会话运行
- **AND** 清空路径 MUST 仅执行 identity + chrome 状态更新，MUST NOT 触发 `refreshEngineModels` / `get_engine_models` / `vendor_switch_*` 等 IPC

#### Scenario: closed thread can be re-opened from the sidebar after an empty-canvas close

- **GIVEN** 用户关闭最后一个 topbar tab 且画布已落空态
- **WHEN** 用户从侧栏会话列表重新激活被关闭的 thread
- **THEN** 系统 MUST 正常切换到该 thread
- **AND** 该 thread MUST 重新进入 topbar 轮转窗口
