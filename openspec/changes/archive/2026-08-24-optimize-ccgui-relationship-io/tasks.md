## 1. Backend read/write

- [x] 1.1 `project_map_relationship_read` 增加可选 `include`；缺省全量
- [x] 1.2 `repair` 读路径 cap / 兼容 v1 与 v2；禁止回写
- [x] 1.3 新 scan 写 compact repair；`duplicate-relation` 只计数
- [x] 1.4 默认不再整包 backup；写成功后回收过期 `backup-*`
- [x] 1.5 Rust 单测覆盖 include / repair cap / backup GC matcher

## 2. Frontend callers

- [x] 2.1 `readProjectMapRelationships` 透传 `include`
- [x] 2.2 Search Radar：按需 read，禁止自动 scan；状态含 stale/empty
- [x] 2.3 `useProjectMapDataset` context 只读 manifest/contextPack/stale
- [x] 2.4 SearchPalette i18n：过期提示，不再说「正在扫描磁盘」

## 3. Tests / verify

- [x] 3.1 更新 Search Radar / SearchPalette 测试
- [x] 3.2 跑相关 Vitest + Rust 单测
- [x] 3.3 勾选 tasks
