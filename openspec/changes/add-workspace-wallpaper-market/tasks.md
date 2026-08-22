## 1. Contract

- [x] 1.1 OpenSpec delta：市场浏览 / 下载 / 去重 / SFW
- [x] 1.2 扩展 duplicate 匹配，覆盖 `https://wallhaven.cc/w/<id>` sourcePath

## 2. Host

- [x] 2.1 `search_workspace_wallpaper_market`：Wallhaven search，强制 SFW
- [x] 2.2 `download_workspace_wallpaper`：仅 wallhaven host，写入 `~/.ccgui/wallpapers/`
- [x] 2.3 command registry + FE `src/services/tauri` 包装
- [x] 2.4 Rust unit：URL allowlist、分类映射、JSON 解析、拒绝非 https

## 3. Picker

- [x] 3.1 Library / Market tabs
- [x] 3.2 搜索、分类、分页、下载中态、已在库中标记
- [x] 3.3 点市场项：去重或下载后选中并关闭
- [x] 3.4 zh/en 文案；其余 locale 英文占位；vitest setup keys
- [x] 3.5 CSS：市场工具栏 / 下载态，弹窗保持不透明

## 4. Verify

- [x] 4.1 focused vitest + Rust wallpaper tests + `tsc --noEmit` 绿
- [x] 4.2 不改 AppShell bag / Windows 流体路径
- [ ] 4.3 手测：市场浏览一张、下载铺上、再点同一张不重复下
