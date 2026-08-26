# Change: fix-claude-history-window-message-loss

## Why

用户群集中反馈「吞消息」（Windows / Claude 引擎，0.9.1~0.9.3 全版本）：对话过程中
流式内容可见，turn 结束一刻消息消失；一旦吞过，后续每轮都吞；刷新不回来。
用用户原始 session jsonl（619KB / 271 行）端到端对账确认：**磁盘数据完整，
是 history window 加载链在丢消息**。三个叠加 bug：

1. **死游标**：`load_claude_session_window_from_path`（`engine/claude_history.rs`）
   在 window 已覆盖全文件（`window_start == 0`）但 parsed rows 仍超过 limit(80)
   时，drain 最旧 N 行后仍返回 `has_more=true` + `next_cursor="0"`；前端以
   `before="0"` 翻页得到空页 → 被裁掉的消息**永远无法加载**。
   且即使 `window_start > 0`，drain 掉的行落在两页 byte 范围之间，
   翻页同样永久跳过（inter-page gap）。
2. **256KB 边界吞行**：window 组装按 chunk（`CLAUDE_WINDOW_TAIL_CHUNK` = 256KB）
   逐段 drop 首行残段，跨界行尾部被 drop 后与下一完整行粘成非法 JSON，
   被解析循环静默跳过——**每个 chunk 边界丢 2 行**。用户样本实测丢 4 行；
   若丢中 assistant text chunk，该回答从界面永久消失。
3. **reconcile 全量替换**：turn/completed 后 +1.2s
   `useThreadRealtimeHistoryReconcile` → `refreshThread` →
   `resumeThreadForWorkspace(force, replaceLocal)` 用上述 window 结果
   `setThreadItems` 整体替换 live items，窗口之外的已展示消息（含已翻页
   加载的旧消息）被裁掉，且 `itemCountAfter > 0` 时不重试——
   把 bug 1/2 的丢失在「结束那一刻」具象化，并造成 sticky 感知。

## What Changes

### Backend（`engine/claude_history.rs`，P0）

- window 组装改为**整段组装后只对首段做一次行对齐**（trim-once）：不再逐 chunk
  drop 首行残段，保证任意完整 jsonl 行不丢失；单行超过 byte window 的极端情形
  （如超大 base64 image 行）fail-closed：该行仅由更早分页携带，不产生错误数据。
- 移除 messages drain：`limit` 仅作为 byte window 行数启发（`limit*4` newlines），
  window 解析出的 messages **全量返回**；`has_more = window_start > 0`，
  `next_cursor = window_start`（行对齐偏移）。两页 byte 范围首尾相接，
  分页连续无损；`window_start == 0` 时 `has_more=false`、`next_cursor=None`，
  死游标消除。
- 响应形状不变（messages/hasMore/nextCursor 同字段同语义），兼容现有前端；
  单页 messages 数量上限由 window 行数启发自然约束（≤ ~limit*4 行），
  前端首漆 300 条渐进 cap 不变。

### Frontend（P1）

- `useThreadRealtimeHistoryReconcile`：Claude reconcile 触发前检查
  `hasPendingOptimisticUserBubble`，有待定乐观气泡时按 attempt+1 延迟
  （与 codex 路径对齐），避免替换掉尚未落盘的用户气泡。
- `resumeThreadForWorkspace` 的 force+replace 路径（post-turn reconcile 专用）
  增加 **preserve-prefix merge**：以 hydrated 首条 item id 在现有列表中定位锚点，
  `merged = current[0..k] ++ hydrated`；锚点找不到时回退整体替换（信任磁盘）。
  保留窗口之外已展示/已翻页的旧消息，消除「结束那一刻少一截」。
- 显式 rewind / fork / delete 路径不经此 merge（仍整体替换，信任磁盘），
  语义不回归。

## Impact

| 维度 | 说明 |
| ---- | ---- |
| Backend | `engine/claude_history.rs`（window 组装 + drain 移除）、`claude_history_list_budget_tests.rs`（契约更新）、新增 `claude_history_window_fidelity_tests.rs` |
| Frontend | `useThreadRealtimeHistoryReconcile.ts`（乐观气泡守卫）、`useThreadActionsResumeThread.ts`（preserve-prefix merge）、`useThreadActions.ts`（refreshThread 传递 merge 选项）+ 对应测试 |
| 兼容性 | `load_claude_session` 响应字段不变；单页 messages 可能多于 limit（设计上界 ~limit*4）；`next_cursor` 语义不变（行对齐 byte offset），不再出现 `"0"` |
| Out of scope | grok 引擎的同类反馈（机制不同链：grok 无 window 加载、无 post-turn reconcile；待用户样本单开 change）；live settle 路径其它边缘 |

## Acceptance

1. 构造 >80 parsed rows 且全文件可被 window 覆盖的 session：首次加载返回
   **全部** messages，`has_more=false`，`next_cursor=None`；旧消息一条不少。
2. 构造跨 256KB 边界的 jsonl（含压边界的 assistant text 行）：window 加载
   行数守恒，压边界行完整出现在结果中。
3. 构造 window_start > 0 的大文件：page1 + page2（before=cursor）messages
   并集 == 全量，无交集、无缺口。
4. 单行 >256KB（模拟大图消息）压 window seam：该行由更早分页完整带回，
   不产生非法 JSON 吞行。
5. post-turn reconcile 后，窗口之外已展示的旧消息保留；有待定乐观用户气泡时
   reconcile 延迟，气泡不被替换。
6. 既有 claude_history 测试套件全绿（契约更新后的预期）。
