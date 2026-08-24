# unify-engine-send-core · design

> 状态：proposal 阶段骨架。脚手架 PR 前必须先完成 §2 的差异审计并回填 §5 裁决表。

## 1. 核心抽象

```text
engine/send_core/
  mod.rs            // send_message / send_message_sync 编排入口
  runtime_access.rs // SendRuntimeAccess trait：两运行面的状态访问注入
  per_engine/       // 每引擎一个 module，迁移时从旧分支平移
```

- **EventSink**：复用 `crate::backend::events::EventSink`。GUI 注入 `TauriEventSink` / `BatchedTauriEventSink`，daemon 注入 `DaemonEventSink`。send core 不感知运行面。
- **SendRuntimeAccess**（新）：抽象两侧对以下能力的访问差异——
  - engine manager / per-engine session 句柄获取
  - session registry 读写（thread binding、session_id 解析）
  - app settings / provider profile 读取
  - workspace 元数据解析
  - 具体形态（trait vs 参数 struct）在脚手架 PR 定稿：优先 trait（daemon 侧无 `State<'_>` 生命周期），若 async trait 生命周期噪声过大再降级为按用例拆分的入参 struct。

## 2. 迁移前置：双侧差异审计（必做）

对每个引擎分支，diff GUI 与 daemon 两份实现，产出三类清单：

1. **同构段**：直接平移进 send core。
2. **有意分叉**：运行面本质差异（如 GUI 独有的 UI 快照节流、daemon 独有的 sink 队列语义）——留在薄壳或经 SendRuntimeAccess 注入。
3. **意外漂移**：语义应同而实际不同——**逐条裁决哪边正确**，记录在 §5，修复方向进对应引擎的迁移 PR。

## 3. 迁移期路由

send core 入口按引擎路由：已迁移引擎走 core，其余 fall through 回调用方旧分支。路由表随迁移 PR 收缩，最后一个引擎迁完后删除路由与两侧旧分支。

## 4. 验收矩阵（每引擎迁移 PR）

- cargo：该引擎相关测试 + `--bin cc_gui_daemon` 双 target 编译零 error
- 前端：该引擎 vitest 合同测试（threads / messages 相关批次）
- 手测：GUI 发消息（流式 / 中断 / 续聊）+ daemon 面同场景
- 行为快照：事件顺序与 payload 与迁移前一致（抽样对拍）

## 5. 分叉裁决表（迁移中回填）

| 引擎 | 分叉点 | GUI 行为 | daemon 行为 | 裁决 | 依据 |
|------|--------|----------|-------------|------|------|
| （待审计回填） | | | | | |
