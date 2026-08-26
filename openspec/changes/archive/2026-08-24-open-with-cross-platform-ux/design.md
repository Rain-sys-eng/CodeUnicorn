# Design: open-with-cross-platform-ux

## Context

- UI：`src/features/settings/components/settings-view/sections/OpenAppsSection.tsx`
- 类型：`OpenAppTarget.kind = "app" | "command" | "finder"`
- 启动：`open_workspace_in`（mac `open -a`；非 mac 候选 PATH/安装路径）
- 文件管理器：`reveal_in_file_manager` 已分平台，但前端文案未分平台
- 图标：`useOpenAppIcons` 仅 mac 且受 `enabled` 门控（应继续）
- 性能基线：禁止高频根链 setState；设置页能力必须懒加载

原型参考：`docs/prototypes/open-with-redesign-v1.html`

## Goals / Non-Goals

### Goals

1. 小白路径：预设 + Browse
2. 跨平台文案正确
3. 健康态轻量、懒探测
4. 零冷启动回归

### Non-Goals

- 宏系统 / dry-run
- 全盘 App 索引
- Win 原生图标抽取（本期）

## Decisions

### D1. 持久化 kind 保持 `finder`，展示层平台化

- **选择**：存储与类型继续 `kind: "finder"`，避免大规模迁移与 serde 破坏。
- **展示**：i18n 键按平台选择 `typeFileManagerMac` / `Windows` / `Linux`，或运行时 `platformFileManagerLabel()`。
- **备选**：rename 为 `fileManager` + 读入兼容 → 收益小、触点多，本期不做。

### D2. 添加流改为两阶段 Dialog

1. **AddPicker**：搜索 + 预设网格 + Browse + 自定义命令入口  
2. **EditDialog**：沿用现有字段；app 行增加 Browse；command 保持文本  

「添加」不再直接塞空 draft 再开空编辑框。

### D3. 预设目录前端静态 + 后端可选 probe

- 前端：`OPEN_APP_PRESETS` 按平台列出 id/label/defaultAppName/commandHints  
- 后端新增（推荐）`probe_open_app_presets`：对已知候选做 **同步一次性** existence/which 检查，返回 `{ id, installed, resolvedPath? }[]`  
- **仅当** OpenAppsSection `active===true` 时 invoke 一次；结果放 section 内 state / module cache  
- **备选**：纯前端不探测 → 无法显示「已检测」，体验弱  

### D4. Browse 用 Tauri dialog，不自研文件浏览器

- 新增 `pickApplicationPath()`：  
  - mac：可无 filter 或 `app`  
  - win：`exe`  
- 选中后写入 `appName`（绝对路径优先）；label 默认取 basename  

### D5. 健康态计算规则（轻量）

| 条件 | 状态 |
|------|------|
| kind=finder | 始终 ok |
| kind=app 且绝对路径且 probe 文件不存在 | broken |
| kind=app 且命中 preset installed | ok |
| kind=app 仅显示名、未 probe | unknown（不阻塞保存） |
| kind=command 非空 | unknown/ok（不强制 which） |

列表徽标；**不**在后台轮询。

### D6. 性能护栏（硬）

1. 不在 `main` / AppShell / workspace 切换时调用 probe  
2. `useOpenAppIcons` 继续 `enabled: active`  
3. probe 结果 module-level cache（session），同一会话二次进入设置不重复 IPC（可选 force refresh 按钮，默认无）  
4. 预设网格仅在 AddPicker 挂载时渲染；关闭即卸载  
5. 禁止 setInterval 健康检查  

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| probe 在慢盘上阻塞 UI | spawn_blocking + 前端 await 时 skeleton；超时则全部 unknown |
| 绝对路径写入后跨机同步失效 | 健康态 broken + 引导 Browse |
| i18n 十语言未齐 | zh/en 必填；其它语言先回退 en 或复制 en 键 |
| 误把探测挂到全局 store | 代码审查：state 仅 OpenAppsSection / SettingsView 局部 |

## Migration Plan

1. 发布后旧 `openAppTargets` 原样加载  
2. 默认列表仍含 finder + 编辑器预设  
3. 回滚：恢复旧 OpenAppsSection 与 i18n 键即可；无 DB migration  

## Open Questions

- Linux 预设是否包含 `code`/`cursor` only：是  
- 是否提供「刷新检测」：P1 可选，默认不暴露以减复杂度  

## 实现落点（文件）

| 区域 | 文件 |
|------|------|
| UI | `OpenAppsSection.tsx`（AddPicker + Browse） |
| Drafts | `settingsViewActions.ts` |
| Presets | 新 `src/features/app/constants/openAppPresets.ts` 或扩 `constants.ts` |
| Pick | `src/services/tauri/filePickers.ts` |
| Probe | `src-tauri/src/workspaces/commands.rs` + tauri export |
| i18n | `src/i18n/locales/*/settings.ts`（至少 zh/en） |
| 测试 | OpenAppsSection 或 openApp utils 单测 |
