## Why

[#1125](https://github.com/zhukunpenglinyutong/desktop-cc-gui/issues/1125)：Linux 官方 AppImage 在 AI 回答完成播放通知声音时，`WebKitWebProcess` 以 `SIGABRT` 退出，主窗口还在但网页区域无法点击。

根因是 `playNotificationAudioUrl` 使用 `HTMLAudioElement`。Linux Tauri 走 WebKitGTK，HTML5 audio 依赖 GStreamer `appsink` / `autoaudiosink`。AppImage 通常只打 GStreamer core、不带 plugin；缺 plugin 时 WebKitGTK 2.52 不是 JS `error`，而是空指针 abort。默认 `notificationSoundsEnabled = true`，所以完成一轮就会炸。`try/catch` 救不了页面进程。

## 目标与边界

- **P0（本 change）**：Linux native Tauri / WebKitGTK 禁止构造 `HTMLAudioElement` 播通知音。页面必须在回答完成后仍可点击。
- macOS、Windows、Linux web-service（普通浏览器）保持现有 HTMLAudio 路径，不得改播放语义。
- 本 change **不**做 native 播放（rodio/cpal）、**不**往 AppImage 打 GStreamer 插件。缺音可以，崩进程不行。
- 设置页「测试」按钮走同一播放函数，必须一并被 Linux skip 罩住。

## 方案选择

| 方案 | 结论 |
| --- | --- |
| A. Linux native skip `HTMLAudioElement` | **采用（P0）**。最小、平台隔离、不碰 GStreamer ABI |
| B. AppImage 打 gst plugins | 不采用。依赖树大，且仓库已有 bundled `libwayland-*` ABI 裁剪前科 |
| C. WebAudio / JS decode WAV | P0 不采用。WebKitGTK AudioContext 是否仍走 GStreamer 未证实 |
| D. Native 播放 | **P1 后续**。真正恢复 Linux 出声，不在本 change |

## 影响

- Frontend：`src/utils/notificationSounds.ts`、`src/utils/rendererPlatform.ts` 与 focused tests
- Behavior：Linux native 通知音暂时静音；其他 runtime 不变
- Spec：`conversation-completion-notification-sound` 增加 Linux WebKitGTK crash-safety 约束
