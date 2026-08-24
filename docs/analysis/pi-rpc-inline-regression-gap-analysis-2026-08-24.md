# PI 发送改 RPC 内联——回归漏点全景分析与对照清单

> 日期:2026-08-24
> 性质:分析文档(不改代码)。用于「他人修复完成后逐条对照验收」的基线。
> 分析方法:5 路并行精读(Rust 运行时 / pi_history+命令层 / pi-session 前端 /
> 发送链+乐观 UI / capability+OpenSpec)+ upstream `pi@0.84.2 docs/rpc.md`
> 契约逐条比对 + 关键发现人工代码复核。

## 一、变更与已修基线

变更主体:`c4b4fba57 feat(pi): 接入 RPC 长驻会话并落地分叉/会话树/融合/压缩原生能力`
——PI 引擎从 spawn-per-turn(`pi --print --mode json`)迁移到 `pi --mode rpc`
长驻进程主路径,spawn/handshake 失败自动回退 print-json。

**已修复(不再重复报告)**:

| commit | 内容 |
|---|---|
| acf122187 | 侧栏标题剥离附件包装不再泄漏 `<file name="...">` 原始 tag |
| d38dc9850 | 中文路径附件切片 panic 导致会话永远打不开 |
| 718bac22e | 首刷后后台补 pi 盘扫让独立 main 全部可达 |
| f0c8d8866 | 侧栏 index 分页排除 pi fork 派生行以免挤占 main 槽位 |
| 3f8946709 | 防护 fork 静默 no-op 误藏主线并让派生隐藏可自愈 |
| c66e67970 | 硬化 compact 链路——500s 独立超时、活跃 run 守卫、成功原地反馈 |
| 4c56cefe3 | 长会话会话树画不出来(递归限制+爆栈)并全链路瘦身 |
| 57431ccca | fork 弹窗接 i18n 并将不可分叉报错映射为行动指引 |
| c6c14ae13 | 分叉父条目被过滤时会话树丢失连接曲线 |
| f46e46829 | 发送前对账 resident 模型修复选型漂移不生效 |
| e459f5ba5 | 侧栏 live 窗口内 fork 分支泄漏为顶层行 |
| 0d8f2426c | 回合结束终稿正文丢失的 terminal 提交竞态 |
| ac51d44f9 | 已完成回合被进程退出码误判失败引发的 shared 续跑死循环 |
| 7f91b7389 | pi turn 结算改看门狗对账修复长任务误杀(分析期间提交) |
| 0fdcdb27c | 防止带图提问 hydrate 后用户气泡接到助手尾巴(分析期间提交) |
| cfad29b82 | 从 RPC image block 还原历史用户附图(分析期间提交) |

## 二、剩余漏点清单(对照验收用)

每条带稳定 ID。置信度:**已核实** = 分析者逐行复核过代码链;
**待验证** = 代码链成立但需手测/实测定性;**单源** = 单子代理发现未复核。

### P0 级

---

#### G1. 失败 turn 的 TurnError 双发(终态纪律破洞)【已核实】

**证据链**:
- `src-tauri/src/engine/pi.rs:318-331` — `settle_rpc_run` 对每个 waiter 先 emit
  `TurnError` 再 `waiter.send(Err)`
- `src-tauri/src/engine/pi.rs:1085` — 看门狗 `Ok(Ok(Err(error)))` 臂返回
  `PiRpcSendError::Failed(error)`
- `src-tauri/src/engine/pi.rs:1459-1461` — `send_message` Failed 臂**再次**
  `emit_error`

**后果**:每一条以错误结算的 RPC turn(agent_settled 带错 / resident 退出 /
流错误)TurnError 发两次。前端是否去重取决于 `useThreadTurnEvents.ts` 的
`matchesActiveTurn` 判定(`markTerminalSettlement` 后 `activeTurnId===null`
时仍放行,见 `useThreadTurnEvents.ts:817-824`)。已修的 0d8f2426c / ac51d44f9
均属此象限,该类竞态有实害前科。

**建议修法**:看门狗收到 waiter 传来的 Err 一律按 `Settled` 臂返回(终态已随
run 结算发出,禁止重发),与 timeout 臂同纪律。

**验收口径**:构造一条失败 turn(如断网后发送),前端只出现一张错误卡片;
日志中同一 turn_id 的 TurnError 只出现一次。

---

#### G2. 远程/daemon 模式:5 个 pi_* 命令全部 `unknown method`【已核实】

**证据**:
- `src-tauri/src/engine/commands.rs:4860/4888/4956/5026/5104` — 五个命令都有
  `remote_backend::call_remote` 转发臂
- `src-tauri/src/bin/cc_gui_daemon.rs:2724` — catch-all 直接
  `unknown method: {method}`,无任何 `pi_get_session_tree / pi_fork /
  pi_compact / pi_get_session_stats / pi_get_fork_messages` 分支
  (对比 `list_qoder_sessions` 有注册,daemon.rs:2283)
- commit message 声称的「daemon engine_bridge 影子同步」实际只是 `#[path]`
  编译依赖同步(engine_bridge.rs +2 行)

**后果**:远程(daemon)模式下会话树 / 分叉 / 压缩 / 统计 / fork 消息面板全灭。
属新能力在远程面的缺失而非行为回归;远程若在支持面内则为 P0,否则降 P1。

**建议修法**:daemon `handle_rpc_request` 补 5 个分支 + daemon_state 对应方法;
同步修正 OpenSpec tasks 3.5 的事实差距。

**验收口径**:daemon 模式下五个命令均可调用且返回正确数据。

---

#### G3. 广播 lag 丢 TextDelta → 终稿正文缺块【已核实】

**证据链**(两条路径复合):
- `src-tauri/src/engine/pi.rs:844` — projection 消费每个事件都要拿 `rpc_run` **写锁**
- `src-tauri/src/engine/pi.rs:1028-1071` — steer/prompt 注册段**持写锁跨整个
  RPC 往返**(`client.steer().await` 最长 30s)
- `src-tauri/src/engine/pi_rpc.rs:131` — broadcast 容量 1024
- `src-tauri/src/engine/pi.rs:799-801` — projection 侧 `Lagged → continue`,
  delta 永久丢失
- `src-tauri/src/engine/commands.rs:3045-3052` — forwarder 同款 lag 丢弃

锁等待期间 pump 持续投喂,溢出即丢。`run.response_text` 与 forwarder 的
`accumulated_agent_text` 都会有洞;`agent_settled` 丢了有 `settle_stale`
自愈,**正文缺块没有任何修复通道**(upstream 提供 `get_last_assistant_text`,
未使用)。0d8f2426c 修的是提交竞态,这个洞还在。

**建议修法**:① 缩短临界区——不要持 `rpc_run` 写锁 await RPC(先注册后写或
缩小锁范围);② settle 前用 `get_last_assistant_text` 对账修复;③ broadcast
扩容作兜底。

**验收口径**:长会话高 token 速率流式 + 中途 steer 附加,终稿正文完整无缺块。

---

### P1 级

#### G4. align 全量扫盘【已核实】
`resolve_pi_session_file_by_id`(`pi_history.rs:784-791` → `736-778`)在
sessions root 下**打开每个 jsonl 读首行**;更快的 `locate_pi_session_file`
(encoded-cwd 直达,`pi_history.rs:382`)未被 RPC 路径复用。每次切会话 / 发送 /
tree/stats/fork/compact 命令 align 到不同会话时触发。会话多了之后切会话卡顿。
**修法**:先 locate(cwd 目录),miss 再全量;或加 id→file 缓存。
**验收**:数百会话规模下切会话/发送无明显卡顿。

#### G5. fallback 与 resident 双写同一 session 文件【已核实】
`reconcile_rpc_model` 失败 → Fallback → print-json 进程写 session 文件时
resident 仍活着绑同一文件;并发拒绝守卫只查 `active_processes` 不查 resident
(`pi.rs:1472-1478`)。
**修法**:fallback 前 kill resident,或守卫加 resident 检查。

#### G6. RPC 路径 `@file` 引用不展开【待验证】
`extract_at_file_references` 只服务 `build_command`(print-json,
`pi.rs:1414`);RPC prompt 原样发送文本(`pi.rs:1045`)。upstream 文档明确
print 模式不展开 inline `@path`(TUI-editor-only),RPC prompt 未提及。
**实测口径**:RPC 模式下发送 `@某文件 总结一下`,看 pi 是否注入文件内容。
若不展开 → P1 功能回归;修法:RPC 路径复用提取逻辑。

#### G7. 能力准入静态 vs RPC 可用性动态【已核实代码链,队列行为待验证】
RPC spawn 失败(`rpc_disabled` 翻转)降级 print-json 后,前端
`input.mid-turn=supported` 照放 fusion/steer(`useQueuedSend.ts:845-846`);
Rust fallback 拒绝并发(`pi.rs:1472-1478`,「message stays queued」只是注释
承诺,前端队列是否真留待验证)。
**修法**:暴露 rpc 可用性为运行时 capability,fallback 时前端降级入口。

#### G8. fork/compact 与 send 无互斥(TOCTOU)【已核实】
`pi_fork`(`commands.rs:4989`)/`pi_compact`(`commands.rs:4921`)的
`rpc_has_active_run` 检查与 `try_send_message_rpc` 的 run 注册
(`pi.rs:1028`)之间无锁,检查-操作可交错穿过守卫。
**修法**:per-session 命令互斥锁,或检查+操作放进同一临界区。

#### G9. fork 后 switch-back 失败 → tracked id 写成 forked id【已核实,有自愈】
`commands.rs:5011-5016`:switch back 失败仅 warn,`rpc_resync_session_id`
把 tracked id 写成 forked id。发送/命令路径的 align 会自愈(params.session_id
≠ current → switch 回旧文件),但 switch 失败本身意味着 resident 状态异常,
align 的 switch 可能同样失败。
**修法**:switch back 失败时 tracked id 回写 pre_state 旧 id,并显式报错。

#### G10. 前端入口无运行中禁用【单源,已抽查成立】
`PiCompactDialog.tsx:183` / `PiForkDialog.tsx:179` 只靠后端守卫拒绝,
UX 是「报错」而非「禁用」;入口未按 isProcessing disable。
**修法**:入口按 isProcessing disable + 提示文案。

#### G11. piSessionStore 只增不减【单源,已抽查成立】
`piSessionStore.ts` 的 `treeByKey` / `derivedThreadIds` 无清理机制,
长期使用内存单调上涨。
**修法**:thread/workspace 切换清理或 LRU 上限。

#### G12. optimistic 收敛全局 1:1 限制【单源,待验证】
`threadReducerOptimisticUserReconciliation.ts:75-76` 要求
`unmatchedOptimisticUsers.length === 1 && incomingNewUsers.length === 1`;
快速连发两条 steer 时第二条无法进 tail replacement,留死气泡
(0fdcdb27c 修复的残留边界)。
**修法**:放宽为「最后一个 unmatched × 最后一个 incoming」配对。

#### G13. RPC-era 大图 data URL 直进 timeline【已核实】
`cfad29b82` 把 base64 原样塞 `images[]`(`pi_history.rs`
`extract_image_content_display_refs`),`piHistoryParser.ts` 原样透传;
长会话多图重开有渲染内存峰值。
**修法**:超阈值落缓存文件/缩略图,点击按需加载。

### P2 级(边界与欠账)

| ID | 漏点 | 证据 | 置信度 |
|---|---|---|---|
| G14 | manual compact 无幕布指示:compaction_start/end 需挂 run turn_id(`pi.rs:818-842`),无 run 时 canonical `thread/compacting` 事件丢弃 | pi.rs:818-842 | 已核实 |
| G15 | prompt 在飞窗口的 interrupt 空跑:rpc_run 未登记时 interrupt 不 abort,prompt 随后照样启动 run(窗口通常 ms 级,resident 卡住可达 30s) | pi.rs:1828-1848 | 已核实 |
| G16 | `encode_images_for_rpc` 无大小上限:整文件读内存 + base64;print-json 时代走 argv 无此问题 | pi.rs:353-385 | 已核实 |
| G17 | `PiSession::drop` `try_write` 失败 → resident 孤儿进程 | pi.rs:1923-1932 | 已核实 |
| G18 | pi_fork 用 30s 通用超时,与 compact 500s 独立预算不对等(深会话 fork 复制大文件可能超时) | pi_rpc.rs:34 | 已核实 |
| G19 | 读命令误 spawn 无模型 resident:树/fork 消息面板首开拉起 resident(model=None 钉默认模型),后续靠 reconcile 修正,多一次 set_model 往返;且 `rpc_client_for_commands` 重置 `rpc_disabled`,RPC 坏了时打开面板反复重试 spawn | pi.rs:1176-1179 | 已核实 |
| G20 | fork 后 session_index 不即时刷新,新分支要等 8s freshness 窗口才进侧栏 | commands.rs:4994-5022 × session_index/commands.rs:308-366 | 单源 |
| G21 | i18n 欠账:PiCompactDialog / PiSessionTreePanel / PiBranchChip / PiThreadBranchBadge 大量硬编码中文(57431ccca 只修了 fork 弹窗;tasks.md 5.5 未勾) | pi-session/components/* | 已核实 |
| G22 | capability hygiene:`session.switch=unknown` 但 align 大量用 switch_session;`projectEngineFeaturesToCapabilityStates` 对 RPC-era 键硬编 unknown(只影响诊断展示) | matrix.json × engineCapabilityMatrix.ts:57-62 | 已核实 |
| G23 | OpenSpec 收尾:`enhance-pi-native-rpc-session` 未归档;ADR 校准回写 gate 要求基石文档校准行覆盖后续 ~16 个 fix 提交;tasks.md 3.5 声称 daemon 同步(实际只是编译同步) | openspec/changes/ × docs/research/mossx-multi-cli-provider-session-foundation-design.md | 已核实 |
| G24 | 看门狗 vs auto-retry 静默窗:`auto_retry_start` 后 `delayMs` 退避期 resident 无事件,900s 预算通常够;供应商级长 backoff(配额类)场景待实测 | upstream rpc.md auto_retry 节 × pi.rs:1138-1143 | 待验证 |
| G25 | centerMode≠chat(打开文件)时 `piTreeOpen` 仍强制 composer 进隐藏 chat 列,composer 可能整屏消失 | DesktopLayout.tsx:192-212 | 待验证 |

## 三、复核后降级/排除的原始发现(避免修复者重复劳动)

| 原始发现 | 结论 | 理由 |
|---|---|---|
| DesktopLayout inert effect 缺 piTreeOpen 依赖(P0) | **误报** | `centerMode === mode` 先命中(DesktopLayout.tsx:235-236),pi tree 在 chat layer 内,不会 inert;派生出真问题 G25 |
| steer attach 竞态(agent_settled 在检查与锁之间到达) | **降级待验证** | 后端自愈:agent_settled 后 pi 空闲,prompt 语义正确;但前端 fusion 状态机按 same-run 分类等待的信号可能不来,队列停顿风险待手测 |
| piRealtimeAdapter 缺 agentMessageSnapshotMode | **误报** | pi 流是 delta 制(TextDelta),不发 snapshot 式 item/updated |
| read_session_summary 的 message_count 不计 toolResult | **待确认语义** | 侧栏消息数可能本就只数对话轮次,非缺陷 |
| piSessionRpc 无 AbortController/超时 | **降级 P2** | store 按 key 写入 + loadingByKey 防重入,React 18 卸载 setState 无害;真实风险已被 G11 覆盖 |
| load_pi_session 未处理 compaction 摘要行 | **待确认** | jsonl 为 append-only,压缩后历史仍在;需确认 pi 是否写入特殊 entry type 影响解析 |
| extract_image_content_display_refs 未处理 OpenAI image_url 内联对象 | **待确认** | pi 自产格式为 `{type:"image",data,mimeType}`,OpenAI 格式是否出现待实测 |

## 四、upstream 契约备忘(pi@0.84.2 docs/rpc.md,比对结论)

- `response.success==true` 仅受理,turn 终态只有 `agent_settled` —— mossx 已遵守。
- streaming 中 `prompt` 必须带 `streamingBehavior`;mossx 用独立 `steer` 命令,合规。
- `steer` 不允许 extension 命令(如 `/xxx`):用户在 streaming 时输入斜杠命令会
  被 pi 拒绝,与空闲时行为不一致 —— 已知边界,未修。
- `set_steering_mode` 默认 `one-at-a-time`;mossx 未调整,多条 steer 按子轮次
  逐条投递,语义兼容。
- `compaction_end` 带 `willRetry:true`(overflow 时)会自动重试 prompt ——
  mossx 看门狗 900s 静默预算覆盖。
- `get_last_assistant_text` / `get_entries(since 游标)` 可用作正文修复通道,
  当前未使用(G3 的修法候选)。
- extension_ui_request 一律 auto-cancel 符合 headless 边界(v1 决策)。

## 五、对照验收流程(修复完成后用)

1. 逐条核对 G1-G25:在「修复 commit」列登记 commit hash;状态改为 ✅已修 /
   ⏭️不修(注明理由)/ 🔄部分修(注明残留)。
2. P0(G1-G3)必须附验证证据:测试名或手测记录。
3. 待验证项(G6/G7 队列行为/G24/G25)必须先实测定性再决定修不修。
4. 全部 P0/P1 清零后,执行 G23 的 OpenSpec 收口:补 ADR 校准行 →
   `openspec validate --strict` → archive。
5. 回归门禁:Rust 测试(pi/pi_rpc/pi_history/events)+ 前端 vitest
   (pi-session / threads hooks)+ `npm run check:app-shell:governance`
   (若动到 shell)。

| ID | 严重度 | 修复 commit | 状态 | 备注 |
|---|---|---|---|---|
| G1 | P0 | 本轮 | ✅已修 | waiter Err → Settled |
| G2 | P0 | 本轮 | ✅已修 | daemon 五个 `pi_*` 分支 |
| G3 | P0 | 本轮 | ✅已修 | 缩短锁 + pump 8192 + get_last_assistant_text |
| G4 | P1 | 本轮 | ✅已修 | locate 快路径先于全量扫盘 |
| G5 | P1 | 本轮 | ✅已修 | fallback 前 drop_resident |
| G6 | P1 | 本轮 | ✅已修 | RPC 展开 `@file` |
| G7 | P1 | | ⏭️不修 | fallback 已拒并发；不做第二套 runtime capability |
| G8 | P1 | 本轮 | ✅已修 | `with_exclusive_rpc_command` |
| G9 | P1 | 本轮 | ✅已修 | switch-back 失败回写并报错 |
| G10 | P1 | 本轮 | ✅已修 | compact 入口 isProcessing disable |
| G11 | P1 | 本轮 | ✅已修 | treeByKey 超 48 修剪异 workspace |
| G12 | P1 | 本轮 | ✅已修 | 末条 optimistic × 末条 incoming |
| G13 | P1 | 本轮 | ✅已修 | >8KiB 落临时文件 |
| G14 | P2 | 本轮 | 🔄部分修 | 无 run 仍 emit 合成 turn_id，幕布 forwarder 未必订阅 |
| G15 | P2 | 本轮 | ✅已修 | in_flight_turn interrupt |
| G16 | P2 | 本轮 | ✅已修 | 单图 10MB 上限 |
| G17 | P2 | 本轮 | ✅已修 | Drop try_read 兜底 kill |
| G18 | P2 | 本轮 | ✅已修 | fork 120s |
| G19 | P2 | 本轮 | ✅已修 | 命令不再重置 rpc_disabled |
| G20 | P2 | | ⏭️不修 | 侧栏仍走 freshness 窗口，非发送回归 |
| G21 | P2 | 本轮 | ✅已修 | compact/tree i18n 10 语言 |
| G22 | P2 | | ⏭️不修 | 内部 switch 未产品化，matrix 保持 unknown |
| G23 | P2 | | ⏭️不修 | change 仍 active，归档另刀 |
| G24 | P2 | | ⏭️不修 | last_event_ms 已覆盖 auto_retry 行 |
| G25 | P2 | 本轮 | ✅已修 | 仅 chat 模式把 composer 放进树列 |

## 六、建议处置顺序(供修复者参考)

1. **先堵终态纪律**:G1 改动最小、与最近三个已修回归同族,优先。
2. **再堵正文完整性**:G3(缩短锁临界区 + settle 对账修复)——「长会话丢字」
   类回归的最后残留通道。
3. **性能与数据安全**:G4(align 快路径)、G5(fallback 双写)、G9(fork 绑定)。
4. **实测裁决待验证项**:G6 / G7 / G24 / G25——各项 5 分钟手测即可定性。
5. **远程面决策**:G2 取决于 daemon 模式是否仍是支持面。
6. 前端体验与欠账(G10-G13 + P2 批)可打包一个 polish PR;G21 i18n 和
   G23 OpenSpec 归档随收口一起做。
