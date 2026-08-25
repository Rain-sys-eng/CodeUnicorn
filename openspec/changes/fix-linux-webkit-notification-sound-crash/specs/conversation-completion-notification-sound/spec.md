## ADDED Requirements

### Requirement: Linux WebKitGTK MUST NOT Use HTMLMediaElement For Notification Sounds

Linux native Tauri（WebKitGTK）MUST NOT construct or play `HTMLAudioElement` / `HTMLMediaElement` for notification sounds. Missing GStreamer plugins abort `WebKitWebProcess` instead of surfacing a recoverable media error. macOS, Windows, and Linux web-service runtimes MUST keep the existing HTMLAudio playback path.

#### Scenario: Linux native skips HTMLAudioElement

- **WHEN** notification sound playback is requested on Linux native Tauri (`detectRendererPlatform() === "linux"` and not web-service)
- **THEN** the system MUST NOT construct `HTMLAudioElement`
- **AND** the WebView page process MUST remain usable after a completed turn
- **AND** audible playback MAY be skipped until a native audio path exists

#### Scenario: macOS and Windows keep HTMLAudioElement

- **WHEN** notification sound playback is requested on macOS or Windows
- **THEN** the system MUST use the existing `HTMLAudioElement` playback path

#### Scenario: Linux web-service runtime keeps HTMLAudioElement

- **WHEN** Linux is detected but the runtime is web-service (`window.__MOSSX_WEB_SERVICE__ === true`)
- **THEN** the system MUST use the existing `HTMLAudioElement` playback path
