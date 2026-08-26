## 1. Types and sanitize

- [x] 1.1 在 `src/types/settings.ts` 增加 `WorkspaceWallpaperFluidMotion`（`drift | taiji | storm | tornado | chase`），并把 `ash` 加入 `WorkspaceWallpaperFluidPreset`；`WorkspaceWallpaperSettings` 增加可选 `fluidMotion`
- [x] 1.2 更新 `workspaceWallpaper` sanitize / default / store persist：缺字段或非法 motion → `drift`；非法 preset 仍 → `mist`；换色不改 motion，换 motion 不改色
- [x] 1.3 Tauri `WorkspaceWallpaperSettings` 增加 `fluid_motion`（default `drift`）；serde round-trip 保留 `tornado`；缺字段回 `drift` 且不丢 `fluidPreset`

## 2. Shader and tones

- [x] 2.1 `fluidTones.ts` 支持可选 `chroma`；新增 `ash = { id: "ash", hue: 3, depth: 46, chroma: 0.06 }`；dark/light 皆为低饱和灰白且与 `ink` 可区分
- [x] 2.2 `fluidShader.ts` 增加 `u_motionMode`（0 drift / 1 taiji / 2 storm / 3 tornado / 4 chase）与 `FluidParams.motionMode`；`setParams` 热更新不 relink；storm 比原型提高雨丝对比；`chase` 两条中国龙各自游走，分支 `< 3.5` tornado else chase
- [x] 2.3 `FirstRunFluidBackdrop` 接收可选 `motionMode` / `speed`；缺省仍走 `SITE_FLUID_PARAMS`（speed 14 + drift）。`WorkspaceWallpaperHost` 传入 `WORKSPACE_FLUID_SPEED = 9` 与 sanitize 后的 motion。Windows / lite / reduced-motion 契约不变

## 3. Settings UI and i18n

- [x] 3.1 `BasicAppearanceSection` 在 `mode === "fluid"` 时于色点下方展示五个动势芯片；点击立即 persist `fluidMotion`；`none` / `custom` 不展示
- [x] 3.2 配色点增加到 7 个（含 `ash`）；`settings.part2.basic-redesign.css` 补芯片与 `ash` swatch
- [x] 3.3 10 个 locale 的 `settings.ts` 补 motion 标签与 `ash` 名称：zh / zh-TW 用中文，其余跟 en

## 4. Prototype, tests, verify

- [x] 4.1 对照原型 `docs/designs/fluid-motion-presets/index.html` 同步 `ash` 与减速（speed 9）
- [x] 4.2 扩展 wallpaper / settings / shader 测试：sanitize、正交 persist、ash 列表、动势芯片显隐、no-op handle
- [x] 4.3 跑 focused vitest + 相关 typecheck；确认 Windows 门禁与 first-run 速度未被改写

## 5. Chase motion

- [x] 5.1 union / `WORKSPACE_FLUID_MOTIONS` 增加 `chase`（mode 4）；sanitize 合法保留，未知仍回 `drift`
- [x] 5.2 shader `motionChase`：两条中国龙各自游走；`taiji` 保持居中；分支不得被 tornado `else` 吞掉
- [x] 5.3 10 locale + vitest.setup 补 `workspaceWallpaperMotion_chase`（zh 游走 / zh-TW 遊走 / 其余 Chase）；原型与 OpenSpec delta 同步五场
