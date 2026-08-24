## 背景

ccgui 是多引擎桌面客户端。新用户首次打开时缺少产品级 onboarding：CLI 安装/校验藏在 Settings，IDE open-with 与身份偏好没有首次收集入口。参考欢迎页是大留白极简步进流。

`StartupGateOverlay` 是冷启动点击门，默认只在测试 flag 下挂到 router；产品向导必须独立、且不得抢冷启动 first-click。

## 方案

**选定：主窗口全屏 overlay + client-store setup profile**

| Option | Summary | Trade-off |
|--------|---------|-----------|
| A. Router 级 overlay + `app.setupProfile`（采用） | 不进 AppShell bag；复用 installer/detect | 需独立读 settings 写 IDE |
| B. 塞进 AppShell domain | 能直接拿 engine/settings | 违反 AppShell Structure Gate |
| C. 只做 Settings 向导入口 | 改动最小 | 新用户仍会先掉进空工作台 |

### 完成态

```
unset → welcome | ide | cli | done
level: unset | partial | ready
```

- `ready`：至少 1 个 setup 引擎 `installed` 且 version/detect 通过，用户点「进入」。
- `partial`：走过欢迎并显式 skip CLI，或完成 IDE 后稍后进入。
- `complete` 对 UI 等价于用户离开向导（`dismissedAt`）；level 仍区分 ready/partial。

### Legacy 豁免

满足任一即视为已 onboarding，写 `legacyExempted` 并不再展示：

1. `app.releaseNotesLastSeenVersion` 存在
2. sidebar snapshot 有 workspace
3. composer `selectedEngine` 已持久化

设置里「重新运行」会清 `dismissedAt` 并打开向导，但不抹掉 IDE。

### CLI 步

推荐引擎：Claude、Codex；「更多」折叠 Grok / Kimi / OpenCode / DSH / PI。

每引擎：detect + `getCliVersionStatus` → 已装显示绿点和短版本；未装在卡片内显示「未安装」，hover / 选中后变成就地「安装」按钮，点击卡片或按钮走 `useCliInstallLifecycle`（`installLatest`）。验证通过 = `installed === true` 且 version status 无硬错误。detect 返回的 missing-binary（`Failed to execute … os error 2`）不得写入卡片错误；只有 install plan blocked / installer 失败才展示。

Done 摘要与 enter-app 的 `primaryEngine` / composer `selectedEngine` 以用户点选的已装引擎为准。detect 只登记 `validatedEngines`，不得因「第一个已装」覆盖用户选择。

Gemini 无 installer engine id，本 change 不提供一键安装。

### UI

- 全屏居中，max-width ~440px，大留白，单主按钮。
- 底部 step dots；Step 1+ 可返回。
- Esc 不关闭；Enter 触发当前主 CTA。
- 跟随主题 token，主按钮用产品绿（对齐参考图，避免紫渐变 / emoji / 装饰 icon）。
- Logo 用 `assets/icon.png`。

### 门控与冷启动

- 仅 `windowLabel === main`。
- 等 `app` client store ready 后再判定。
- z-index `2147482000`，低于 StartupGate `2147483000`。
- 不在 pointerdown 上做重 IO；CLI detect 在进入 CLI 步或欢迎页空闲后触发。

## 接线

```
AppRouter (main)
  └─ FirstRunSetupHost
        ├─ read/write app.setupProfile
        ├─ detectEngines / getCliVersionStatus / useCliInstallLifecycle
        └─ getAppSettings + updateAppSettings.selectedOpenAppId
HomeChat
  └─ SetupIncompleteBanner (level === partial)
Settings BasicBehavior
  └─ reopenFirstRunSetup()
```

## 风险

- 误伤老用户：三重 legacy 信号 + 单测钉死。
- 向导挡住冷启动：低于 StartupGate，且 store 未就绪时不渲染。
- 安装器失败：展示错误 + 允许 skip，不卡死。
