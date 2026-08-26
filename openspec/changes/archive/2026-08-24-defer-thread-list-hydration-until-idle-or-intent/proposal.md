# Proposal: defer-thread-list-hydration-until-idle-or-intent

> OpenSpec change id: `defer-thread-list-hydration-until-idle-or-intent`  
> Evidence: 冷启立刻点假死（Win/Mac）；用户反馈「会话转圈期间整窗不可点」「切工作区/对话会反复」；  
> 基线对照：v0.7.15 因竞态常跳过 list 体感不卡，0.8 `9e3c1bdd8` 修正确性后几乎必跑 first-paint。  
> 关联：`optimize-cold-start-hydration-orchestration`、`fix-runtime-workspace-switch-main-thread-stall`、  
> `docs/analysis/cold-start-click-freeze-postmortem-2026-08-10.md`

## Why

冷启 / 切工作区后 **自动立即跑 first-paint list 管线**，与用户点击抢主线程，表现为转圈、整窗假死、必须等加载完才能点。  
护盾挡点击不是产品终局。应改为：**能不启就不启；最简预热；意图或空闲再跑有界 first-paint**，加载中全局仍可交互。

## 目标与边界

### 目标

1. **冷启默认不立即 ensure IPC list**；壳 + 本地 snapshot/cache 先可点。  
2. **用户切换工作区（意图）** → 对目标 workspace 跑有界 first-paint；取消旧 workspace 任务。  
3. **无意图** → `requestIdleCallback`/超时天花板补跑当前 active，保证列表最终正确。  
4. **加载中不得锁死整窗**；list apply 必须 `isStale` 可丢弃。  
5. 回退本轮无效的 `StartupInteractionShield`；保留有价值的 uiScale rAF / home gate 等小修。

### 边界

- 主改：`useWorkspaceThreadListHydration` 调度策略 + 单测 + OpenSpec specs。  
- 不改 threads reducer 业务语义、不改 multi-engine merge 规则、不重做 uiScale platform-split。  
- 不引入默认全屏遮罩。

### 非目标

- 不回退 `9e3c1bdd8` 正确性（map 未齐不 mark 永久跳过）。  
- 不在本 change 做 Rust catalog 9999 再扫（导航侧已本地 topology）。  
- 不解决流式对话 jank。  
- 不把「点任意 UI」都当 first-paint 触发。

## What Changes

- **BREAKING（行为）**：冷启 active 齐后 **不再短定时必跑 first-paint**；改为 **输入 quiet 门控**（minDelay + quiet + 天花板）。  
- **`useWorkspaceRestore` 同步修复**：hasLoaded 后 **禁止同 tick list**（Cmd+R 复发主因，与 hydration 双开）；同样 quiet 调度 + first-paint 模式。  
- 工作区切换：cancel 旧任务 + quiet 意图 first-paint。  
- gate 未 ready 时 pointerdown：**soft-cancel** in-flight list apply 并重排 quiet。  
- 显式 `force` / Settings ensure / Load older：路径不变。  
- 删除 `StartupInteractionShield`（已回退）。  
- Spec：扩展 `client-startup-orchestration` / `runtime-workspace-switch-hydration` 滞后调度条款。

## 技术方案对比

| 方案 | 做法 | 取舍 |
|------|------|------|
| A 护盾挡点击 | 冷启仍立刻 list | 否决：产品差、穿透、不治切换 |
| B 永久跳过 auto list | 恢复 0.7 竞态 | 否决：侧栏假加载 |
| **C 意图 + idle 滞后（采用）** | 冷启 idle 补跑；切 workspace 意图跑 | 可点 + 最终正确 |

## Capabilities

### New Capabilities

- 无（调度策略落在既有 capability）

### Modified Capabilities

- `client-startup-orchestration`：冷启 list 触发改为 idle-or-intent，禁止 mount 后短定时必跑。  
- `runtime-workspace-switch-hydration`：切换为意图触发 first-paint + cancel 旧任务；加载中全局可交互。

## Impact

- Code: `useWorkspaceThreadListHydration.ts` + tests；`interactiveMainThread.scheduleWhenBrowserIdle` 复用  
- 可能触及：uiScale gate 时机（list 更晚 stamp `startup-gate-ready`）— home/input-ready 路径保留  
- 用户可见：冷启侧栏可能更久显示 cache/空态，但可点设置/切项目；切换后列表稍后填满  

## 验收标准

1. 冷启 0–2s 不调用 `listThreadsForWorkspace`（无用户切 workspace）。  
2. 冷启 idle/天花板后 active 仍会 first-paint 一次。  
3. active A→B：cancel A，对 B first-paint（意图路径）。  
4. force ensure 立即跑。  
5. 相关 Vitest 绿；无 StartupInteractionShield 生产挂载。
