# Design：`~/.ccgui` 关系快照 IO 收敛

## 口径（已拍板）

1. Search Radar 发现接口名单过期时：**只提示，不自动全量 scan**。
2. 历史大备份是实现细节，不是用户资产：**当过期缓存回收**，不弹「请确认删除」。

## 读路径

`project_map_relationship_read` 增加可选 `include: string[]`。

- `None` / 空：与今天一致，读全部 artifact（旧客户端安全）
- 有值：只序列化点名的字段
- `stale` 可在 backend 用 `files` 计算，但不把 `files` 传过 IPC
- `repair` 无论是否 include，只要返回就必须经过 cap：
  - v2 compact：原样返回
  - v1 大数组：内存摘要 `issueCount + byKind + samples(<=20/kind) + truncated`
  - **禁止 read-path rewrite**

合法 section：`manifest` `profile` `run` `scan` `files` `symbols` `relations` `relationsByFile` `relationsByType` `modules` `impact` `contextPack` `apiContracts` `stale` `repair`

## 调用方

| 调用方 | include |
|---|---|
| Search Radar | `manifest, apiContracts, stale` |
| `useProjectMapDataset` context | `manifest, contextPack, stale` |
| RelationshipSection 首屏 / 扫后刷新 | 全量（图仍要 files/relations；repair 已被 cap） |
| Intent Canvas / code selection | 过渡期全量；不在本 change 做 neighborhood command |

RelationshipSection 仍可能读 40MB+ `relations/latest.json`。本 change 先消掉搜索框和 contextPack 的重复整包，以及 35MB repair IPC。完整图延迟加载留给后续。

## Search Radar

打开 palette 且内容含 APIs：

1. 只 `read(include)`
2. 有 endpoints：`complete`；若 `isFresh === false` 标 `stale`
3. 无 snapshot：`empty`，不 scan
4. 读失败：`error`

删除 `refreshEndpoints` / `scanProjectMapRelationships` 从该 section 的自动路径。

状态机：`idle | loading | complete | stale | empty | error`。去掉自动路径上的 `refreshing`。

## 写路径

新 scan：

- `repair/latest.json` 写 schemaVersion=2 compact
- `duplicate-relation` 只进计数，不进 samples（除非总数为 0 之外的展示需要，默认不落明细）
- 默认 `create_backup_snapshot=false`
- 写成功后跑 backup GC：只删 `backups/backup-<UTC timestamp>`
  - 保留最近 2 份
  - 或总备份 > 200MB 时继续删最旧
  - 当前 `latest/*` 永不进 GC

若未来需要完整 backup，显式 `createBackup: true` 仍可走旧拷贝列表，但 GC 仍生效。

## 兼容

- 磁盘根路径 / storageKey 不变
- 旧 `relations/latest.json`、v1 `repair/latest.json` 仍合法
- 启动不扫、不改写、不删
- 旧前端不传 include → 全量（repair 仍 cap，这是唯一对旧前端可见的 payload 收缩；UI 本来不渲染 9.8 万条 issue）

## 风险

- Search Radar 接口名单可能略旧：可接受，文案说清楚
- GC 误删：matcher 严格、启动不跑、只在写成功后
- include 漏字段：集中 helper + 测试
