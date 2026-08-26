# Change: fix-client-store-ipc-jank-and-markdown-worker-churn

## Why

本机实测（2026-08-26，生产构建，`~/.ccgui/client/diagnostics.json` 覆盖 17:44–21:15 会话）抓到两个主线程慢点与一个高频写放大源：

1. **client store 写盘 IPC marshaling 冻结主线程 3.3 秒**。设置页「最近卡顿（实时）」worst 记录：20:52:46 帧间隙 **4021ms**，热点归因 `client-store-write=3338ms (max 3338 diagnostics:diagnostics.rendererLifecycleLog)`。该条因命中 `hasDiagnosticsOwnedHotspot` 只进 volatile ring（磁盘日志搜不到，机制已从代码核实）。
   - 根因不是 `JSON.stringify`：实测 Node/V8 stringify 这份 274KB payload 仅 **0.5ms**。慢在 `invoke("client_store_patch")` 把**嵌套对象图**（641 条 entry）同步搬过 WKWebView 桥——`client_storage.rs` 的 `client_store_write/patch` 直接收 `serde_json::Value`，WebView 侧按对象数逐个转换。
   - 既有止血（30s diagnostics persist 节流、256KB byte budget、`WRITE_DEBOUNCE_MS` 300ms、diagnostics-owned 掉帧降级 volatile）都绕不开这座桥；`docs/perf/render-jank-knife-experiments-2026-07-08.md` 已把 `client-store-write` 列入热点榜，但桥本身从未换过。
   - 放大源：流式期间每个 reasoning delta 持久化进 `diagnostics.threadSessionLog`（当天 **323 条** `thread/session:reasoning-text-delta`，`useThreadItemEvents.ts` `logReasoningRoute` 无门控），每 ≥300ms 触发一次 ~147KB 全量 key patch。
   - 潜在同雷：`composer.json` 的 `sharedQueuedFollowUps.v1` 已堆到 **2.45MB** 且 `writeSharedQueuedFollowUps` 以 `immediate: true` 全量写——同一座桥，一旦触发理论冻结秒级到几十秒级。

2. **fast-markdown-worker 全会话崩溃循环 + 无负缓存，流式窗口反复白付崩溃往返**。当天 4 次 `fast-markdown-worker/failed`（`errorClass: worker-uncaught`，fallbackCount 累计 108），40 次 `perf.messages.markdown.precompute` **全部** `mode: fallback`（88–325ms/次），集中在 17:46–17:53 流式窗口；同一 `contentHash`（`f8rbwo`/`dpn8bt`）各被重复编译 **10 次**且 `cacheState` 恒为 miss。代码核实两个缺陷：
   - `workerAdapter.ts` `disposeBrokenWorker` 置空 worker 后，`getSharedWorker` 无退避立即重建 → 每次请求都付「建 worker → 崩」往返（即日志里 88–325ms 的 durationMs）；
   - `messageMarkdownPrecompute.ts` 只在 worker **成功**分支写 `setCachedMessageMarkdownPrecompute`，catch 分支不写 → 同内容重复尝试、重复崩溃。
   - 崩溃原因不可追溯：`fast-markdown-worker/failed` 只落 `reasonCode/errorClass`，原始 `event.message` 被 diagnostics 脱敏策略整条 redact。

## What Changes

- **F1 client store 写路径改 raw-string payload 通道（治本）**：`client_store_write` / `client_store_patch` 的载荷参数从嵌套对象改为 **pre-stringified JSON string**（JS 侧 `payloadJson`，Rust 侧 `payload_json: String` + `serde_json::from_str`）。字符串过桥成本 O(len) 且极低，对象图逐对象转换被整体绕开。调用方仅 `clientStorage.ts` `flushStoreWrite` 一处（同 bundle 发版，无版本偏差）；`client_store_read` 响应方向本就是 JSON text → JS parse，不改。非法 JSON / 非 object patch 返回结构化 error，走既有 writeChain retry 语义。
- **F2 markdown worker 崩溃遏制**：
  - F2a **fallback 负缓存**：`runMessageMarkdownPrecompute` worker 失败分支同样写入 precompute cache（保留 `fallbackReason`/`evidenceClass`），同 request 二次调用直接命中，不再重复 worker 往返；
  - F2b **crash-loop 退避**：`workerAdapter` 连续 runtime-error 后按指数退避（首个崩溃不退避、第 2 次起 30s 起倍增至 5min 封顶），退避窗内 `getSharedWorker` 返回 null（走既有 worker-unsupported 路径），worker 成功响应即清零计数；
  - F2c **崩溃指纹**：`fast-markdown-worker/failed` payload 增补 `messageHash`（短 hash，过脱敏）+ `messageLength`，并在崩溃现场 `console.warn` 完整 message（console 不受脱敏），使 worker 崩溃可归因。
- **F3 threadSessionLog 黑名单 reasoning per-delta label**：`isBlockedThreadSessionLogLabel` 增加 `thread/session:reasoning-text-delta` 与 `thread/session:reasoning-summary-delta`（均 per-delta 高频、无 turn 级信息量；`realtime.turnTrace.summary` 已聚合 deltaCount）。新增条目拒绝 + startup maintenance 同判定清存量，与既有黑名单机制一致。

## Capabilities

### Modified Capabilities

- `client-storage-performance`：
  - MODIFIED requirement「client store patch 写路径成本与 store 体积解耦」——解耦维度从「读盘与 deep equality」扩展到「IPC 载荷形态」：write/patch 载荷 MUST 以单一 JSON string 过桥，MUST NOT 传嵌套对象图；
  - MODIFIED requirement「client store 存量维护在启动时执行」/「高频写入源节流」——threadSessionLog 黑名单 MUST 覆盖 reasoning per-delta label。
- `markdown-parse-pipeline`：
  - MODIFIED requirement「Large Final Markdown MUST Use Worker-Capable Precompute Or Explicit Fallback」——fallback MUST 负缓存，worker 连续崩溃 MUST 退避；
  - MODIFIED requirement「Markdown Worker Requests MUST Have Bounded Lifecycle Diagnostics」——崩溃诊断 MUST 携带 messageHash 指纹。

### Non-Goals

- 不改 `client_store_read` 响应方向（启动期 async 读，非本次实测慢点）。
- 不做 `sharedQueuedFollowUps.v1` 的 key 拆分 / 存量清理 / debounce 化（F1 已消除其冻结风险；数据治理另开 change）。
- 不改 diagnostics 脱敏策略本体（`window/error` message 全 redact 的可诊断性问题另开 change）。
- 不动 `thread/list claude/codex catalog timeout`（后端扫描超时，独立问题）。
- 不引入 payload 分级通道（>32KB 才走 raw 之类）——统一 raw 更简单，小 payload 字符串成本同样可忽略。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Frontend | `src/services/clientStorage.ts`（flushStoreWrite 载荷改 string）；`src/features/markdown/messageMarkdownPrecompute.ts`（负缓存）；`src/features/markdown/fastMarkdownRenderer/workerAdapter.ts`（退避 + 指纹） |
| Backend | `src-tauri/src/client_storage.rs`（两个 command 签名 `Value` → `payload_json: String` + parse）；命令名与注册表不变 |
| 热路径 | 所有 client store 写入（diagnostics/threads/composer/layout/app/leida…）每次写省掉对象图过桥；流式期间 threadSessionLog patch 频率下降（黑名单 + F1 叠加） |
| 兼容性 | JS 与 Rust 同 bundle 发版，无版本偏差；磁盘格式、锁、原子写、no-op 跳过语义全部不变；worker 退避窗内 markdown 渲染走既有 fallback 路径，行为与 worker 不可用时一致 |
| 验证方式 | TDD：每项先写红测试（改前断言新契约），实现后转绿；Rust `cargo test` + JS `vitest`；`rustfmt --edition 2021 --check` 改动文件 |

## Acceptance

- **A1（F1）**：`flushStoreWrite` 触发的 `client_store_write`/`client_store_patch` invoke 载荷为 `{ store, payloadJson: string }`，`payloadJson` 内含 `__schemaVersion` 与脏 key；Rust 侧拒绝非法 JSON 与非 object patch（error string），合法路径行为与现状 bit 级一致（compact 写、no-op 跳过、cache 语义）。
- **A2（F2a）**：worker 失败后，同 request 二次 `runMessageMarkdownPrecompute` 不再调用 `compileInWorker`，返回 `mode: "cache-hit"`、`cacheState: "hit"`、`durationMs: 0`，且保留 `fallbackReason: "worker-error"` 供诊断区分。
- **A3（F2b）**：连续 runtime-error ≥2 次后，退避窗内不重建 worker（`precomputeFastMarkdownInWorker` 返回 null → 既有 worker-unsupported 路径）；成功响应后计数清零、恢复重建。
- **A4（F2c）**：崩溃时 `console.warn` 完整 message 一次；`fast-markdown-worker/failed` payload 含 `messageHash`（≤16 位字母数字）与 `messageLength`。
- **A5（F3）**：`isBlockedThreadSessionLogLabel("thread/session:reasoning-text-delta")` 与 `("thread/session:reasoning-summary-delta")` 为 true；新增条目不进 threadSessionLog，startup maintenance 清存量。
- **A6（回归）**：`clientStorage.test.ts`、`clientStoreMaintenance.test.ts`、`messageMarkdownPrecompute.test.ts`、workerAdapter 相关测试全绿；`cargo test --lib`（client_storage 模块）全绿；改动 `.rs` 过 `rustfmt --check`；`npm run typecheck` 0 error。
