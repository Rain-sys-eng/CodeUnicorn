# Tasks: add-minimal-transcript-live-turn-fold

## 1. View Model 核心

- [x] 1.1 [P0] `messagesViewModel.ts`：新增 `MINIMAL_TRANSCRIPT_TRAILING_COLLAPSE_THRESHOLD = 4`；默认模式 `TRAILING_PROCESS_COLLAPSE_THRESHOLD = 5` 不动。
- [x] 1.2 [P0] `resolveMinimalTranscriptCollapsedTimeline` 的 `isThinking` 分支改为 `foldLiveTurn`（design §2）：live anchor 前整段折叠 + 极简阈值 4 的 trailing 窗口 + `liveturn:` phaseKey + 两种放置路径。
- [x] 1.3 [P0] `foldCompletedTurn` 增加 `legacyExpandedKeys` 参数，完成分支传入 tail segment 的 `liveturn:` key 做展开态迁移（design §2.2）。

## 2. 测试

- [x] 2.1 [P0] `messagesViewModel.minimalTranscript.test.ts` 追加 design §5 用例 1-5（改写旧 per-phase 回落用例 + 新增 5 例，共 12 例全绿）。
- [x] 2.2 [P1] 默认模式 trailing 阈值 5 guard：常数与 `collectProcessPhaseCollapsedTimeline` 逐行未动，orchestration 套件 93/93 全绿覆盖。

## 2A. 展开态内层 per-phase 渲染（2026-08-25 修订，目视验收反馈）

- [x] 2A.1 [P0] `messagesViewModel.ts`：抽出 `collectPerPhaseCollapsedInto`（默认模式 per-phase + trailing 收集逻辑平移），`collectProcessPhaseCollapsedTimeline` 改为调用它（design §2.4）。
- [x] 2A.2 [P0] `foldCompletedTurn` / `foldLiveTurn` expanded 分支：外层 chip 保持渲染（insertBeforeItemId 锚首个可见 item）+ 内层调用 `collectPerPhaseCollapsedInto`；折叠态逐行不变。
- [x] 2A.3 [P0] `messagesTimelineProjection.ts`：`phaseByFirstItemId` 支持同锚多 chip（外层 header 在上）。
- [x] 2A.4 [P0] 测试：改写 minimalTranscript 两个 expanded 用例 + 新增 design §5 用例 7-8；投影测试追加用例 9。
- [x] 2A.5 [P1] focused vitest + tsc + `openspec validate add-minimal-transcript-live-turn-fold --strict --no-interactive` 全绿。

## 3. 验证与收口

- [x] 3.1 [P0] focused vitest（messages/orchestration 93/93）全绿；`src/features/messages` 全量 30 失败经 HEAD 对照（git show 换出本 change 两文件复跑，30 failed 完全一致）确认为 HEAD 存量问题，与本 change 零 delta。
- [x] 3.2 [P0] `openspec validate add-minimal-transcript-live-turn-fold --strict --no-interactive` 通过。
- [x] 3.3 [P1] tsc 类型检查 0 error。
- [x] 3.4 [P1] 人工目视：极简开启流式中只剩「live chip + 生长 prose + 尾部窗口」；展开/折回/完成瞬间不抖动；默认模式无变化。（2026-08-25 用户目视验收通过；展开态内层 per-phase 渲染经 §2A 修订后二次验收通过）
