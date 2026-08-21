## 背景

用户看到竞品选择弹窗那片缩略图网格，体感是「壁纸市场」。Windows 上那是本机 Steam 工坊目录；本仓库不能依赖 Wallpaper Engine。正确补法是：本地库保留，再加一个公开图库浏览/下载层。

## 方案

**选定：Wallhaven 公开 search API + 下载进既有受管目录**

| Option | Summary | Trade-off |
|--------|---------|-----------|
| A. Wallhaven `GET /api/v1/search`（采用） | 无需账号、SFW 可匿名、缩略图/原图齐全 | 依赖第三方可用性；默认无 API key 有速率限制 |
| B. 扫描本机 Wallpaper Engine 工坊 | 最像竞品截图 | macOS / 没装 WE 的机器是空的；越界 |
| C. Unsplash / Pexels | 也有市场感 | 需要开发者 key，设置页会变复杂 |

### 数据流

```
Picker Market tab
  → search_workspace_wallpaper_market({ query, category, page })
  → Wallhaven JSON（host 拉，不走前端 CORS）
  → { id, thumbUrl, fullUrl, sourceUrl, resolution, category }[]
用户点卡片
  → 若 library.sourcePath === sourceUrl 已存在 → 选中并关闭
  → 否则 download_workspace_wallpaper({ url: fullUrl, sourceUrl, suggestedName })
  → copy 到 ~/.ccgui/wallpapers/<uuid>.<ext>
  → 追加 library、selectedLibraryId、mode=custom
```

### Host 约束

- User-Agent: `cc-gui-wallpaper/1.0`
- 仅允许 `https://wallhaven.cc` 与 `https://*.wallhaven.cc`
- 搜索强制 `purity=100`（SFW）；`categories` 映射：
  - `all` → `111`
  - `general` → `100`
  - `anime` → `010`
  - `people` → `001`
- 空 query 时用 `sorting=toplist&topRange=1M`
- 有 query 时用 `sorting=relevance`
- `page` ≥ 1；每页 24（Wallhaven 默认）
- 下载：跟跳转、上限 40MB、Content-Type 必须是 jpeg/png/webp；扩展名从 URL 或 content-type 推断
- 拒绝 `file:` / 非 https / 非 wallhaven host

### UI

选择弹窗顶部 segmented：**我的库 | 壁纸市场**。

市场 tab：

- 搜索框 + 分类 segmented（全部 / 风景 / 二次元 / 人物）
- 缩略图网格；卡片角标「下载」或「已在库中」
- 底部分页：上一页 / 下一页（有 `meta.last_page` 才显示）
- 加载中 / 空结果 / 错误文案
- 弹窗保持不透明

缩略图 `<img src=thumbUrl>` 走 CSP 已允许的 `img-src https:`。下载走 Rust，不把原图 blob 塞进前端。

### 去重

`findDuplicateWallpaperLibraryItem` 已按 `sourcePath` 规范化比较。下载项的 `sourcePath` 写成 `https://wallhaven.cc/w/<id>`，再点同一张会命中。

## 风险

- Wallhaven 无 key 时可能 429：展示错误文案，允许重试，不写库。
- 缩略图 CDN 失败：卡片显示占位，不影响下载按钮。
- 不把 NSFW 开关、API key、工坊扫描加进来。
