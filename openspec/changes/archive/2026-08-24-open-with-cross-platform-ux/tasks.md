# Tasks: open-with-cross-platform-ux

## 1. OpenSpec

- [x] 1.1 创建 proposal / design / specs / tasks
- [x] 1.2 `openspec status` 确认 apply-ready；实现后 validate

## 2. i18n 与平台文案（P0）

- [x] 2.1 增加文件管理器平台文案键（mac/win/linux）与中性 openInHelp
- [x] 2.2 OpenAppsSection / kindLabel 按平台选择展示名
- [x] 2.3 zh + en 必填；其它 locale 回退 en

## 3. Browse 与添加向导（P0–P1）

- [x] 3.1 `pickApplicationPath()`（dialog filters 分平台）
- [x] 3.2 预设目录 `openAppPresets`（按平台）
- [x] 3.3 AddPicker UI：搜索 + 预设 + Browse + 自定义命令
- [x] 3.4 编辑 Dialog：app 行 Browse；缺省路径写入 appName
- [x] 3.5 未检测预设 → 引导 Browse

## 4. 懒探测与健康态（P1，性能护栏）

- [x] 4.1 后端 `probe_open_app_presets` + 前端 invoke
- [x] 4.2 仅 section `active` 时触发；module cache
- [x] 4.3 列表健康徽标（ok / missing / broken / unknown）
- [x] 4.4 确认无冷启动调用、无 interval（`useOpenAppPresetProbe` + session cache）

## 5. 兼容与打开路径

- [x] 5.1 保留 kind finder/app/command；appName 可存绝对路径
- [x] 5.2 OpenAppMenu / openPathInTarget 未改契约（仍走 open_workspace_in / reveal）

## 6. 测试与回归

- [x] 6.1 单元：平台 label、preset、health
- [x] 6.2 组件级：设置 section 逻辑集成于 OpenAppsSection（dialog/browse 走 Tauri）
- [x] 6.3 相关 vitest 绿
- [x] 6.4 Rust `probe_open_app_presets_sync_returns_catalog_entries` 绿
- [x] 6.5 用户手测验收通过（顶栏开当前文件 / 访达开工作区 / 底栏下拉 / 图标与主题）
