## 1. OpenSpec

- [x] 1.1 补齐 proposal / design / spec delta / tasks
  - 验证：`openspec status --change show-live-working-indicator-tokens`

## 2. Live token projection

- [x] 2.1 抽出 `resolveWorkingIndicatorLiveTokenCount`（last 三桶求和 + 过期快照丢弃）
  - 验证：helper 单测覆盖无数 / 有数 / 旧快照 / 缺时间戳
- [x] 2.2 WorkingIndicator 订 canvas `activeTokenUsage`，计时旁渲染 compact tokens
  - 验证：组件测有 usage 显示 `· 5.6K tokens`；无数不占位

## 3. i18n and contracts

- [x] 3.1 全 locale + vitest.setup 增加 `messages.liveTokenUsage`
  - 验证：无 raw key
- [x] 3.2 钉死 Messages 根 selector 不含 `activeTokenUsage`
  - 验证：`conversationCanvasNode` 源码断言 + 现有 canvas selector 测不回归

## 4. Tests

- [x] 4.1 focused vitest：helper + WorkingIndicator
  - 验证：相关测试绿
