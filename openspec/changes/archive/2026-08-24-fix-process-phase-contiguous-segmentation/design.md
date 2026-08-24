## Context

- 折叠核：`resolveCollapsedTimelineItems` → `processPhaseChips` → `messagesTimelineProjection` → `MiddleStepsCollapsedChip`。
- 2026-08-02 把 contiguous walk-back 改成 turn-final ownership，消除
  `reasoning → assistant(plan) → tools → assistant(final)` 顶部孤儿思考。
- 副作用：长回合所有工具进终稿一个 chip，中间正文连成墙。用户明确要求恢复分段穿插。

## Goals / Non-Goals

**Goals**

- 每段 assistant 正文只拥有紧挨其前的连续 process run。
- 保留 hard-unmount、canvas-hidden shell、单步也折叠、trailing 窗口。
- 最小 diff，用既有 phase 投影（collapsed 停在 assistant 前，expanded 锚在首个 process）。

**Non-Goals**

- 改 engine 事件顺序或 Shared `TurnCommitted` projector。
- 启发式隐藏计划句。

## Decisions

### Decision 1: Contiguous walk-back per assistant（采用）

对每个有可见正文的 assistant `A`：

1. 从 `A` 向前 walk，遇非 `reasoning` / `tool` / `explore` 即停。
2. 该连续 run 归属 `A`（`phaseKey = A.id`）。
3. Claude 双身份：`candidate.id === A.id` 的 process 不进 chip。
4. `countRenderableCollapsedEntries >= 1` 建 phase（沿用单步思考也折叠）。

```text
user → tools1 → A1 → tools2 → A2 → running
         └── chip A1  └── chip A2   └── trailing live
```

**Why not keep turn-final**

- 正是「198 次工具收成一条」的根因；分段叙事比消孤儿思考更优先。

**Why not hide mid-assistant**

- 用户要的是穿插，不是只留终稿。

### Decision 2: 孤儿思考归到紧挨的正文（接受）

```text
reasoning → A-plan → tools → A-final
```

旧 turn-final：思考+工具全进 A-final，plan 上方空。  
新 contiguous：思考进 A-plan chip，工具进 A-final chip。

顶部不再出现展开的孤儿 `思考过程` 行（仍 hard-unmount 进 chip），只是 chip 挂在 plan 而不是终稿。这比整轮合并更接近「正常分段」。

### Decision 3: trailing / shell / hard-unmount 不动

- 终稿后的 live process 仍不并入已完成 phase。
- 超 `TRAILING_PROCESS_COLLAPSE_THRESHOLD` 仍留最后 3 张卡。
- `filterCanvasHiddenProcessTools` 仍先跑，再 walk-back。

## Risks

| Risk | Mitigation |
|------|------------|
| 短回合多一个 plan 上方思考 chip | 单步仍折叠，视觉比孤儿思考行轻 |
| 既有 turn-final 测试改红 | 改写成「每段一 chip」断言 |
| Shared 历史若本就 process-before-prose | 通常只有一段终稿，外观不变 |

## Implementation Notes

- 入口：`collectContiguousProcessItemsForAssistant` 替换 `collectTurnProcessItemsForFinalAssistant`。
- projection / chip UI 不改：collapsed 仍 `phaseByAssistantId`，expanded 仍 `insertBeforeItemId`。
- 测试锁定多段两 chip、孤儿思考归 plan、trailing 仍 live。

## Validation

见 `tasks.md` / `verification.md`。
