## 背景

工作台 wallpaper 已落地：`mode = none | fluid | custom`，custom 只存一张本地绝对路径，Settings 外观一行 segmented + 「选择图片」。竞品 `dsh-wallpaper-engine` 的体验差在：没有库、没有选择弹窗、没有视频、没有倍速/翻转/模糊/暗化、源文件一挪就丢。

本 change **不搬** Wallpaper Engine 工坊扫描 / Scene `.pkg` / iframe Web 壁纸。把竞品真正可复用的「库 + 弹窗 + 视频 + 效果」接到既有 Appearance 自定义态。

## 方案

**选定：扩展 `workspaceWallpaper` + 受管副本 + router host 渲染**

| Option | Summary | Trade-off |
|--------|---------|-----------|
| A. 扩展现有 settings 字段 + `~/.ccgui/wallpapers/`（采用） | 不进 bag；重启不丢；源文件可删 | 占一点 app home 磁盘 |
| B. 只记绝对路径列表 | 无新 command | 用户移动源文件即失效 |
| C. 整段移植竞品插件 | 功能最全 | 依赖 Steam WE、HTTP 路由、DSH web 形态，越界 |

### 数据模型

```ts
type WorkspaceWallpaperLibraryKind = "image" | "video";
type WorkspaceWallpaperObjectFit = "cover" | "contain" | "center" | "fill";

type WorkspaceWallpaperLibraryItem = {
  id: string;
  kind: WorkspaceWallpaperLibraryKind;
  path: string;          // managed copy under ~/.ccgui/wallpapers/
  sourcePath?: string;   // original pick, display only
  hidden?: boolean;
};

type WorkspaceWallpaperSettings = {
  mode: "none" | "fluid" | "custom";
  customImagePath: string | null; // legacy single-path; still rendered if no selectedLibraryId
  fluidPreset?: ...;
  fluidMotion?: ...;
  veilOpacity?: number;           // frost 0–20, existing
  library?: WorkspaceWallpaperLibraryItem[];
  selectedLibraryId?: string | null;
  wallpaperBlur?: number;         // 0–40 px, default 0
  wallpaperDarken?: number;       // 0–80 %, default 0
  playbackRate?: number;          // 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2
  flip?: boolean;
  objectFit?: WorkspaceWallpaperObjectFit;
  paused?: boolean;
  rotationEnabled?: boolean;
  rotationIntervalMinutes?: 5 | 15 | 30 | 60;
};
```

Sanitize：

- 未知 kind / 非法扩展名的 library 项丢弃。
- `selectedLibraryId` 不在可见（未 hidden）库内 → 回退第一张可见项；库空则走 legacy `customImagePath`；两者都空则运行时显示 fluid，不改写 mode。
- blur / darken / playbackRate / objectFit clamp；缺字段给默认，旧存储继续能读。
- 不把 wallpaper 写入 AppShell domain bag。

### 受管文件

Rust command：

- `import_workspace_wallpaper(sourcePath)` → copy 到 `app_home_dir()/wallpapers/<uuid>.<ext>`，返回 `{ id, kind, path, sourcePath }`。仅允许 png/jpg/jpeg/webp/gif/bmp/mp4。拒绝 `://`、NUL、非文件。
- `remove_workspace_wallpaper(path)` → 仅当 path 落在 `wallpapers/` 目录内才删文件。隐藏不调这个 command。

前端导入：dialog 多选图片+视频 → 逐个 invoke import → 追加 library 并选中最后一张。去重按 `sourcePath` 规范化字符串，已存在则直接选中。

### 渲染

`WorkspaceWallpaperHost`：

```
custom + 选中视频 → <video muted loop playsInline>
custom + 选中/legacy 图片 → <img>
fluid → FirstRunFluidBackdrop（不变）
none → 不挂层
```

CSS 变量（写在 host / `:root`）：

- `--workspace-wallpaper-media-blur`
- `--workspace-wallpaper-darken`
- `--workspace-wallpaper-object-fit`
- `--workspace-wallpaper-flip`（`scaleX(-1)`）

Windows 流体 punch-through / lite profile **原样保留**。视频/图片层 `pointer-events: none`。`prefers-reduced-motion` 或性能兼容：视频 `paused` 强制为 true（运行时，不改写存储）。

轮播：host 内 `setTimeout`，间隔取 `rotationIntervalMinutes`；只在 `mode===custom` 且未隐藏项 ≥2 且 `rotationEnabled` 时走。手动点选重置计时。不进根 hook 链、不进 AppShell bag。

### 设置 UI

自定义态在 segmented 下方：

1. 当前壁纸卡：缩略图 + 名称 + 选择壁纸 / 暂停（仅视频）
2. 点「选择壁纸」→ 不透明 Dialog：网格、类型过滤（全部/图片/视频）、隐藏/已隐藏、导入、移除
3. 效果：object-fit、倍速（视频）、翻转、壁纸模糊、暗化；既有 frost 滑杆保留
4. 轮播：开关 + 间隔 segmented（5/15/30/60 分钟），库内可见项 <2 时禁用

弹层必须实色（preference guide）。设置页本身仍是克制 preference list，不把网格直接铺进外观卡。

### 平台与风险

- 视频自动播放必须 muted；失败保持静帧，不抛穿设置页。
- 大 MP4 只做 CSS 铺满，不做转码。
- WebView2 上 `backdrop-filter` 仍不得盖 WebGL；本 change 的 blur 加在 media 元素 `filter` 上，不改 Win frost=none 规则。
- 导入失败 toast，不写坏 library。

## 接线

```
Settings 自定义 → import_workspace_wallpaper
  └─ library[] + selectedLibraryId → AppSettings
        └─ publishWorkspaceWallpaper
              └─ WorkspaceWallpaperHost (img | video | fluid)
```
