## Why

新手指引的 fluid backdrop 视觉完成度明显高于进入主界面后的实色壳。用户希望把同一套默认背景带到工作台，并在设置里选择默认背景、关闭背景，或上传自定义图片。

## 目标与边界

### 目标

- 主窗口默认不渲染 wallpaper；用户可在设置里手动开 first-run 同款 fluid，或上传图片。
- Settings → 外观 提供三选一：不要背景 / 流体背景 / 自己上传图片。
- 选择立即生效并跨重启持久化；损坏路径 / 非法 mode 安全回退。
- 工作区面板在开启背景时半透明，保证背景可见且正文可读。

### 边界

- 不把 wallpaper 状态塞进 AppShell domain bag。
- 不新增 Rust command；自定义图保存本地绝对路径，用既有 `convertFileSrc` 读取。
- 不改 first-run wizard 的独立背景；向导继续自带 `FirstRunFluidBackdrop`。
- 不在 detached / about 窗口挂主窗口 wallpaper。
- 性能兼容模式或 `prefers-reduced-motion` 时默认流体只画静态帧，不循环 RAF。

## 非目标

- 不做多套内置预设、色相滑杆或视频背景。
- 不把自定义图复制进 app data，也不做跨设备同步。
- 不改 native 窗口透明 / Dock icon。

## What Changes

| 区域 | 变更 |
|------|------|
| `AppSettings.workspaceWallpaper` | `none` / `fluid` / `custom` + 可选自定义路径 |
| `src/features/theme/**` | wallpaper 类型、sanitize、主窗口 host |
| Settings 外观 | segmented 入口 + 上传 / 清除 |
| 主窗口 CSS | `.app` / home / messages / composer / sidebar / right-panel 共用同一 `--workspace-wallpaper-veil` |
| i18n | zh / en settings copy |
| OpenSpec | 本 change + capability delta |

## Capabilities

### New Capabilities

- `workspace-wallpaper`：主窗口背景 mode、持久化、设置入口、可读性 / 降级。

### Modified Capabilities

- 无

## 验收标准

1. 默认（含缺字段）主窗口不挂 wallpaper，保持实色主题底。
2. 用户手动选流体或自定义后立即生效；选「不要背景」后立即回到实色主题底，重启后仍关闭。
3. 上传本地图片后立即铺满主窗口；路径丢失或非法扩展名回退到默认 fluid。
4. 设置页 segmented 可扫读；自定义态才出现上传 / 清除。
5. 对话气泡、设置弹层、下拉菜单保持不透明可读。
6. 性能兼容模式或减少动态效果时，默认流体不持续动画。
7. focused vitest 覆盖 sanitize、host 渲染分支、设置入口。

## Impact

| 层 | 影响 |
|----|------|
| Frontend feature | theme wallpaper host + settings appearance |
| App settings | 新持久化字段，Rust `AppSettings` 同步 |
| Router | 主窗口挂 wallpaper host，不进 AppShell bag |
| CSS | 主壳 / home / messages 透底 |
| OpenSpec | 本 change + capability |
