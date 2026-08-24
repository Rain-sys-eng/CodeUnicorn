## Why

新用户打开 ccgui 后直接落入完整工作台，没有「至少装通一个 CLI」的路径，也没有身份 / IDE 习惯收集。现有 `StartupGateOverlay` 只挡冷启动，Settings 的 CLI Validation / installer 藏在设置深处。需要一条极简 first-run 设置流，让用户从欢迎页走到能发第一条可用对话。

## 目标与边界

### 目标

- 首次进入主窗口时，在 StartupGate 之后展示全屏 First-run Setup（欢迎 → IDE → CLI 装验 → 完成）。
- 至少 1 个 engine `installed + validation pass` 才算 `ready`；允许 skip，进入主界面后用 soft banner 拉回。
- IDE 习惯写入 `setupProfile.preferredIde`，并在设置里可改；对应外部编辑器时同步 `selectedOpenAppId`。CLI 复用现有 installer / detect / version status。
- 已有工作区、已看过 Release Notes、或已持久化引擎选择的 legacy 用户不得被强制重跑。
- 设置页可重新运行引导。

### 边界

- 不改 `StartupGateOverlay` 关闭规则，不把 wizard 塞进 AppShell domain bag。
- 不复刻完整 Settings / Provider 凭证向导。
- 不做 spotlight tour（Part B 仅 soft banner + 首页空态 CTA）。
- 不新增 Rust command；安装 / 探测走既有 tauri API。

## 非目标

- 不强制 CLI 才能进主界面。
- 不把身份绑定到模型、权限或安全策略。
- 不在本 change 做 Gemini 安装器（detect 可用即可）。
- 不改 mac/Win chrome、不引入新 shell 状态 owner。

## What Changes

| 区域 | 变更 |
|------|------|
| `src/features/onboarding/**` | setup profile、gate、wizard UI、CLI step |
| `src/router.tsx` | 主窗口挂 `FirstRunSetupHost` |
| `src/features/home/components/HomeChat.tsx` | 未完成 CLI 的空态 CTA |
| Settings 基础行为 | 「重新运行新手设置」 |
| `openAppPresets` / icons | 补 JetBrains IDEA |
| i18n | zh / en critical `onboarding` + settings 入口文案 |
| OpenSpec | 本 change + capability delta |

## Capabilities

### New Capabilities

- `first-run-setup`：首次设置向导、完成态、skip / legacy 豁免、soft banner、设置重跑。

### Modified Capabilities

- 无

## 验收标准

1. 全新安装（无 setup profile、无 workspace、无 release-notes last-seen、无 persisted engine）：主窗口展示向导。
2. Welcome → IDE → CLI 验证通过 → 进入应用；profile 落盘为 `ready`。
3. CLI 步点「稍后设置」后进入主界面，首页出现 soft banner，可回到 CLI 步。
4. Legacy 用户不弹向导。
5. 设置 → 重新运行新手设置 可再打开向导。
6. 向导 z-index 低于 StartupGate test overlay；不在 detached 窗口出现。
7. focused vitest 覆盖 profile normalize / gate / wizard 步骤。
8. 未安装引擎不展示 detect 的 `Failed to execute … os error 2`；「未安装」hover / 选中变成卡片内「安装」，卡片外不再放独立安装按钮。

## Impact

| 层 | 影响 |
|----|------|
| Frontend feature | 新 `onboarding` slice |
| Router | 主窗口 overlay |
| Settings / Home | 重跑入口 + banner |
| Client storage | `app.setupProfile` |
| App settings | IDE 选择写 `selectedOpenAppId` |
| OpenSpec | 本 change + capability |
