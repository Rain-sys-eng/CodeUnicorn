## 1. Contract

- [x] 1.1 放宽 `parseAgentTaskNotification`：无 `<result>` 仍解析 header；空 envelope 仍 null；起点守卫不变
- [x] 1.2 新增 `isBackgroundStyleAgentTaskNotification`（及命令名提取）；SubAgent 优先为 false
- [x] 1.3 补 contract 单测：截图同款无 result、entity-escaped 无 result、散文误伤、空 envelope、Background / SubAgent 互斥

## 2. Presentation 分流

- [x] 2.1 `buildMessageRowPresentation`：Background 折叠 flag；`displayText=""`；subtype 与旧卡互斥
- [x] 2.2 `MessageRow`：Background 渲染折叠条，不加蓝气泡 / 旧卡；`role=user` 左对齐
- [x] 2.3 确认 Timeline SubAgent 退役与 `data-agent-task-*` 锚点不受伤

## 3. 折叠 UI

- [x] 3.1 抽出 Background 折叠组件：默认收起，复用 process-phase chip 语言
- [x] 3.2 展开区只展示一份详情：有 snapshot 走 inspector，否则走 kv；去掉 raw XML 叠层
- [x] 3.3 补 zh/en i18n 与最小 CSS（含 `.message-agent-task-fold`）

## 4. 回归

- [x] 4.1 更新 `Messages.rich-content.test.tsx`：Background 走折叠；非 Background 有 result 仍旧卡；scroll 锚点仍可用
- [x] 4.2 补 user-role 无 result 回执：无蓝气泡、无裸 XML
- [x] 4.3 跑 focused vitest + 本 change `openspec validate --strict`
- [x] 4.4 更新 `openspec/changes/README.md` active 行

## 5. History / live 去重

- [x] 5.1 CLI 注入的 task-notification user 不再作为 shadow last-user / live 等价搜索边界
- [x] 5.2 追加 `claude-shadow-recovered-*` 前扫描已有等价 assistant，命中则 skip / merge
- [x] 5.3 补 `[assistant, wakeup fold] + shadow` 与 assembler live complete 单测；中断恢复旧用例仍追加
