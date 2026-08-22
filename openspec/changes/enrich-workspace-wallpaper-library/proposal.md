## Why

竞品 `dsh-wallpaper-engine` 的更换壁纸体验完整：缩略图选择弹窗、本地图/视频库、倍速/翻转、模糊与暗化、隐藏恢复。本仓库目前只有流体三选一 + 单张本地图路径，自定义入口无法浏览已选过的壁纸，也不支持视频。用户希望把这套「可换、可管、可调」的能力接到工作台 Appearance，而不是依赖 Wallpaper Engine 工坊扫描。

## 目标与边界

### 目标

- Settings → 外观的「自定义」升级为 **wallpaper library**：可导入多张 JPG/PNG/WebP/GIF/BMP 与 MP4，选择弹窗用缩略图网格点选。
- 选中项立即铺到主窗口；图片 cover/contain/center/fill，视频静音循环播放，可暂停、倍速、水平翻转。
- 导入文件复制进 `~/.ccgui/wallpapers/`，设置只存 library id + 受管路径；重启不丢。
- 可隐藏/恢复库内项（软删除，不碰源文件）；可从库中移除受管副本。
- 自定义态提供壁纸模糊、暗化，与既有毛玻璃滑杆并存；可选按间隔在未隐藏项之间轮播。

### 边界

- 不接入 Steam Wallpaper Engine 工坊扫描、Scene `.pkg` 提取、Web/HTML iframe、Application 壁纸。
- 不把 wallpaper 状态塞进 AppShell domain bag。
- 不改 first-run wizard 独立背景；不在 detached / about 窗口挂主窗口 wallpaper。
- 不做黑胶唱片、CD 架紧凑布局、内容分级、设置窗口整页液态玻璃换肤。
- 不把 Windows 流体兜底写进 Mac 默认路径；视频/图片走 CSS，不新增 WebGL。

## 非目标

- 不复制竞品 host HTTP 路由或 Cordis 插件形态。
- 不把自定义文件上传到远程服务器。
- 不改 native 窗口透明 / Dock icon。

## What Changes

| 区域 | 变更 |
|------|------|
| `AppSettings.workspaceWallpaper` | library 数组、selectedLibraryId、blur/darken/playbackRate/flip/objectFit/paused/rotation |
| Rust `import_workspace_wallpaper` / `remove_workspace_wallpaper` | 复制进 app home、删除受管副本 |
| `WorkspaceWallpaperHost` | 渲染库内图片或 `<video>`，应用效果 token |
| Settings 外观 | 自定义态：当前壁纸卡 + 选择弹窗 + 效果控件 |
| i18n / CSS / tests | zh/en 主文案 + 其余 locale 英文占位；focused vitest + Rust unit |

## Capabilities

### New Capabilities

- 无。本 change 是既有 `workspace-wallpaper` 的增量。

### Modified Capabilities

- `workspace-wallpaper`：自定义模式从单路径升级为可管理的本地图/视频库，并补齐选择弹窗与效果。

## 验收标准

1. 自定义态点「选择壁纸」打开不透明缩略图弹窗；点一张立即换背景并持久化。
2. 可导入多张图片与至少一个 MP4；视频静音循环；暂停/倍速/翻转即时生效、不重载。
3. 隐藏只从网格拿掉，可在「已隐藏」恢复；移除才删 `~/.ccgui/wallpapers/` 副本。
4. 旧 `customImagePath` 仍能显示；新导入进入 library 后优先用 selectedLibraryId。
5. 流体 / 不要背景行为不变；Windows 流体路径不被这次改动回写。
6. focused vitest + Rust wallpaper command 测试绿。

## Impact

| 层 | 影响 |
|----|------|
| Frontend feature | theme wallpaper host + settings appearance picker |
| App settings | 扩展 `workspaceWallpaper` 字段，sanitize 兼容旧存储 |
| Rust | 新 command 复制/删除受管壁纸文件 |
| CSS | 视频层、object-fit、blur/darken token |
| OpenSpec | 本 change + `workspace-wallpaper` delta |
