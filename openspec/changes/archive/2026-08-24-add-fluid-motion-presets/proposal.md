## Why

工作台 fluid wallpaper 现在只有一套墨韵域扭曲，六个色点只换 hue。用户需要可选的结构化动势（太极 / 暴风雨 / 龙卷风），并补一套低饱和「深灰白」，同时把默认流动再放慢一点。

## 目标与边界

### 目标

- Settings → 外观在流体模式下增加第二行「流体动势」：流动 / 太极 / 暴风雨 / 龙卷风 / 游走。
- 动势与配色正交：任意 `fluidPreset` 可搭配任意 `fluidMotion`。
- 背景配色新增 `ash`（深灰白），低饱和灰白洗，不走现有高饱和 hue ramp。
- 工作台流体默认速度比现状略慢（约 14 → 9）；first-run 向导保持原速。
- 选择立即生效并跨重启持久化；非法 / 缺字段回落到 `drift` + 既有配色默认。

### 边界

- 不把 wallpaper / motion 状态塞进 AppShell domain bag。
- 不新开第二条 WebGL 管线；同一条 `attachFluidShader` 用 `u_motionMode` 分支。
- 不改 Windows 不支持流体的既有门禁。
- 不改 `none` / `custom` 模式语义，不改毛玻璃滑杆。
- lite profile / reduced-motion / 性能兼容模式契约保持：最多静态帧。

## 非目标

- 不做用户自定义 shader、视频背景、鼠标搅动。
- 不把太极做成可交互控件，也不做天气粒子系统。
- 不改 first-run wizard 的动势（仍是默认流动）。
- 不在本 change archive 前 sync 无关 capability。

## 技术方案取舍

| 方案 | 做法 | 取舍 |
|------|------|------|
| A. 一条 shader + `u_motionMode` | 现有 two-pass 管线加分支：0 drift / 1 taiji / 2 storm / 3 tornado / 4 chase | 无第二套 WebGL 生命周期；lite / pause / dispose 复用。选这个。 |
| B. 独立 shader program | 每种动势单独 compile / link | 切换要 relink，包体和失败面都变大。不选。 |

配色 `ash` 走可选 `chroma` 覆盖，而不是再写一套独立 color 管线：现有 6 档仍用 hue+depth；灰白需要接近无饱和，param-only hue 做不到。

## What Changes

- `AppSettings.workspaceWallpaper.fluidMotion`: `drift | taiji | storm | tornado | chase`，默认 `drift`
- `WorkspaceWallpaperFluidPreset` 增加 `ash`
- `fluidShader` display pass 增加 `u_motionMode`；工作台 speed 9
- Settings 外观：色点后加动势芯片；7 个色点
- i18n：zh / zh-TW 中文名，其余 locale 英文名
- 对照原型：`docs/designs/fluid-motion-presets/index.html` 同步 `ash` 与减速

## Capabilities

### New Capabilities

- 无。动势与灰白是既有 `workspace-wallpaper` 的增量，不另开 capability。

### Modified Capabilities

- `workspace-wallpaper`：流体背景增加正交动势、深灰白配色、工作台默认减速。

## 验收标准

1. 流体模式下 Settings 展示 7 个配色点 + 5 个动势芯片；点芯片立即换场，不重挂 wallpaper host。`chase` 是两条中国龙各自游走，不是居中太极。
2. 缺 `fluidMotion` 或非法值 sanitize 为 `drift`；缺 / 非法 `fluidPreset` 仍回 `mist`。
3. `ash` 在 light / dark 下都是低饱和灰白，与 `ink`（偏色青）可区分。
4. 工作台流体比改前明显更慢；first-run 向导速度不变。
5. Windows 仍不展示流体入口；reduced-motion / 性能兼容仍只画静态帧。
6. focused vitest 覆盖 sanitize、配色列表、设置入口与 shader no-op。

## Impact

- `src/types/settings.ts`
- `src/features/theme/utils/workspaceWallpaper.ts` + store + tests
- `src/features/onboarding/utils/fluidShader.ts` + `fluidTones.ts`
- `src/features/onboarding/components/FirstRunFluidBackdrop.tsx`
- `src/features/theme/components/WorkspaceWallpaperHost.tsx`
- `src/features/settings/components/settings-view/sections/BasicAppearanceSection.tsx`
- `src/styles/settings.part2.basic-redesign.css`
- `src/i18n/locales/*/settings.ts`
- `docs/designs/fluid-motion-presets/index.html`
- OpenSpec：本 change 的 `workspace-wallpaper` delta
