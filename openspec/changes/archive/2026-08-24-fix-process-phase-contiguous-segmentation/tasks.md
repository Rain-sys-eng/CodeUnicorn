## 1. 折叠归属

- [x] 1.1 [P0] 用 `collectContiguousProcessItemsForAssistant` 替换 turn-final collect；遇非 process 即停。
- [x] 1.2 [P0] 保留 hard-unmount、shell filter、单步折叠、trailing 窗口。
- [x] 1.3 [P1] 更新 `ProcessPhaseCollapse` / 函数注释为 contiguous segmentation。

## 2. 测试

- [x] 2.1 [P0] 多段 assistant 各挂自己的 chip；中间正文保留且不被整轮 unmount 后贴成无过程墙。
- [x] 2.2 [P0] `reasoning → plan → tools → final`：思考归 plan，工具归 final。
- [x] 2.3 [P1] 单步思考 / trailing live / shell hide 既有用例保持绿。

## 3. Spec

- [x] 3.1 [P0] 写本 change 的 `message-process-phase-collapse` delta。
- [x] 3.2 [P0] 同步 main spec `openspec/specs/message-process-phase-collapse/spec.md`。
