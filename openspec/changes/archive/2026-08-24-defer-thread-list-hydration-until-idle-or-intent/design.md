# Design: defer-thread-list-hydration-until-idle-or-intent

## Context

- 0.8 修 hydration race 后，active+map 齐 → `setTimeout(500)` → first-paint **几乎必跑**。  
- first-paint 仍含 titles/shared/codex list + setThreads，与点击叠假死。  
- 切工作区同 effect 再跑一遍 → 用户「会反复」。  
- 护盾方案已否决并回退。

## Goals / Non-Goals

**Goals：** 调度「何时 ensure」；保留 first-paint 有界负载与 cancel/stale。  
**Non-Goals：** 再砍 first-paint IPC 内部（可后续）；重遮罩。

## 触发矩阵

| 事件 | 调度 | 说明 |
|------|------|------|
| 冷启 / Cmd+R / 首次 bind active | **Quiet first-paint** | minDelay 1.5s + 无输入 quiet 1s，天花板 15s |
| `useWorkspaceRestore` | **同一 quiet 调度** | **禁止** hasLoaded 后同 tick list（复发根因） |
| active A→B | **Intent + quiet** | cancel A；短 delay + quiet 再 ensure B |
| pointerdown 且 gate 未 ready | **soft-cancel** list apply + 重排 quiet | 点击优先于 setThreads |
| `ensure(..., force)` / Settings | **立即** | 现有路径 |
| 用户 Load older / 显式刷新 | **立即** | 现有路径 |
| 无 active（home） | **不跑 list** | 可 stamp home-input-ready |

## 核心逻辑（伪代码）

```
effect(activeWorkspaceId, workspacesById):
  prev = previousRef
  if prev && prev !== active:
    cancelWorkspaceTasks(prev, "stale")
    cancel pending idle/intent timers for prev
  previousRef = active

  if !active: clear auto; return
  if autoHydrated === active: return   // already started ensure for this id
  if !map.has(active): return          // 正确性：不永久 skip，等 map

  isIntentSwitch = prev != null && prev !== active

  if isIntentSwitch:
    timer(100ms) → mark auto; ensure(active, preserve)
  else:
    // cold / first bind
    idle(minDelay=2s, timeout=8s) → mark auto; ensure(active, preserve)
```

常量（test 模式全 0）：

- `COLD_START_IDLE_MIN_DELAY_MS = 2000`
- `COLD_START_IDLE_TIMEOUT_MS = 8000`
- `WORKSPACE_SWITCH_INTENT_DELAY_MS = 100`

## Gate / uiScale

- `startup-gate-ready` 仍由 first-paint-complete / force-enter / home-input-ready stamp。  
- 冷启 list 更晚 → gate 更晚；uiScale phase-2 仍可用 `input-ready && !active-workspace-ready` 或 12s 天花板，**不依赖护盾**。  
- 保留 `confirmUiScaleHealthy` rAF 延后（减少首帧同步 IO）。

## 风险

| 风险 | 缓解 |
|------|------|
| 侧栏短暂空/旧 | snapshot/cache 优先展示；idle 必补 |
| 连切 A→B→C 叠任务 | cancel + auto 标记仅在真正 start ensure 时写 |
| 测试 fragile | test 模式 delay=0，advanceTimers / waitFor |

## 回滚

恢复 `setTimeout(500)` auto ensure 一行逻辑即可；OpenSpec change 标记 abandoned。
