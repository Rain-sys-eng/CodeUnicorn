# Tasks: fix-orphan-turn-during-backend-unavailability

## 1. F1 前端孤儿 turn 看门狗

- [x] 1.1 新 util `src/features/threads/utils/orphanTurnWatchdog.ts`：`ORPHAN_TURN_FIRST_EVENT_TIMEOUT_MS`（prod 90s / test 可配）+ 纯函数 `decideOrphanTurnWatch` + 首事件登记表。
- [x] 1.2 `useThreadMessaging.ts` native 路径：`markProcessing(threadId, true)` 后经 `useOrphanTurnWatchdog` hook 挂 timer；`useThreads.ts` 的 `onAppServerEvent` catch-all（链式保留原诊断 handler）登记首事件；unmount 清理。
- [x] 1.3 触发动作：`markProcessing(false)` + `setActiveTurnId(null)` + `pushThreadErrorMessage`（i18n key `threads.turnOrphanedRetryable`）+ `onDebug` 诊断 `orphan-turn-first-event-timeout`；fire 时二次检查 isProcessing 防竞态（纯判定互斥）。
- [x] 1.4 i18n：10 locale 补 key（en/es/fr/hi/ja/ko/pt-BR/ru/zh-TW/zh）；shared 路径不挂看门狗（`threadKind !== "shared"` 守卫）。
- [x] 1.5 单测（vitest + fake timers，14 测）：零事件 90s 触发 settle；首事件 <90s 取消；processing 先被清除不触发；disarm 不触发；零事件窗口内重复 arm 复用最早 deadline；unmount 清 timer；arm 前陈旧首事件登记不遮蔽判定；已见首事件后再次 arm 重挂全新窗口（新 turn 孤儿可判出）。

## 2. F3 后端 detached send panic 兜底

- [x] 2.1 `engine/commands.rs`：`drive_detached_pi_send`（`AssertUnwindSafe` + `futures_util::FutureExt::catch_unwind`），panic 时经 `emit_error` 补发 TurnError + `log::error!`。
- [x] 2.2 Rust 单测（commands_tests.rs `orphan_turn_send_guard`，3 测）：panic → TurnError 文案含 panic 信息；Err 仅日志不重复发事件；成功 no-op。

## 3. F2 后端 PI send gate

- [x] 3.1 `pi.rs` 补只读查询：`rpc_spawn_blocked()`（latch 冷却期，只读不清闩）+ `print_json_fallback_blocked(session_id)`（同 session 活跃子进程占用）。
- [x] 3.2 `engine/commands.rs` PI 分支：dispatch 前双证据检查（latch 生效 AND fallback busy）→ 返回结构化 error（code `pi_engine_unavailable`，`extractRpcErrorMessage` 命中既有 rpcError 路径），不返回 started。
- [x] 3.3 Rust 单测：latch 置位→拦 + 只读语义（闩不被查询改变）；空活跃表→不 busy（同 session busy 判定纯函数 `print_json_fallback_busy` 既有测试覆盖）。

## 4. 验证与收口

- [x] 4.1 `npm run typecheck` 0 error；threads/hooks vitest 对照 HEAD worktree 失败清单 **完全一致（零新增红）**；i18n 91/91；watchdog 14/14。
- [x] 4.2 `cargo test --lib orphan_turn_send_guard` 3/3、`send_gate` 3/3；`rustfmt --check` 改动文件通过（rustfmt-clean）；`cargo check --lib` 0 error。
- [ ] 4.3 真机复现验证：`tauri dev` 重启窗口发送 → ≤90s UI 落可重试错误、composer 可再发（对照分析文档场景；待真机）。
- [x] 4.4 `openspec validate fix-orphan-turn-during-backend-unavailability --strict` 通过；`openspec/changes/README.md` 索引已更新。
- [x] 4.5 分析文档状态行更新：待修 → 已核实 + 已开提案。
