## ADDED Requirements

### Requirement: Wallpaper picker SHALL browse and download from an online market

选择壁纸弹窗 MUST 提供「壁纸市场」tab，浏览公开 SFW Wallhaven 图库。搜索与分类 MUST 由 host command 完成。用户点一张市场壁纸 MUST 下载到 `~/.ccgui/wallpapers/`，追加 library，并立即设为当前自定义背景。同一 `https://wallhaven.cc/w/<id>` 再点 MUST 选中已有项且 MUST NOT 再下载。系统 MUST NOT 请求 NSFW（purity 必须为 SFW），MUST NOT 扫描 Wallpaper Engine 工坊，MUST NOT 把市场结果写入 AppShell domain bag。

#### Scenario: User opens the wallpaper market

- **WHEN** wallpaper mode 为 `custom` 且用户打开选择弹窗并切到「壁纸市场」
- **THEN** 系统 MUST 请求 SFW 热门/默认列表并展示缩略图网格
- **AND** 弹窗 MUST 保持不透明

#### Scenario: User searches or filters the market

- **WHEN** 用户输入关键词或选择分类（全部 / 风景 / 二次元 / 人物）
- **THEN** 系统 MUST 用对应 Wallhaven categories 重新搜索
- **AND** 空结果 MUST 显示空态，失败 MUST 显示可重试错误，MUST NOT 改写 library

#### Scenario: User downloads a market wallpaper

- **WHEN** 用户点一张尚未在 library 中的市场壁纸
- **THEN** 系统 MUST 从允许的 wallhaven host 下载原图到 `wallpapers/` 目录
- **AND** MUST 追加 library 项（`sourcePath` 为 `https://wallhaven.cc/w/<id>`）并选中它
- **AND** 主窗口 MUST 立即铺上该图

#### Scenario: User picks a market wallpaper already in the library

- **WHEN** 用户点一张 `sourcePath` 已匹配的市场壁纸
- **THEN** 系统 MUST 选中已有项并关闭或保持选中态
- **AND** MUST NOT 再发起下载

#### Scenario: Download rejects non-wallhaven URLs

- **WHEN** download command 收到非 https 或非 `wallhaven.cc` host 的 URL
- **THEN** 系统 MUST 拒绝写入受管目录
