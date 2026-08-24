# unify-engine-send-core

## Why

`engine_send_message` / `engine_send_message_sync` 在 GUI 与 daemon 两个运行面各有一份近乎完整的复制实现：

- GUI：`src-tauri/src/engine/commands.rs` — `engine_send_message` 约 L1724–3820（~2097 行）、`engine_send_message_sync` 约 L3824–4655（~832 行），Tauri command，事件经 `AppHandle` / `TauriEventSink` 下发。
- Daemon：`src-tauri/src/bin/cc_gui_daemon/daemon_state.rs` — `DaemonState::engine_send_message` 约 L1170–3029（~1860 行）、`_sync` 约 L3032–3592（~561 行），事件经 `DaemonEventSink` 下发。

两份实现的归一化行集合 Jaccard ≈ 0.43（共享 ~299 行、仅 GUI ~267、仅 daemon ~134），且都包含同构的 `EngineType::{Claude,Gemini,Grok,Kimi,OpenCode,Pi,Qoder,…}` 分支、`accumulated_agent_text` 流式聚合与合成 `agentMessage` 逻辑。后果：

1. **修 bug 漏改一边**：任何 per-engine 结算 / 流式 / 中断修复都要人肉双写，历史上两边已出现语义漂移（差异行 ~400 行中相当部分不是有意分叉）。
2. **新引擎接入成本翻倍**：Engine Onboarding 核对矩阵要求逐层勾选，双份 send 让每个引擎的接入点天然 ×2，是矩阵中最大的静默失败面之一。
3. **单函数 ~2k 行**：超出 large-file gate 的 bridge-runtime-critical fail 线，无法在现状上做安全的局部演进。

关键事实：`EventSink` trait（`crate::backend::events::EventSink`）已存在，GUI 侧 `TauriEventSink` / `BatchedTauriEventSink` 与 daemon 侧 `DaemonEventSink` 均为其实现——**分叉不在 sink 抽象缺失，而在编排逻辑本体被复制**。

## What Changes

- 新增 `src-tauri/src/engine/send_core/`（module），承载 send 编排的单一实现：参数归一（engine/model/effort/images/skills/preset…）、per-engine 分支、流式聚合、`agentMessage` 合成、turn 结算与错误路径。
- send core 通过两个注入面与运行面解耦：
  1. `impl EventSink`（复用既有 trait，不新发明）。
  2. `SendRuntimeAccess`（新 trait 或入参 struct）：抽象 GUI `State<AppState>` 与 daemon `DaemonState` 对 session registry / engine manager / settings 的访问差异。
- `engine/commands.rs` 与 `daemon_state.rs` 的对应函数收缩为薄壳：参数接线 + 构造各自 sink / runtime access + 调 send core。
- **逐引擎迁移，一引擎一 PR**：迁移期间未迁移引擎继续走旧路径（core 内按引擎路由回旧分支），保证每步可回归、可回退。
- 迁移完成后删除两侧的复制分支，`engine_send_message` 双侧薄壳目标各 ≤300 行。

## 目标与边界

- **目标**：同一引擎的 send 语义在 GUI 与 daemon 只有一份实现；新引擎接入 send 面只写一次。
- **边界**：只动 send 编排层。per-engine session 壳（`engine/claude.rs` 等）、`*_history.rs` 族、`shared_session_v2`、前端 IPC 合同、事件 payload schema 一律不动。
- **验收基线**：迁移每个引擎前后，该引擎的 cargo 测试 + 前端对应 vitest 合同测试必须全绿；GUI 与 daemon 双 target 编译零 error。

## 非目标

- 不改任何引擎的行为语义（结算时机、事件顺序、错误文案均按现状快照）。
- 不统一 `Result<_, String>` 错误类型（另立 change）。
- 不合并 shared_sessions V1/V2。
- 不重构 `command_registry.rs` 或缩减 command 面。
- 不为 daemon 引入 Tauri 依赖，也不为 GUI 引入 daemon 依赖；send core 必须双 target 可编译。

## Capabilities

### New Capabilities

- `engine-send-core`: send 编排单源合同——per-engine send 语义唯一实现于 send core；GUI / daemon 仅注入 sink 与 runtime access；新引擎 send 接入点唯一。

### Modified Capabilities

- （无既有主 spec 直接改写；迁移期间若发现两侧语义分叉，需逐条判定「哪边是对的」并在 design.md 记录裁决，归档时同步受影响引擎的 runtime capability spec。）

## Impact

| 层 | 影响面 |
|----|--------|
| Backend | 新增 `engine/send_core/`；`engine/commands.rs` L1724–4655 收缩；`bin/cc_gui_daemon/daemon_state.rs` L1170–3592 收缩；`Cargo.toml` bin target 模块可见性调整 |
| Frontend | 无（IPC 合同与事件 payload 不变；回归靠既有 vitest 合同测试） |
| Specs | 新增 `engine-send-core` |
| Gate | 命中 Engine Onboarding Gate（实施前必读基石设计 §3.1「薄 Core，不复制 Feature」、§3.5「统一 AgentEvent」与 onboarding 核对矩阵 §0）；命中 ADR 校准回写 Gate（engine registry / terminal contract 面，归档前回写基石文档「最近校准」） |
| 风险 | 双侧语义分叉的「裁决」是最大风险点：任何分叉都不允许静默取其一，必须在 design.md 留档并在 PR 描述标注 |

## 技术方案对比

| 选项 | 描述 | 取舍 |
|------|------|------|
| A. 维持双份 + diff 守护测试 | 加快照测试锁住两边同构段 | 不解决双写成本；快照噪声大。**否决** |
| B. daemon 复用 GUI 进程（RPC 到 GUI） | 只留一份实现在 GUI | daemon 无头场景不成立；引入进程依赖。**否决** |
| C. 一次性大爆炸合并 | 单 PR 抽 core | ~4k 行行为面一次挪，不可回归。**否决** |
| **D. send core module + EventSink（既有）+ SendRuntimeAccess 注入，逐引擎迁移（推荐）** | 每引擎一 PR，未迁移引擎走旧路径 | 步子小、可回退；代价是迁移期 core 内有临时路由 |

## 实施顺序（对应 tasks.md）

1. 脚手架：`send_core` module + `SendRuntimeAccess` 抽象 + 双 target 编译验证（不迁移任何引擎）。
2. 首引擎选 **Kimi 或 Grok**（分支最小、行为面窄），打通全链路并沉淀迁移模板。
3. 逐个迁移 OpenCode → Gemini → Pi → Qoder → Codex → Claude（复杂度递增，Claude 最后）。
4. 删除两侧遗留分支，收缩薄壳，跑 Engine Onboarding 矩阵核对 + 回写 ADR 校准，verify / sync / archive。
