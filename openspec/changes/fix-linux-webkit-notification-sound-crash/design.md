## 背景

通知音唯一播放点是 `src/utils/notificationSounds.ts` 的 `playNotificationAudioUrl`：`new Audio(url).play()`。调用方：

- `useAgentSoundNotifications`（`turn/completed`）
- 设置页测试音（`useUpdaterController`）

Linux native 检测对齐既有百度统计旁路：`detectRendererPlatform() === "linux"` 且 `window.__MOSSX_WEB_SERVICE__ !== true`。web-service 是普通浏览器，HTMLAudio 安全，必须继续播放。

## Native WebView API Gate

- Q1：HTMLAudio 就是会 SIGABRT 的 WebView 路径。P0 的纯 Web 替代是「不调用 HTMLMediaElement」（静音 > 死进程）。不引入新 native audio API。
- Q2：P0 后用户不必改设置自救；回答完成后 WebView 仍可点。
- Q3：验收覆盖 Linux native skip、Linux web-service 仍播放、macOS 仍播放、Windows 仍播放。

## 实现

1. `rendererPlatform.ts` 导出 `isLinuxWebKitGtkHtmlMediaUnsafe(navigatorLike?, webServiceRuntime?)`。参数可注入，测试不依赖 host OS。
2. `playNotificationSoundBySelection` 入口先 skip，避免 Linux 上还去 `convertFileSrc` / 动态 import wav。
3. `playNotificationAudioUrl` 再 skip 一次，挡住未来直接调用。
4. skip 时打 `source: "client"` debug，label 含 `linux webkit skip`，不抛错。

## 非目标

- 不改默认 `notificationSoundsEnabled`
- 不改 macOS / Windows 音量、预加载、error handler
- 不引入 rodio/cpal/GST_PLUGIN_PATH
