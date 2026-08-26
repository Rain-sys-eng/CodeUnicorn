# Tasks: fix-client-store-ipc-jank-and-markdown-worker-churn

## 1. F1 client store raw-string IPC（TDD：先红后绿）

- [x] 1.1 红测试（JS）：`clientStorage.test.ts` 新增断言——write/patch invoke 载荷为 `{ store, payloadJson: string }`，`payloadJson` 解析后含 `__schemaVersion` 与脏 key；既有 `data:`/`patch:` 对象断言同步改写为新契约（红：5 failed → 绿：9 passed）。
- [x] 1.2 红测试（Rust）：`client_storage.rs` tests 新增——`payload_json` 非法 JSON / 非 object patch 返回 error；合法 string parse 后与既有 write/patch 行为一致（红：E0432 → 绿：3 passed）。
- [x] 1.3 实现：`client_storage.rs` `client_store_write`/`client_store_patch` 签名 `Value` → `payload_json: String`（提取 `parse_store_payload_json` / `parse_store_patch_json` 纯函数）；`clientStorage.ts` `flushStoreWrite` 传 `payloadJson: JSON.stringify(...)`。
- [x] 1.4 绿：`clientStorage.test.ts` 9/9、`cargo test --lib client_storage` 8/8；hotspot `client-store-write` detail 语义不变。

## 2. F2 markdown worker 崩溃遏制（TDD）

- [x] 2.1 红测试：`messageMarkdownPrecompute.test.ts`——worker 失败后同 request 二次调用 `compileInWorker` 仅被调用一次，返回 `cache-hit` + `fallbackReason: "worker-error"`（红 1 → 绿 9/9）。
- [x] 2.2 实现：catch 分支补 `setCachedMessageMarkdownPrecompute`（负缓存，`fallbackReason` 随缓存保留）。
- [x] 2.3 红测试：新增 `fastMarkdownRenderer/__tests__/workerAdapterCrashBackoff.test.ts`（stub `globalThis.Worker` + `Date.now` spy，4 测）——首崩立即重建、连二崩进 30s 退避窗、退避期满恢复重建、成功响应清零计数、崩溃指纹 `messageHash`/`messageLength` + `console.warn` 完整 message。
- [x] 2.4 实现：`workerAdapter.ts` `consecutiveWorkerCrashes` + `currentWorkerCrashBackoffMs`（首崩不退避，30s×2^n 封顶 5min）+ `__resetFastMarkdownWorkerBackoffForTests`（含 60s 节流 map 清理）+ `hashStableString(message).slice(0,16)` 指纹。
- [x] 2.5 绿：workerAdapterCrashBackoff 4/4；既有 workerAdapterDiagnostics 等回归全绿（相关面 16 文件 175 测）。

## 3. F3 threadSessionLog 黑名单（TDD）

- [x] 3.1 红测试：`clientStoreMaintenance.test.ts`——存量清理用例加入两个 reasoning per-delta label；新增 `isBlockedThreadSessionLogLabel` 直测（红 2 → 绿 6/6）。
- [x] 3.2 实现：`useDebugLog.ts` `isBlockedThreadSessionLogLabel` 增补 `thread/session:reasoning-text-delta` 与 `thread/session:reasoning-summary-delta` exact-match。

## 4. 验证与收口

- [x] 4.1 `npm run typecheck` 0 error；相关 vitest 全绿：clientStorage 10 + clientStoreMaintenance 7 + rendererDiagnostics + messageMarkdownPrecompute 9 + fastMarkdownRenderer __tests__ 全部 + useDebugLog（合计 16 文件 175 测 0 失败）。
- [x] 4.2 `cargo test --lib client_storage` 8/8；`rustfmt --edition 2021 --check src/client_storage.rs` clean；`git diff --stat` 无格式化噪音（9 文件 +208/−35，均为本 change hunk）。
- [x] 4.3 `openspec validate fix-client-store-ipc-jank-and-markdown-worker-churn --strict --no-interactive` 通过；`openspec/changes/README.md` 索引已更新。

## 5. 深度 review 与碰撞测试（2026-08-26 二轮）

- [x] 5.1 Tauri camelCase→snake_case 参数映射静态实证：仓库现役命令 `project_map_relationship_scan`（Rust `workspace_id` / JS `workspaceId`，生产在用）证明 Tauri 2.9 映射成立，`payloadJson`→`payload_json` 同理；调用面收敛核实（JS 仅 `clientStorage.ts`，Rust 仅 command_registry 注册）。
- [x] 5.2 碰撞测试补充 3 项：退避 5min 封顶（连崩 6 次、299_999ms 仍挡、300s 恰好恢复）/ 黑名单 trim+lowercase 归一化防大小写旁路（含 claude-stream 前缀不误伤）/ unicode（中文+emoji+换行+引号）payloadJson roundtrip；新文件 prettier clean，存量 WARN 文件（HEAD 即 WARN）按 Format Discipline Gate 不动。
- [x] 5.3 Rust 全量对照：`cargo test --lib` 2538 passed / 18 failed，失败全部位于 claude_history/gemini/dsh/runtime/session_management（零 client_storage），抽样 3 个在 HEAD worktree 基线同样失败（存量/环境 flaky）。
- [x] 5.4 前端依赖面对照（clientStorage 全部 73 个依赖测试文件 + 本 change 直接面，共 87 文件）：当前 worktree 7 失败文件 ⊆ HEAD worktree 基线 9 失败文件（严格子集，零新增）；失败形态归属在途改动（`rememberSessionIndexWorkspacePath` mock 缺失为 session-index 域、app-shell.startup update loop 为 composer 域），与本 change 无关。
- [ ] 4.4 真机复验（发版前）：设置页清空「最近卡顿」→ 流式重会话 → `client-store-write` 热点 max 从秒级降到个位数 ms；markdown worker 若仍崩，退避期内不再出现连续 fallback 往返，且 console 有完整崩溃 message。
