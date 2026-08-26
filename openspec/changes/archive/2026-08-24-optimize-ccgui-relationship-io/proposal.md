## Why

`~/.ccgui/project-map-relations` 对老用户已经膨胀到数百 MB。当前 `project_map_relationship_read` 会整包读取 `relations/latest.json`、`repair/latest.json` 等约 80MB JSON，再经 IPC 进前端。Search Radar 打开「接口」时，只要判定 snapshot stale，还会偷偷触发全仓库 scan。扫描每次整包备份且无回收，磁盘持续上涨。需要按需读取、停止搜索框偷扫，并把备份当过期缓存回收，同时兼容已有磁盘数据。

## What Changes

- `project_map_relationship_read` 增加可选 `include`；缺省保持今天的全量行为
- Search Radar 只读 `manifest + apiContracts + stale`；**禁止**因 stale / 缺索引自动 `scan`
- 搜索文案改为「接口名单不是最新」，不再暗示正在扫盘
- 读 `repair` 时对巨型 v1 `issues[]` 做内存摘要；不在读路径回写磁盘
- 新 scan 写出 compact repair（计数 + 每类 sample）；`duplicate-relation` 只计数
- 新 scan 默认不再整包拷贝 60MB+ backup；写成功后回收过期 `backups/backup-*`
- Project Map / contextPack 调用改为按需 `include`，避免为几 KB 元数据拉整包

**BREAKING**: 无磁盘根路径 / storageKey 变更。旧客户端不传 `include` 仍拿全量。Search Radar 不再自动刷新接口名单，这是产品行为变更。

## 目标与边界

**目标**

- 打开搜索框不再触发全仓库关系扫描
- 常用读路径不再把 80MB JSON 打进 IPC
- 老用户不重扫也能打开已有 snapshot
- 停止 backups 无上限膨胀，旧大副本当缓存回收

**边界**

- 不把 relations 迁 SQLite
- 启动不扫、不改写、不弹「请确认删除备份」
- 不自动清 `client1/` 或 `codex-provider-homes`
- 完整 neighborhood query API 可后续单独立项；本 change 先按需读现有文件

## 非目标

- 不做启动期 migration job
- 不改 Project Map 主图谱 dataset 存储
- 不把 Search Radar 做成实时代码索引

## 技术方案对比（取舍）

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| A. 只改 Search Radar 不再 scan | 前端去掉 refreshEndpoints | 立刻去掉最卡路径 | 整包 read 仍在 | 必要但不充分 |
| B. 一次性迁 SQLite | 新库 + 迁移老 JSON | 查询快 | 兼容/半写风险高 | 否 |
| C. 可选 include + compact repair + backup 当缓存 | 读按需、写收敛、旧文件只读兼容 | 老用户零迁移、可回滚 | 全量图仍可能读 latest.json | **采纳** |

## 验收标准

1. 打开 Search Radar（含 APIs）且已有 snapshot：不调用 `project_map_relationship_scan`
2. stale snapshot：仍展示上次接口名单，状态为「不是最新」，不后台全量扫
3. 无 snapshot：接口结果为空，提示去 Project Map 扫描，不自动 scan
4. 不传 `include` 的 read 仍返回现有字段（旧前端兼容）
5. 传 `include: ["manifest","apiContracts","stale"]` 时不把 `relations` / `repair.issues` 全量打进 IPC
6. 新 scan 后 `repair/latest.json` 为 compact schema；旧 35MB v1 文件可读且被摘要
7. 新 scan 不再每次复制 `relations/latest.json` + 全量 repair；过期 `backup-*` 在写成功后回收
8. 启动不改写、不删除用户文件

## Capabilities

### New Capabilities

- `project-map-relationship-io`: 关系快照按需读取、Search Radar 不自动 scan、repair/backup 缓存收敛

### Modified Capabilities

- （无）现有 main specs 未钉死 Search Radar 自动 scan 与整包 read

## Impact

- 代码：`src-tauri/src/project_map_relations.rs`、Search Radar、Project Map persistence/hooks、SearchPalette i18n
- 存储：新 scan 写 compact repair；backup 变小并回收；旧 latest.json 仍合法
- 产品：搜索框不再偷偷重建接口索引
