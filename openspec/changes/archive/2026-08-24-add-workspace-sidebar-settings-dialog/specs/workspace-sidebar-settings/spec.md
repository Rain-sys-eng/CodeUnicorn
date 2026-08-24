## ADDED Requirements

### Requirement: Workspace section MUST expose a global settings dialog

侧栏「工作区」段头 MUST 在「添加项目」右侧提供设置按钮。激活后 MUST 打开不透明的工作区设置弹窗。该弹窗 MUST 编辑对所有项目生效的 sidebar 偏好，并 MAY 后续追加其他工作区设置项。

#### Scenario: settings button sits after add project

- **WHEN** 侧栏渲染工作区段头
- **THEN** 设置按钮 MUST 出现在「添加项目」按钮右侧
- **AND** 按钮 MUST 有可访问名称

#### Scenario: dialog is ready for more workspace preferences

- **WHEN** 用户打开工作区设置弹窗
- **THEN** 弹窗 MUST 以 preference list 呈现至少一项「默认显示会话数」
- **AND** 布局 MUST 允许后续追加同行设置，而不改入口位置

### Requirement: default sidebar session count MUST apply to all projects

系统 MUST 把折叠态默认露出的 unpinned root 会话数存在 `AppSettings.defaultVisibleThreadRootCount`。出厂默认 MUST 为 `5`。用户可调范围 MUST 为 `1..20`。该值 MUST 对所有未单独覆盖的 workspace / worktree / folder tree 生效。

#### Scenario: unset projects follow the global default

- **WHEN** workspace settings 不包含有效 `visibleThreadRootCount`
- **THEN** sidebar 折叠态 MUST 使用全局 `defaultVisibleThreadRootCount`
- **AND** 若全局值也缺失，MUST 回退到 `5`

#### Scenario: user can change the global default from the dialog

- **WHEN** 用户在工作区设置弹窗把默认显示会话数改成合法整数 N（1..20）
- **THEN** 系统 MUST 持久化到 AppSettings
- **AND** 所有未覆盖项目的折叠态默认露出条数 MUST 变为 N
- **AND** 「更多」分页 MUST 按 N / 2N / 3N… 递增

#### Scenario: invalid global values are clamped

- **WHEN** 全局值不是 1..20 的整数
- **THEN** 系统 MUST 在消费和持久化前将其收敛到 1..20
- **AND** MUST NOT 导致 sidebar 空白、全量展开或分页语义漂移

#### Scenario: explicit workspace override still wins

- **WHEN** 某个 workspace 已保存有效 `visibleThreadRootCount`
- **THEN** 该项目 MUST 继续使用自己的覆盖值
- **AND** 其他未覆盖项目 MUST 仍跟随全局默认
