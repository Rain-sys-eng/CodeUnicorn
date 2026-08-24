## 1. Contract and persistence

- [x] 1.1 `AppSettings.workspaceWallpaper` 类型 + FE/Rust default（`none`）+ sanitize
- [x] 1.2 focused vitest：缺字段 / 非法 mode / 空自定义路径 / 非法扩展名

## 2. Wallpaper host

- [x] 2.1 `WorkspaceWallpaperHost` 挂主窗口 router，不进 AppShell bag
- [x] 2.2 fluid 复用 `FirstRunFluidBackdrop`；custom 用 `convertFileSrc` cover
- [x] 2.3 none / 兼容模式 / reduced-motion 降级
- [x] 2.4 focused vitest：三态渲染
- [x] 2.5 工作台 fluid 走 lite profile（半分辨率 / 12fps），输入时不停画

## 3. Surface translucency

- [x] 3.1 `workspace-wallpaper.css` 最后加载，覆盖 shell / reduced-transparency 实色 token
- [x] 3.2 气泡、popover、settings dialog 保持不透明
- [x] 3.3 主区 / 右侧 / topbar 与侧栏共用同一 `--workspace-wallpaper-veil`，去掉二次稀释

## 4. Settings entry

- [x] 4.1 外观页 segmented：默认 / 不要背景 / 自定义
- [x] 4.2 自定义上传、预览、清除；zh / en copy
- [x] 4.3 SettingsView 测试覆盖切换与上传
- [x] 4.4 默认流体提供多套配色预设
- [x] 4.5 开启背景后可调毛玻璃强度（0–20px，默认 12）
- [x] 4.6 三栏统一毛玻璃，去掉可调灰蒙层

## 5. Verify

- [x] 5.1 focused vitest 绿
- [x] 5.2 不改 AppShell domain bag / ownership
- [x] 5.3 wallpaper frost 不得盖住标题栏控件；Home 空白条仍可拖窗
