## Why

上一轮把竞品的本地库 + 选择弹窗接到了 Appearance，但用户记得的「市场感」是：打开弹窗就能逛一堆壁纸、点一下就能下到本机。`dsh-wallpaper-engine` 那片网格其实是本机 Wallpaper Engine 工坊库存；macOS / 没有 Steam WE 的机器扫不到任何东西。本 change 用公开的 Wallhaven 图库补上「可浏览、可下载」这一环，下载后落入既有 `~/.ccgui/wallpapers/` 库并立即铺到主窗口。

## 目标与边界

### 目标

- 选择壁纸弹窗增加 **我的库 / 壁纸市场** 两个 tab。
- 市场 tab 能搜索、按分类浏览 Wallhaven 缩略图；点一张即下载到受管目录、追加 library、设为当前壁纸。
- 默认只拉 SFW（`purity=100`）；不接 NSFW / 登录 / API key。
- 已下载过的同一 `wallhaven.cc/w/<id>` 再点一次，MUST 选中已有项，MUST NOT 再下一份。

### 边界

- 不接入 Steam Wallpaper Engine 工坊扫描、Scene `.pkg`、Web/HTML iframe。
- 不把市场结果写入 AppShell domain bag。
- 不改流体 / none 路径，不改 Windows frost 兜底。
- 市场只提供静态图（jpg/png），不从 Wallhaven 下视频。

## 非目标

- 不做 Wallpaper Engine Workshop 客户端、不做付费壁纸商店。
- 不缓存整站图库到磁盘；只持久化用户点过下载的那几张。
- 不把 API key / 账号登录塞进设置。

## What Changes

| 区域 | 变更 |
|------|------|
| Rust | `search_workspace_wallpaper_market` / `download_workspace_wallpaper` |
| FE IPC | `src/services/tauri/settings.ts` 包装 |
| Picker | Library / Market tabs，搜索、分类、下载中态 |
| i18n / CSS / tests | zh/en + 其余 locale 英文占位；focused vitest + Rust unit |

## Capabilities

### Modified Capabilities

- `workspace-wallpaper`：选择弹窗增加可浏览、可下载的在线市场。

## 验收标准

1. 自定义态打开选择弹窗，能切到「壁纸市场」，默认看到一批 SFW 热门缩略图。
2. 搜索 / 分类后网格更新；点一张下载到 `~/.ccgui/wallpapers/`，立即成为当前壁纸。
3. 同一 Wallhaven id 再点一次只选中已有库项，不重复下载。
4. 网络失败有 toast，不写坏 library。
5. focused vitest + Rust wallpaper tests + `tsc --noEmit` 绿。

## Impact

| 层 | 影响 |
|----|------|
| Frontend | wallpaper picker 增加市场 tab |
| Rust | Wallhaven search + 受管目录下载 |
| Network | 仅 `wallhaven.cc` / `*.wallhaven.cc` HTTPS |
| OpenSpec | 本 change + `workspace-wallpaper` delta |
