# Delta: workspace-sidebar-session-loading

## ADDED Requirements

### Requirement: User-Initiated Thread List Reload MUST Force Session Index Rescan

用户显式触发的会话列表重载（侧栏「重新加载」入口）MUST 以强制发现语义执行：Session Index 写者 MUST rescan（`forceSessionIndexSync`），MUST NOT 只做温 SQLite 读（`syncIfNeeded: false, forceSync: false` 的 first-paint 默认路径）。

重载 MUST 保持 first-paint hydration kind，MUST NOT 因此升级为 full-catalog 多引擎盘扫扇出。

#### Scenario: reload within importer polling window surfaces new session

- **WHEN** 新 CLI 会话已落盘但后端 importer 90s 轮询尚未 tick
- **AND** 用户点击该 workspace 的「重新加载」
- **THEN** Session Index MUST 被强制 rescan
- **AND** 新会话 MUST 在本次重载结果中可见

#### Scenario: reload stays index-scoped

- **WHEN** 用户点击「重新加载」
- **THEN** hydration kind MUST 保持 first-paint
- **AND** MUST NOT fan out 多引擎盘扫（Gemini/Grok/OpenCode disk lists）

#### Scenario: passive paths keep warm reads

- **WHEN** 冷启动 first-paint / focus-refresh / 后台软重同步等非用户显式路径读取会话列表
- **THEN** 系统 MUST 维持既有温读与 freshness 策略
- **AND** MUST NOT 因本 requirement 增加强制 rescan
