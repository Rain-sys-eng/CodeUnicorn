## 背景

first-run wizard 已有 MIT 来源的 WebGL2 fluid backdrop（`FirstRunFluidBackdrop` + `fluidShader`）。进入主界面后 `.app` / `.home-chat` / `.messages` 都是实色，背景立刻消失。用户要求把这套默认背景带到工作台，并在设置里可选关闭或换成自己的图。

AppShell Structure Gate 禁止无主塞 bag；first-run 已证明 router 级 overlay 是正确挂点。

## 方案

**选定：router 级 wallpaper host + AppSettings 持久化**

| Option | Summary | Trade-off |
|--------|---------|-----------|
| A. Router host + `AppSettings`（采用） | 不进 bag；设置跨重启；复用 first-run shader | 需让主壳半透明透底 |
| B. 塞进 AppShell domain | 能直接拿 settings | 违反 AppShell Structure Gate |
| C. 只改 Home 空态 | 改动最小 | 进对话后背景又没了 |

### 数据模型

```ts
type WorkspaceWallpaperMode = "none" | "fluid" | "custom";

type WorkspaceWallpaperSettings = {
  mode: WorkspaceWallpaperMode;
  customImagePath: string | null;
};
```

- 默认：`{ mode: "none", customImagePath: null, veilOpacity: 0 }`。背景是 opt-in，用户必须在设置里手动开 `fluid` 或 `custom`。
- `veilOpacity` 现在表示毛玻璃模糊半径（px），范围 0–20，缺字段回 0。开壁纸默认原图，不上霜。旧默认 12 视为未设置。开启背景时 Settings 可提供滑杆，host 把它写成 `--workspace-wallpaper-frost`。
- `custom` 但路径空 / 非法 / 非图片扩展名 → sanitize 保留 `custom`；运行时显示回退到 `fluid`，不改写用户存储。
- 旧设置缺字段 → `none`。已持久化 `fluid` / `custom` 的用户保持原值。

### 渲染

```
AppRouter (main)
  └─ WorkspaceWallpaperHost
        ├─ none: 不挂层
        ├─ fluid: 复用 FirstRunFluidBackdrop
        └─ custom: convertFileSrc(path) + CSS cover
  └─ AppShell (.app[data-workspace-wallpaper=fluid|custom])
```

- host 挂在 `LazyAppShell` 之前、`FirstRunSetupHost` 之后亦可，z-index 必须低于向导和 StartupGate。
- 不在 about / detached 窗口渲染。
- `performanceCompatibilityModeEnabled` 或 `prefers-reduced-motion`：fluid 走现有单帧路径。

### 透底策略

开启 wallpaper 时：

- 壁纸层只做轻微 saturate/contrast + 8–10% wash。chrome 不再用可调灰蒙层。
- sidebar / `.main` / `.right-panel` 共用同一层 16% 轻色洗 + 可调 frost（默认 0px，0–20）。滑杆调的是 blur，不是透明度。
- `prefers-reduced-transparency` 把 frost 置 0。
- 开启 wallpaper 时关掉 `.main` 的 desktop 圆角，并恢复 sidebar / `.main` 的 1px 分割线。
- 消息气泡、popover、Dialog、settings 浮层、composer 输入框保持不透明（preference guide：弹层必须实色可读）。
- 侧栏列表行保持足够对比，避免字糊进流体。

### 设置 UI

Settings → 基础 → 外观，主题行下方新增 preference row：

```
页面背景
默认背景 | 不要背景 | 自定义
[自定义] 预览条 + 选择图片 + 清除
```

- 2–3 选项用现有 `settings-pref-segmented`。
- 上传走 `@tauri-apps/plugin-dialog` 单选图片（png/jpg/jpeg/webp/gif）。
- 存绝对路径，不复制文件。用户移动/删除源文件后下次 sanitize / 加载失败回退 fluid。

### 性能与风险

- WebGL2 失败已经是 first-run 的 CSS fallback，主窗口沿用。
- 30fps + `low-power` + DPR cap 1.5 已存在，不另开第二条 shader。
- 自定义超大图只做 CSS `background-size: cover`，不做解码缩放（避免新 command）。
- 主壳半透明可能让长对话滚动时看到背景流动；这是预期，可用「不要背景」关掉。

## 接线

```
AppSettings.workspaceWallpaper
  └─ useAppSettings.normalize
        └─ WorkspaceWallpaperHost (router)
        └─ BasicAppearanceSection
.app[data-workspace-wallpaper]
  └─ CSS 半透明透底
```

## 风险

- 可读性：半透明过度会糊字。用中等 mix（约 72–86%）+ 气泡不透明。
- 老用户突然看到流体：符合「默认背景」需求；可用设置一键关。
- 自定义路径失效：sanitize + img onError 回退 fluid，不写坏用户存储。
