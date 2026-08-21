## ADDED Requirements

### Requirement: Custom wallpaper SHALL be chosen from a managed local library

Settings 自定义模式 MUST 维护本机 wallpaper library（图片与 MP4）。用户 MUST 能从缩略图弹窗点选当前背景。导入 MUST 复制到 `~/.ccgui/wallpapers/`，设置只存 library id 与受管路径。旧 `customImagePath` MUST 在没有 `selectedLibraryId` 时仍能显示。系统 MUST NOT 扫描 Wallpaper Engine 工坊，MUST NOT 把 library 写入 AppShell domain bag。

#### Scenario: User opens the wallpaper picker

- **WHEN** wallpaper mode 为 `custom` 且用户点击「选择壁纸」
- **THEN** 系统 MUST 打开不透明 Dialog，展示未隐藏项的缩略图网格
- **AND** 当前选中项 MUST 有可见选中态

#### Scenario: User picks a library item

- **WHEN** 用户在弹窗中点选一张可见壁纸
- **THEN** 系统 MUST 把 `selectedLibraryId` 写入 `workspaceWallpaper` 并立即铺到主窗口
- **AND** 重启后 MUST 仍显示该项

#### Scenario: User imports local images and a video

- **WHEN** 用户在弹窗中导入 png / jpg / jpeg / webp / gif / bmp 或 mp4
- **THEN** 系统 MUST 复制到 app home `wallpapers/` 目录并追加 library 项
- **AND** MUST 选中刚导入的最后一项
- **AND** 重复导入同一 `sourcePath` MUST 选中已有项，MUST NOT 再复制一份

#### Scenario: Legacy custom path still renders

- **WHEN** mode 为 `custom`、library 为空或没有合法 `selectedLibraryId`，且 `customImagePath` 合法
- **THEN** 主窗口 MUST 仍以该路径显示图片

#### Scenario: Hidden items leave the picker but stay on disk

- **WHEN** 用户隐藏一张库内壁纸
- **THEN** 系统 MUST 从默认网格与轮播候选中剔除它
- **AND** MUST NOT 删除受管文件
- **WHEN** 用户在「已隐藏」中恢复
- **THEN** 该项 MUST 回到网格

#### Scenario: Removing a managed wallpaper deletes the copy

- **WHEN** 用户从库中移除一项且其 path 位于 `wallpapers/` 目录
- **THEN** 系统 MUST 删除该受管文件并从 library 数组去掉
- **AND** 若它是当前选中项，MUST 回退到下一张可见项或 legacy path

### Requirement: Custom wallpaper SHALL support video playback and media effects

自定义视频 MUST 静音循环播放。用户 MUST 能暂停、调节 playbackRate（0.5x–2x）、水平翻转，并为自定义媒体选择 object-fit。壁纸模糊与暗化 MUST 只作用于媒体层。`performanceCompatibilityModeEnabled` 或 `prefers-reduced-motion: reduce` 时视频 MUST NOT 自动播放。流体模式的 Windows compat 路径 MUST NOT 被这些效果改写。

#### Scenario: Video wallpaper loops muted

- **WHEN** 选中 library 项 kind 为 `video` 且 mode 为 `custom`
- **THEN** 主窗口 MUST 渲染 muted loop 的 `<video>`
- **AND** MUST NOT 因自动播放去 unmute

#### Scenario: User changes playback speed or flip

- **WHEN** 当前是视频（倍速）或任意自定义媒体（翻转）
- **THEN** 调整 MUST 立即生效且不重挂 wallpaper host
- **AND** 值 MUST 写入 `workspaceWallpaper` 并跨重启保持

#### Scenario: User adjusts wallpaper blur and darken

- **WHEN** mode 为 `custom`
- **THEN** Settings MUST 提供壁纸模糊（0–40px）与暗化（0–80%）
- **AND** 这些效果 MUST 画在媒体层，MUST NOT 替代既有 frost 滑杆
- **AND** Windows 流体 `backdrop-filter: none` 规则 MUST 保持不变

#### Scenario: Optional rotation among visible items

- **WHEN** 用户开启轮播且可见 library 项不少于 2
- **THEN** 系统 MUST 按所选间隔在可见项之间切换 `selectedLibraryId`
- **WHEN** 用户手动点选一张
- **THEN** 系统 MUST 重置下一次轮播计时

#### Scenario: Reduced motion keeps video still

- **WHEN** 系统处于减少动态效果或性能兼容模式，且当前自定义壁纸是视频
- **THEN** 系统 MUST 保持暂停
- **AND** MUST NOT 改写用户持久化的 `paused` 字段
