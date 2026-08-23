# enhance-pi-native-rpc-session

## Why

PI 引擎当前以 `pi --print --mode json` **spawn-per-turn** 接入（`src-tauri/src/engine/pi.rs`），每轮起一个进程、靠 `--session-id` 续接。该形态拿不到 pi 的一等能力：mid-turn steer / follow-up 排队、会话内 compact、fork、session tree——这些全部是 **`pi --mode rpc` 长驻进程**的命令面能力（本地 `docs/rpc.md` 与 `dist/modes/rpc/rpc-types.d.ts` 实证，pi ≥ 0.84）。

同时，mossx 已有通用「排队 + 融合」链路（`composer-queued-followup-fusion`）：`decideEngineMessageDelivery` 按 capability matrix 的 `input.mid-turn` 决定 same-run steer / cutover / queue。pi 的 `input.mid-turn` 目前标 `unsupported`，融合按钮对 pi 永远不可用——但 upstream steer 是 pi 的强项，属于「上游有、我们没接」。

设计稿已定稿：`docs/designs/pi-native-features/final-recommended.html`（方案 2 全屏树 × 方案 3 tab 分支 chip 融合，只做 pi native 独立增强；跨引擎共同分叉方案 4 不在本 change）。

## What Changes

- **Rust：新增 `engine/pi_rpc.rs` RPC 长驻会话**。`pi --mode rpc` resident process per (workspace × session)：strict JSONL framing（仅 `\n` 分隔、strip `\r`）、request/response id 关联（oneshot map）、事件泵复用 `parse_pi_stream_line` 投影 EngineEvent、extension UI request 一律 auto-cancel（headless 安全边界）、进程死亡检测 + 下一次 send 惰性复活。**fallback**：RPC spawn 失败自动回退现有 print-json 路径并 log warn，不阻断发消息。
- **发送语义**：idle 时 `prompt`；`isStreaming` 时 `steer`（same-run 融合）——turn 终态从「进程 EOF」升级为 typed `agent_settled`；interrupt 从 kill 升级为 `abort` 命令（kill 仅作兜底）。steered user message 经 `message_start`(role=user) 投影上幕布。
- **新 Tauri 命令**：`pi_get_session_stats`（contextUsage 百分比）、`pi_compact`（customInstructions）、`pi_fork`（entryId → 返回源文本填入 composer）、`pi_get_session_tree`（get_tree 投影 lanes/书签/leaf）、`pi_get_fork_messages`。
- **前端接线**（全部 capability-gated，仅 pi 生效）：
  - `input.mid-turn: supported` → 现有 MessageQueue「融合」按钮对 pi 可用（same-run steer，默认排队行为不变）；capability 即准入，不要求 experimental steer 总开关；
  - composer footer 新增 pi-only `/compact` 入口 → 弹窗（统计三连 + 自定义指令）→ compaction 事件经 Raw 映 canonical `thread/compacting|compacted|compactionFailed` 留痕；
  - user 气泡 hover `⑂` 分叉 → 确认弹窗（明说「回到该消息之前的点、以该消息为草稿重写、新会话文件」语义）→ fork-then-switch-back + 源文本填入新会话草稿 + 自动跳转分叉幕布；
  - **会话树 = 中间对话区「上下右」dock**（`PiConversationTreeSplit` pi 独立容器，与 subAgent inspector 分域零改动）：git-graph 轨道（首个 child 延续主线）、会话族全图（`parentSession` 血缘；跳入分支主线不截断）、激活路径跨 lane 贯通染色、lane chip + ↪ 树内跳转（派生 lane 来回跳、文件内 lane 诚实禁用）、user 节点 fork、turn 结束自动刷新；**只读地图 + fork + 跳转，不做树内 leaf 移动**；
  - tab 分支 chip（>1 lane 才出现，点击开树）+ 侧栏 `⑂ N` 徽标（仅 active thread）+ run-status 条「会话树」pill，三处共享同一 feature-local store；
  - **fork 派生会话不占侧栏**：`parentSession` → `parentSessionId` → `parentThreadId`（session-index 与 live disk list 双通道归一化）→ `useThreadRows` 隐藏派生行；pi parentThreadId 与子代理计数三处分域。
- **capability matrix pi 行刷新**：`input.mid-turn` → supported；`session.fork` → supported（**fork-to-new-file 语义**，注释注明非树内 lane）；`session.tree` → supported（只读 tree + fork，RPC 无 leaf-move，注释注明）；`rpc.server` → supported；`session.switch` 保持 unknown（`switch_session` 换文件能力未产品化）。

## Capabilities

### New Capabilities

- `pi-rpc-session-runtime`: PI 引擎的 RPC 长驻会话运行时——resident process 生命周期、strict JSONL framing、request/response 关联、steer/follow-up/abort/compact/fork/tree 命令面、print-json fallback。
- `pi-session-fork-tree`: PI 会话的 fork（fork-to-new-file + 源文本回填）与只读会话树投影（全屏 overlay / tab chip / 侧栏徽标）。

### Modified Capabilities

- `engine-capability-matrix`: pi 行 `input.mid-turn` / `session.fork` / `session.tree` / `rpc.server` 四格升级（语义注释），`session.switch` 保持 unknown。
- `composer-queued-followup-fusion`: pi 作为 `input.mid-turn=supported` 引擎接入既有 same-run steer 融合路径；默认排队行为不变。

## Impact

- Affected code: `src-tauri/src/engine/{pi.rs,pi_rpc.rs(新),pi_history.rs,mod.rs,commands.rs,events.rs}`、`src-tauri/src/command_registry.rs`、`src-tauri/src/session_index/writers.rs`（pi 行 parentSessionId）、`src-tauri/src/bin/cc_gui_daemon/engine_bridge.rs`（影子同步）、`src/features/composer/**`、`src/features/messages/**`（气泡 action bar / compaction pill）、`src/features/pi-session/**`（新：dock 树面板 / fork dialog / compact dialog / 投影 / feature-local store）、`src/features/app/components/{ThreadList,TopbarSessionTabs}.tsx`（⑂N 徽标 / tab chip）、`src/features/app/hooks/useThreadRows.ts`（派生隐藏）、`src/features/threads/hooks/useThreadActions{,.helpers}.ts`（pi list 归一化携带 parentSessionId）、`src/features/layout/{components/DesktopLayout.tsx,hooks/useLayoutNodes.tsx}`（dock 挂载 / 跳转消费 / 子代理分域）、`openspec/specs/engine-capability-matrix/fixtures/matrix.json` + codegen、`src/services/tauri/**`、`src/i18n/locales/*`（新增 key 走既有命名空间）。
- APIs: 新增 Tauri 命令 `pi_get_session_stats` / `pi_compact` / `pi_fork` / `pi_get_session_tree` / `pi_get_fork_messages`。
- Data: pi session 文件仍由 pi 自己写（`~/.pi/agent/sessions/**`），mossx 不写 vendor 文件（红线 21 不变）；fork 产生的新文件由 pi RPC 命令创建。
- Compatibility: RPC spawn 失败回退 print-json，行为与现状一致；其他 8 引擎零影响（全部 pi-gated）。

## 目标与边界

- 目标：pi native 会话获得 steer 融合、/compact、fork、只读会话树四项一等能力，达到设计稿 `final-recommended.html` 的终态。
- 边界与诚实语义（2026-08-23 RPC contract 校准，依据 `rpc-types.d.ts` 全量命令枚举）：
  - **fork = fork-to-new-file**（新会话文件，复制 active path 至分叉点，源文本回填 composer）；**不是** TUI `/tree` 的同文件树内 lane。
  - **树 = 只读地图 + fork 入口**：RPC 无 leaf-move / navigate 命令（upstream gap），不做「跳转到任意节点继续」的假交互；TUI 创建的同文件 lanes 可展示。
  - tab chip = 当前文件 lane 指示器 + 开树入口，**不做跨 lane 切换**（切换语义 RPC 不存在）。
  - ACK 分级：prompt/steer 的 `response.success=true` = accepted/queued；turn 终态 = typed `agent_settled`；进程退出只算 cleanup（对齐 Qoder 校准的 inputAck 纪律）。
  - Extension UI request（select/confirm/input/editor）一律 auto-cancel，不桥接 mossx elicitation（v1 边界）。

## 非目标

- 不改变 Shared Session 中 pi 的既有行为（Shared 路径仍走现有 spawn 逻辑；本 change 只动 native pi thread）。
- 不做跨引擎共同分叉（方案 4：claude/grok/codex/opencode 的 Context Compiler 截断投影）——独立 change。
- 不做 pi `switch_session` 换文件的产品化（`session.switch` 保持 unknown）、不做 `clone` / `export_html` / `get_commands` / bash 命令面。
- 不做树内 leaf 移动 / branch summary 自动生成（upstream RPC 无命令；等 pi 补 navigate 后独立评估）。
- 不做 MCP（upstream 明确反 MCP 设计立场，matrix 维持 `unsupported` 并注释原因）。
- 不动幕布（curtain）骨架、侧栏结构、composer 骨架（设计稿冻结项）。
