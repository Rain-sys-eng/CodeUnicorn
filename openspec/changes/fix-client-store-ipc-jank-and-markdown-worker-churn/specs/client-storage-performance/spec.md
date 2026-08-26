# Delta: client-storage-performance

## MODIFIED Requirements

### Requirement: client store patch 写路径成本与 store 体积解耦

`client_store_patch` SHALL 避免在每次写入时对整份 store 做 full read+parse 与全量 deep equality：store 内容 SHALL 由进程内 cache 提供，equality 比较 SHALL 仅针对 patch 涉及的 key，序列化 SHALL 采用 compact JSON。原子写语义（tmp 文件 + fsync + rename）SHALL 保留。

写路径的 IPC 载荷 SHALL 以单一 pre-stringified JSON string 过桥（renderer 传 `payloadJson`，Rust 侧 `payload_json: String` + `serde_json::from_str`），MUST NOT 把 store 快照作为嵌套对象图传入 `client_store_write` / `client_store_patch`——WKWebView 桥按对象数逐个同步转换，是主线程秒级冻结的实测来源（2026-08-26：274KB patch 同步段 3338ms）。非法 JSON 与非 object patch SHALL 返回结构化 error 并走既有 writeChain retry 语义。

#### Scenario: 小 patch 不触发整份 store 重解析

- **WHEN** renderer 对一个大体积 store（如数 MB 的 `threads.json`）发起单 key patch
- **THEN** Rust 侧从进程内 cache 取 existing 值，不重新读盘解析整份文件
- **AND** 仅比较 patch key 对应的旧值，no-op 时跳过写盘

#### Scenario: compact 序列化可回读

- **WHEN** store 以 compact JSON 写盘后再次读取
- **THEN** 数据与写入前 deep-equal

#### Scenario: write/patch 载荷以单一 JSON string 过桥

- **WHEN** renderer 触发 `flushStoreWrite`（write 或 patch 任一路径）
- **THEN** invoke 载荷 MUST 为 `{ store, payloadJson: string }`，`payloadJson` 解析后含 `__schemaVersion` 与脏 key
- **AND** Rust 侧 MUST 以字符串解析取得 `serde_json::Value`，磁盘格式、锁、原子写、no-op 跳过语义不变

#### Scenario: 非法载荷快速失败

- **WHEN** `payload_json` 不是合法 JSON，或 patch 解析后不是 object
- **THEN** command MUST 返回结构化 error
- **AND** renderer 侧 writeChain MUST 按既有语义保留脏 key 并重试

### Requirement: client store 存量维护在启动时执行

应用启动（`preloadClientStores` 完成）后 SHALL 执行一次 client store maintenance：`diagnostics.threadSessionLog` 按持久化黑名单过滤存量并施加单条 payload 与总条数上限；legacy `app` store 中的 `diagnostics.threadSessionLog` / `diagnostics.rendererLifecycleLog` SHALL 迁移合并后置空；`threads.customNames` SHALL 裁剪到容量上限（保留最近插入的 2,000 条）。

threadSessionLog 持久化黑名单 SHALL 覆盖 per-delta 高频 label（`thread/session:reasoning-text-delta`、`thread/session:reasoning-summary-delta`）：新增条目拒绝持久化，startup maintenance 用同一判定清理存量。turn 级聚合信息由 `realtime.turnTrace.summary` 承担，per-delta 路由日志不承担诊断职责。

#### Scenario: threadSessionLog 存量清理

- **WHEN** 启动时 `diagnostics.threadSessionLog` 含有黑名单 label（如 `thread/list response`）或超限 payload 的存量条目
- **THEN** 黑名单条目被移除，超限 payload 被截断为 preview，总条数不超过上限

#### Scenario: reasoning per-delta 日志不再持久化

- **WHEN** 流式期间 `thread/session:reasoning-text-delta` 或 `thread/session:reasoning-summary-delta` debug 事件到达
- **THEN** 该条目 MUST NOT 追加进 `diagnostics.threadSessionLog`
- **AND** startup maintenance MUST 清理两类 label 的存量条目

#### Scenario: legacy app store 死数据清退

- **WHEN** `app` store 中仍残留 `diagnostics.*` legacy key
- **THEN** 其内容合并入 `diagnostics` store 后，legacy key 置为 null
