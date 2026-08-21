## 1. Contract and persistence

- [x] 1.1 扩展 `WorkspaceWallpaperSettings`（FE + Rust）：library / selectedLibraryId / blur / darken / playbackRate / flip / objectFit / paused / rotation
- [x] 1.2 sanitize：非法项丢弃、选中 id 回退、旧 `customImagePath` 兼容、clamp 效果字段
- [x] 1.3 focused vitest：legacy path、hidden 回退、视频扩展名、缺字段默认

## 2. Managed copies

- [x] 2.1 `app_paths::wallpaper_dir()` → `~/.ccgui/wallpapers/`
- [x] 2.2 `import_workspace_wallpaper` / `remove_workspace_wallpaper` command + registry
- [x] 2.3 FE `src/services/tauri` 包装
- [x] 2.4 Rust unit：允许扩展名、拒绝越权删除、复制落盘

## 3. Wallpaper host

- [x] 3.1 custom 解析选中 library 项或 legacy path；图片 img、视频 video
- [x] 3.2 应用 blur / darken / flip / objectFit / playbackRate / paused
- [x] 3.3 可选轮播（可见项 ≥2）；手动选择重置计时
- [x] 3.4 reduced-motion / 性能兼容：视频不自动播
- [x] 3.5 focused vitest：视频层、效果 token、legacy 图、不进 bag

## 4. Settings picker

- [x] 4.1 自定义态当前壁纸卡 + 「选择壁纸」不透明 Dialog 网格
- [x] 4.2 导入多选、隐藏/恢复、移除受管副本、类型过滤
- [x] 4.3 效果控件：fit / 倍速 / 翻转 / 模糊 / 暗化；轮播开关
- [x] 4.4 zh / en 文案；其余 locale 英文占位；vitest setup keys
- [x] 4.5 SettingsView + picker focused tests

## 5. Verify

- [x] 5.1 focused vitest 绿；Rust `workspace_wallpaper` 5 测绿；`tsc --noEmit` 绿
- [x] 5.2 不改 AppShell domain bag / Windows 流体默认路径
- [ ] 5.3 气泡 / settings dialog 保持不透明（待手测）
