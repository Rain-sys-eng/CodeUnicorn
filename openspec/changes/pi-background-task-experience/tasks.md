# pi-background-task-experience · tasks

## 0. Spike（实施前）

- [ ] 0.1 [P0] customType 透出验证：RPC resident 触发短 bg_run，dump 事件流，确认 host 端是否可见 `customType: 'background-task-notification'`；结论回写 design.md §3。
- [ ] 0.2 [P0] 历史重载形态验证：pi: jsonl 中 notification 的持久化形态与折叠态重建可行性。
- [ ] 0.3 [P1] registry 目录语义确认：`session-<pid>-<pid>` 两段含义 + resume 场景可读性。

## 1. P1 · A1 任务卡 + A2 通知消费

- [ ] 1.1 [P0] pi.rs 事件转换：bg 工具名单常量表（`bg_run` / `bg_delegate` / `bg_run_pi_attested` / `fusion_*`）+ receipt 解析 → canonical `backgroundTask` item；解析失败降级普通工具卡；单测。
- [ ] 1.2 [P0] `agentTaskNotification.ts`：识别 `<background-task-notification>`（正则边界硬化，延续 0.3.12 口径）+ `taskId` 字段 + `isCliInjectedAgentTaskNotificationText` 覆盖；单测。
- [ ] 1.3 [P0] 前端 `BackgroundTaskCard`：运行中活体（elapsed/tail/心跳占位，B 未上线时为通知驱动）、终态原地折叠为 `message-agent-task-fold` 行、chevron 重展开；组件测试。
- [ ] 1.4 [P0] 通知消费接线：按 taskId 驱动折叠 + 终态摘要；通知不渲染为 bubble、不作 turn 边界用户提问；followUp turn 正常接续。
- [ ] 1.5 [P1] 历史重载：任务卡折叠态回放。

## 2. P2 · B registry watch 健康信号

- [ ] 2.1 [P0] Rust watcher：watch `.pi/tasks/session-<pid>/` metadata + 进程存活探测，状态变更封装 canonical event 推前端；pid 不匹配时降级。
- [ ] 2.2 [P0] 断链判定：metadata 停更 + 进程退出 + 通知未到达 → 「异常终止」；组件联动。
- [ ] 2.3 [P1] 输出日志 tail 按需读取（byte budget 对齐 tool-output 口径）。

## 3. P3 · A3+C 工具条 pill

- [ ] 3.1 [P0] `ComposerRunStatusStrip` 数据源扩展：会话级 backgroundTask 状态表 → 「后台任务」pill（live dot / 计数 / 全部完成态）；无任务不占位。
- [ ] 3.2 [P0] pill 就地展开 panel：任务分组列表 + 日志查看；顶栏入口与任务卡「查看日志」聚焦联动。
- [ ] 3.3 [P1] Render Perf 自查：elapsed/tail 组件本地 state、pill 事件驱动、无根链高频 setState（对照 `docs/perf/pr-1092-performance-retrospective.md` 红线）。

## 4. 文档与校准

- [ ] 4.1 [P0] 基石设计 `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 校准表：pi engine 事件契约新增 backgroundTask item kind 行（ADR 校准回写 Gate）。
- [ ] 4.2 [P1] i18n：后台任务 pill / 卡片 / panel 文案（en + zh + 其余 locale 走既有补全流程）。
- [ ] 4.3 [P1] OpenSpec validate。

## 5. 验证

- [ ] 5.1 [P0] focused vitest（解析器 / 转换 / 组件状态机）。
- [ ] 5.2 [P0] 手测：真机 pi 会话长命令全链路（运行→pill→折叠→接续）+ 杀进程断链（P2 后）。
- [ ] 5.3 [P1] 设计稿对照：`docs/designs/pi-background-tasks/index.html` 视觉走查。

## 非目标（不在本 change）

- 任务取消能力（二期拍板后单开 change）。
- D 提示词层降 bg_run 倾向（随时可做，不阻塞）。
