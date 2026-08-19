## 1. OpenSpec

- [x] 1.1 写 proposal / design / spec delta

## 2. 核心策略

- [x] 2.1 `classifySharedProviderRetryError` + 单测
- [x] 2.2 `providerRetryPolicy` 默认值 / clamp / 退避 + 单测
- [x] 2.3 按 `workspace::thread::engine` 的内存 settings store
- [x] 2.4 overlay controller + 倒计时 + 提交入口

## 3. 发送挂钩

- [x] 3.1 Shared `turn/error` / completed / catch 后记入 controller
- [x] 3.2 用户手输新消息结束 series
- [x] 3.3 用户停止 / recovery / 协作运行 / 切会话取消
- [x] 3.4 自动续跑走现有 `onSend`，带 `originKind`，不带图

## 4. UI

- [x] 4.1 幕布一行提示 `SharedProviderRetryHint`
- [x] 4.2 协作旁 `SharedProviderRetryToggle`
- [x] 4.3 自动续跑用户气泡小标记
- [x] 4.4 全量 `sharedSend` i18n 键

## 5. 验证

- [x] 5.1 focused vitest：classifier / policy / store / controller / hint / locale
