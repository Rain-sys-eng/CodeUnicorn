# sidebar-thread-pin-scope Specification

## Purpose
TBD - created by archiving change add-thread-pin-scope-and-section-fold. Update Purpose after archive.
## Requirements
### Requirement: pin scopes MUST be mutually exclusive

置顶作用域 MUST 只有 `global` 与 `workspace` 两种，同一会话同一时刻 MUST 至多处于一个作用域。将会话置顶到某一作用域时，系统 MUST 同时移除其在另一作用域的置顶记录。取消置顶 MUST 清除该会话在全部作用域的置顶记录。

#### Scenario: pinning to project removes the global pin

- **WHEN** 一条已全局置顶的会话被选择「置顶到项目内」
- **THEN** 该会话 MUST 从全局置顶区消失
- **AND** MUST 以项目内置顶身份排在其 workspace 会话列表顶部

#### Scenario: pinning to global removes the project pin

- **WHEN** 一条已项目内置顶的会话被选择「置顶到全局」
- **THEN** 该会话 MUST 离开 workspace 列表顶部
- **AND** MUST 进入全局置顶区

#### Scenario: unpin clears whichever scope holds the thread

- **WHEN** 用户取消一条已置顶会话的置顶
- **THEN** 该会话在两个作用域的置顶记录 MUST 都被清除
- **AND** 该会话 MUST 回到常规会话列表且 MUST NOT 产生重复行

### Requirement: project-pinned threads MUST lead their workspace session list

`workspace` 作用域置顶的 root 会话 MUST 渲染在其所属 workspace 会话列表的最顶部、普通会话之前，且 MUST NOT 进入全局置顶区。项目内置顶 root 之间 MUST 按 pin timestamp 排序（与全局置顶区同一排序约定），子会话 MUST 跟随其 root。项目内置顶 MUST NOT 占用 workspace 列表的分页配额（`visibleThreadRootCount`），也 MUST NOT 计入 `totalRoots`。置顶状态 MUST 持久化到 clientStorage（`threads`/`workspacePinnedThreads`），重启后 MUST 保留。

#### Scenario: project-pinned rows render at the top of the workspace list only

- **WHEN** 一条会话被置顶到项目内
- **THEN** 该会话 MUST 渲染在其 workspace 会话列表顶部并带 pin 图标
- **AND** MUST NOT 出现在侧栏全局置顶区

#### Scenario: project-pinned roots order by pin timestamp

- **WHEN** 同一 workspace 存在多条项目内置顶会话
- **THEN** 它们 MUST 按 pin timestamp 以与全局置顶区相同的顺序约定排列

#### Scenario: project pin survives reload

- **WHEN** 用户置顶会话到项目内后重启应用
- **THEN** 该会话 MUST 仍以项目内置顶身份渲染在其 workspace 列表顶部

#### Scenario: children stay with the project-pinned root

- **WHEN** 一条项目内置顶 root 带有 depth > 0 的子会话
- **THEN** 子会话 MUST 随 root 一并渲染在 workspace 列表顶部区段

### Requirement: pin entries MUST offer both scopes and mark the active one

线程右键菜单的 pin 项 MUST 是 submenu，包含「置顶到全局」与「置顶到项目内」两个选项。当前生效的作用域 MUST 在菜单项上有可见标注。选择当前已生效的作用域 MUST 取消置顶；选择另一作用域 MUST 迁移置顶。未置顶会话的 hover pin 图标点击 MUST 弹出同款两选项菜单。会话不满足 pin 条件（`canPin` 为 false）时 MUST NOT 渲染任何 pin 入口。

#### Scenario: context menu shows the pin submenu with two scope options

- **WHEN** 用户打开一条可置顶线程的右键菜单
- **THEN** pin 入口 MUST 是包含「置顶到全局」「置顶到项目内」两个选项的 submenu

#### Scenario: active scope is marked and reselecting it unpins

- **WHEN** 一条已全局置顶的线程打开 pin submenu
- **THEN** 「置顶到全局」MUST 有当前作用域标注
- **AND** 点击「置顶到全局」MUST 取消置顶
- **AND** 点击「置顶到项目内」MUST 将会话迁移为项目内置顶

#### Scenario: unpinned hover pin click opens the same two-option menu

- **WHEN** 用户点击未置顶线程行的 hover pin 图标
- **THEN** 系统 MUST 在点击位置弹出包含两个作用域选项的菜单
- **AND** 菜单选项与右键 pin submenu MUST 一致

### Requirement: pin scope copy MUST be localized

作用域菜单的可访问名称与可见文案 MUST 走 i18n，仓库已支持的任一 locale 都 MUST 有 `threads.pinToGlobal` 与 `threads.pinToProject` 的翻译，MUST NOT 回退成 raw key。

#### Scenario: missing locale keys are not acceptable

- **WHEN** 切换到仓库已支持的任一 locale
- **THEN** `threads.pinToGlobal`、`threads.pinToProject` MUST 都有翻译

