# sidebar-pinned-calendar-fold delta

## MODIFIED Requirements

### Requirement: pinned dates MUST be the outermost headers and MUST match the workspace section

当侧栏存在至少一条全局置顶会话时，置顶区顶部 MUST 渲染一个总折叠行：pin icon + 本地化「已固定」文案 + 置顶数量 + 折叠 chevron，视觉 MUST 复用工作区 section header 合同（`.sidebar-section-header` / `.sidebar-section-title`）。点击该行 MUST 折叠或展开整个置顶区；折叠时 MUST 只保留该行，所有日历日组头与会话行 MUST NOT 渲染。总折叠状态 MUST 持久化到 clientStorage（`layout.pinnedSectionFold.sectionExpanded`），重启后 MUST 保留。

段展开时，最外层内容 MUST 直接是本地日历日 `yyyy-mm-dd` 组头，MUST NOT 在日组头与总折叠行之间再插入其它分区层。日期头视觉 MUST 与「工作区」section header 对齐，MUST NOT 展示折叠 chevron 或数量角标。日期头仍 MUST 可激活以折叠/展开该日。

总折叠是显式用户状态：当前活跃会话落在置顶区时，系统 MUST NOT 自动展开已折叠的总折叠行；日级 auto-expand MUST 只在段已展开时生效。

#### Scenario: master fold row collapses the whole pinned section

- **WHEN** 用户点击置顶区顶部的总折叠行
- **THEN** 所有 `yyyy-mm-dd` 日组头与会话行 MUST 隐藏，只保留总折叠行
- **AND** 再次点击 MUST 恢复展开，各日组折叠状态 MUST 与收起前一致

#### Scenario: master fold state persists across reload

- **WHEN** 用户折叠总折叠行后重启应用
- **THEN** 置顶区 MUST 以折叠态首屏渲染
- **AND** MUST NOT 先展开再闪回收起

#### Scenario: date headers sit at the outer layer like 工作区

- **WHEN** 置顶区段处于展开态且按日渲染
- **THEN** 每个组头 MUST 使用工作区 section header 的视觉合同
- **AND** 组头可见文案 MUST 仅为该日的 `yyyy-mm-dd`
- **AND** 总折叠行之下 MUST 直接是 `yyyy-mm-dd` 组头，不得插入其它分区层

#### Scenario: active thread MUST NOT override a collapsed section

- **WHEN** 总折叠行处于折叠态且当前活跃会话在置顶区内
- **THEN** 系统 MUST 保持总折叠行折叠
- **AND** MUST NOT 因活跃会话自动展开总折叠行
