## Why

Shared Session 使用 Codex（及其它会 spawn 子会话的 CLI）时，native owner binding 被 hide 后，子代理仍带着 `parent_thread_id` / `parentSessionId` 指向该 hidden owner。`useThreadRows` 在父 id 不在列表中时把子会话升为顶层根，侧栏出现 Archimedes / Aristotle 等「下崽」行。现有 hide 只挡 binding id / control-plane 标题，无法靠前缀识别子代理；native Codex 靠父 id 建树，Shared 侧 parent→`shared:` 的 remap 仅 exact map lookup，id 形态（raw / `engine:raw`）不一致时会漏挂。

## 目标与边界

### 目标

| ID | 目标 | 可测定义 |
|----|------|----------|
| G1 | Shared 子代理按 parent id 改挂 `shared:` | child.parent 指向 hidden native owner（任意支持引擎 id 形态）→ 侧栏挂在对应 `shared:*` 下，而非顶层根 |
| G2 | 引擎无关 | Codex / Claude / Grok（及 map 内任意 owner）共用同一 lookup；无 parent 的引擎 no-op |
| G3 | 不扩大 hide | 不因本变更删除用户可见行；不改 id hide / MOSSX / collab title 闸语义 |
| G4 | 无 Shared / 普通 native 父子零回归 | parent 不在 shared owner map 时 `parentThreadId` 不变 |

### 边界

- Frontend thread list / parent remap 与 live 子树投影辅助。
- 不改 Shared V2 send / binding materialize / 后端 catalog 是否吐 parent。

## 非目标

| 项 | 原因 |
|----|------|
| 按昵称/标题猜父子 | 无 parent 时宁漏勿误伤 |
| Grok/Kimi catalog 补 `parentSessionId` | 后端独立洞，本波次不修 |
| 整棵 hide Shared 子代理 | 破坏 Strip / `childSubagentThreads` / S10 |
| 改 lineage / provider-continuation 字段 | 与会话树 parent 正交 |

## What Changes

- 增强 parent-id lookup（raw / `engine:` 变体），用于识别 Shared 下崽。
- **侧栏精准隐藏**：`useThreadRows` 对 parent 命中 Shared hidden owner / `shared:` 的 native 行不进入侧栏树（不下崽）。
- **store 仍保留**子会话行，供幕布 / Strip / `childSubagentThreads`；**不**改幕布 subAgent 展示规则。
- list 路径可继续 remap parent→`shared:`（辅助识别/对齐）；侧栏清洁以 **hide 动作** 为准，不是「展开可见的嵌套」。
- 单测：侧栏隐藏 + lookup 变体 + native 树不受影响。

## 技术方案对比与取舍

| 方案 | 说明 | 取舍 |
|------|------|------|
| A. 前缀/标题 hide 子代理 | 无稳定前缀 | 拒绝 |
| B. parent∈hide 则删行 | 破坏 Strip 子树 | 拒绝 |
| **C. parent-id 变体 lookup + 改挂 shared:（采用）** | 对齐 native 识别；不碰 hide | **采用** |

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `subagent-session-tree-navigation`：Shared parent 替换 hidden native owner 时 MUST 覆盖跨引擎 id 形态（raw / `engine:raw`），且不得因 owner 被 hide 而将子会话升为顶层根。

## Impact

| 层 | 触点 |
|----|------|
| Frontend | `sharedSessionSummaries.ts`、`useThreadActions.helpers.ts`（Grok merge remap）、`sidebarInternals.ts`、Vitest |
| Specs | `openspec/specs/subagent-session-tree-navigation` delta |
| 无 | IPC / schema / Rust catalog |

## 验收标准

1. Shared × Codex：子代理 parent 为 raw 或 `codex:` owner → 侧栏挂在 `shared:` 下，无顶层希腊名根行（在 parent 元数据可用时）。
2. Shared × Claude / Grok：同等 parent 变体改挂；无 parent 时行为与 baseline 一致。
3. Native 无 Shared：父子树不因本变更改变。
4. 现有 hide id / MOSSX / collab title 单测不回归。
5. `openspec validate enhance-shared-subagent-parent-id-attach --strict` 通过；focused Vitest 通过。
6. **不自动 commit**；作者 review 后由用户检查。
