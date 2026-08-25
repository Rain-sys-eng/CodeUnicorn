# workspace-sidebar-visual-harmony delta

## MODIFIED Requirements

### Requirement: Thread Pin Toggle Interaction MUST Be Hover-Revealed and Non-Disruptive

根线程行的 pin/unpin 入口 MUST 在悬停或键盘聚焦时显示，且 pin 操作不得误触发线程切换。置顶拆分为互斥的 `global` 与 `workspace` 两个作用域后，hover pin 图标在会话未置顶时点击 MUST 弹出包含「置顶到全局」「置顶到项目内」两个选项的作用域菜单；会话已置顶（任一作用域）时点击 MUST 直接取消当前作用域的置顶。

#### Scenario: root thread rows reveal pin toggle on hover/focus only

- **WHEN** 用户悬停或聚焦根线程行
- **THEN** 系统 MUST 显示图钉切换入口
- **AND** 非根线程行 MUST NOT 显示该入口

#### Scenario: clicking pin toggle on an unpinned thread opens the scope menu

- **WHEN** 用户点击未置顶根线程行的图钉切换入口
- **THEN** 系统 MUST 弹出包含「置顶到全局」与「置顶到项目内」两个选项的菜单
- **AND** MUST NOT 触发线程选中或导航
- **AND** MUST NOT 在选择作用域之前改变任何置顶状态

#### Scenario: clicking pin toggle on a pinned thread unpins it directly

- **WHEN** 用户点击已置顶（全局或项目内）根线程行的图钉切换入口
- **THEN** 系统 MUST 仅取消该线程当前作用域的置顶
- **AND** MUST NOT 触发线程选中或导航

#### Scenario: unpin from pinned section updates lists without stale duplicates

- **WHEN** 用户在固定区点击某线程的 `Unpin`
- **THEN** 该线程 MUST 从固定区移除并回到常规线程列表
- **AND** 系统 MUST NOT 保留残留项或产生重复行
