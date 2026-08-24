# sidebar-pinned-calendar-fold Specification

## Purpose
TBD - created by archiving change fold-sidebar-pinned-by-calendar-day. Update Purpose after archive.
## Requirements
### Requirement: pinned dates MUST be the outermost headers and MUST match the workspace section

当侧栏存在至少一条全局置顶会话时，置顶区 MUST NOT 渲染「已固定」分区头、钉子 icon、或段级折叠控件。最外层 MUST 直接是本地日历日 `yyyy-mm-dd` 组头。日期头视觉 MUST 与「工作区」section header 对齐（复用 `.sidebar-section-header` / `.sidebar-section-title`），MUST NOT 展示折叠 chevron 或数量角标。日期头仍 MUST 可激活以折叠/展开该日。

#### Scenario: no pinned section layer

- **WHEN** 置顶区有 N 条 root 会话
- **THEN** 界面 MUST NOT 显示「已固定」或等价段头文案
- **AND** MUST NOT 渲染钉子段头 icon
- **AND** MUST NOT 渲染折叠 chevron

#### Scenario: date headers sit at the outer layer like 工作区

- **WHEN** 置顶区按日渲染
- **THEN** 每个组头 MUST 使用工作区 section header 的视觉合同
- **AND** 组头可见文案 MUST 仅为该日的 `yyyy-mm-dd`

### Requirement: pinned rows MUST group by local calendar day as yyyy-mm-dd

置顶会话 MUST 按 root `updatedAt` 的本地日历日分组。组头文案 MUST 是 `yyyy-mm-dd`。系统 MUST NOT 使用「今天 / 昨天 / 更早」或其它相对日桶。子会话 MUST 跟随其 root；continuation family MUST 跟随 representative 的日期。

#### Scenario: latest day is open and older days are collapsed by default

- **WHEN** 置顶区包含多个日历日且用户未改过日折叠状态
- **THEN** 系统 MUST 展开日期最大的那一组
- **AND** 更早的日期组 MUST 只显示组头、不显示会话行

#### Scenario: date headers use calendar keys only

- **WHEN** 置顶区按日渲染
- **THEN** 每个组头 MUST 显示该组的 `yyyy-mm-dd`
- **AND** 组头 MUST NOT 显示今天 / 昨天 / 更早

#### Scenario: toggling a day only affects that calendar day

- **WHEN** 用户激活某个已收起的日期头
- **THEN** 系统 MUST 只展开该 `yyyy-mm-dd` 下的置顶行
- **AND** 其它日期的展开状态 MUST 不变

#### Scenario: children stay with the root day

- **WHEN** 一条置顶 root 带有 depth > 0 的子会话，且子会话 `updatedAt` 落在另一天
- **THEN** 子会话 MUST 仍渲染在 root 的日历日组内

#### Scenario: active thread day auto-expands

- **WHEN** 当前会话落在已收起的日期组
- **THEN** 系统 MUST 展开该日期组
- **AND** MUST NOT 因此展开其它日期组

### Requirement: pinned fold copy MUST be localized

日期头折叠/展开动作的可访问名称 MUST 走 i18n，不得在非英语 locale 回退成 raw key。日期键 `yyyy-mm-dd` 保持原文。

#### Scenario: missing locale keys are not acceptable

- **WHEN** 切换到仓库已支持的任一 locale
- **THEN** `sidebar.collapsePinnedDay`、`sidebar.expandPinnedDay` MUST 都有翻译

