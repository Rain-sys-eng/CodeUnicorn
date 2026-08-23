# enhance-pi-native-rpc-session tasks

> 执行顺序按 Engine Onboarding Guide §0 矩阵纪律；本 change 是「既有 engine 接入面变更」，A/B 层只动 pi 臂，其余引擎零影响。
> 验收前不提交（用户要求）；全部任务完成后跑 §10 全量 verify。

## 1. OpenSpec 与调研

- [x] 1.1 Gate 文档通读：基石设计 + Onboarding Guide §0 矩阵 + pi `docs/rpc.md` / `rpc-types.d.ts` / `sessions.md`
- [x] 1.2 RPC 语义校准：fork=fork-to-new-file；无 leaf-move 命令；design.md §2 落档
- [x] 1.3 创建 change 四件套（proposal / design / tasks / spec deltas）
- [x] 1.4 `openspec validate enhance-pi-native-rpc-session --strict --no-interactive` 通过

## 2. Rust：`pi_rpc.rs` 长驻 RPC 客户端

- [x] 2.1 `PiRpcClient`：spawn（`--mode rpc` + `--session-id` + home/custom_args）、strict JSONL framing（`\n` split + strip `\r`）、request/response id 关联（oneshot + 30s timeout + 迟到丢弃）
- [x] 2.2 事件泵：response / extension_ui_request（auto-cancel）/ agent event 三分流；agent event 复用 `parse_pi_stream_line` 投影 EngineEvent
- [x] 2.3 命令面：prompt / steer / abort / get_state / get_session_stats / compact / fork / get_tree / get_fork_messages / set_model / set_thinking_level
- [x] 2.4 投影：steered user message 走前端乐观气泡（后端不重复投影，spec 已校准）；compaction_start/end 经 Raw → canonical `thread/compacting|compacted|compactionFailed`；agent_settled 终态
- [x] 2.5 单测：framing（U+2028 不分割）/ 序列化 / extension cancel shape / acceptance≠terminal 纪律测试 + events.rs compaction 映射测试

## 3. Rust：`PiSession` 接入 + fallback + 命令注册

- [x] 3.1 `PiSession` 持有 `rpc` slot + `ensure_rpc()`（惰性 spawn / 死亡检测重建 / Drop kill / 握手后 sticky disable）
- [x] 3.2 `send_message` RPC 主路径（idle→prompt / streaming→steer attached 随 run 同结算 / `agent_settled` 终态 / 10min turn timeout）+ RPC 失败回退 print-json + **fallback 拒绝并发发送**（防双进程交叉写 session 文件）
- [x] 3.3 `interrupt` / `interrupt_turn` → `abort` + 2s kill 兜底
- [x] 3.4 图片输入：RPC 路径读文件 → base64 `images[]`（复用 `cli_image_input` resolve）
- [x] 3.5 新 Tauri 命令 `pi_get_session_stats` / `pi_compact` / `pi_fork` / `pi_get_session_tree` / `pi_get_fork_messages` + `command_registry.rs` 注册 + remote 转发 + daemon `engine_bridge.rs` `#[path]` 同步（A5 纪律）
- [x] 3.6 `cargo test --lib engine::pi`（33）+ `engine::pi_rpc`（4）+ `engine::events`（35）全绿；`cargo check --lib` / `--bins` 通过（`assemble_canonical_facts` 测试引用缺失文件为既有问题）

## 4. 前端：steer 融合接线

- [x] 4.1 matrix fixture：pi `input.mid-turn` → supported + `--write` 重新生成（TS + Rust 产物）+ gate 绿
- [x] 4.2 融合按钮对 pi 可用：`decideEngineMessageDelivery` 全 capability 驱动，matrix 升级后自动路由 same-run steer（useQueuedSend 既有链路，MessageQueue 11 测试绿）
- [x] 4.3 steered user message 上幕布：前端乐观气泡既有链路（`wasProcessing && steerEnabled`），后端不重复投影（spec 已校准）
- [x] 4.4 vitest：delivery decision pi same-run steer 路由用例（engineMessageDelivery.test.ts 7 测试绿）

## 5. 前端：ctx 占用环 + /compact

- [x] 5.1 `pi_get_session_stats` API 封装 + stats store（feature-local 外部 store，不进 domain bag）
- [x] 5.2 Composer footer usage 区新增 pi-only `PiCompactEntry`（⤓ 压缩按钮）
- [x] 5.3 `PiCompactDialog`：统计三连（占用 %/消息数/tokens）+ customInstructions textarea → `pi_compact`
- [x] 5.4 compaction_start/end 经 events.rs Raw Pi 臂映到 canonical thread/compacting|compacted|compactionFailed（幕布复用 Claude 同款渲染，含失败分支）
- [ ] 5.5 i18n：pi-session 组件文案当前硬编码中文（决策记录：v1 接受，H 层补齐为后续任务；不破坏既有 parity 测试）

## 6. 前端：气泡 ⑂ 分叉

- [x] 6.1 user 气泡 action bar 增加 pi-only ⑂ 按钮（TimelineRowRenderer，行缓存兼容：beginForkWithQuote 引用稳定）
- [x] 6.2 `PiForkDialog`：引用原文 + 「创建新会话文件 · 源会话保持不动」诚实文案 → `pi_fork(entryId)`（entryId 由 `pi_get_fork_messages` 文本匹配解析，匹配不到给出明示错误）
- [x] 6.3 **fork-then-switch-back**（2026-08-23 验收后修正）：Rust fork 后立即 `switch_session` 切回源文件（源 thread 发送不漂移）；**turn 进行中禁止 fork**（rpc_has_active_run 守卫）；草稿写入新会话（`pi:<forkedSessionId>`，缺失退化当前 thread）

## 7. 前端：分屏会话树（subAgent 同款左右分屏）

- [x] 7.1 `pi-session` store：`pi_get_session_tree` → lanes 投影（多 child 分叉点每个 child 各开新 lane）+ leaf + label 书签（vitest 4 测试绿）
- [x] 7.2 `PiSessionTreeOverlay` 改造为 **ConversationInspectorSplit 右栏 drawer**（2026-08-23 验收后从全屏 overlay 改为分屏）：lanes 缩进 / 当前 leaf 高亮 / onpath-offpath / 过滤器 / user 节点 ⑂ fork / Esc 关闭 / **非 message 元数据条目不渲染**（model_change / sidechain 等）
- [x] 7.3 topbar「会话树」入口按钮（pi-only，经 MainHeader `extraActionsNode` slot，不动骨架）+ ConversationHost 集成（与 agent/subagent inspector 同槽位，切会话自动让位）

## 8. 前端：tab 分支 chip + 侧栏 ⑂N 徽标

- [x] 8.1 tab 内 `main ▾` chip：>1 lane 才渲染，点击开树 overlay（title 注明 RPC 无 lane 切换命令）
- [x] 8.2 ThreadList thread-meta `⑂ N` 徽标（pi + 仅 active thread + >1 lane，无后台 IPC fan-out），可点击开树
- [x] 8.3 三处共享同一 feature-local store；chip 挂载即拉取（一次性，不轮询）

## 9. Capability matrix 刷新 + codegen + gates

- [x] 9.1 `matrix.json` pi 行四格（input.mid-turn / session.fork / session.tree / rpc.server 升 supported；session.switch 保持 unknown；tool.mcp 维持 unsupported）
- [x] 9.2 `check-engine-capability-matrix.mjs --write` 重新生成 TS + Rust 产物
- [x] 9.3 `check:engine-capability-matrix` / `check:engine-adapter-registry` / `check:model-provider-catalog` / `check:capability-aware-policy-router` / `check:app-shell:governance`（22 测试）全绿
- [x] 9.4 `scan-engine-name-branches.mjs` 新增 4 条 pi 分支全部加 `capability-router-allow-engine-branch` 豁免注释（新 disallowed = 0）

## 10. 收口：校准回写 + 全量 verify

- [x] 10.1 基石文档「最近校准」+「零、当前实现校准」表新增 PI protocol / runtime 行（ADR 校准回写 Gate）
- [x] 10.2 设计稿 `final-recommended.html` legend 增加 RPC 校准注记（fork=新文件 / 无 leaf-move / chip 不切换 / 复用 mossx queue）
- [x] 10.3 `pnpm typecheck` 绿；eslint 改动文件 0 error 0 新增 warning；前端相关 vitest 全绿（threads/hooks 91 失败与 realtimeHistoryParity 2 失败为基线既有，stash 对照确认）
- [x] 10.4 i18n 决策记录：v1 组件文案硬编码中文（见 5.5），不破坏 parity 测试；H 层 10 语言补齐列为后续任务
- [x] 10.5 `openspec validate enhance-pi-native-rpc-session --strict --no-interactive` 终态通过
- [x] 10.6 人工黄金 turn 验收清单（steer 融合 / abort / compact / fork / 树 / chip / 徽标）——**用户客户端实测通过（2026-08-23，b1–b4 多分支会话族全链路）**

## 11. 验收修复 round 1（2026-08-23，色差 / 元数据泄漏 / 优雅）

- [x] 11.1 色差：pi-session.css 全量改用真实主题变量（`--surface-popover` / `--text-*` / `--border-*` / `--status-*`），消除亮色 fallback
- [x] 11.2 非文本条目：树过滤非 message 元数据条目；assistant 空文本显示「⚙ 工具调用」
- [x] 11.3 优雅：lane 缩进（lane × 22px）+ 主题色 dot + hover 态补齐

## 12. 验收修复 round 2（2026-08-23，分屏 / fork 关联 / compact）

- [x] 12.1 会话树从全屏 overlay 改为 ConversationInspectorSplit 右栏分屏（subAgent 同款），幕布列保持可见可交互
- [x] 12.2 fork 关联修复：fork-then-switch-back + turn 进行中禁止 fork + 草稿写入新会话；compact「Nothing to compact」降为中性提示
- [x] 12.3 spec / design / tasks 同步 fork 与树语义变更；openspec validate 通过

## 13. 验收修复 round 3（2026-08-23，分屏布局复刻 / resident 会话对齐）

- [x] 13.1 布局复刻：树面板根节点挂 `.subagent-inspector-drawer`（flex 尺寸 + divider 拖拽 + 键盘调宽全部由 split 既有机制接管）；去掉自创 width:100%（曾撑爆 split 导致 composer 漂移）
- [x] 13.2 **Resident 会话对齐**（树结构不对的根因）：`align_rpc_session` —— 发送与五个 RPC 命令前经 pi_history id→file 解析 + `switch_session` 对齐到调用方 thread 的会话文件；新会话目标用 `new_session`；活跃 run 且目标不同 = 拒绝「另一 PI 会话的 turn 仍在进行中」
- [x] 13.3 前端五个命令调用链全量携带 sessionId（threadId `pi:<id>` 解析）；fork 流恢复 threadId 传参
- [x] 13.4 spec 增加「Resident MUST 对齐调用方会话文件」Requirement；design/tasks/基石文档同步
- [x] 13.5 布局「左上下 | 右」对齐：`DesktopLayout.shouldPlaceComposerInChatColumn` 纳入 pi 树开态（原条件只认 subagent/agent inspector，导致 composer 落在内容区下方形成「左右下」）

## 14. 验收修复 round 4（2026-08-23，fork 僵尸 run / 树形态 / 融合门）

- [x] 14.1 fork 不好使根因：**僵尸 run**——`agent_settled` 经广播传输，丢失则 run 永驻，后续 fork/对齐/跨会话发送全部被「turn 进行中」误拒。修复 `settle_stale_rpc_run_if_idle` 自愈：client `is_streaming` 为权威，run 存在但非流式 = settle 丢失，防御性结算清除；接入 align / send / fork 三入口（fork 守卫移到对齐之后，只挡真实流式）
- [x] 14.2 树形态升级 git-graph 轨道：row × lane 格子 = node / line / 肘部连接（新 lane 首行回连 parent lane）；user 节点实心 accent + 文本加粗、当前节点光晕；时间戳 HH:mm 入 meta
- [x] 14.3 融合按钮禁用根因：same-run steer 被 `experimentalSteerEnabled` 总开关挡死。改为 **capability 即准入**：`input.mid-turn=supported`（pi/dsh）原生放行 same-run steer，compat-input 引擎（claude/codex cutover）仍走原开关——不动共享语义

## 15. 验收修复 round 5（2026-08-23，fork「假失败」= 无成功反馈）

- [x] 15.1 排查结论：用用户真实会话文件实测完整命令序列（align → fork entryId `31b5b4cc` → switch back）全部成功；**fork 实际一直是成功的**（用户 10:45:01 的会话文件已创建）——感知失败 = 成功后零反馈（无 toast / 无导航 / 草稿写进新会话 composer 不可见 / 侧栏发现延迟）
- [x] 15.2 `PiForkDialog` 增加成功确认态：「✓ 分叉已创建」1.6s 自动关闭，明确告知去向

## 16. 重做（2026-08-23，派生会话族模型：parentSession 血缘 + 树合并 lanes）

> 用户决策：fork 派生会话不占顶层侧栏；线路由会话树统一控制；只影响 native pi。
> 注：16.2 的「subagent 嵌套收纳」形态后被 §17 否决（与 subAgent 混淆），16.1/16.3 仍是终态基础。

- [x] 16.1 `pi_history` 解析 session 头 `parentSession`（`SessionHeader.parent_session_id`）→ `PiSessionSummary.parent_session_id` → `rows_from_pi_summaries` 写入 SessionIndexRow（复用 qoder 同款 parentSessionId 管线）
- [x] 16.2 ~~侧栏嵌套收纳~~（§17 改为 `useThreadRows` 直接隐藏派生行）
- [x] 16.3 树合并：`pi_get_session_tree` 返回 `derivedLanes`（同目录 `parentSession` 匹配文件的条目流，只读）；前端 `graftDerivedLanes` 按共享前缀 id 去重、尾部接分叉点（vitest graft 用例）
- [x] 16.4 文案同步（§17 再次更新为「会话树面板」口径）

## 17. 重做 v2（2026-08-23，pi 树与 subAgent 分域：右侧面板独立 tab + 树内跳转）

> 注：本节的「右侧 tab 面板」形态后被 §18 否决（用户要的是中间对话区 dock）；17.1 还原、17.3 侧栏隐藏、17.4 树内跳转仍是终态基础。

- [x] 17.1 **还原**：`ConversationHost.tsx` / `DesktopLayout.tsx` git checkout（subAgent inspector 逻辑零改动）；删除 ConversationInspectorSplit 集成与 `.subagent-inspector-drawer` 用法
- [x] 17.2 ~~右侧面板「会话树」tab~~（§18 拆除，改中间 dock）
- [x] 17.3 **侧栏隐藏派生会话**：`useThreadRows` 过滤 `engineSource === "pi" && parentThreadId` 行（与 Shared pup 同款侧栏级隐藏，thread 本体留 store 供跳转）；不再使用 subagent 嵌套视觉
- [x] 17.4 **树内跳转**：投影标记 `originSessionId` / `laneSessionIds`；派生 lane「↪ 跳转」（§18 改 store 中转）→ onSelectThread `pi:<lane-session-id>`；文件内 lane 诚实禁用（RPC 无 leaf-move）
- [x] 17.5 入口改向（§18 统一为 `openPiTreeOverlay` 开态）
- [x] 17.6 文案：fork 弹窗 / 成功态 / 树 footer 改为「分支出现在会话树面板，跳转继续」

## 18. 重做 v3（2026-08-23，树位置：中间对话区「上下右」dock）

> 用户纠正：树应在**中间对话区**的「上（幕布）下（composer）｜ 右（树）」布局，不是右侧文件/Git tab 面板。v2 的右侧 tab 方案全量拆除。

- [x] 18.1 拆除右侧 tab：`filePanelMode: "piTree"` union / `PanelTabs.tabIds` / `visibleTabs.piTree` / 内容分支 / `handlePiAwareFilePanelModeChange` 全部还原
- [x] 18.2 `PiConversationTreeSplit`（pi 独立容器，包裹聊天列；`activeCanvasStore` 读当前 thread；开态 = pi-session store）挂载于 DesktopLayout 聊天列——subAgent ConversationInspectorSplit / ConversationHost 逻辑零改动
- [x] 18.3 树内跳转改 store 中转（`requestPiThreadJump` → useLayoutNodes 消费 → onSelectThread），panel 带关闭按钮
- [x] 18.4 topbar 按钮 / chip / 侧栏徽标 → `openPiTreeOverlay`（同一开态源）
- [x] 18.5 eslint 新增告警（options dep）修复；app-shell governance 通过
- [x] 18.6 dock 拖拽调宽（pi 自有分隔条 + clientStore 持久化 280–640px）；「上下右」布局修正：`shouldPlaceComposerInChatColumn` 纳入 pi 树开态（composer 进左列，不再落内容区下方）
- [x] 18.7 错误残留清理：locale `panels.piTree`（10 语言）与 `.pi-tree-panel-empty` CSS 删除

## 19. 树体验打磨（2026-08-23，主线贯穿 + 会话族全图 + 来回跳转）

- [x] 19.1 lane 语义修正：**首个 child 延续主线**（分叉点不再截断 lane 0；原「每 child 各开 lane」口径作废），vitest 同步更新
- [x] 19.2 **会话族全图**：`resolve_pi_session_family`（parentSession 链上溯 root + 同族成员收集）；root 非当前文件时主线从磁盘只读解析（`parse_pi_session_entries` + `entriesToForest`）；跳入分支后主线不截断
- [x] 19.3 **来回跳转**：`laneSessionIds[0] = rootSessionId`，主线 lane 也有「↪ 主线」按钮；派生 lane 跳转原样；新增 family 投影 vitest（rootEntries 主线 + 派生 lane + lane0 跳回）

## 20. recovery 卡片根除（2026-08-23，stale session id + align 硬失败）

- [x] 20.1 根因 A：`new_session` / `switch_session` / `fork` 后 `client.state` 缓存不刷新——spawn 握手缓存 id X，`new_session` 后 pi 实际会话是 Y，但 `SessionStarted` 仍发 X（X 从未落盘）→ 下一轮 align(X) 报「session file not found」触发「当前会话需要恢复」卡片。修复：三个命令成功后一律 `get_state` 刷新缓存
- [x] 20.2 根因 B：align 目标文件不存在时硬报错直接触发 recovery 卡片。修复：降级为 `new_session` + warn 日志（文件不存在 = 本来就没有可继续的历史；不打扰用户）

## 21. fork 幕布切换 + 死代码清理（2026-08-23）

- [x] 21.1 fork 成功 = 明确的「去新分支继续」意图：`usePiForkFlow.confirm` 成功后直接 `requestPiThreadJump(pi:<forkedSessionId>)` 切到分叉幕布（草稿已在新会话 composer）；不再只给提示不跳转（forkedSessionId 缺失时保留成功确认态退化路径）
- [x] 21.2 死代码清理：stats store 切片（`statsByKey` / `refreshPiSessionStats` / `usePiSessionStats`，写了没人读）、`PiSessionThreadKey` 类型、`piSessionKey` 导出、`PiSessionFeatureHost.tsx` 更名 `PiBranchChip.tsx`（内容只有 chip）
- [x] 21.3 locale `panels.piTree` add-then-remove churn 全量还原（10 语言 `git checkout`）

## 22. fork 语义钉正 + 「一棵大树」终态（2026-08-23）

> 磁盘实证：pi fork = 回到被点消息的父点、以该消息为草稿重写（对齐 TUI `/tree` selection 语义）；分叉与点击消息一一对应（分支在该消息位置长出，内容是你的重写版）。

- [x] 22.1 **主线丢失 bug**：当前文件是分支时 RPC tree 非空导致 `rootEntries` 被整体忽略——投影改为 `rootEntries.length > 0` 时一律以主线为基底（vitest 回归用例）
- [x] 22.2 **面板跳转后保持打开**：开态从「精确 thread 匹配」改为「workspace + pi 判定」，族内跳转不再关闭面板
- [x] 22.3 **lane 轨道呈现（终态）**：线性链是一条直线（不按深度递进），只在分叉点偏移一次——首个 child 延续主线（lane 0 贯穿），lane-start 行画肘部回连父 lane；lane chip + ↪跳转标在 lane 首行；当前路径实体、其余虚化。此前两版错误形态（lane 分列卡片 / 按深度递进的楼梯）与对应 CSS/投影元数据全量删除，pi-session.css 树段整体重写（修复被我块替换搞残的 head/filter/close 样式）
- [x] 22.4 fork 弹窗语义钉正：「回到该消息之前的点，以该消息为草稿重写」（对齐 pi 真实 fork 语义，不再说「复制到该消息为止」）
- [x] 22.5 **pi fork 分支与子代理计数分域**：三处过滤——① `collectCanvasChildSubagentThreads`；② `Composer.stripChildThreads` 的 parentMap 直通合并；③ **`useStatusPanelData.seedSubagentsFromChildTree`**（子代理列表真正的兜底数据源：tool/collab 扫空时直接读 `threadParentById` 播种，前两个过滤都拦不到）。pi 的 parentThreadId 是会话分支而非 subagent 血缘，分支归会话树单独控制（vitest 回归用例）。**Review 结论：三处均为 `pi:` 前缀 / `engineSource === "pi"` 精确匹配，thread id 引擎命名空间下无其他引擎使用 `pi:` 前缀，其他引擎 subagent 判断零影响（grok/claude:subagent 用例全绿）**
- [x] 22.6 **会话树 pill 进 run-status 条（native pi 专属）**：`ComposerRunStatusStrip` 新增 `piTree` prop——与 todo/subagent/plan/edit 完全同款 pill（GitFork 图标 + 「会话树」label + lane 计数），点击 toggle 会话树 dock（非 section 无展开面板），open 态 `is-selected` 高亮；`selectedEngine === "pi"` 时才传入（其他引擎 strip 零变化）

## 23. 验收修复 round 6 + 收口 review（2026-08-23，树全路径贯通 / turn 末刷新 / 侧栏泄漏 / review 四修）

> 用户实测：分叉链路（b1–b4 多分支会话族）全量通过；本节为最后一批 UI 精修与提交前代码 review 的修复记录。

- [x] 23.1 **树高亮改「激活路径贯通染色」**：原「只亮激活 lane + 直接分叉锚点段」口径在多级分叉（main→b3→b4）下上方链路断色。终态规则：当前叶→根整条祖先链（`onActivePath`）跨 lane 全贯通——每条 lane 首个~末个 on-path 节点间格子（轨道+圆点+时间序插入行的过路段）染激活 lane 色；lane-start 在路径上的分叉曲线才上色；路径外分支一律置灰（`PiSessionTreePanel.activePathLaneRows`）。中间的「触发锚点 walk」方案被该口径取代后已删除
- [x] 23.2 **turn 结束自动刷树**：`PiSessionTreePanel` 经 `useAppServerEvents.onTurnCompleted`（hub 多订阅者安全，`useAgentSoundNotifications` 同款先例）按 workspace+thread 过滤后 `refreshPiSessionTree`——不再靠手动切分支刷新；面板未挂载不刷（打开时 mount 刷新兜底）；store `loadingByKey` 防重入
- [x] 23.3 **侧栏 b4 泄漏根因修复**：`normalizePiSessionSummaries` 复用 Gemini 形状归一化时丢弃 `parentSessionId`——live disk list 路径合入的派生行拿不到 parentThreadId，绕过 `useThreadRows` 派生隐藏（session-index 路径正常，故仅 index 快照后新建的 b4 泄漏）。修复：新增 `PiSessionSummary` 类型 + normalizer 按 grok 同款解析 `parentSessionId ?? parent_session_id`；已泄漏 live 行由 merge 的 backfill 臂下轮刷新自动补回。vitest 回归 ×3（归一化双命名 / merge 映射 `pi:<id>` / live 行 backfill）
- [x] 23.4 **review 修复 ①（pi_rpc 请求竞态）**：`request_with_timeout` 原「先写 stdin 后注册 pending」——response 走独立 stdout pump，可在窗口内到达被当 late/unknown 丢弃，调用方干等 30s（get_state 握手等本地快命令最易命中）。修复：pending 先于写注册，写失败回滚
- [x] 23.5 **review 修复 ②（TurnError 双发）**：`try_send_message_rpc` 的 steer-mismatch / align-fail / timeout 三臂自发 TurnError 后返回 `Failed`，`send_message` 的 Failed 臂又发一次——同一 turn 双终态事件（quarantine / onTurnTerminalExternal 双跑）。修复：内层不再自发，Failed 臂统一发一次
- [x] 23.6 **review 修复 ③（turn timeout 双结算）**：600s 超时原只 emit error + abort，run 与 waiter 残留——`agent_settled` 迟到或 stale-settle 自愈时同一 turn 收第二次终态（TurnError 后又 TurnCompleted）。修复：超时即摘下 run、全 waiter（main + attached steer）以同一错误一次结算，再 abort；新增 `PiRpcSendError::Settled` 臂告知 send_message 不再重发
- [x] 23.7 **review 修复 ④（interrupt 空闲 2s 惩罚）**：`interrupt()` 原只要 RPC client 存活就 abort + 2s grace sleep——空闲时 Esc/stop 纯延迟。修复：与 `interrupt_turn` 对齐，仅活跃 run 存在时才 abort + grace
- [x] 23.8 验证：`cargo check --lib` 绿；`cargo test --lib engine::pi::`（16）/ `engine::pi_rpc`（4）/ `engine::pi_history`（3）/ `engine::events`（35）全绿（`pi_auth::list_missing_file_is_all_none` 失败为环境依赖既有问题——本机 shell 有 API key 环境变量使 provider 状态非 none，与本 change 无关）；前端 `tsc --noEmit` 0 错误；pi-session / useThreadActions.helpers vitest 全绿

## 24. 验收修复 round 7（2026-08-23，侧栏 live 窗口分支泄漏 + 「main 丢失」取证）

- [x] 24.1 **live 窗口分支泄漏**：fork 跳转 / `thread/started` 新建的分支行没有 `parentThreadId`，而 pi list 刷新可能整局不跑（`includeEngineDiskLists` gate）→ 分支泄漏成顶层行直到重启（23.3 的 backfill 要等下轮刷新才生效）。修复：`piSessionStore` 新增进程内存级派生登记（① fork 成功即 `markPiDerivedThread`；② 树投影加载时登记全部 lane>0 的 laneSessionIds，lane 0 主线不登记），`useThreadRows` pi 过滤并列查询该集合。vitest 回归 ×2（live 窗口无 parent 也隐藏 / 权威 parent 路径 main 可见）
- [x] 24.2 **「main 丢失」取证结论（无代码改动）**：用真实数据全层验证——index 行（parent/cwd/workspace 正确、未 tombstone）✓；live list cwd 匹配 ✓；真实数据跑 `sessionIndexRowsToThreadSummaries` + `mergePiSessionSummaries` + 派生过滤纯管线，三个疑似丢失 main 全部 `visible=true` ✓；折叠数学不成立（比它新的 root 仅 7 条，阈值 12）✓；Shared / archive / catalog `hiddenAutomaticSessionIds` 均无这些 id 的记录 ✓。结论：非过滤逻辑误杀，最可能为当时 app 会话的 index 快照时序 + first-paint 不跑 pi disk list 的暂态；如复现需加诊断日志再查
- [x] 24.3 **分叉曲线丢失误画「裸偏移列」**：lane-start 的直接父条目是被过滤的元数据条目（`model_change` / `thinking_level_change`）时，`forkLinks` 按 parentId 查不到可见行 → 整条 S 曲线被丢弃，分支画成无连接线的平行列（用户目击「两种线性树画法」）。修复：沿未过滤父子链向上找最近可见祖先作为曲线起点（64 步环保护；同 lane 则跳过不画）。真实数据验证：b1「现在呢」的 parent 链（两级 model_change）正确解析到 lane 0 的 assistant 回复行
- [x] 24.4 **fork 弹窗 i18n + 「Invalid entry ID for forking」正常系提示**：上游语义实证（`agent-session-runtime.js`：entry 不在当前 SessionManager 或非 user 消息即抛错）——用户在他 lane 的消息上分叉时必现。修复：`PiForkDialog` 全量接 i18n（新增 `piSession` locale 命名空间 ×10 语言 + parity 测试，5.5/10.4 的硬编码口径由此开始收敛），该错误映射为行动指引文案「先在会话树 ↪ 跳转到该消息所在分支，再分叉」；气泡 ⑂ 按钮 label 同 key 复用。其余 RPC 错误原样透传
- [x] 24.5 **1000+ 条长会话树「画不出来」根因三连修**（实测 1985 条 / 24MB 会话）：① **serde_json 128 层递归限制**（真凶）：线性会话的树是 ~2000 层深链，pump 解析直接 `recursion limit exceeded` 丢弃 → 请求干等 30s 超时 → 面板永远「加载中」——`unbounded_depth` 特性 + pump 解析点显式放开；② **载荷**：原始响应 24.2MB（50 张粘贴截图 base64 占 18.7MB）——`pi_get_session_tree` 改为返回浅层 `entries`（摊平消灭嵌套深度，Tauri IPC 序列化同样受递归限制）+ 剥图片/截 500 字符预览（实测 24.2MB → 3.7MB）；磁盘解析 derivedLanes/rootEntries 同步截断；③ **前端 DOM**：行高固定 34px 的 DOM 窗口化（>300 行只渲染视口 ±20 行，spacer 撑总高，rAF 节流）+ railCells/forkLinks 的 O(n²·lanes) 全扫改 O(n·lanes) 预计算。测试：flatten 保序/剥图/截断 + 500 层深链解析（默认解析器必败的对照）+ pi-session vitest 全绿。**24.5a 崩溃修正（用户 SIGABRT 报告实证）**：第一版「直接 disable_recursion_limit」在 2MB tokio worker 上递归解析 ~1008 层即爆栈；深层 Value 的递归 drop 跨线程逃逸同样爆栈。终态：pump 按行嵌套深度分流（浅行默认解析器 / 深行 32MB 大栈线程），get_tree 响应在大栈线程内 flatten_deep_tree_response 摊平后才跨线程，浅会话在 get_tree 内就地摊平，语义不变

## 25. 发送模型对账（2026-08-23，resident 模型漂移：选 kimi-coding/k3 实际回 MiniMax-M3）

- [x] 25.1 根因（三缺口叠加）：① resident model 只在 spawn 时经 `--model` 设定，`ensure_rpc` 复用存活进程时忽略传入 model；② `set_model` RPC 已实现但全仓零调用（死代码）；③ `rpc_client_for_commands`（tree/stats/fork/compact）经 `ensure_rpc(None, None)` 裸 spawn——打开会话树即在首次发送前把 resident 钉死到 pi 本地配置 `defaultModel`（本机 MiniMax-M3），之后切 k3 / k3-256k / deepseek-v4-flash 发送全部无效
- [x] 25.2 修复：新 run 启动前 `reconcile_rpc_model` 对账——纯函数 `plan_rpc_model_reconcile` 判定四态（Skip=未显式指定 / Match / Set=`set_model` 纠正 / BareMismatch=裸 id 仅 warn）；`set_model` 成功后刷新缓存 state（fork/switch/new_session 同纪律）；失败回退 print-json（per-send 带 `--model`），不以漂移模型静默作答；steer attach 不中途换模型（warn，下个新 run 修正）；`split_provider_model` 只切首段（openrouter 嵌套斜杠模型 id 安全）
- [x] 25.3 验证：`cargo check --lib` 绿；`cargo test --lib engine::pi` 35 全绿（新增 `split_provider_model_only_first_segment_is_provider` + `model_reconcile_plan_matrix` 六态矩阵）；spec delta 见 `specs/pi-rpc-session-runtime`「Resident 模型 MUST 与发送请求模型对齐」。ADR gate：未命中基石文档更新触发器（非 engine registry / Shared 支持集合 / provider binding / canonical fact schema / context compiler / terminal-ACK contract / recovery exit-abandon），无需回写

## 26. 验收修复 round 8（2026-08-24，compact 链路 review 硬化）

- [x] 26.1 **`compact` 独立长超时**：原走通用 `PI_RPC_REQUEST_TIMEOUT`（30s），而 compaction 是对整段会话文本的 LLM summarization——真正值得压缩的长会话极易超 30s；超时后 pi 侧仍继续跑完，UI 误报 `timed out` 且 late response 被丢弃 → 状态分裂。修复：新增 `PI_RPC_COMPACT_TIMEOUT`（500s，覆盖超大会话 + 慢模型），`compact()` 改走 `request_with_timeout`；spec「response 按 id 关联」场景同步标注例外
- [x] 26.2 **`pi_compact` 补活跃 run 守卫**：pi `session.compact()` 内部第一步是 `abort()`，turn 进行中从 dialog 点压缩会无提示掐断当前流式（fork 早有守卫，compact 漏了）。修复：align 之后 `rpc_has_active_run()` 拦截，与 fork 同纪律；spec 新增「活跃 run 禁止 fork/compact（同会话亦拦截）」场景
- [x] 26.3 **压缩成功零反馈修复**：手动 compact 无 active run，pump 的 `compaction_start/end` 拿不到 turn_id 静默丢弃，`onCompacted` 又是 no-op——成功后 dialog 直接关窗，用户无任何确认。修复：`PiCompactDialog` 成功后原地展示 `tokensBefore → estimatedTokensAfter` 并重拉 stats 三连，取消键变「关闭」，不再静默关窗
- [x] 26.4 **「太短」提示补原因**：pi 默认 `keepRecentTokens = 20000`，短会话整体落在保留窗口内属预期拒绝；中性提示补明「pi 会完整保留最近约 20k tokens」，避免用户误判为故障。错误分类抽为 `compactErrorToNotice` 纯函数
- [x] 26.5 验证：`cargo test --lib pi_rpc` 10 全绿（新增 `compact_command_trims_and_omits_blank_instructions` + `compact_timeout_exceeds_generic_request_budget` 纪律测试）；`PiCompactDialog.test.tsx` 2 全绿（分类映射 / 其它错误保持红色路径）；`tsc --noEmit` 0 错误
