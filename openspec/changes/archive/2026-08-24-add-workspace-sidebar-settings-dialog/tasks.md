## 1. Contract and defaults

- [x] 1.1 出厂默认 `DEFAULT_VISIBLE_THREAD_ROOT_COUNT` 12→5；新增全局 clamp `1..20`
  - 验证：constants 单测覆盖默认 5、全局 clamp、workspace 覆盖仍可到 200
- [x] 1.2 `AppSettings.defaultVisibleThreadRootCount` 打通 TS + Rust + normalize
  - 验证：缺字段回 5；21→20；0→1
- [x] 1.3 resolve helper：workspace 覆盖 ?? 全局默认；first-paint / Index page size 同源
  - 验证：threadList helper 单测

## 2. Sidebar settings dialog

- [x] 2.1 「添加项目」右侧加设置按钮
  - 验证：Sidebar 测到按钮在 add 之后，有可访问名称
- [x] 2.2 `WorkspaceSettingsDialog`：默认显示会话数 1..20，立即持久化
  - 验证：打开、改值、clamp、保存回调
- [x] 2.3 全 locale sidebar i18n + vitest setup / Sidebar mocks
  - 验证：无 raw key

## 3. Wiring and regression

- [x] 3.1 layoutNodes / Sidebar / WorktreeSection 吃全局默认
  - 验证：未覆盖项目用 5；覆盖项目仍用自己的值
- [x] 3.2 会话管理 hint 同步新默认；既有 12 断言改为 5
  - 验证：focused vitest 绿
- [x] 3.3 OpenSpec artifacts 齐
  - 验证：proposal / design / spec / tasks 齐套
