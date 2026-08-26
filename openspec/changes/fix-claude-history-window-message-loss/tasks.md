# Tasks

## 1. Backend 测试先行（TDD red）

- [x] 新增 `engine/claude_history_window_fidelity_tests.rs`（mod 注册进 `engine/mod.rs`）
- [x] T1 边界守恒：assistant text 行压 window chunk 边界（file_len - CHUNK）→ 完整保留且行数守恒
- [x] T2 无 drain / 死游标消除：> limit 条 messages 但全文件可覆盖 → 全量返回、`has_more == Some(false)`、`next_cursor == None`
- [x] T3 分页连续：`window_start > 0` 大文件逐页遍历 → id 并集 == 全量且无交集、cursor 非 "0"
- [x] T4 单行 >256KB 压 seam → 由更早分页完整带回、不产生截断片段
- [x] 既有契约测试更新为新语义（重命名 `load_claude_session_window_whole_file_returns_all_without_cursor`）
- [x] red 确认（worktree @ HEAD `3bc778f2a` 隔离）：T1 glue 吞行、T2 drain 80/100、T3 cursor="0"、T4 giant 0 次、契约 3/20 全部如期失败；主树回归被并行会话 `session_delete_v2/local_usage` 15 个编译错误阻断，与己无关

## 2. Backend 实现（TDD green）

- [x] `load_claude_session_window_from_path` 改 trim-once：逐 chunk 原样 prepend 累计 newline 计数，退出循环后仅对 assembled 首段做一次行对齐；无换行极端片段 fail-closed
- [x] 移除 drain 分支：`has_more = window_start > 0`、`next_cursor = window_start`（>0 时），全量返回 messages
- [x] green 确认（同一 worktree）：60 passed / 9 failed；T1~T4 + 契约测试全绿；9 个失败与 red 跑存量名单**逐一相同**（filter_tests×2、inline tests×2、delete_tests×3、issue529×2，均为 HEAD 存量红，与本 change 无关）

## 3. Frontend 测试先行（TDD red）

- [x] `useThreadRealtimeHistoryReconcile.test.tsx`：pending optimistic user bubble 时 claude reconcile 延迟一次再触发
- [x] `mergeHydratedItemsPreservePrefix.test.ts`：锚点命中/缺失/空列表 ×2 共 4 用例
- [x] red 确认：HEAD 版 `useThreadRealtimeHistoryReconcile.ts` 下新用例如期失败（气泡仍被替换），恢复后 9/9 绿

## 4. Frontend 实现（TDD green）

- [x] `useThreadRealtimeHistoryReconcile.ts`：claude 分支补 `hasPendingOptimisticUserBubble` 守卫（镜像 codex）
- [x] `mergeHydratedItemsPreservePrefix.ts`：新增纯函数
- [x] `useThreadActionsResumeThread.ts`：`applyHydratedItems` 支持 `mergeHydratedPrefix`（默认关闭；rememberFullHistoryForWindow 用 merged 列表）
- [x] `useThreadActions.ts`：`refreshThread`（force+replace）开启 merge；fork 路径（同 force+replace）不开启
- [x] green 确认：merge 4/4、reconcile 5/5、resume-guard + dispatchThreadItemsProgressively 全绿；`start-fork` 1 个失败经 HEAD 对照证实为存量红（另一会话已提交改动引入），与己无关

## 5. 验证与收口

- [x] `rustfmt --edition 2021 --check` 四个改动 .rs 文件 clean
- [x] `cargo test --lib engine::claude_history` 模块回归（worktree 隔离，见 §2 green）
- [x] LSP（primary, error 级）四个前端改动文件 0 诊断
- [x] 用户样本 jsonl 端到端 probe（worktree 一次性测试，已随 worktree 清除）：`page1: messages=142 has_more=Some(false) next_cursor=None`，pages=1、unique=142；最后两条回答、用户首问（最旧区）全部命中；旧实现下 drain 58 行 + 边界丢 4 行 + cursor="0"
- [x] lens_diagnostics 改动文件零新增告警（仅 spec delta 的 MD041 markdown 风格提示，与既有 change 的 spec delta 格式一致）
- [x] ADR 校准回写 Gate：本 change 不涉 engine registry / Shared 支持集合 / provider binding / canonical fact schema / context compiler / terminal-ACK contract / recovery exit-abandon，**无需回写基石文档**（结论记录于此）
