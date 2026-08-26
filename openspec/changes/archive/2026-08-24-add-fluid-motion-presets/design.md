## Context

主窗口 wallpaper 已落地：`mode = none | fluid | custom`，fluid 复用 first-run 的 WebGL2 two-pass shader，配色是 6 档 hue+depth。`SITE_FLUID_PARAMS.speed = 14` 驱动 `u_time`。鼠标 stir 未接线。Windows 整段关闭流体。对照原型在 `docs/designs/fluid-motion-presets/index.html`。

## Goals / Non-Goals

**Goals:**

- 一条 shader 五种场：`drift`（现状）、`taiji`、`storm`、`tornado`、`chase`
- 配色与动势正交；新增低饱和 `ash`
- 工作台默认减速；first-run 不变
- Settings 第二行芯片可扫读，立即 persist

**Non-Goals:**

- 不新开 WebGL 管线，不进 AppShell bag
- 不改 custom 图 / frost / Windows 门禁
- 不做用户自定义场或视频

## Decisions

### D1. `fluidMotion` 独立字段，不塞进 `fluidPreset`

- 选：`workspaceWallpaper.fluidMotion?: "drift" | "taiji" | "storm" | "tornado" | "chase"`，缺省 / 非法 → `drift`
- 不选：把「暮色蓝-龙卷风」编成组合 id。组合会炸设置矩阵，色点无法复用。

### D2. 一条 display shader + `u_motionMode`

- 选：`FluidParams.motionMode` 0–4，`setParams` 热更新，不 relink
- 不选：多套 program。切换成本高，lite / pause / reduced-motion 要复制多份
- drift 继续走现有 domain-warp；结构化场用 screen-space `vUv`（太极 / 涡旋不能再被墨韵坐标扭曲）
- storm 相对原型略提高雨丝与云层对比，避免 8–12px frost 后糊成一片
- `chase` 是两条中国龙：各自走 incommensurate wander + slither，长身渐细，MUST NOT 复用 `taiji` 居中双鱼盘。`else` 分支必须先 `< 3.5` 走 tornado，再走 chase，否则 mode 4 会被 tornado 吞掉

### D3. `ash` 用可选 `chroma`，不走 hue ramp

- 现有 6 档 `fluidToneColors(dark, hue, depth)` 饱和度锁死，hue 换不出灰白
- 选：preset 可带 `chroma`（0–1），`ash = { hue: 3, depth: 46, chroma: 0.06 }`，hue 3 + `HUE_BASE` 落在冷灰蓝，饱和度压到接近中性
- 不选：硬编码三色。dark/light 还得手写两套，和现有 ramp 脱节

### D4. 只降工作台速度

- `WORKSPACE_FLUID_SPEED = 9`（现状 14 的 ~64%）由 wallpaper host 传入 `FirstRunFluidBackdrop`
- first-run 仍用 `SITE_FLUID_PARAMS.speed = 14`
- 结构化场的时间用 `u_time * 7.0` 还原到「秒级可读」，再乘工作台 0.64，避免 speed=9 时太极几乎不转

### D5. Settings 第二行芯片，不新开 preference row

- 流体展开区：色点一行，动势芯片一行，frost 滑杆不动
- 动势只在 `mode === "fluid"` 出现
- i18n：zh / zh-TW 用中文名；其余 locale 跟 en

## Risks / Trade-offs

- [Risk] 结构化场在 lite（12fps / 0.5 res）下太极边缘锯齿 → Mitigation：太极用 smoothstep 软边，不做法线级描边
- [Risk] storm 在高 frost 下仍偏糊 → Mitigation：生产比原型提高雨丝对比；用户可把 frost 拉低
- [Risk] shader 分支导致 compile fail 整段回退 CSS → Mitigation：分支保持 mediump、固定迭代上限；失败仍走既有 no-op handle
- [Risk] 旧设置缺 `fluidMotion` → Mitigation：sanitize 默认 `drift`，不改写磁盘直到用户下次保存
- [Risk] 前端字段未进 Tauri schema → Mitigation：`fluid_motion` 与 `fluid_preset` 同级 persist；Rust serde 回归覆盖 echo 不丢字段

## Migration Plan

1. 读入缺字段视为 `drift` + 既有 preset
2. 回滚：去掉 `fluidMotion` / `ash` 后，sanitize 会把未知 preset 打回 `mist`，未知 motion 打回 `drift`
3. Tauri `WorkspaceWallpaperSettings` 必须 round-trip `fluidMotion`（与 `fluidPreset` 同级）。漏字段时 serde 静默丢弃，save echo 会把芯片打回 `drift`

## Open Questions

- 无。原型已目视确认四套场后，用户追加 `chase`：先做阴阳二气，后改成两条中国龙各自游走。
