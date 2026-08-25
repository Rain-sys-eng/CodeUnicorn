## 1. Spec

- [x] 1.1 写 proposal / design / delta spec：Linux WebKitGTK 禁止 HTMLMediaElement 播通知音；其他平台不变。

## 2. Implementation

- [x] 2.1 在 `rendererPlatform.ts` 增加 `isLinuxWebKitGtkHtmlMediaUnsafe`，仅 Linux native 为 true。
- [x] 2.2 `notificationSounds.ts` 在公共入口和 `HTMLAudioElement` 构造前 skip Linux native。
- [x] 2.3 同步 `conversation-completion-notification-sound` main spec。

## 3. Tests

- [x] 3.1 `rendererPlatform.test.ts`：Linux native true；Linux web-service / macOS / Windows false。
- [x] 3.2 `notificationSounds.test.ts`：Linux native 不构造 `Audio`；macOS / Windows / Linux web-service 构造 `Audio`。
- [x] 3.3 跑 focused vitest。
