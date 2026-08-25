# Tasks: fix-pi-rpc-latch-cooldown-tree-error-state

## 1. `pi.rs` 闩冷却自恢复

- [x] 字段 `rpc_disabled: Arc<AtomicBool>` → `rpc_disabled_since: Arc<Mutex<Option<Instant>>>`（含注释：只拦新 spawn、冷却自愈、存活 resident 不受影响）；`PiSession::new` 初始化同步替换。
- [x] 新增常量 `PI_RPC_DISABLED_RETRY_COOLDOWN = Duration::from_secs(60)` 与纯函数 `rpc_disabled_blocks_spawn(disabled_since: Option<Instant>, now: Instant) -> bool`。
- [x] `ensure_resident` 闩检查改为：读 `rpc_disabled_since` → 纯函数判定，冷却内 `Err("pi rpc disabled after previous failure")`；冷却过且曾置位 → log info 放行试探。
- [x] spawn `Ok` 臂：`rpc_disabled_since.take().is_some()` 时 log info「latch cleared」；`Err` 臂：置 `Some(Instant::now())`。
- [x] 单测 `rpc_disabled_latch_blocks_within_cooldown_and_allows_probe_after`：None 不拦 / 冷却内拦（10s、cooldown-1s）/ 冷却边界与翻倍放行。

## 2. 前端会话树错误态

- [x] `piSessionStore.ts`：`PiSessionFeatureState` 加 `errorByKey: Record<string, string>`（init `{}`）；`refreshPiSessionTree` 尝试开始清该 key 旧错误、catch 写 `error instanceof Error ? error.message : String(error)`；新增 `usePiSessionTreeError(workspaceId, threadId): string | null`。
- [x] `PiSessionTreePanel.tsx`：`tree === null` 分支改为 `treeError ? 错误态 : 加载中…`；错误态含 `role="alert"`、错误详情、重试 button（`onClick={() => void refreshPiSessionTree(workspaceId, threadId)}`）。
- [x] i18n：`src/i18n/locales/zh/piSession.ts` 与 `en/piSession.ts` 的 `tree` 段补 `loadFailed` / `retry`。

## 3. 测试

- [x] 新建 `src/features/pi-session/store/piSessionStore.test.ts`（jsdom）：mock `piGetSessionTree` reject → `usePiSessionTreeError` 返回消息；再次调用 refresh → 错误在尝试开始即清除。
- [x] 新建 `src/features/pi-session/components/PiSessionTreePanel.test.tsx`（jsdom，对齐 `PiConversationTreeSplit.test.tsx` 的 stub 与 overlay 模式）：mock reject → 面板出现「加载失败」+ retry 按钮；点击 retry → mock 被再次调用。

## 4. OpenSpec 与验证

- [x] spec delta：`pi-rpc-session-runtime` MODIFIED（追加冷却自恢复 scenario）；`pi-session-fork-tree` ADDED（加载失败错误态 requirement）。
- [x] `cargo test --lib engine::pi` 全绿。
- [x] focused vitest（piSessionStore + PiSessionTreePanel + PiConversationTreeSplit 回归）全绿。
- [x] `openspec validate fix-pi-rpc-latch-cooldown-tree-error-state` 通过。

## 5. 发版（P0 ①）

- [ ] 代码合并后 `npm run tauri build` 出新安装版（含 `5e15b934f` + 本 change），替换 /Applications/ccgui.app。
