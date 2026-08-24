## 1. Backend: mux 绑定与 Goal 结算

- [x] 1.1 MuxHub 增加 per-session `goal_phase` 与 `awaiting_session_idle`；`goal/change` 更新 snapshot（含 clear tombstone）。验证：`cargo test` 能覆盖 apply/clear。依赖：无。优先级：P0
- [x] 1.2 `dispatch_mux_text`：completed `turn/end` 只 notify waiter，不解绑；cancelled/error 才 unbind。验证：普通 completed 后 binding 仍在。依赖：1.1。优先级：P0
- [x] 1.3 Goal `active` 时抑制 `TurnCompleted`；`paused`/`complete`/clear 补发；`blocked` 发 TurnCompleted 但保持绑定；未见 `goal/change` 则照常结算但不解绑。验证：events.rs 单测覆盖四态。依赖：1.1 1.2。优先级：P0
- [x] 1.4 `user/message` + `source.kind === "goal"` 投影 `EngineEvent::Raw { kind: "dsh-goal-injection" }`；其它 injected kinds 仍不投影。验证：events.rs 单测。依赖：1.1。优先级：P0

## 2. Backend: history 与 sidebar

- [x] 2.1 `is_dsh_injected_user_message` 对 `source.kind === "goal"` 返回 false（保留行）；其它非 user 仍隐藏。验证：history.rs 单测「goal 保留 + plugin 仍跳过」。依赖：无。优先级：P0
- [x] 2.2 `sanitize_dsh_sidebar_title` 把纯 `<goal_round>` / Goal 注入文本视为空 title。验证：history.rs 单测。依赖：2.1。优先级：P1

## 3. Frontend: 折叠卡投影

- [x] 3.1 `ConversationPresentationContext` 增加 `dsh-goal`；`dshRuntimeContext` 提供 `isDshGoalInjection` / `buildDshGoalPresentationMetadata`。验证：dshRuntimeContext 单测。依赖：无。优先级：P0
- [x] 3.2 `dshHistoryParser` 把 goal 行写成 message + presentationMetadata（displayText 空）。验证：history loader 单测。依赖：3.1。优先级：P0
- [x] 3.3 `dshRealtimeAdapter` 把 `dsh-goal-injection` Raw 映射为 `itemStarted` + 同一 metadata。验证：realtimeAdapters 单测。依赖：3.1。优先级：P0
- [x] 3.4 MessageRow / presentation：渲染 `dsh-goal` 折叠卡（克隆 note-card 视觉），空气泡但行可见。验证：组件或 presentation 单测。依赖：3.1。优先级：P0
- [x] 3.5 10 locale 增加「上下文注入」/ 展开收起 key。验证：zh/en 至少有 key，其余 locale 同步。依赖：3.4。优先级：P1

## 4. 验证与 ADR

- [x] 4.1 跑 `cargo test --manifest-path src-tauri/Cargo.toml dsh` 与相关 Vitest（dshRuntimeContext / dshHistoryParser / realtimeAdapters / MessageRow）。依赖：1–3。优先级：P0
- [x] 4.2 归档前回写 `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 最近校准（terminal/ACK，事实源指向本 change）。依赖：4.1。优先级：P1
